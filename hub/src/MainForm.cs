// Control Hub — the main window: Overview, Projects, Connections, Panel, Updates, Backup and Help.
// C# 5 / .NET Framework 4.x.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using ControlHubShared;

namespace ControlHub
{
    /// <summary>A plain column of rows (no scrolling) that grows with its content.</summary>
    class Column : Panel
    {
        public Column() { BackColor = T.Win; Height = 0; }
        protected override void OnLayout(LayoutEventArgs e)
        {
            int y = 0;
            foreach (Control c in Controls)
            {
                if (!c.Visible) continue;
                c.Bounds = new Rectangle(0, y, Width, c.Height);
                y += c.Height + T.Px(4);
            }
            int h = Math.Max(0, y - T.Px(4));
            if (Height != h) Height = h;
            base.OnLayout(e);
        }
        protected override void OnResize(EventArgs e) { base.OnResize(e); PerformLayout(); }
        public void Clear()
        {
            while (Controls.Count > 0) { var c = Controls[0]; Controls.RemoveAt(0); c.Dispose(); }
            PerformLayout();
        }
    }

    class MainForm : Form
    {
        readonly Panel nav, content;
        readonly Dictionary<string, Stack> pages = new Dictionary<string, Stack>();
        readonly Dictionary<string, NavItem> navItems = new Dictionary<string, NavItem>();
        readonly System.Windows.Forms.Timer timer;
        Dictionary<string, object> status;
        bool polling;
        string current;

        // Overview
        LampStrip lamps;
        Lamp lService, lPanel, lUpdate, lSpotify, lDiscord;
        Row ovUpdate, ovPanel, ovBackup;
        Pill ovPanelPill;
        FlatButton ovPanelButton;
        // Projects
        Row prPanel;
        Pill prPill;
        FlatButton prStart;
        readonly List<KeyValuePair<Pill, string>> projectPills = new List<KeyValuePair<Pill, string>>();
        // Connections
        readonly Dictionary<string, Pill> connPills = new Dictionary<string, Pill>();
        readonly Dictionary<string, FlatButton> connForget = new Dictionary<string, FlatButton>();
        // Panel
        Toggle autostart;
        bool settingToggles;
        // Updates
        Row upMine, upReady, upBack;
        Label upNotes;
        FlatButton upCheck, upNow, ovUpdateNow;
        Updater.Info updInfo;
        bool updBusy;
        DateTime updChecked = DateTime.MinValue;
        // Backup
        Row bkNow, bkAuto, bkRestore;
        Toggle bkAutoToggle;
        Column layoutList;
        bool backupBusy;
        // Help
        TextBox logBox;

        public MainForm()
        {
            AutoScaleMode = AutoScaleMode.None;   // sizes are already scaled (T.Px)
            Text = HubApp.Name;
            Icon = HubApp.AppIcon(32);
            BackColor = T.Win;
            ForeColor = T.Text;
            Font = T.Body;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(T.Px(1080), T.Px(720));
            MinimumSize = new Size(T.Px(900), T.Px(600));
            DoubleBuffered = true;
            HandleCreated += delegate { DarkTitle.Apply(this); };

            // ---- left: logo and menu
            nav = new Panel { Dock = DockStyle.Left, Width = T.Px(224), BackColor = T.Nav, Padding = new Padding(T.Px(10)) };
            var logo = new PictureBox { Image = HubApp.AppIcon(48).ToBitmap(), SizeMode = PictureBoxSizeMode.Zoom, Size = new Size(T.Px(38), T.Px(38)), Location = new Point(T.Px(18), T.Px(20)), BackColor = Color.Transparent };
            var name = new Label { Text = HubApp.Name, Font = T.Head, ForeColor = T.Text, AutoSize = true, Location = new Point(T.Px(66), T.Px(20)), BackColor = Color.Transparent };
            var ver = new Label { Text = "Version " + Updater.Installed(), Font = T.Small, ForeColor = T.Mute, AutoSize = true, Location = new Point(T.Px(67), T.Px(41)), BackColor = Color.Transparent };
            nav.Controls.Add(logo); nav.Controls.Add(name); nav.Controls.Add(ver);
            int y = T.Px(84);
            foreach (var n in new[] { new[] { Glyph.Home, "Overview" }, new[] { Glyph.Tiles, "Projects" }, new[] { Glyph.Link, "Connections" },
                                      new[] { Glyph.Monitor, "Panel" }, new[] { Glyph.Sync, "Updates" }, new[] { Glyph.History, "Backup" } })
            {
                AddNav(n[0], n[1], y);
                y += T.Px(42);
            }
            var help = AddNav(Glyph.Help, "Help", 0);
            help.Anchor = AnchorStyles.Left | AnchorStyles.Bottom;
            nav.Resize += delegate { help.Top = nav.ClientSize.Height - help.Height - T.Px(12); };

            content = new Panel { Dock = DockStyle.Fill, BackColor = T.Win };
            Controls.Add(content);
            Controls.Add(nav);

            pages["Overview"] = BuildOverview();
            pages["Projects"] = BuildProjects();
            pages["Connections"] = BuildConnections();
            pages["Panel"] = BuildPanel();
            pages["Updates"] = BuildUpdates();
            pages["Backup"] = BuildBackup();
            pages["Help"] = BuildHelp();
            foreach (var p in pages.Values) { p.Dock = DockStyle.Fill; p.Visible = false; content.Controls.Add(p); }
            ShowPage("Overview");

            timer = new System.Windows.Forms.Timer { Interval = 3000 };
            timer.Tick += delegate { Poll(); };
            timer.Start();
            Shown += delegate { help.Top = nav.ClientSize.Height - help.Height - T.Px(12); Poll(); CheckUpdates(true); LoadLayouts(); };
            Activated += delegate { Poll(); };
        }

