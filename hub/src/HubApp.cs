// Control Hub — the app window. Shows your projects, connections, backups and help.
// Control Hub Service (the tray part) does the work; this window only asks it.
// C# 5 / .NET Framework 4.x (built with the compiler that ships with Windows).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace ControlHub
{
    static class HubApp
    {
        public const string Version = "1.1.0";
        public const string Name = "Control Hub";
        public const string ServiceExe = "Control Hub Service.exe";
        public const string ServiceProcess = "Control Hub Service";

        [DllImport("user32.dll")] static extern IntPtr FindWindow(string cls, string title);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);

        public static string Folder { get { return Path.GetDirectoryName(Application.ExecutablePath); } }
        public static string ServicePath { get { return Path.Combine(Folder, ServiceExe); } }

        [STAThread]
        static void Main()
        {
            bool createdNew;
            using (var mutex = new Mutex(true, "ControlHub.App.SingleInstance", out createdNew))
            {
                if (!createdNew)
                {
                    // Already open: bring that window to the front.
                    IntPtr h = FindWindow(null, Name);
                    if (h != IntPtr.Zero) { ShowWindow(h, 9); SetForegroundWindow(h); }
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm());
            }
        }

        public static Icon AppIcon(int size)
        {
            try
            {
                var s = typeof(HubApp).Assembly.GetManifestResourceStream("ControlHub.ico");
                if (s != null) using (s) return new Icon(s, size, size);
            }
            catch { }
            return SystemIcons.Application;
        }

        public static bool ServiceRunning()
        {
            var ps = Process.GetProcessesByName(ServiceProcess);
            bool any = ps.Length > 0;
            foreach (var p in ps) p.Dispose();
            return any;
        }

        public static void StartService()
        {
            try
            {
                if (File.Exists(ServicePath)) Process.Start(new ProcessStartInfo(ServicePath) { UseShellExecute = true, WorkingDirectory = Folder });
                else MessageBox.Show("Control Hub Service isn't installed next to Control Hub.\nRun \"Install Control Hub.bat\" again.", Name);
            }
            catch (Exception ex) { MessageBox.Show("Couldn't start Control Hub Service: " + ex.Message, Name); }
        }

        /// <summary>Closes the service and starts it again (used after changes and for "Restart").</summary>
        public static void RestartService()
        {
            foreach (var p in Process.GetProcessesByName(ServiceProcess))
            {
                try { p.Kill(); p.WaitForExit(4000); } catch { }
                finally { p.Dispose(); }
            }
            Thread.Sleep(400);
            StartService();
        }

        public static void Open(string path)
        {
            try { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); }
            catch (Exception ex) { MessageBox.Show("Couldn't open " + path + "\n" + ex.Message, Name); }
        }
    }

    /// <summary>Colours and fonts, matching the panel's navy/teal look.</summary>
    static class Ui
    {
        public static readonly Color Back = Color.FromArgb(11, 18, 32);
        public static readonly Color Side = Color.FromArgb(14, 23, 41);
        public static readonly Color Card = Color.FromArgb(20, 31, 54);
        public static readonly Color CardLine = Color.FromArgb(34, 48, 78);
        public static readonly Color Fore = Color.FromArgb(232, 238, 252);
        public static readonly Color Dim = Color.FromArgb(142, 160, 196);
        public static readonly Color Accent = Color.FromArgb(45, 212, 191);
        public static readonly Color Good = Color.FromArgb(52, 211, 153);
        public static readonly Color Warn = Color.FromArgb(251, 191, 36);
        public static readonly Color Bad = Color.FromArgb(248, 113, 113);
        public static readonly Color ButtonBack = Color.FromArgb(30, 43, 70);
        public static readonly Color ButtonHover = Color.FromArgb(40, 57, 92);

        public static readonly Font Body = new Font("Segoe UI", 10f);
        public static readonly Font Small = new Font("Segoe UI", 9f);
        public static readonly Font Bold = new Font("Segoe UI Semibold", 10.5f);
        public static readonly Font Title = new Font("Segoe UI Semibold", 15f);
        public static readonly Font Big = new Font("Segoe UI Semibold", 20f);
        public static readonly Font Mono = new Font("Consolas", 9f);

        public static Button Btn(string text, bool accent)
        {
            var b = new Button
            {
                Text = text,
                FlatStyle = FlatStyle.Flat,
                BackColor = accent ? Accent : ButtonBack,
                ForeColor = accent ? Color.FromArgb(6, 30, 28) : Fore,
                Font = accent ? Bold : Body,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                Padding = new Padding(10, 4, 10, 4),
                Margin = new Padding(0, 0, 8, 8),
                Cursor = Cursors.Hand,
                UseVisualStyleBackColor = false
            };
            b.FlatAppearance.BorderSize = 0;
            b.FlatAppearance.MouseOverBackColor = accent ? Color.FromArgb(94, 234, 212) : ButtonHover;
            return b;
        }

        public static Label Lbl(string text, Font font, Color color)
        {
            return new Label { Text = text, Font = font, ForeColor = color, AutoSize = true, BackColor = Color.Transparent, Margin = new Padding(0, 0, 0, 4) };
        }

        /// <summary>A rounded card that stacks its children top to bottom.</summary>
        public static FlowLayoutPanel MakeCard(int width)
        {
            var p = new RoundPanel
            {
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                BackColor = Ui.Card,
                Padding = new Padding(18, 14, 18, 10),
                Margin = new Padding(0, 0, 0, 14),
                MinimumSize = new Size(width, 0),
                MaximumSize = new Size(width, 0)
            };
            return p;
        }

        /// <summary>A row of buttons (or other controls) side by side.</summary>
        public static FlowLayoutPanel Row()
        {
            return new FlowLayoutPanel
            {
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = true,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                BackColor = Color.Transparent,
                Margin = new Padding(0, 6, 0, 0)
            };
        }
    }

    /// <summary>A panel with rounded corners (the cards).</summary>
    class RoundPanel : FlowLayoutPanel
    {
        public RoundPanel() { DoubleBuffered = true; ResizeRedraw = true; }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            var parentColor = Parent != null ? Parent.BackColor : Ui.Back;
            e.Graphics.Clear(parentColor);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var path = Rounded(new Rectangle(0, 0, Width - 1, Height - 1), 14))
            using (var brush = new SolidBrush(BackColor))
            using (var pen = new Pen(Ui.CardLine))
            {
                e.Graphics.FillPath(brush, path);
                e.Graphics.DrawPath(pen, path);
            }
        }

        public static GraphicsPath Rounded(Rectangle r, int radius)
        {
            int d = radius * 2;
            var p = new GraphicsPath();
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }
    }

    /// <summary>A small coloured dot + text (connected / not connected).</summary>
    class StatusLabel : Label
    {
        public Color Dot = Ui.Dim;
        public StatusLabel()
        {
            AutoSize = true;
            Font = Ui.Body;
            ForeColor = Ui.Dim;
            BackColor = Color.Transparent;
            Padding = new Padding(16, 0, 0, 0);
            Margin = new Padding(0, 2, 0, 6);
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            int s = 9, y = (Height - s) / 2;
            using (var b = new SolidBrush(Dot)) e.Graphics.FillEllipse(b, 2, y, s, s);
        }
        public void Set(string text, Color dot)
        {
            if (Text != text) Text = text;
            if (Dot != dot) { Dot = dot; Invalidate(); }
        }
    }

    class MainForm : Form
    {
        readonly Panel content;
        readonly Dictionary<string, Control> pages = new Dictionary<string, Control>();
        readonly Dictionary<string, Button> nav = new Dictionary<string, Button>();
        readonly System.Windows.Forms.Timer timer;
        string current;
        Dictionary<string, object> status;
        bool polling;

        // Projects page
        StatusLabel cpService, cpPanel;
        Label cpVersions;
        // Updates
        StatusLabel updStatus;
        Label updNotes;
        Button updNow, updCheck, updBack;
        Updater.Info updInfo;
        bool updBusy;
        DateTime updChecked = DateTime.MinValue;
        Button cpStart;
        FlowLayoutPanel projectList;
        // Connections page
        readonly Dictionary<string, StatusLabel> connLabels = new Dictionary<string, StatusLabel>();
        readonly Dictionary<string, Button> forgetButtons = new Dictionary<string, Button>();
        // Panel page
        CheckBox autostart;
        bool settingAutostart;
        FlowLayoutPanel backupList;
        Label backupNote;
        // Help page
        TextBox logBox;
        // Offline banner
        Panel offline;

        public MainForm()
        {
            // Sizes below are for 100 % display scaling; Windows' scaling (125 %, 150 %…) enlarges them.
            SuspendLayout();
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            Text = HubApp.Name;
            Icon = HubApp.AppIcon(32);
            BackColor = Ui.Back;
            ForeColor = Ui.Fore;
            Font = Ui.Body;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(1040, 680);
            MinimumSize = new Size(900, 560);
            DoubleBuffered = true;

            // Left: logo and navigation.
            var side = new Panel { Dock = DockStyle.Left, Width = 220, BackColor = Ui.Side, Padding = new Padding(16, 18, 16, 16) };
            var logo = new PictureBox { Image = HubApp.AppIcon(48).ToBitmap(), SizeMode = PictureBoxSizeMode.Zoom, Size = new Size(44, 44), Location = new Point(18, 20), BackColor = Color.Transparent };
            var name = Ui.Lbl(HubApp.Name, Ui.Title, Ui.Fore); name.Location = new Point(70, 22);
            var ver = Ui.Lbl("Version " + HubApp.Version, Ui.Small, Ui.Dim); ver.Location = new Point(72, 48);
            side.Controls.Add(logo); side.Controls.Add(name); side.Controls.Add(ver);
            int y = 100;
            foreach (var n in new[] { "Projects", "Connections", "Panel", "Help" })
            {
                var b = NavButton(n);
                b.Location = new Point(12, y);
                y += 46;
                side.Controls.Add(b);
                nav[n] = b;
            }

            content = new Panel { Dock = DockStyle.Fill, BackColor = Ui.Back, Padding = new Padding(28, 22, 28, 16) };

            offline = new Panel { Dock = DockStyle.Top, Height = 46, BackColor = Color.FromArgb(68, 40, 20), Visible = false };
            var offText = Ui.Lbl("Control Hub Service isn't running, so the panel can't do much right now.", Ui.Body, Color.FromArgb(253, 230, 138));
            offText.Location = new Point(18, 13);
            var offBtn = Ui.Btn("Start it", true);
            offBtn.Click += delegate { HubApp.StartService(); RefreshSoon(); };
            offline.Controls.Add(offText);
            offline.Controls.Add(offBtn);
            offline.Resize += delegate { offBtn.Location = new Point(offline.Width - offBtn.Width - 16, 8); };

            Controls.Add(content);
            Controls.Add(offline);
            Controls.Add(side);

            pages["Projects"] = BuildProjects();
            pages["Connections"] = BuildConnections();
            pages["Panel"] = BuildPanel();
            pages["Help"] = BuildHelp();
            foreach (var p in pages.Values) { p.Visible = false; content.Controls.Add(p); }
            ShowPage("Projects");

            content.Resize += delegate { FitCards(); };

            timer = new System.Windows.Forms.Timer { Interval = 3000 };
            timer.Tick += delegate { Poll(); };
            timer.Start();
            Shown += delegate { FitCards(); Poll(); LoadBackups(); CheckUpdates(true); };
            Activated += delegate { Poll(); };
            ResumeLayout(false);
            PerformLayout();
        }

        Button NavButton(string text)
        {
            var b = new Button
            {
                Text = "   " + text,
                TextAlign = ContentAlignment.MiddleLeft,
                FlatStyle = FlatStyle.Flat,
                BackColor = Ui.Side,
                ForeColor = Ui.Dim,
                Font = Ui.Bold,
                Size = new Size(196, 40),
                Cursor = Cursors.Hand,
                UseVisualStyleBackColor = false
            };
            b.FlatAppearance.BorderSize = 0;
            b.FlatAppearance.MouseOverBackColor = Ui.ButtonHover;
            b.Click += delegate { ShowPage(text); };
            return b;
        }

        void ShowPage(string page)
        {
            current = page;
            foreach (var kv in pages) kv.Value.Visible = kv.Key == page;
            foreach (var kv in nav)
            {
                bool on = kv.Key == page;
                kv.Value.BackColor = on ? Ui.ButtonBack : Ui.Side;
                kv.Value.ForeColor = on ? Ui.Accent : Ui.Dim;
            }
            if (page == "Help") LoadLog();
            if (page == "Panel") LoadBackups();
        }

        /// <summary>A scrolling page with a title.</summary>
        FlowLayoutPanel Page(string title, string sub)
        {
            var p = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                AutoScroll = true,
                BackColor = Ui.Back
            };
            p.Controls.Add(Ui.Lbl(title, Ui.Big, Ui.Fore));
            var s = Ui.Lbl(sub, Ui.Body, Ui.Dim);
            s.Margin = new Padding(0, 0, 0, 16);
            p.Controls.Add(s);
            return p;
        }

        int CardWidth { get { return Math.Max(560, content.ClientSize.Width - content.Padding.Horizontal - 24); } }

        /// <summary>Cards are as wide as the window allows.</summary>
        void FitCards()
        {
            int w = CardWidth;
            foreach (var page in pages.Values) FitIn(page, w);
            if (logBox != null) logBox.Width = w - 40;
        }

        static void FitIn(Control parent, int w)
        {
            foreach (Control c in parent.Controls)
            {
                if (c is RoundPanel)
                {
                    c.MinimumSize = new Size(w, 0);
                    c.MaximumSize = new Size(w, 0);
                    // Long texts wrap inside the card instead of being cut off.
                    foreach (Control x in c.Controls) if (x is Label) x.MaximumSize = new Size(w - 40, 0);
                }
                else if (c is FlowLayoutPanel) FitIn(c, w);
            }
        }

        // ================================================================== Projects

        Control BuildProjects()
        {
            var page = Page("Projects", "Everything Control Hub looks after. Updates will appear here.");

            var card = Ui.MakeCard(CardWidth);
            card.Controls.Add(Ui.Lbl("Control Panel", Ui.Title, Ui.Fore));
            card.Controls.Add(Ui.Lbl("The touch panel on your XENEON EDGE, and Control Hub Service, which powers it from the tray.", Ui.Body, Ui.Dim));
            cpService = new StatusLabel(); card.Controls.Add(cpService);
            cpPanel = new StatusLabel(); card.Controls.Add(cpPanel);
            cpVersions = Ui.Lbl("", Ui.Small, Ui.Dim); card.Controls.Add(cpVersions);
            var row = Ui.Row();
            cpStart = Ui.Btn("Start service", true);
            cpStart.Click += delegate { HubApp.StartService(); RefreshSoon(); };
            var restart = Ui.Btn("Restart service", false);
            restart.Click += delegate { HubApp.RestartService(); RefreshSoon(); };
            var folder = Ui.Btn("Open program folder", false);
            folder.Click += delegate { HubApp.Open(HubApp.Folder); };
            var data = Ui.Btn("Open settings folder", false);
            data.Click += delegate
            {
                string f = HubApi.Str(status, "folder");
                if (string.IsNullOrEmpty(f)) f = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ControlHub");
                HubApp.Open(f);
            };
            row.Controls.Add(cpStart); row.Controls.Add(restart); row.Controls.Add(folder); row.Controls.Add(data);
            card.Controls.Add(row);

            // Updates (first on the page).
            var upd = Ui.MakeCard(CardWidth);
            upd.Controls.Add(Ui.Lbl("Updates", Ui.Title, Ui.Fore));
            upd.Controls.Add(Ui.Lbl("New versions come from GitHub (" + Updater.Owner + "/" + Updater.Repo + "). Control Hub, the service and the panel are all updated together.", Ui.Body, Ui.Dim));
            updStatus = new StatusLabel(); upd.Controls.Add(updStatus);
            updNotes = Ui.Lbl("", Ui.Body, Ui.Fore); updNotes.Visible = false; upd.Controls.Add(updNotes);
            var uRow = Ui.Row();
            updNow = Ui.Btn("Update now", true);
            updNow.Visible = false;
            updNow.Click += delegate { DoUpdate(); };
            updCheck = Ui.Btn("Check for updates", false);
            updCheck.Click += delegate { CheckUpdates(false); };
            updBack = Ui.Btn("Go back to the previous version", false);
            updBack.Click += delegate { GoBack(); };
            uRow.Controls.Add(updNow); uRow.Controls.Add(updCheck); uRow.Controls.Add(updBack);
            upd.Controls.Add(uRow);
            page.Controls.Add(upd);
            page.Controls.Add(card);

            projectList = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoSize = true, BackColor = Ui.Back, Margin = new Padding(0) };
            page.Controls.Add(projectList);
            LoadProjects();
            return page;
        }

        /// <summary>Other projects, from projects.json next to the program (one short entry each).</summary>
        void LoadProjects()
        {
            projectList.Controls.Clear();
            string file = Path.Combine(HubApp.Folder, "projects.json");
            List<Dictionary<string, object>> list = new List<Dictionary<string, object>>();
            try { if (File.Exists(file)) list = HubApi.List(HubApi.Parse(File.ReadAllText(file, Encoding.UTF8)), "projects"); }
            catch { }
            foreach (var p in list)
            {
                var proj = p;
                string pname = HubApi.Str(proj, "name") ?? "Project";
                var card = Ui.MakeCard(CardWidth);
                card.Controls.Add(Ui.Lbl(pname, Ui.Title, Ui.Fore));
                string desc = HubApi.Str(proj, "description");
                if (!string.IsNullOrEmpty(desc)) card.Controls.Add(Ui.Lbl(desc, Ui.Body, Ui.Dim));
                var st = new StatusLabel();
                card.Controls.Add(st);
                string proc = HubApi.Str(proj, "process");
                st.Tag = proc;
                var row = Ui.Row();
                string start = HubApi.Str(proj, "start"), folder = HubApi.Str(proj, "folder"), url = HubApi.Str(proj, "url");
                if (!string.IsNullOrEmpty(start))
                {
                    var b = Ui.Btn("Start", true);
                    b.Click += delegate { HubApp.Open(Expand(start)); };
                    row.Controls.Add(b);
                }
                if (!string.IsNullOrEmpty(proc))
                {
                    var b = Ui.Btn("Stop", false);
                    b.Click += delegate
                    {
                        foreach (var x in Process.GetProcessesByName(proc)) { try { x.CloseMainWindow(); if (!x.WaitForExit(3000)) x.Kill(); } catch { } finally { x.Dispose(); } }
                    };
                    row.Controls.Add(b);
                }
                if (!string.IsNullOrEmpty(folder)) { var b = Ui.Btn("Open folder", false); b.Click += delegate { HubApp.Open(Expand(folder)); }; row.Controls.Add(b); }
                if (!string.IsNullOrEmpty(url)) { var b = Ui.Btn("Open page", false); b.Click += delegate { HubApp.Open(url); }; row.Controls.Add(b); }
                card.Controls.Add(row);
                projectList.Controls.Add(card);
            }
            UpdateProjectStatus();
        }

        static string Expand(string s) { return Environment.ExpandEnvironmentVariables(s); }

        void UpdateProjectStatus()
        {
            foreach (Control card in projectList.Controls)
                foreach (Control c in card.Controls)
                {
                    var st = c as StatusLabel;
                    if (st == null) continue;
                    string proc = st.Tag as string;
                    if (string.IsNullOrEmpty(proc)) { st.Set("", Ui.Dim); continue; }
                    var ps = Process.GetProcessesByName(proc);
                    bool on = ps.Length > 0;
                    foreach (var x in ps) x.Dispose();
                    st.Set(on ? "Running" : "Not running", on ? Ui.Good : Ui.Dim);
                }
        }

        // ================================================================== Updates

        void CheckUpdates(bool quiet)
        {
            if (updBusy) return;
            updBusy = true;
            updChecked = DateTime.Now;
            updCheck.Enabled = false;
            if (!quiet || updInfo == null) updStatus.Set("Checking GitHub for a new version…", Ui.Dim);
            ShowGoBack();
            ThreadPool.QueueUserWorkItem(delegate
            {
                var info = Updater.Check();
                if (IsDisposed) return;
                try { BeginInvoke((MethodInvoker)delegate { updBusy = false; updCheck.Enabled = true; ShowUpdate(info); }); }
                catch { }
            });
        }

        void ShowUpdate(Updater.Info info)
        {
            updInfo = info;
            string mine = Updater.Installed();
            if (info.Error != null)
            {
                updStatus.Set("Couldn't check for updates: " + info.Error, Ui.Warn);
                updNow.Visible = false;
                updNotes.Visible = false;
                return;
            }
            if (info.Newer)
            {
                updStatus.Set("Version " + info.Version + " is ready (you have " + mine + ")", Ui.Accent);
                var sb = new StringBuilder("What's new:");
                foreach (var n in info.Notes) sb.Append("\n•  ").Append(n);
                updNotes.Text = sb.ToString();
                updNotes.Visible = info.Notes.Count > 0;
                updNow.Text = "Update to " + info.Version;
                updNow.Visible = true;
            }
            else
            {
                updStatus.Set("You have the newest version (" + mine + ")", Ui.Good);
                updNow.Visible = false;
                updNotes.Visible = false;
            }
            FitCards();
        }

        void ShowGoBack()
        {
            bool can = Updater.CanGoBack();
            string prev = Updater.PreviousVersion();
            updBack.Visible = can;
            if (can) updBack.Text = "Go back to the previous version" + (string.IsNullOrEmpty(prev) ? "" : " (" + prev + ")");
        }

        void DoUpdate()
        {
            if (updInfo == null || !updInfo.Newer || updBusy) return;
            if (MessageBox.Show(this,
                "Update to version " + updInfo.Version + "?\n\n" +
                "Control Hub closes, and a window builds and installs the new version (about a minute). " +
                "If anything fails there, nothing is changed.\n\n" +
                "At the end iCUE may ask you to accept the updated panel widget.",
                HubApp.Name, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            updBusy = true;
            updNow.Enabled = false;
            updCheck.Enabled = false;
            updStatus.Set("Downloading the new version…", Ui.Accent);
            ThreadPool.QueueUserWorkItem(delegate
            {
                string error;
                string folder = Updater.Download(delegate (string msg)
                {
                    try { BeginInvoke((MethodInvoker)delegate { updStatus.Set(msg, Ui.Accent); }); } catch { }
                }, out error);
                if (IsDisposed) return;
                try
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        updBusy = false;
                        updNow.Enabled = true;
                        updCheck.Enabled = true;
                        if (folder == null) { updStatus.Set("The update couldn't be downloaded: " + error, Ui.Bad); return; }
                        if (!Updater.RunInstaller(folder)) { updStatus.Set("Couldn't start the installer.", Ui.Bad); return; }
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
            if (MessageBox.Show(this,
                "Go back to the previous version" + (string.IsNullOrEmpty(prev) ? "" : " (" + prev + ")") + "?\n\n" +
                "Control Hub and the service are put back as they were before the last update. " +
                "Your settings, logins and panel layout are not touched.",
                HubApp.Name, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            if (Updater.GoBack()) Application.Exit();
            else MessageBox.Show(this, "Couldn't start going back. Run \"Restore previous version.bat\" in the program folder.", HubApp.Name);
        }

        // ================================================================== Connections

        static readonly string[][] Connections =
        {
            // key, name, what it's for, connect action, can sign out
            new[] { "spotify", "Spotify", "Music on the panel: playlists, like, search and starting Spotify for you.", "connectSpotify", "1" },
            new[] { "discord", "Discord", "Who's talking, mute, deafen, push-to-talk and joining channels.", "connectDiscord", "1" },
            new[] { "twitch", "Twitch", "Which of the channels you follow are live.", "connectTwitch", "1" },
            new[] { "steam", "Steam", "Only for seeing friends online (your games work without it).", "steamKey", "1" },
            new[] { "sayintentions", "SayIntentions", "Usually found by itself while you fly; add the key only if it isn't.", "sayIntentionsKey", "1" },
            new[] { "cs2", "Counter-Strike 2", "Score, health, money and the bomb timer on the panel (Valve's own, VAC-safe).", "cs2", "" },
            new[] { "simconnect", "MSFS SimConnect", "Flight data from MSFS 2024. Pick SimConnect.dll from the MSFS SDK once.", "simconnect", "" },
        };

        Control BuildConnections()
        {
            var page = Page("Connections", "Log in once; the logins stay encrypted on this PC for your Windows user.");
            foreach (var c in Connections)
            {
                var conn = c;
                var card = Ui.MakeCard(CardWidth);
                card.Controls.Add(Ui.Lbl(conn[1], Ui.Title, Ui.Fore));
                card.Controls.Add(Ui.Lbl(conn[2], Ui.Body, Ui.Dim));
                var st = new StatusLabel();
                card.Controls.Add(st);
                connLabels[conn[0]] = st;
                var row = Ui.Row();
                var connect = Ui.Btn(conn[0] == "simconnect" ? "Find SimConnect.dll…" : conn[0] == "cs2" ? "Set up CS2" : conn[0] == "steam" || conn[0] == "sayintentions" ? "Add key…" : "Connect…", true);
                connect.Click += delegate
                {
                    if (!HubApi.Run(conn[3])) { NotRunning(); return; }
                    if (conn[0] == "spotify") MessageBox.Show(this, "A small window asks for your Spotify Client ID (it may open behind this one).\n\nNew to this? On the panel, the Spotify tile → How? shows the steps.", HubApp.Name);
                    RefreshSoon();
                };
                row.Controls.Add(connect);
                if (conn[4] == "1")
                {
                    var forget = Ui.Btn("Sign out", false);
                    forget.Click += delegate
                    {
                        if (MessageBox.Show(this, "Remove the " + conn[1] + " login from this PC?", HubApp.Name, MessageBoxButtons.YesNo) != DialogResult.Yes) return;
                        var b = new Dictionary<string, object>();
                        b["what"] = "forget";
                        b["service"] = conn[0];
                        if (!HubApi.Do(b)) NotRunning();
                        RefreshSoon();
                    };
                    forgetButtons[conn[0]] = forget;
                    row.Controls.Add(forget);
                }
                card.Controls.Add(row);
                page.Controls.Add(card);
            }
            return page;
        }

        // ================================================================== Panel

        Control BuildPanel()
        {
            var page = Page("Panel", "Settings for the panel, things to add, and your layout backups.");

            var startCard = Ui.MakeCard(CardWidth);
            startCard.Controls.Add(Ui.Lbl("Start with Windows", Ui.Title, Ui.Fore));
            autostart = new CheckBox { Text = "Start Control Hub Service when I sign in (recommended, the panel needs it)", AutoSize = true, ForeColor = Ui.Fore, BackColor = Color.Transparent, Font = Ui.Body, Margin = new Padding(0, 4, 0, 6) };
            autostart.CheckedChanged += delegate
            {
                if (settingAutostart) return;
                if (!HubApi.Run(autostart.Checked ? "autostartOn" : "autostartOff")) NotRunning();
                RefreshSoon();
            };
            startCard.Controls.Add(autostart);
            page.Controls.Add(startCard);

            var addCard = Ui.MakeCard(CardWidth);
            addCard.Controls.Add(Ui.Lbl("Add to the panel", Ui.Title, Ui.Fore));
            addCard.Controls.Add(Ui.Lbl("Programs and websites show up when you pick what a button opens.", Ui.Body, Ui.Dim));
            var row = Ui.Row();
            AddAction(row, "Add a program…", "addProgram");
            AddAction(row, "Add a website…", "addWebsite");
            AddAction(row, "Add a calendar link…", "addCalendar");
            AddAction(row, "Add a button picture…", "addPicture");
            AddAction(row, "Open pictures folder", "openPictures");
            addCard.Controls.Add(row);
            page.Controls.Add(addCard);

            var bCard = Ui.MakeCard(CardWidth);
            bCard.Controls.Add(Ui.Lbl("Layout backups", Ui.Title, Ui.Fore));
            bCard.Controls.Add(Ui.Lbl("The panel saves a copy of your layout by itself. Restore one if something went wrong.", Ui.Body, Ui.Dim));
            backupNote = Ui.Lbl("", Ui.Small, Ui.Warn);
            bCard.Controls.Add(backupNote);
            backupList = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoSize = true, BackColor = Ui.Card, Margin = new Padding(0, 4, 0, 4) };
            bCard.Controls.Add(backupList);
            var bRow = Ui.Row();
            var reload = Ui.Btn("Refresh list", false);
            reload.Click += delegate { LoadBackups(); };
            bRow.Controls.Add(reload);
            AddAction(bRow, "Open backups folder", "openBackups");
            bCard.Controls.Add(bRow);
            page.Controls.Add(bCard);
            return page;
        }

        void AddAction(FlowLayoutPanel row, string text, string what)
        {
            var b = Ui.Btn(text, false);
            b.Click += delegate { if (!HubApi.Run(what)) NotRunning(); };
            row.Controls.Add(b);
        }

        void LoadBackups()
        {
            if (backupList == null) return;
            ThreadPool.QueueUserWorkItem(delegate
            {
                var d = HubApi.Get("/api/backups", 4000);
                if (IsDisposed) return;
                try { BeginInvoke((MethodInvoker)delegate { ShowBackups(d); }); } catch { }
            });
        }

        void ShowBackups(Dictionary<string, object> d)
        {
            backupList.SuspendLayout();
            backupList.Controls.Clear();
            if (d == null) backupList.Controls.Add(Ui.Lbl("Start Control Hub Service to see your backups.", Ui.Body, Ui.Dim));
            else
            {
                var list = HubApi.List(d, "backups");
                if (list.Count == 0) backupList.Controls.Add(Ui.Lbl("No backups yet. The panel makes them by itself.", Ui.Body, Ui.Dim));
                int shown = 0;
                foreach (var b in list)
                {
                    if (shown++ >= 12) break;
                    var bk = b;
                    string name = HubApi.Str(bk, "name") ?? "";
                    var when = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(HubApi.Long(bk, "time")).ToLocalTime();
                    string kind = HubApi.Str(bk, "kind") ?? "";
                    string what = kind == "auto" ? "Automatic" : kind.StartsWith("before") ? "Before a change" : kind == "manual" ? "Saved by you" : kind;
                    var line = new FlowLayoutPanel { FlowDirection = FlowDirection.LeftToRight, AutoSize = true, WrapContents = false, BackColor = Ui.Card, Margin = new Padding(0, 0, 0, 2) };
                    var lbl = Ui.Lbl(when.ToString("ddd d MMM  HH:mm") + "   ·   " + what + "   ·   " + HubApi.Long(bk, "pages") + " pages, " + HubApi.Long(bk, "tiles") + " tiles", Ui.Body, Ui.Fore);
                    lbl.Margin = new Padding(0, 8, 14, 0);
                    lbl.MinimumSize = new Size(470, 0);
                    var restore = Ui.Btn("Restore", false);
                    restore.Click += delegate
                    {
                        if (MessageBox.Show(this, "Restore the layout from " + when.ToString("dddd d MMMM HH:mm") + "?\n\nThe panel keeps a copy of the current layout first, just in case.", HubApp.Name, MessageBoxButtons.YesNo) != DialogResult.Yes) return;
                        var body = new Dictionary<string, object>();
                        body["what"] = "restore";
                        body["name"] = name;
                        if (HubApi.Do(body)) backupNote.Text = "Sent to the panel. It restores the layout within a few seconds (the panel has to be on).";
                        else NotRunning();
                    };
                    line.Controls.Add(lbl);
                    line.Controls.Add(restore);
                    backupList.Controls.Add(line);
                }
            }
            backupList.ResumeLayout();
        }

        // ================================================================== Help

        Control BuildHelp()
        {
            var page = Page("Help", "If something doesn't work, copy the details below and send them to Claude.");
            var card = Ui.MakeCard(CardWidth);
            var row = Ui.Row();
            var copy = Ui.Btn("Copy details for Claude", true);
            copy.Click += delegate { CopyDetails(); };
            var refresh = Ui.Btn("Refresh", false);
            refresh.Click += delegate { LoadLog(); };
            var open = Ui.Btn("Open log file", false);
            open.Click += delegate { if (!HubApi.Run("openLog")) NotRunning(); };
            row.Controls.Add(copy); row.Controls.Add(refresh); row.Controls.Add(open);
            card.Controls.Add(row);
            logBox = new TextBox
            {
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                WordWrap = false,
                BackColor = Color.FromArgb(9, 14, 26),
                ForeColor = Color.FromArgb(190, 205, 230),
                Font = Ui.Mono,
                BorderStyle = BorderStyle.None,
                Size = new Size(CardWidth - 40, 380),
                Margin = new Padding(0, 6, 0, 6)
            };
            card.Controls.Add(logBox);
            page.Controls.Add(card);
            return page;
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
            sb.AppendLine("Control Hub " + HubApp.Version + " on " + Environment.OSVersion.VersionString);
            if (status != null)
            {
                sb.AppendLine("Service " + HubApi.Str(status, "version") + ", start with Windows: " + HubApi.Bool(status, "autostart") + ", panel seen " + HubApi.Long(status, "panelSeconds") + " s ago");
                var conns = HubApi.Obj(status, "connections");
                if (conns != null) foreach (var kv in conns) sb.AppendLine("  " + kv.Key + ": " + HubApi.Str(kv.Value as Dictionary<string, object>, "text"));
            }
            else sb.AppendLine("Service: not running");
            sb.AppendLine("--- log ---");
            sb.AppendLine(logBox != null ? logBox.Text : "");
            try { Clipboard.SetText(sb.ToString()); MessageBox.Show(this, "Copied. Paste it into the chat with Claude.", HubApp.Name); }
            catch (Exception ex) { MessageBox.Show(this, "Couldn't copy: " + ex.Message, HubApp.Name); }
        }

        // ================================================================== status

        void NotRunning()
        {
            MessageBox.Show(this, "Control Hub Service isn't running. Start it first (Projects → Start service).", HubApp.Name);
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
            offline.Visible = !up;
            cpStart.Visible = !up;
            if (!up)
            {
                bool proc = HubApp.ServiceRunning();
                cpService.Set(proc ? "Control Hub Service is starting or not answering…" : "Control Hub Service isn't running", proc ? Ui.Warn : Ui.Bad);
                cpPanel.Set("Panel: unknown", Ui.Dim);
                cpVersions.Text = "";
                foreach (var kv in connLabels) kv.Value.Set("Unknown (service not running)", Ui.Dim);
                UpdateProjectStatus();
                return;
            }
            cpService.Set("Control Hub Service is running", Ui.Good);
            long secs = HubApi.Long(d, "panelSeconds");
            if (secs < 0) cpPanel.Set("Panel: not seen since the service started", Ui.Warn);
            else if (secs <= 30) cpPanel.Set("Panel: connected", Ui.Good);
            else cpPanel.Set("Panel: last seen " + (secs < 120 ? secs + " seconds" : (secs / 60) + " minutes") + " ago", Ui.Warn);
            string wv = HubApi.Str(d, "widgetVersion");
            string panelSource = HubApi.Bool(d, "panelFromHub") ? "loaded from Control Hub" : secs < 0 ? "not loaded yet" : "using its built-in copy";
            cpVersions.Text = "Service " + HubApi.Str(d, "version") + "  ·  Control Hub " + HubApp.Version +
                (string.IsNullOrEmpty(wv) ? "" : "  ·  Panel " + wv + " (" + panelSource + ")");

            var conns = HubApi.Obj(d, "connections");
            foreach (var kv in connLabels)
            {
                var c = HubApi.Obj(conns, kv.Key);
                if (kv.Key == "simconnect") { kv.Value.Set("Set up once; the panel shows when flight data comes in", Ui.Dim); continue; }
                if (c == null) { kv.Value.Set("Unknown", Ui.Dim); continue; }
                bool on = HubApi.Bool(c, "on"), conf = HubApi.Bool(c, "configured");
                kv.Value.Set(HubApi.Str(c, "text") ?? "", on ? Ui.Good : conf ? Ui.Warn : Ui.Dim);
                Button f;
                if (forgetButtons.TryGetValue(kv.Key, out f)) f.Visible = on;
            }

            settingAutostart = true;
            autostart.Checked = HubApi.Bool(d, "autostart");
            settingAutostart = false;
            UpdateProjectStatus();
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            timer.Stop();
            base.OnFormClosed(e);
        }
    }
}
