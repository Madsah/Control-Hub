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
        // Overview cards (1.11)
        Label greet, greetSub;
        StatusCard dStatus;
        TextCard dUpdate;
        FlatButton dUpdateBtn, dPanelShow, dPlay;
        PanelCard dPanel;
        MusicCard dMusic;
        FlightCard dFlight;
        QuickCard dQuick;
        QuickTile qService;
        List<Dictionary<string, object>> panelPages = new List<Dictionary<string, object>>();
        int panelShown = -1, panelLive = -1;
        DateTime panelBrowsed = DateTime.MinValue, layoutAt = DateTime.MinValue, bookAt = DateTime.MinValue;
        string coverUrl;
        bool spPlaying;
        // Settings (1.11)
        Toggle autostart2;
        AccentPicker accentPick;
        string accentChoice = "panel", panelAccent;
        readonly Dictionary<string, Row> connRows = new Dictionary<string, Row>();
        static readonly System.Globalization.CultureInfo En = new System.Globalization.CultureInfo("en-GB");

        public MainForm()
        {
            AutoScaleMode = AutoScaleMode.None;   // sizes are already scaled (T.Px)
            Text = HubApp.Name;
            Icon = HubApp.AppIcon(32);
            BackColor = T.Win;
            ForeColor = T.Text;
            Font = T.Body;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(T.Px(1180), T.Px(780));
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
            var settingsNav = AddNav(Glyph.Settings, "Settings", 0);
            settingsNav.Anchor = AnchorStyles.Left | AnchorStyles.Bottom;
            nav.Resize += delegate
            {
                help.Top = nav.ClientSize.Height - help.Height - T.Px(12);
                settingsNav.Top = help.Top - settingsNav.Height - T.Px(4);
            };

            content = new Panel { Dock = DockStyle.Fill, BackColor = T.Win };
            Controls.Add(content);
            Controls.Add(nav);

            HubApp.Step("Menu built");
            pages["Overview"] = BuildOverview(); HubApp.Step("Overview built");
            pages["Projects"] = BuildProjects(); HubApp.Step("Projects built");
            pages["Connections"] = BuildConnections(); HubApp.Step("Connections built");
            pages["Panel"] = BuildPanel(); HubApp.Step("Panel built");
            pages["Updates"] = BuildUpdates(); HubApp.Step("Updates built");
            pages["Backup"] = BuildBackup(); HubApp.Step("Backup built");
            pages["Help"] = BuildHelp(); HubApp.Step("Help built");
            pages["Settings"] = BuildSettings(); HubApp.Step("Settings built");
            foreach (var p in pages.Values) { p.Dock = DockStyle.Fill; p.Visible = false; content.Controls.Add(p); }
            ShowPage("Overview");
            HubApp.Step("Pages shown");

            timer = new System.Windows.Forms.Timer { Interval = 3000 };
            timer.Tick += delegate { Poll(); };
            timer.Start();
            Shown += delegate
            {
                HubApp.Started = true;
                HubApp.Step("Window open");
                help.Top = nav.ClientSize.Height - help.Height - T.Px(12);
                settingsNav.Top = help.Top - settingsNav.Height - T.Px(4);
                Poll(); CheckUpdates(true); LoadLayouts(); LoadLogos();
            };
            LoadLook();
            RestoreWindow();
            FormClosing += delegate { SaveWindow(); };
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
            greet = s.Heading(Greeting(), DateTime.Now.ToString("dddd d MMMM", En));
            greetSub = s.Controls[s.Controls.Count - 1] as Label;

            // The older parts (lamps and rows) still keep their state; they're just not shown on the Overview any more.
            lamps = new LampStrip();
            lService = lamps.Add("Service");
            lPanel = lamps.Add("Panel");
            lUpdate = lamps.Add("Update");
            lSpotify = lamps.Add("Spotify");
            lDiscord = lamps.Add("Discord");
            ovUpdate = new Row(Glyph.Download, "", "") { Highlight = true, Visible = false };
            ovUpdateNow = ovUpdate.Add(Btn("Update", true, delegate { DoUpdate(); }));
            ovPanel = new Row(Glyph.Monitor, "Control Panel", "The touch panel on your XENEON EDGE");
            ovPanelPill = ovPanel.Add(new Pill());
            ovPanelButton = ovPanel.Add(Btn("Restart", false, delegate { ServiceButton(); }));
            ovBackup = new Row(Glyph.Save, "Back up everything", "");

            var grid = s.Put(new DashGrid());
            dStatus = grid.Add(new StatusCard(7, 156));
            dUpdate = grid.Add(new TextCard("Updates", 5, 156));
            dUpdate.Set("Checking for updates…", "");
            dUpdateBtn = dUpdate.Add(Btn("Check now", false, delegate
            {
                if (updInfo != null && updInfo.Error == null && updInfo.Newer) DoUpdate();
                else CheckUpdates(false);
            }));
            dUpdate.Add(Btn("What's new", false, delegate { ShowPage("Updates"); }));

            dPanel = grid.Add(new PanelCard(8, 262));
            dPanel.Add(new FlatButton("", false) { IconGlyph = Glyph.Left }).Click += delegate { BrowsePanel(-1); };
            dPanel.Add(new FlatButton("", false) { IconGlyph = Glyph.Right }).Click += delegate { BrowsePanel(1); };
            dPanelShow = dPanel.Add(Btn("Show on panel", true, delegate { ShowOnPanel(); }));
            dPanel.Add(Btn("Layouts", false, delegate { ShowPage("Backup"); }));

            dMusic = grid.Add(new MusicCard(4, 262));
            dMusic.Add(new FlatButton("", false) { IconGlyph = Glyph.Prev }).Click += delegate { Spotify("prev"); };
            dPlay = dMusic.Add(new FlatButton("", true) { IconGlyph = Glyph.Play });
            dPlay.Click += delegate { Spotify(spPlaying ? "pause" : "play"); spPlaying = !spPlaying; dPlay.IconGlyph = spPlaying ? Glyph.Pause : Glyph.Play; };
            dMusic.Add(new FlatButton("", false) { IconGlyph = Glyph.Next }).Click += delegate { Spotify("next"); };

            dFlight = grid.Add(new FlightCard(5, 196));
            dFlight.Add(Btn("Open FlightLine", true, delegate { OpenFlightLine(); }));
            dFlight.Add(Btn("Start session", false, delegate { ThreadPool.QueueUserWorkItem(delegate { HubApi.Run("flightSessionStart"); }); }));

            dQuick = grid.Add(new QuickCard(7, 196));
            dQuick.AddTile(Glyph.Save, "Back up now", delegate { BackupNow(false); });
            dQuick.AddTile(Glyph.Sync, "Check for updates", delegate { CheckUpdates(false); ShowPage("Updates"); });
            qService = dQuick.AddTile(Glyph.Refresh, "Restart service", delegate { ServiceButton(); });
            dQuick.AddTile(Glyph.Folder, "Settings folder", delegate { HubApp.Open(BackupFile.DataFolder); });
            return s;
        }

        static string Greeting()
        {
            int h = DateTime.Now.Hour;
            string hi = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
            string n = Environment.UserName ?? "";
            int cut = n.IndexOfAny(new[] { '.', ' ', '_' });
            if (cut > 0) n = n.Substring(0, cut);
            bool ok = n.Length >= 2 && n.Length <= 14;
            foreach (char c in n) if (!char.IsLetter(c)) ok = false;
            return ok ? hi + ", " + char.ToUpper(n[0]) + n.Substring(1) : hi;
        }

        void OpenFlightLine()
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                if (!HubApp.OpenFlightLine())
                    try { BeginInvoke((MethodInvoker)delegate { Dlg.Info(this, "FlightLine couldn't open", "Control Hub Service isn't answering. Restart it on the Overview, then try again."); }); } catch { }
            });
        }

        void Spotify(string what)
        {
            var b = new Dictionary<string, object>();
            b["action"] = "spotify";
            b["what"] = what;
            ThreadPool.QueueUserWorkItem(delegate { HubApi.Action(b); try { BeginInvoke((MethodInvoker)delegate { RefreshSoon(); }); } catch { } });
        }

        void BrowsePanel(int step)
        {
            if (panelPages.Count == 0) return;
            int i = panelShown < 0 ? 0 : panelShown;
            panelShown = ((i + step) % panelPages.Count + panelPages.Count) % panelPages.Count;
            panelBrowsed = DateTime.Now;
            DrawPanelPage();
        }

        void ShowOnPanel()
        {
            if (panelShown < 0 || panelShown >= panelPages.Count) return;
            var p = panelPages[panelShown];
            var b = new Dictionary<string, object>();
            b["what"] = "showPanelPage";
            b["page"] = HubApi.Str(p, "id") ?? HubApi.Str(p, "name");
            ThreadPool.QueueUserWorkItem(delegate
            {
                bool ok = HubApi.Do(b);
                try { BeginInvoke((MethodInvoker)delegate { if (!ok) NotRunning(); else { panelLive = panelShown; DrawPanelPage(); RefreshSoon(); } }); } catch { }
            });
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
            prPanel.IconBack = T.Mix(T.Raise, T.Acc, 0.5f);
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
            // FlightLine: part of Control Hub (its flights are recorded by Control Hub Service).
            var fl = s.Put(new Row(Glyph.Airplane, "FlightLine", "Your flight logbook, and Start session for your flight programs"));
            fl.IconImage = FlightLineLogo();
            fl.IconBack = Color.FromArgb(37, 99, 235);
            fl.Add(Btn("Open", true, delegate
            {
                ThreadPool.QueueUserWorkItem(delegate
                {
                    if (!HubApp.OpenFlightLine())
                        try { BeginInvoke((MethodInvoker)delegate { Dlg.Info(this, "FlightLine couldn't open", "Control Hub Service isn't answering. Restart it on the Overview, then try again."); }); } catch { }
                });
            }));
            fl.Add(Btn("Start session", false, delegate
            {
                ThreadPool.QueueUserWorkItem(delegate { HubApi.Run("flightSessionStart"); });
            }));
            if (full)
            {
                FlatButton sc = null;
                sc = Btn(File.Exists(HubApp.FlightLineLink) ? "Remove desktop shortcut" : "Desktop shortcut", false, delegate
                {
                    bool on = !File.Exists(HubApp.FlightLineLink);
                    if (!HubApp.SetFlightLineShortcut(on)) { Dlg.Info(this, "Couldn't change the shortcut", "See Help for the details."); return; }
                    sc.Text = File.Exists(HubApp.FlightLineLink) ? "Remove desktop shortcut" : "Desktop shortcut";
                    fl.PerformLayout();
                });
                fl.Add(sc);
                fl.Add(Btn("Flights folder", false, delegate
                {
                    string d = Path.Combine(BackupFile.DataFolder, "FlightLine");
                    Directory.CreateDirectory(d);
                    HubApp.Open(d);
                }));
            }
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

        /// <summary>Each service's own colour, behind its icon until the real logo has loaded.</summary>
        static Color Brand(string key)
        {
            switch (key)
            {
                case "spotify": return Color.FromArgb(30, 185, 84);
                case "discord": return Color.FromArgb(88, 101, 242);
                case "twitch": return Color.FromArgb(145, 70, 255);
                case "steam": return Color.FromArgb(27, 40, 56);
                case "sayintentions": return Color.FromArgb(14, 116, 144);
                case "cs2": return Color.FromArgb(217, 119, 6);
                case "simconnect": return Color.FromArgb(37, 99, 235);
                default: return Color.Empty;
            }
        }

        Stack BuildConnections()
        {
            var s = new Stack();
            s.Heading("Connections", "Log in once. Logins stay encrypted on this PC, for your Windows user only.");
            foreach (var c in Connections)
            {
                var conn = c;
                var row = s.Put(new Row(conn[1], conn[2], conn[3]));
                row.IconBack = Brand(conn[0]);
                connRows[conn[0]] = row;
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
            // the Updates card on the Overview
            if (info.Error != null) dUpdate.Set("Couldn't check for updates", info.Error);
            else if (ready) dUpdate.Set("Version " + info.Version + " is ready", info.Notes.Count > 0 ? info.Notes[0] : "You have " + mine + ".");
            else dUpdate.Set("You're up to date", "Control Hub " + mine + "  ·  checked " + DateTime.Now.ToString("HH:mm"));
            dUpdate.Glow = ready ? T.Acc : Color.Empty;
            dUpdateBtn.Text = ready ? "Update now" : "Check now";
            dUpdateBtn.Accent = ready;
            dUpdate.PerformLayout();
            dUpdate.Invalidate();
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
                "Control Hub closes, and the update window downloads, builds and installs the new version (about a minute), then opens Control Hub again. If anything fails there, nothing is changed.\n\n" +
                "If the new version changes the panel's starter, iCUE asks you to accept the widget at the end.", "Update")) return;
            // The update window does everything and shows the progress; the old way (a command window) is the fallback.
            if (Updater.StartUpdateWindow(updInfo.Version)) { Application.Exit(); return; }
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
                sb.AppendLine("Service " + HubApi.Str(status, "version") + ", start with Windows: " + HubApi.Bool(status, "autostart") + ", panel seen " + HubApi.Long(status, "panelSeconds") + " s ago, panel " + HubApi.Str(status, "widgetVersion") + (HubApi.Bool(status, "panelFromHub") ? " from Control Hub" : "") +
                    ", panel runs " + (HubApi.Str(status, "panelRunning") ?? "?") + " (" + (HubApi.Str(status, "panelSource") ?? "?") + ")" +
                    (HubApi.Str(status, "panelFailed") != null ? ", failed: " + HubApi.Str(status, "panelFailed") : ""));
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
            bool dash = current == "Overview";
            bool wantLayout = dash && (DateTime.Now - layoutAt).TotalSeconds > 20;
            bool wantBook = dash && (DateTime.Now - bookAt).TotalSeconds > 60;
            string haveCover = coverUrl;
            ThreadPool.QueueUserWorkItem(delegate
            {
                var d = HubApi.Get("/api/hub/status", 2500);
                Dictionary<string, object> sp = null, lay = null, book = null;
                Image cover = null;
                string newCover = haveCover;
                if (d != null && dash)
                {
                    // The Overview's cards: what plays, the panel's layout, the last flight.
                    sp = HubApi.Get("/api/spotify", 2500);
                    var pl = HubApi.Obj(sp, "player");
                    string img = HubApi.Str(pl, "image");
                    if (img != haveCover)
                    {
                        newCover = img;
                        if (!string.IsNullOrEmpty(img) && img.StartsWith("https://")) cover = Pics.Load(img, 6000);
                    }
                    if (wantLayout) lay = HubApi.Get("/api/hub/panel", 3000);
                    if (wantBook) book = HubApi.Get("/api/fl/logbook", 5000);
                }
                if (IsDisposed) { if (cover != null) cover.Dispose(); return; }
                try
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        polling = false;
                        Apply(d);
                        if (dash) ApplyDash(d, sp, lay, book, newCover, cover);
                    });
                }
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
            // Newer service: the panel itself says what it runs.
            string run = HubApi.Str(d, "panelRunning");
            if (!string.IsNullOrEmpty(run))
            {
                wv = run;
                source = HubApi.Str(d, "panelSource") == "hub" ? "loaded from Control Hub" : "its built-in copy";
            }
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
            if (autostart2 != null) autostart2.On = autostart.On;
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

        // ================================================================== Settings

        Stack BuildSettings()
        {
            var s = new Stack();
            s.Heading("Settings", "How Control Hub looks and starts.");

            var look = s.Put(new Row(Glyph.Palette, "Accent colour", "P follows your panel's accent colour (Edit → Look on the panel). Or pick one for this window."));
            look.IconBack = T.Mix(T.Raise, T.Acc, 0.5f);
            accentPick = new AccentPicker { Value = accentChoice };
            accentPick.Changed += delegate
            {
                accentChoice = accentPick.Value;
                try { Directory.CreateDirectory(BackupFile.DataFolder); File.WriteAllText(LookFile, accentChoice); } catch { }
                ApplyAccent();
                look.IconBack = T.Mix(T.Raise, T.Acc, 0.5f);
                Invalidate(true);
            };
            look.SetBody(accentPick, T.Px(40));

            var start = s.Put(new Row(Glyph.Power, "Start with Windows", "Control Hub Service starts when you sign in. The panel needs it."));
            autostart2 = start.Add(new Toggle());
            autostart2.Changed += delegate
            {
                if (settingToggles) return;
                if (!HubApi.Run(autostart2.On ? "autostartOn" : "autostartOff")) NotRunning();
                RefreshSoon();
            };

            var win = s.Put(new Row(Glyph.Window, "Window", "Control Hub remembers its size and place on the screen."));
            win.Add(Btn("Reset size", false, delegate
            {
                WindowState = FormWindowState.Normal;
                ClientSize = new Size(T.Px(1180), T.Px(780));
                CenterToScreen();
            }));

            s.Section("Folders");
            var f1 = s.Put(new Row(Glyph.Folder, "Your settings", BackupFile.DataFolder));
            f1.Add(Btn("Open", false, delegate { HubApp.Open(BackupFile.DataFolder); }));
            var f2 = s.Put(new Row(Glyph.Folder, "Program", HubApp.Folder));
            f2.Add(Btn("Open", false, delegate { HubApp.Open(HubApp.Folder); }));

            s.Section("About");
            var about = s.Put(new Row(Glyph.Info, "Control Hub " + Updater.Installed(), "Your panel, FlightLine and the rest, in one place."));
            about.Add(Btn("Updates", false, delegate { ShowPage("Updates"); }));
            about.Add(Btn("Help", false, delegate { ShowPage("Help"); }));
            return s;
        }

        // ================================================================== Overview cards

        void ApplyDash(Dictionary<string, object> d, Dictionary<string, object> sp, Dictionary<string, object> lay, Dictionary<string, object> book, string newCover, Image cover)
        {
            greet.Text = Greeting();
            if (greetSub != null) greetSub.Text = DateTime.Now.ToString("dddd d MMMM", En);

            // ---- status
            var chips = new List<KeyValuePair<string, Color>>();
            if (d == null)
            {
                bool proc = HubApp.ServiceRunning();
                dStatus.Set(proc ? "Control Hub Service isn't answering" : "Control Hub Service isn't running",
                    "The panel needs it. Start it with the button under Quick actions.", T.Bad, chips);
                qService.Text = "Start service";
            }
            else
            {
                qService.Text = "Restart service";
                var problems = new List<string>();
                chips.Add(new KeyValuePair<string, Color>("Service", T.Ok));
                long secs = HubApi.Long(d, "panelSeconds");
                bool panelOn = secs >= 0 && secs <= 30;
                chips.Add(new KeyValuePair<string, Color>("Panel", panelOn ? T.Ok : T.Warn));
                if (!panelOn) problems.Add(secs < 0 ? "The panel hasn't connected yet. Is iCUE running?" : "The panel was last seen " + Ago(secs) + ". Is iCUE running?");
                var conns = HubApi.Obj(d, "connections");
                foreach (var k in new[] { "spotify", "discord", "twitch" })
                {
                    var c = HubApi.Obj(conns, k);
                    if (c == null || !HubApi.Bool(c, "configured")) continue;
                    bool on = HubApi.Bool(c, "on");
                    string nm = char.ToUpper(k[0]) + k.Substring(1);
                    chips.Add(new KeyValuePair<string, Color>(nm, on ? T.Ok : T.Warn));
                    if (!on) problems.Add(nm + " needs you to log in again (Connections).");
                }
                if (problems.Count == 0) dStatus.Set("Everything is running", "The service, your panel and your connections are working.", T.Ok, chips);
                else dStatus.Set(problems.Count == 1 ? "One thing needs a look" : problems.Count + " things need a look", string.Join(" ", problems.ToArray()), T.Warn, chips);

                // the panel's accent colour and the page it shows
                panelAccent = HubApi.Str(d, "panelAccent");
                ApplyAccent();
                object pg;
                int live = d.TryGetValue("panelPage", out pg) && pg != null ? (int)HubApi.Long(d, "panelPage") : -1;
                if (live != panelLive)
                {
                    panelLive = live;
                    if ((DateTime.Now - panelBrowsed).TotalSeconds > 30) panelShown = live;
                    DrawPanelPage();
                }
            }

            // ---- the panel's layout
            if (lay != null)
            {
                layoutAt = DateTime.Now;
                var l = HubApi.Parse(HubApi.Str(lay, "layout") ?? "");
                panelPages = HubApi.List(l, "pages");
                if (panelLive < 0 && l != null) panelLive = (int)HubApi.Long(l, "current");
                if (panelShown < 0 || panelShown >= panelPages.Count) panelShown = Math.Max(0, Math.Min(panelPages.Count - 1, panelLive));
                DrawPanelPage();
            }

            // ---- now playing
            if (newCover != coverUrl)
            {
                coverUrl = newCover;
                dMusic.SetCover(cover);
            }
            else if (cover != null) cover.Dispose();
            var player = HubApi.Obj(sp, "player");
            bool spOn = sp != null && HubApi.Bool(sp, "connected");
            if (!spOn)
            {
                dMusic.Song = sp == null ? "Spotify" : "Spotify isn't connected";
                dMusic.Artist = sp == null ? "" : "Connect it under Connections";
                dMusic.Progress = 0;
            }
            else if (player == null || string.IsNullOrEmpty(HubApi.Str(player, "title")))
            {
                dMusic.Song = "Nothing playing";
                dMusic.Artist = "Press play to start Spotify";
                dMusic.Progress = 0;
            }
            else
            {
                dMusic.Song = HubApi.Str(player, "title");
                dMusic.Artist = (HubApi.Str(player, "artist") ?? "") + (string.IsNullOrEmpty(HubApi.Str(player, "device")) ? "" : "  ·  " + HubApi.Str(player, "device"));
                double dur = HubApi.Num(player, "duration");
                dMusic.Progress = dur > 0 ? (float)(HubApi.Num(player, "progress") / dur) : 0;
            }
            spPlaying = player != null && HubApi.Bool(player, "playing");
            dPlay.IconGlyph = spPlaying ? Glyph.Pause : Glyph.Play;
            dMusic.Bar.Visible = spOn;
            dMusic.Invalidate();

            // ---- the last flight
            if (book != null)
            {
                bookAt = DateTime.Now;
                var flights = HubApi.List(book, "flights");
                dFlight.Facts.Clear();
                if (flights.Count == 0) { dFlight.From = ""; dFlight.To = ""; }
                else
                {
                    var f = flights[0];
                    dFlight.From = HubApi.Str(f, "from") ?? HubApi.Str(f, "planFrom") ?? "";
                    dFlight.To = HubApi.Str(f, "to") ?? HubApi.Str(f, "planTo") ?? "";
                    string ac = HubApi.Str(f, "aircraft") ?? "";
                    ac = System.Text.RegularExpressions.Regex.Replace(ac, "\\s+(Asobo|Microsoft|iniBuilds|PMDG|Fenix|FBW|Headwind)\\b", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase).Trim();
                    if (ac.Length > 22) ac = ac.Substring(0, 21) + "…";
                    if (ac.Length > 0) dFlight.Facts.Add(new KeyValuePair<string, string>("Plane", ac));
                    long min = HubApi.Long(f, "blockMin");
                    if (min > 0) dFlight.Facts.Add(new KeyValuePair<string, string>("Time", (min / 60) + " h " + (min % 60).ToString("00")));
                    object fpm;
                    if (f.TryGetValue("fpm", out fpm) && fpm != null) dFlight.Facts.Add(new KeyValuePair<string, string>("Landing", "−" + HubApi.Long(f, "fpm") + " fpm"));
                    long start = HubApi.Long(f, "start");
                    if (start > 0) dFlight.Facts.Add(new KeyValuePair<string, string>("Date", new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(start).ToLocalTime().ToString("d MMM", En)));
                }
                dFlight.Invalidate();
            }
            dStatus.Invalidate();
        }

        /// <summary>Draws one of the panel's pages on the Overview (the one on the panel, unless you browsed).</summary>
        void DrawPanelPage()
        {
            dPanel.Boxes.Clear();
            if (panelShown < 0 || panelShown >= panelPages.Count)
            {
                dPanel.Caption = "Your panel";
                dPanelShow.Visible = false;
                dPanel.Invalidate();
                return;
            }
            var p = panelPages[panelShown];
            var tiles = HubApi.List(p, "tiles");
            var gridO = HubApi.Obj(p, "grid");
            float cols = (float)HubApi.Num(gridO, "cols"), rows = (float)HubApi.Num(gridO, "rows");
            float maxX = 1, maxY = 1;
            foreach (var t in tiles)
            {
                var b = new PanelCard.Box
                {
                    X = (float)HubApi.Num(t, "x"), Y = (float)HubApi.Num(t, "y"),
                    W = Math.Max(1f, (float)HubApi.Num(t, "w")), H = Math.Max(1f, (float)HubApi.Num(t, "h")),
                    Type = HubApi.Str(t, "type") ?? "",
                };
                b.Name = TileName(b.Type, HubApi.Obj(t, "cfg"));
                maxX = Math.Max(maxX, b.X + b.W);
                maxY = Math.Max(maxY, b.Y + b.H);
                dPanel.Boxes.Add(b);
            }
            dPanel.Cols = cols > 0 ? Math.Max(cols, maxX) : Math.Max(15, maxX);
            dPanel.Rows = rows > 0 ? Math.Max(rows, maxY) : Math.Max(4, maxY);
            string name = HubApi.Str(p, "name") ?? "Page " + (panelShown + 1);
            dPanel.Caption = "Your panel  ·  " + name + (panelShown == panelLive ? "  ·  showing now" : "  ·  page " + (panelShown + 1) + " of " + panelPages.Count);
            dPanelShow.Visible = panelShown != panelLive;
            dPanel.PerformLayout();
            dPanel.Invalidate();
        }

        static string TileName(string type, Dictionary<string, object> cfg)
        {
            string n = HubApi.Str(cfg, "name");
            if ((type == "shortcut" || type == "folder") && !string.IsNullOrEmpty(n)) return n;
            switch (type)
            {
                case "spotify": return "Spotify";
                case "spvolume": return "Spotify volume";
                case "spplaylists": return "Playlists";
                case "discord": return "Discord";
                case "clock": return "Clock";
                case "weather": return "Weather";
                case "speakers": return "Speakers";
                case "mic": return "Microphone";
                case "output": return "Output";
                case "power": return "Power";
                case "dnd": return "Do Not Disturb";
                case "appsearch": return "Search";
                case "launcher": return "Apps";
                case "metar": return "METAR";
                case "ofp": return "SimBrief plan";
                case "simbrief": return "SimBrief";
                case "dayview": return "Today";
                case "media": return "Media";
                case "mixer": return "Mixer";
                case "keepawake": return "Keep awake";
                default: return type.Length > 0 ? char.ToUpper(type[0]) + type.Substring(1) : "";
            }
        }

        // ================================================================== accent colour

        string LookFile { get { return Path.Combine(BackupFile.DataFolder, "hub-look.txt"); } }

        void LoadLook()
        {
            try { if (File.Exists(LookFile)) accentChoice = File.ReadAllText(LookFile).Trim(); } catch { }
            if (string.IsNullOrEmpty(accentChoice)) accentChoice = "panel";
            if (accentPick != null) accentPick.Value = accentChoice;
            ApplyAccent();
        }

        void ApplyAccent()
        {
            Color c;
            string hex = accentChoice == "panel" ? panelAccent : accentChoice;
            if (!T.TryHex(hex, out c)) c = Color.FromArgb(45, 212, 191);
            if (T.SetAccent(c)) Invalidate(true);
        }

        // ================================================================== window size and place

        string WindowFile { get { return Path.Combine(BackupFile.DataFolder, "hub-window.txt"); } }

        void RestoreWindow()
        {
            try
            {
                if (!File.Exists(WindowFile)) return;
                var p = File.ReadAllText(WindowFile).Trim().Split(',');
                if (p.Length < 5) return;
                var r = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
                if (r.Width < MinimumSize.Width || r.Height < MinimumSize.Height) return;
                bool seen = false;
                foreach (var s in Screen.AllScreens) if (s.WorkingArea.IntersectsWith(new Rectangle(r.X + 40, r.Y + 10, Math.Max(1, r.Width - 80), 40))) seen = true;
                if (!seen) return;
                StartPosition = FormStartPosition.Manual;
                Bounds = r;
                if (p[4] == "1") WindowState = FormWindowState.Maximized;
            }
            catch { }
        }

        void SaveWindow()
        {
            try
            {
                var r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                Directory.CreateDirectory(BackupFile.DataFolder);
                File.WriteAllText(WindowFile, r.X + "," + r.Y + "," + r.Width + "," + r.Height + "," + (WindowState == FormWindowState.Maximized ? "1" : "0"));
            }
            catch { }
        }

        // ================================================================== logos

        /// <summary>Real app icons (from the apps on this PC, through the service) for the rows that have one.</summary>
        void LoadLogos()
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                var apps = HubApi.List(HubApi.Get("/api/apps", 10000), "apps");
                var want = new Dictionary<string, string[]>();
                want["spotify"] = new[] { "Spotify" };
                want["discord"] = new[] { "Discord" };
                want["steam"] = new[] { "Steam" };
                want["sayintentions"] = new[] { "SayIntentions" };
                want["cs2"] = new[] { "Counter-Strike 2" };
                want["simconnect"] = new[] { "Microsoft Flight Simulator 2024", "Microsoft Flight Simulator" };
                want["panel"] = new[] { "iCUE", "CORSAIR iCUE" };
                var got = new Dictionary<string, Image>();
                foreach (var kv in want)
                {
                    foreach (var name in kv.Value)
                    {
                        Dictionary<string, object> hit = null;
                        foreach (var a in apps)
                        {
                            string n = HubApi.Str(a, "name") ?? "";
                            if (HubApi.Str(a, "kind") == "url" || string.IsNullOrEmpty(HubApi.Str(a, "icon"))) continue;
                            if (string.Equals(n, name, StringComparison.OrdinalIgnoreCase) || n.StartsWith(name + " ", StringComparison.OrdinalIgnoreCase)) { hit = a; break; }
                        }
                        if (hit == null) continue;
                        var img = Pics.Load("http://127.0.0.1:" + HubApi.Port + "/api/icon?id=" + Uri.EscapeDataString(HubApi.Str(hit, "icon")), 6000);
                        if (img != null) { got[kv.Key] = img; break; }
                    }
                }
                if (IsDisposed) return;
                try
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        foreach (var kv in got)
                        {
                            Row r;
                            if (kv.Key == "panel") { if (prPanel != null) prPanel.IconImage = kv.Value; }
                            else if (connRows.TryGetValue(kv.Key, out r)) r.IconImage = kv.Value;
                        }
                    });
                }
                catch { }
            });
        }

        static Image FlightLineLogo()
        {
            try
            {
                string f = Path.Combine(HubApp.Folder, "FlightLine.ico");
                if (File.Exists(f)) using (var ic = new Icon(f, 64, 64)) return ic.ToBitmap();
            }
            catch { }
            return null;
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