        NavItem AddNav(string glyph, string text, int y)
        {
            var b = new NavItem(glyph, text) { Location = new Point(T.Px(10), y), Width = T.Px(204) };
            b.Click += delegate { ShowPage(text); };
            nav.Controls.Add(b);
            navItems[text] = b;
            return b;
        }

        void ShowPage(string page)
        {
            current = page;
            foreach (var kv in pages) kv.Value.Visible = kv.Key == page;
            foreach (var kv in navItems) { kv.Value.Selected = kv.Key == page; kv.Value.Invalidate(); }
            if (page == "Help") LoadLog();
            if (page == "Backup") LoadLayouts();
            if (page == "Projects" || page == "Overview") UpdateProjectPills();
        }

        static FlatButton Btn(string text, bool accent, EventHandler click)
        {
            var b = new FlatButton(text, accent);
            if (click != null) b.Click += click;
            return b;
        }

        // ================================================================== Overview

        Stack BuildOverview()
        {
            var s = new Stack();
            s.Heading("Overview", "Everything Control Hub looks after on this PC.");
            lamps = s.Put(new LampStrip());
            lService = lamps.Add("Service");
            lPanel = lamps.Add("Panel");
            lUpdate = lamps.Add("Update");
            lSpotify = lamps.Add("Spotify");
            lDiscord = lamps.Add("Discord");
            lamps.Margin = new Padding(0, 0, 0, T.Px(10));

            ovUpdate = s.Put(new Row(Glyph.Download, "", "") { Highlight = true, Visible = false });
            ovUpdate.Add(Btn("What's new", false, delegate { ShowPage("Updates"); }));
            ovUpdateNow = ovUpdate.Add(Btn("Update", true, delegate { DoUpdate(); }));

            s.Section("Your projects");
            ovPanel = s.Put(new Row(Glyph.Monitor, "Control Panel", "The touch panel on your XENEON EDGE"));
            ovPanelPill = ovPanel.Add(new Pill());
            ovPanelButton = ovPanel.Add(Btn("Restart", false, delegate { ServiceButton(); }));
            AddProjectRows(s, false);

            s.Section("Quick actions");
            ovBackup = s.Put(new Row(Glyph.Save, "Back up everything", "One file with your settings, panel layout, pictures and flight tracks"));
            ovBackup.Add(Btn("Back up now", false, delegate { BackupNow(false); }));
            var restore = s.Put(new Row(Glyph.Undo, "Restore a backup", "Go back to an earlier panel layout or a whole earlier set-up"));
            restore.Add(Btn("Choose…", false, delegate { ShowPage("Backup"); }));
            return s;
        }

        void ServiceButton()
        {
            if (status == null) HubApp.StartService();
            else HubApp.RestartService();
            RefreshSoon();
        }

        // ================================================================== Projects

        Stack BuildProjects()
        {
            var s = new Stack();
            s.Heading("Projects", "What Control Hub looks after, and where it lives on this PC.");
            prPanel = s.Put(new Row(Glyph.Monitor, "Control Panel", ""));
            prPill = prPanel.Add(new Pill());
            prStart = prPanel.Add(Btn("Restart service", false, delegate { ServiceButton(); }));
            prPanel.Add(Btn("Program folder", false, delegate { HubApp.Open(HubApp.Folder); }));
            prPanel.Add(Btn("Settings folder", false, delegate { HubApp.Open(BackupFile.DataFolder); }));
            AddProjectRows(s, true);
            var add = s.Put(new Row(Glyph.Add, "Add a project", "Projects are listed in projects.json in the program folder (see the README on GitHub)"));
            add.Add(Btn("Open projects.json", false, delegate
            {
                string f = Path.Combine(HubApp.Folder, "projects.json");
                if (!File.Exists(f)) File.WriteAllText(f, "{\r\n\t\"projects\": []\r\n}\r\n");
                HubApp.Open(f);
            }));
            return s;
        }

        /// <summary>Other projects from projects.json (one short entry each).</summary>
        void AddProjectRows(Stack s, bool full)
        {
            string file = Path.Combine(HubApp.Folder, "projects.json");
            var list = new List<Dictionary<string, object>>();
            try { if (File.Exists(file)) list = HubApi.List(HubApi.Parse(File.ReadAllText(file, Encoding.UTF8)), "projects"); } catch { }
            foreach (var p in list)
            {
                var proj = p;
                string start = HubApi.Str(proj, "start"), folder = HubApi.Str(proj, "folder"), url = HubApi.Str(proj, "url"), proc = HubApi.Str(proj, "process");
                var row = s.Put(new Row(Glyph.Tiles, HubApi.Str(proj, "name") ?? "Project", HubApi.Str(proj, "description") ?? ""));
                if (!string.IsNullOrEmpty(proc)) projectPills.Add(new KeyValuePair<Pill, string>(row.Add(new Pill()), proc));
                if (!string.IsNullOrEmpty(start)) row.Add(Btn("Start", !full, delegate { HubApp.Open(Environment.ExpandEnvironmentVariables(start)); }));
                if (full && !string.IsNullOrEmpty(proc))
                    row.Add(Btn("Stop", false, delegate
                    {
                        foreach (var x in Process.GetProcessesByName(proc)) { try { x.CloseMainWindow(); if (!x.WaitForExit(3000)) x.Kill(); } catch { } finally { x.Dispose(); } }
                        UpdateProjectPills();
                    }));
                if (full && !string.IsNullOrEmpty(folder)) row.Add(Btn("Folder", false, delegate { HubApp.Open(Environment.ExpandEnvironmentVariables(folder)); }));
                if (full && !string.IsNullOrEmpty(url)) row.Add(Btn("Open page", false, delegate { HubApp.Open(url); }));
            }
        }

        void UpdateProjectPills()
        {
            foreach (var kv in projectPills)
            {
                var ps = Process.GetProcessesByName(kv.Value);
                bool on = ps.Length > 0;
                foreach (var x in ps) x.Dispose();
                kv.Key.Set(on ? "Running" : "Not running", on ? T.Ok : T.Mute);
            }
        }

        // ================================================================== Connections

        static readonly string[][] Connections =
        {
            // key, icon, name, what it's for, connect action, button text, can sign out
            new[] { "spotify", Glyph.Music, "Spotify", "Music on the panel: playlists, like, search, and starting Spotify for you", "connectSpotify", "Connect…", "1" },
            new[] { "discord", Glyph.Chat, "Discord", "Who's talking, mute, deafen, push-to-talk and joining channels", "connectDiscord", "Connect…", "1" },
            new[] { "twitch", Glyph.Video, "Twitch", "Which of the channels you follow are live", "connectTwitch", "Connect…", "1" },
            new[] { "steam", Glyph.People, "Steam", "Only for friends online (your games work without it)", "steamKey", "Add key…", "1" },
            new[] { "sayintentions", Glyph.Mic, "SayIntentions", "Usually found by itself while you fly; add the key only if it isn't", "sayIntentionsKey", "Add key…", "1" },
            new[] { "cs2", Glyph.Game, "Counter-Strike 2", "Score, health, money and the bomb timer (Valve's own, VAC-safe)", "cs2", "Set up", "" },
            new[] { "simconnect", Glyph.Airplane, "MSFS SimConnect", "Flight data from MSFS 2024: pick SimConnect.dll from the MSFS SDK once", "simconnect", "Find SimConnect.dll…", "" },
        };

        Stack BuildConnections()
        {
            var s = new Stack();
            s.Heading("Connections", "Log in once. Logins stay encrypted on this PC, for your Windows user only.");
            foreach (var c in Connections)
            {
                var conn = c;
                var row = s.Put(new Row(conn[1], conn[2], conn[3]));
                connPills[conn[0]] = row.Add(new Pill());
                row.Add(Btn(conn[5], conn[0] != "simconnect" && conn[0] != "cs2", delegate
                {
                    if (!HubApi.Run(conn[4])) { NotRunning(); return; }
                    if (conn[0] == "spotify") Dlg.Info(this, "Connect Spotify", "A small window asks for your Spotify Client ID. It may open behind this one.\n\nNew to this? On the panel, the Spotify tile → How? shows the steps.");
                    RefreshSoon();
                }));
                if (conn[6] == "1")
                {
                    connForget[conn[0]] = row.Add(Btn("Sign out", false, delegate
                    {
                        if (!Dlg.Confirm(this, "Sign out of " + conn[2] + "?", "The " + conn[2] + " login is removed from this PC. You can connect again any time.", "Sign out")) return;
                        var b = new Dictionary<string, object>();
                        b["what"] = "forget";
                        b["service"] = conn[0];
                        if (!HubApi.Do(b)) NotRunning();
                        RefreshSoon();
                    }));
                }
            }
            return s;
        }

        // ================================================================== Panel

        Stack BuildPanel()
        {
            var s = new Stack();
            s.Heading("Panel", "Settings for the panel and things to add to it.");
            var start = s.Put(new Row(Glyph.Power, "Start with Windows", "Control Hub Service starts when you sign in. The panel needs it."));
            autostart = start.Add(new Toggle());
            autostart.Changed += delegate
            {
                if (settingToggles) return;
                if (!HubApi.Run(autostart.On ? "autostartOn" : "autostartOff")) NotRunning();
                RefreshSoon();
            };
            s.Section("Add to the panel");
            AddAction(s, Glyph.Add, "Add a program", "Programs you add show up when you pick what a button opens", "Add…", "addProgram");
            AddAction(s, Glyph.Globe, "Add a website", "Websites and Spotify playlists for buttons", "Add…", "addWebsite");
            AddAction(s, Glyph.Calendar, "Add a calendar link", "For the calendar and day overview tiles", "Add…", "addCalendar");
            var pics = AddAction(s, Glyph.Picture, "Button pictures", "Your own pictures for buttons", "Add…", "addPicture");
            pics.Add(Btn("Open folder", false, delegate { if (!HubApi.Run("openPictures")) NotRunning(); }));
            return s;
        }

        Row AddAction(Stack s, string glyph, string title, string sub, string button, string what)
        {
            var row = s.Put(new Row(glyph, title, sub));
            row.Add(Btn(button, false, delegate { if (!HubApi.Run(what)) NotRunning(); }));
            return row;
        }

        // ================================================================== Updates

        Stack BuildUpdates()
        {
            var s = new Stack();
            s.Heading("Updates", "New versions come from GitHub. Control Hub, the service and the panel are updated together.");
            upMine = s.Put(new Row(Glyph.Sync, "Control Hub " + Updater.Installed(), "Checking…"));
            upCheck = upMine.Add(Btn("Check now", false, delegate { CheckUpdates(false); }));
            upReady = s.Put(new Row(Glyph.Download, "", "What's new:") { Highlight = true, Visible = false });
            upNow = upReady.Add(Btn("Update", true, delegate { DoUpdate(); }));
            upNotes = new Label { Font = T.Body, ForeColor = T.Sub, AutoSize = false, BackColor = Color.Transparent };
            upBack = s.Put(new Row(Glyph.Undo, "Go back to the previous version", "Puts Control Hub and the service back as they were before the last update"));
            upBack.Add(Btn("Go back", false, delegate { GoBack(); }));
            var origin = s.Put(new Row(Glyph.Globe, "Where updates come from", "github.com/" + Updater.Owner + "/" + Updater.Repo));
            origin.Add(Btn("Open on GitHub", false, delegate { HubApp.Open("https://github.com/" + Updater.Owner + "/" + Updater.Repo); }));
            ShowGoBack();
            return s;
        }

        void CheckUpdates(bool quiet)
        {
            if (updBusy) return;
            updBusy = true;
            updChecked = DateTime.Now;
            upCheck.Enabled = false;
            if (!quiet || updInfo == null) upMine.SetText("Control Hub " + Updater.Installed(), "Checking GitHub for a new version…");
            ShowGoBack();
            ThreadPool.QueueUserWorkItem(delegate
            {
                var info = Updater.Check();
                if (IsDisposed) return;
                try { BeginInvoke((MethodInvoker)delegate { updBusy = false; upCheck.Enabled = true; ShowUpdate(info); }); }
                catch { }
            });
        }

        void ShowUpdate(Updater.Info info)
        {
            updInfo = info;
            string mine = Updater.Installed();
            bool ready = info.Error == null && info.Newer;
            if (info.Error != null) upMine.SetText("Control Hub " + mine, "Couldn't check for updates: " + info.Error);
            else if (ready) upMine.SetText("Control Hub " + mine, "A new version is ready");
            else upMine.SetText("Control Hub " + mine, "You have the newest version · checked " + DateTime.Now.ToString("HH:mm"));

            upReady.Visible = ready;
            ovUpdate.Visible = ready;
            if (ready)
            {
                upReady.SetText("Version " + info.Version + " is ready", info.Notes.Count > 0 ? "What's new:" : "");
                var sb = new StringBuilder();
                foreach (var n in info.Notes) sb.Append("•  ").Append(n).Append("\n");
                upNotes.Text = sb.ToString().TrimEnd();
                int w = Math.Max(T.Px(300), upReady.Width - T.Px(90));
                int h = TextRenderer.MeasureText(upNotes.Text, upNotes.Font, new Size(w, 0), TextFormatFlags.WordBreak).Height;
                upReady.SetBody(info.Notes.Count > 0 ? upNotes : null, h + T.Px(4));
                upNow.Text = "Update to " + info.Version;
                ovUpdate.SetText("Version " + info.Version + " is ready", string.Join("  ·  ", info.Notes.ToArray()));
                ovUpdateNow.Text = "Update";
            }
            navItems["Updates"].Badge = ready ? 1 : 0;
            navItems["Updates"].Invalidate();
            if (info.Error != null) lUpdate.Set("Couldn't check", Color.Empty);
            else lUpdate.Set(ready ? info.Version + " ready" : "Up to date", ready ? T.Warn : T.Ok);
            foreach (var p in pages.Values) p.PerformLayout();
        }

        void ShowGoBack()
        {
            bool can = Updater.CanGoBack();
            string prev = Updater.PreviousVersion();
            upBack.Visible = can;
            if (can) upBack.SetText("Go back to the previous version" + (string.IsNullOrEmpty(prev) ? "" : " (" + prev + ")"), "Puts Control Hub and the service back as they were before the last update");
        }

        void DoUpdate()
        {
            if (updInfo == null || !updInfo.Newer || updBusy) return;
            if (!Dlg.Confirm(this, "Update to version " + updInfo.Version + "?",
                "Control Hub closes, and a window builds and installs the new version (about a minute). If anything fails there, nothing is changed.\n\n" +
                "If the new version changes the panel's starter, iCUE asks you to accept the widget at the end.", "Update")) return;
            updBusy = true;
            upNow.Enabled = false; ovUpdateNow.Enabled = false; upCheck.Enabled = false;
            upMine.SetText("Control Hub " + Updater.Installed(), "Downloading the new version…");
            ShowPage("Updates");
            ThreadPool.QueueUserWorkItem(delegate
            {
                string error;
                string folder = Updater.Download(delegate (string msg)
                {
                    try { BeginInvoke((MethodInvoker)delegate { upMine.SetText("Control Hub " + Updater.Installed(), msg); }); } catch { }
                }, out error);
                if (IsDisposed) return;
                try
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        updBusy = false;
                        upNow.Enabled = true; ovUpdateNow.Enabled = true; upCheck.Enabled = true;
                        if (folder == null) { upMine.SetText("Control Hub " + Updater.Installed(), "The update couldn't be downloaded: " + error); return; }
                        if (!Updater.RunInstaller(folder)) { upMine.SetText("Control Hub " + Updater.Installed(), "Couldn't start the installer."); return; }
                        // The installer closes Control Hub anyway; closing now lets it replace this program.
                        Application.Exit();
                    });
                }
                catch { }
            });
        }

        void GoBack()
        {
            string prev = Updater.PreviousVersion();
            if (!Dlg.Confirm(this, "Go back to the previous version" + (string.IsNullOrEmpty(prev) ? "" : " (" + prev + ")") + "?",
                "Control Hub and the service are put back as they were before the last update. Your settings, logins and panel layout are not touched.", "Go back")) return;
            if (Updater.GoBack()) Application.Exit();
            else Dlg.Info(this, "Couldn't go back", "Run \"Restore previous version.bat\" in the program folder.");
        }

        // ================================================================== Backup

        Stack BuildBackup()
        {
            var s = new Stack();
            s.Heading("Backup", "Keep a copy of everything, and put it back after a reinstall, on a new PC, or when something went wrong.");
            s.Section("Everything");
            bkNow = s.Put(new Row(Glyph.Save, "Back up now", "One file with your settings, panel layout, pictures, flight tracks and projects"));
            bkNow.Add(Btn("With logins…", false, delegate { BackupNow(true); }));
            bkNow.Add(Btn("Back up now", true, delegate { BackupNow(false); }));
            bkAuto = s.Put(new Row(Glyph.History, "Automatic backups", ""));
            bkAutoToggle = bkAuto.Add(new Toggle());
            bkAutoToggle.Changed += delegate { SetBackup(bkAutoToggle.On, null); };
            bkAuto.Add(Btn("Change folder…", false, delegate { ChangeBackupFolder(); }));
            bkAuto.Add(Btn("Open folder", false, delegate { string f = BackupFolder(); Directory.CreateDirectory(f); HubApp.Open(f); }));
            bkRestore = s.Put(new Row(Glyph.Undo, "Restore from a backup file", "Puts everything back as it was in the backup. A copy of how things are now is kept."));
            bkRestore.Add(Btn("Choose file…", false, delegate { RestoreFile(); }));
            s.Note("Logins are locked to this Windows user. To bring them to a new PC or a fresh Windows, use \"With logins…\" and pick a password.");

            s.Section("Panel layout only");
            s.Note("The panel saves its layout by itself. Restore one of these to go back to an earlier layout; the rest stays as it is.");
            layoutList = s.Put(new Column());
            return s;
        }

        string BackupFolder()
        {
            var b = HubApi.Obj(status, "backup");
            string f = HubApi.Str(b, "folder");
            return string.IsNullOrEmpty(f) ? BackupFile.DefaultFolder() : f;
        }

        void SetBackup(bool auto, string folder)
        {
            if (settingToggles) return;
            var body = new Dictionary<string, object>();
            body["what"] = "backupSettings";
            body["auto"] = auto;
            if (folder != null) body["folder"] = folder;
            if (!HubApi.Do(body)) NotRunning();
            RefreshSoon();
        }

        void ChangeBackupFolder()
        {
            using (var d = new FolderBrowserDialog { Description = "Where should automatic backups go? A OneDrive folder keeps them safe outside this PC.", SelectedPath = BackupFolder(), ShowNewFolderButton = true })
            {
                if (d.ShowDialog(this) != DialogResult.OK) return;
                SetBackup(bkAutoToggle.On, d.SelectedPath);
            }
        }

        void BackupNow(bool withLogins)
        {
            if (backupBusy) return;
            string password = null;
            if (withLogins)
            {
                password = Dlg.Password(this, "Back up with your logins",
                    "Pick a password for the logins (Spotify, Discord, Twitch). You need it to restore them, also on a new PC. Keep it somewhere safe: it can't be recovered.",
                    true, null, "Back up");
                if (password == null) return;
            }
            backupBusy = true;
            string folder = BackupFolder();
            bkNow.SetText("Back up now", "Making a backup…");
            ovBackup.SetText("Back up everything", "Making a backup…");
            ThreadPool.QueueUserWorkItem(delegate
            {
                string error;
                string file = BackupFile.Create(folder, "manual", password, HubApp.Folder, Updater.Installed(), out error);
                if (IsDisposed) return;
                try
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        backupBusy = false;
                        string sub = file != null ? "Saved " + DateTime.Now.ToString("HH:mm") + ": " + Path.GetFileName(file) : "The backup failed: " + error;
                        bkNow.SetText("Back up now", sub);
                        ovBackup.SetText("Back up everything", sub);
                        if (file != null && Dlg.Ask(this, "Backup saved", "Saved as " + Path.GetFileName(file) + " in\n" + folder + (password != null ? "\n\nYour logins are inside, protected with your password." : ""), "Open folder", "OK") == "Open folder")
                            HubApp.Open(folder);
                    });
                }
                catch { }
            });
        }

        void RestoreFile()
        {
            string path;
            using (var d = new OpenFileDialog { Title = "Choose a Control Hub backup", Filter = "Control Hub backups (*.zip)|*.zip", InitialDirectory = Directory.Exists(BackupFolder()) ? BackupFolder() : "" })
            {
                if (d.ShowDialog(this) != DialogResult.OK) return;
                path = d.FileName;
            }
            string error;
            var info = BackupFile.Read(path, out error);
            if (info == null) { Dlg.Info(this, "Can't use that file", error ?? "It isn't a Control Hub backup."); return; }

            string what = "From " + info.Created.ToString("dddd d MMMM yyyy, HH:mm") + (string.IsNullOrEmpty(info.Machine) ? "" : " on " + info.Machine) +
                (info.Pages > 0 ? "\nPanel: " + info.Pages + " pages, " + info.Tiles + " tiles" : "") +
                "\n\nEverything is put back as it was then. A copy of how things are now is kept in your settings folder, just in case.";
            string password = null;
            if (info.Logins)
            {
                while (true)
                {
                    password = Dlg.Password(this, "Restore the backup", what + "\n\nThis backup has your logins. Type its password to restore them too.", false, "Without logins", "Restore");
                    if (password == null) return;
                    if (password == "" || BackupFile.CheckPassword(path, password)) break;
                    Dlg.Info(this, "Wrong password", "That password doesn't open this backup's logins. Try again, or restore without logins.");
                }
                if (password == "") password = null;
            }
            else
            {
                string extra = info.SamePc ? "" : "\n\nThis backup was made on another PC or Windows user, so you'll need to log in again (Connections).";
                if (!Dlg.Confirm(this, "Restore the backup?", what + extra, "Restore")) return;
            }

            bkRestore.SetText("Restore from a backup file", "Restoring…");
            Cursor = Cursors.WaitCursor;
            HubApp.StopService();
            string keptAs;
            bool ok = BackupFile.Restore(path, password, HubApp.Folder, out error, out keptAs);
            HubApp.StartService();
            Cursor = Cursors.Default;
            if (!ok)
            {
                bkRestore.SetText("Restore from a backup file", "Restoring failed: " + error);
                Dlg.Info(this, "Restoring failed", error + "\n\nYour settings were left as they were.");
                return;
            }
            bkRestore.SetText("Restore from a backup file", "Restored the backup from " + info.Created.ToString("d MMM HH:mm"));
            // The panel picks up the restored layout from the service once it's running again.
            ThreadPool.QueueUserWorkItem(delegate
            {
                bool sent = false;
                for (int i = 0; i < 20 && !sent; i++)
                {
                    Thread.Sleep(1000);
                    if (HubApi.Get("/api/hub/status", 1500) == null) continue;
                    var b = new Dictionary<string, object>();
                    b["what"] = "restore";
                    b["name"] = "live";
                    sent = HubApi.Do(b);
                    if (!sent) break;   // no panel layout in the backup
                }
                if (IsDisposed) return;
                try
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        Dlg.Info(this, "Backup restored", "Your settings are back." + (sent ? " The panel loads the layout from the backup within a few seconds (it has to be on)." : "") +
                            (keptAs != null ? "\n\nThe settings from before are kept in:\n" + keptAs : ""));
                        Poll();
                        LoadLayouts();
                    });
                }
                catch { }
            });
        }

        void LoadLayouts()
        {
            if (layoutList == null) return;
            ThreadPool.QueueUserWorkItem(delegate
            {
                var d = HubApi.Get("/api/backups", 4000);
                if (IsDisposed) return;
                try { BeginInvoke((MethodInvoker)delegate { ShowLayouts(d); }); } catch { }
            });
        }

        void ShowLayouts(Dictionary<string, object> d)
        {
            layoutList.SuspendLayout();
            layoutList.Clear();
            if (d == null) layoutList.Controls.Add(new Row(null, "Start Control Hub Service to see the panel's layout backups", ""));
            else
            {
                var list = HubApi.List(d, "backups");
                if (list.Count == 0) layoutList.Controls.Add(new Row(null, "No layout backups yet", "The panel makes them by itself as you change things"));
                int shown = 0;
                foreach (var b in list)
                {
                    if (shown++ >= 12) break;
                    var bk = b;
                    string name = HubApi.Str(bk, "name") ?? "";
                    if (name == "live.json") continue;
                    var when = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(HubApi.Long(bk, "time")).ToLocalTime();
                    string kind = HubApi.Str(bk, "kind") ?? "";
                    string what = kind == "auto" ? "Automatic" : kind.StartsWith("before") ? "Before a change" : kind == "manual" ? "Saved by you" : kind;
                    var row = new Row(null, when.ToString("dddd d MMMM, HH:mm"), what + "  ·  " + HubApi.Long(bk, "pages") + " pages, " + HubApi.Long(bk, "tiles") + " tiles");
                    row.Height = T.Px(56);
                    row.Add(Btn("Restore", false, delegate
                    {
                        if (!Dlg.Confirm(this, "Restore this layout?", "The panel goes back to its layout from " + when.ToString("dddd d MMMM HH:mm") + ". It keeps a copy of the current layout first, just in case.", "Restore")) return;
                        var body = new Dictionary<string, object>();
                        body["what"] = "restore";
                        body["name"] = name;
                        if (HubApi.Do(body)) Dlg.Info(this, "Sent to the panel", "The panel restores the layout within a few seconds (it has to be on).");
                        else NotRunning();
                    }));
                    layoutList.Controls.Add(row);
                }
            }
            layoutList.ResumeLayout();
            layoutList.PerformLayout();
            pages["Backup"].PerformLayout();
        }

        // ================================================================== Help

        Stack BuildHelp()
        {
            var s = new Stack();
            s.Heading("Help", "Something not working? Copy the details and send them to Claude.");
            var row = s.Put(new Row(Glyph.Copy, "Details for Claude", "Versions, connections and the newest lines of the log"));
            row.Add(Btn("Refresh", false, delegate { LoadLog(); }));
            row.Add(Btn("Open log file", false, delegate { if (!HubApi.Run("openLog")) NotRunning(); }));
            row.Add(Btn("Copy details", true, delegate { CopyDetails(); }));
            logBox = s.Put(new TextBox
            {
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                WordWrap = false,
                BackColor = Color.FromArgb(9, 14, 24),
                ForeColor = Color.FromArgb(190, 205, 230),
                Font = T.Mono,
                BorderStyle = BorderStyle.None,
                Height = T.Px(430),
                Margin = new Padding(0, T.Px(6), 0, 0)
            });
            return s;
        }

        void LoadLog()
        {
            if (logBox == null) return;
            ThreadPool.QueueUserWorkItem(delegate
            {
                var d = HubApi.Get("/api/hub/log", 4000);
                if (IsDisposed) return;
                try
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        if (d == null) { logBox.Text = "Control Hub Service isn't running, so its log can't be read here."; return; }
                        logBox.Text = string.Join("\r\n", HubApi.Strings(d, "lines").ToArray());
                        logBox.SelectionStart = logBox.TextLength;
                        logBox.ScrollToCaret();
                    });
                }
                catch { }
            });
        }

        void CopyDetails()
        {
            var sb = new StringBuilder();
            sb.AppendLine("Control Hub " + HubApp.Version + " (installed " + Updater.Installed() + ") on " + Environment.OSVersion.VersionString);
            if (status != null)
            {
                sb.AppendLine("Service " + HubApi.Str(status, "version") + ", start with Windows: " + HubApi.Bool(status, "autostart") + ", panel seen " + HubApi.Long(status, "panelSeconds") + " s ago, panel " + HubApi.Str(status, "widgetVersion") + (HubApi.Bool(status, "panelFromHub") ? " from Control Hub" : ""));
                var conns = HubApi.Obj(status, "connections");
                if (conns != null) foreach (var kv in conns) sb.AppendLine("  " + kv.Key + ": " + HubApi.Str(kv.Value as Dictionary<string, object>, "text"));
            }
            else sb.AppendLine("Service: not running");
            sb.AppendLine("--- log ---");
            sb.AppendLine(logBox != null ? logBox.Text : "");
            try { Clipboard.SetText(sb.ToString()); Dlg.Info(this, "Copied", "Paste it into the chat with Claude."); }
            catch (Exception ex) { Dlg.Info(this, "Couldn't copy", ex.Message); }
        }

        // ================================================================== status

        void NotRunning()
        {
            Dlg.Info(this, "Control Hub Service isn't running", "Start it first: Overview → Control Panel → Start service.");
        }

        void RefreshSoon()
        {
            var t = new System.Windows.Forms.Timer { Interval = 1200 };
            t.Tick += delegate { t.Stop(); t.Dispose(); Poll(); };
            t.Start();
        }

        void Poll()
        {
            if (polling || !Visible || WindowState == FormWindowState.Minimized) return;
            if ((DateTime.Now - updChecked).TotalMinutes > 60) CheckUpdates(true);
            polling = true;
            ThreadPool.QueueUserWorkItem(delegate
            {
                var d = HubApi.Get("/api/hub/status", 2500);
                if (IsDisposed) return;
                try { BeginInvoke((MethodInvoker)delegate { polling = false; Apply(d); }); }
                catch { polling = false; }
            });
        }

        void Apply(Dictionary<string, object> d)
        {
            status = d;
            bool up = d != null;
            UpdateProjectPills();
            if (!up)
            {
                bool proc = HubApp.ServiceRunning();
                lService.Set(proc ? "Not answering" : "Not running", T.Bad);
                lPanel.Set("Unknown", Color.Empty);
                lSpotify.Set("Unknown", Color.Empty);
                lDiscord.Set("Unknown", Color.Empty);
                ovPanelPill.Set(proc ? "Not answering" : "Service stopped", T.Bad);
                prPill.Set(proc ? "Not answering" : "Service stopped", T.Bad);
                ovPanelButton.Text = "Start service";
                prStart.Text = "Start service";
                prPanel.SetText("Control Panel", "Control Hub Service isn't running, so the panel can't do much right now");
                foreach (var kv in connPills) kv.Value.Set("Unknown", T.Mute);
                foreach (var kv in connForget) kv.Value.Visible = false;
                return;
            }
            ovPanelButton.Text = "Restart";
            prStart.Text = "Restart service";
            lService.Set("Running", T.Ok);
            long secs = HubApi.Long(d, "panelSeconds");
            bool panelOn = secs >= 0 && secs <= 30;
            lPanel.Set(panelOn ? "Connected" : secs < 0 ? "Not seen yet" : "Last seen " + Ago(secs), panelOn ? T.Ok : T.Warn);
            string wv = HubApi.Str(d, "widgetVersion");
            string source = HubApi.Bool(d, "panelFromHub") ? "loaded from Control Hub" : secs < 0 ? "not loaded yet" : "its built-in copy";
            ovPanelPill.Set(panelOn ? "Running" : "Panel off", panelOn ? T.Ok : T.Warn);
            prPill.Set(panelOn ? "Running" : "Panel off", panelOn ? T.Ok : T.Warn);
            ovPanel.SetText("Control Panel", "XENEON EDGE" + (string.IsNullOrEmpty(wv) ? "" : "  ·  Panel " + wv + ", " + source));
            prPanel.SetText("Control Panel", "Service " + HubApi.Str(d, "version") + "  ·  Control Hub " + Updater.Installed() + (string.IsNullOrEmpty(wv) ? "" : "  ·  Panel " + wv + " (" + source + ")"));

            var conns = HubApi.Obj(d, "connections");
            foreach (var kv in connPills)
            {
                if (kv.Key == "simconnect") { kv.Value.Set("Set up once", T.Mute); continue; }
                var c = HubApi.Obj(conns, kv.Key);
                if (c == null) { kv.Value.Set("Unknown", T.Mute); continue; }
                bool on = HubApi.Bool(c, "on"), conf = HubApi.Bool(c, "configured");
                kv.Value.Set(HubApi.Str(c, "text") ?? "", on ? T.Ok : conf ? T.Warn : T.Mute);
                FlatButton f;
                if (connForget.TryGetValue(kv.Key, out f)) f.Visible = on;
            }
            LampFor(lSpotify, HubApi.Obj(conns, "spotify"));
            LampFor(lDiscord, HubApi.Obj(conns, "discord"));

            settingToggles = true;
            autostart.On = HubApi.Bool(d, "autostart");
            var bk = HubApi.Obj(d, "backup");
            if (bk != null)
            {
                bool auto = HubApi.Bool(bk, "auto");
                bkAutoToggle.On = auto;
                long last = HubApi.Long(bk, "last");
                string lastText = last > 0 ? "last " + new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(last).ToLocalTime().ToString("d MMM HH:mm") : "none yet";
                bkAuto.SetText("Automatic backups", auto ? "Every week, the newest " + HubApi.Long(bk, "keep") + " are kept (" + lastText + ")  ·  " + HubApi.Str(bk, "folder") : "Off  ·  turn on to keep a copy every week");
            }
            settingToggles = false;
            foreach (var r in new Control[] { ovPanel, prPanel, bkAuto }) r.Invalidate();
            foreach (var p in pages.Values) p.PerformLayout();
        }

        static void LampFor(Lamp l, Dictionary<string, object> c)
        {
            if (c == null) { l.Set("Unknown", Color.Empty); return; }
            bool on = HubApi.Bool(c, "on"), conf = HubApi.Bool(c, "configured");
            l.Set(on ? "Connected" : conf ? "Log in again" : "Not set up", on ? T.Ok : conf ? T.Warn : Color.Empty);
        }

        static string Ago(long secs)
        {
            if (secs < 120) return secs + " s ago";
            if (secs < 7200) return (secs / 60) + " min ago";
            return (secs / 3600) + " h ago";
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            timer.Stop();
            base.OnFormClosed(e);
        }
    }
}
