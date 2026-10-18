// Control Hub Service — the tray part of Control Hub. Powers the Control Panel iCUE widget (formerly "Control Panel Helper").
// Written for C# 5 / .NET Framework 4.x so it builds with the compiler that ships with Windows.
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace ControlPanelHelper
{
    static class Program
    {
        public const string Version = "3.6.0";
        public const string AppName = "Control Hub Service";
        /// <summary>The old helper was set to start with Windows (so this service takes that over).</summary>
        public static bool HadOldAutostart;

        [STAThread]
        static void Main(string[] args)
        {
            bool fromAutostart = args != null && Array.IndexOf(args, "--autostart") >= 0;
            bool createdNew;
            using (var mutex = new Mutex(true, "ControlHub.Service.SingleInstance", out createdNew))
            {
                if (!createdNew)
                {
                    // Already running: started by hand → open the Control Hub app; at sign-in → nothing to do.
                    if (!fromAutostart) Hub.OpenApp();
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                // Close an old "Control Panel Helper" (same port) and bring its settings over, before anything reads them.
                HadOldAutostart = Hub.TakeOver();
                Hub.Migrate();
                Log.Init();
                Hub.LogTakeover();
                AppDomain.CurrentDomain.UnhandledException += delegate (object s, UnhandledExceptionEventArgs e)
                {
                    Log.Write("Unhandled: " + e.ExceptionObject);
                };
                Application.ThreadException += delegate (object s, ThreadExceptionEventArgs e)
                {
                    Log.Write("UI thread: " + e.Exception);
                };
                Application.Run(new TrayApp(fromAutostart));
            }
        }
    }

    /// <summary>The tray icon and its menu. Owns the HTTP server.</summary>
    class TrayApp : ApplicationContext
    {
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        const string RunName = Hub.RunName;

        readonly NotifyIcon tray;
        readonly ToolStripMenuItem startupItem;
        readonly ToolStripMenuItem customMenu;
        readonly Server server;
        readonly SynchronizationContext ui;

        public TrayApp(bool fromAutostart)
        {
            ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
            Settings.Load();

            // First run: start with Windows by default (can be switched off in the menu).
            if (!Settings.Current.AutostartAsked)
            {
                Settings.Current.AutostartAsked = true;
                SetAutostart(true);
                Settings.Save();
            }
            // The old helper started with Windows: this service does that from now on.
            if (Program.HadOldAutostart) SetAutostart(true);
            Hub.Ui = ui;

            var menu = new ContextMenuStrip();
            var title = new ToolStripMenuItem(Program.AppName + " " + Program.Version) { Enabled = false };
            menu.Items.Add(title);
            var openHub = new ToolStripMenuItem("Open Control Hub");
            openHub.Font = new Font(openHub.Font, FontStyle.Bold);
            openHub.Click += delegate { Hub.OpenApp(); };
            menu.Items.Add(openHub);
            menu.Items.Add(new ToolStripSeparator());

            var addProgram = new ToolStripMenuItem("Add a program…");
            addProgram.Click += delegate { AddProgram(); };
            var addWebsite = new ToolStripMenuItem("Add a website…");
            addWebsite.Click += delegate { AddWebsite(); };
            var connectSpotify = new ToolStripMenuItem("Connect Spotify…");
            connectSpotify.Click += delegate
            {
                string id = InputForm.Ask("Connect Spotify", "Client ID (developer.spotify.com → Dashboard → your app → Settings):", Settings.Current.SpotifyClientId ?? "");
                if (id == null) return;
                Spotify.Connect(id);
                tray.ShowBalloonTip(6000, Program.AppName, "Your browser opens Spotify: log in and click Agree.", ToolTipIcon.Info);
            };
            var connectTwitch = new ToolStripMenuItem("Connect Twitch…");
            connectTwitch.Click += delegate
            {
                string id = InputForm.Ask("Connect Twitch", "Client ID (dev.twitch.tv → Your Console → Applications → Manage):", Settings.Current.TwitchClientId ?? "");
                if (id == null) return;
                string code = Twitch.Connect(id);
                if (code == null) MessageBox.Show("Twitch didn't accept that Client ID. Is the app's Client Type set to Public?", Program.AppName);
                else tray.ShowBalloonTip(15000, Program.AppName, "In the browser, check the code is " + code + " and click Activate.", ToolTipIcon.Info);
            };
            var steamKey = new ToolStripMenuItem("Steam Web API key…");
            steamKey.Click += delegate
            {
                string k = InputForm.Ask("Steam friends", "Only for seeing friends online. Key from steamcommunity.com/dev/apikey:", Settings.Current.SteamKey ?? "");
                if (k == null) return;
                Settings.Current.SteamKey = k.Trim();
                Settings.Save();
            };
            var siKey = new ToolStripMenuItem("SayIntentions API key…");
            siKey.Click += delegate
            {
                string k = InputForm.Ask("SayIntentions", "Only needed if the panel can't find it by itself. Pilot Portal → API Key (ACARS ID):", Settings.Current.SayIntentionsKey ?? "");
                if (k == null) return;
                Settings.Current.SayIntentionsKey = k.Trim();
                Settings.Save();
            };
            var cs2Item = new ToolStripMenuItem("Set up Counter-Strike 2…");
            cs2Item.Click += delegate
            {
                string st = Cs2.State3();
                if (st == "nocs2") { MessageBox.Show("Counter-Strike 2 wasn't found in your Steam library.", Program.AppName); return; }
                if (Cs2.Install())
                    MessageBox.Show("Done. CS2 now sends your score, health, money and so on to the panel.\n\nThis is Valve's own Game State Integration (the same thing iCUE's CS2 lighting uses). It doesn't touch the game, so it's VAC-safe.\n\nRestart CS2 if it's open.", Program.AppName);
                else MessageBox.Show("Couldn't write the file into CS2's cfg folder. See the log.", Program.AppName);
            };
            var simDll = new ToolStripMenuItem("Find SimConnect.dll…");
            simDll.Click += delegate
            {
                using (var dlg = new OpenFileDialog())
                {
                    dlg.Title = "Pick SimConnect.dll (MSFS 2024 SDK → SimConnect SDK → lib)";
                    dlg.Filter = "SimConnect.dll|SimConnect.dll";
                    if (Directory.Exists(@"C:\MSFS 2024 SDK\SimConnect SDK\lib")) dlg.InitialDirectory = @"C:\MSFS 2024 SDK\SimConnect SDK\lib";
                    if (dlg.ShowDialog() != DialogResult.OK) return;
                    if (Sim.Keep(dlg.FileName)) tray.ShowBalloonTip(5000, Program.AppName, "Got it. SimConnect.dll is kept safe now, also when Control Hub updates.", ToolTipIcon.Info);
                    else MessageBox.Show("Couldn't copy that file. See the log.", Program.AppName);
                }
            };
            var connectDiscord = new ToolStripMenuItem("Connect Discord…");
            connectDiscord.Click += delegate { ConnectDiscord(); };
            var addCalendar = new ToolStripMenuItem("Add a calendar link…");
            addCalendar.Click += delegate { AddCalendar(); };
            customMenu = new ToolStripMenuItem("Your added shortcuts");
            var addPicture = new ToolStripMenuItem("Add a button picture…");
            addPicture.Click += delegate { AddPicture(); };
            var openPictures = new ToolStripMenuItem("Open pictures folder");
            openPictures.Click += delegate
            {
                try { Directory.CreateDirectory(Pictures.Folder); System.Diagnostics.Process.Start(Pictures.Folder); } catch { }
            };
            menu.Items.Add(addProgram);
            menu.Items.Add(addWebsite);
            menu.Items.Add(addCalendar);
            menu.Items.Add(connectDiscord);
            menu.Items.Add(siKey);
            menu.Items.Add(connectSpotify);
            menu.Items.Add(connectTwitch);
            menu.Items.Add(steamKey);
            menu.Items.Add(cs2Item);
            menu.Items.Add(simDll);
            menu.Items.Add(customMenu);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(addPicture);
            menu.Items.Add(openPictures);
            var openBackups = new ToolStripMenuItem("Open backups folder");
            openBackups.Click += delegate
            {
                try { Directory.CreateDirectory(Backups.Folder); System.Diagnostics.Process.Start(Backups.Folder); } catch { }
            };
            menu.Items.Add(openBackups);
            menu.Items.Add(new ToolStripSeparator());

            startupItem = new ToolStripMenuItem("Start with Windows") { CheckOnClick = true, Checked = IsAutostart() };
            startupItem.CheckedChanged += delegate { SetAutostart(startupItem.Checked); };
            menu.Items.Add(startupItem);

            var logItem = new ToolStripMenuItem("Open log file");
            logItem.Click += delegate { try { System.Diagnostics.Process.Start(Log.FilePath); } catch { } };
            menu.Items.Add(logItem);

            var quit = new ToolStripMenuItem("Quit");
            quit.Click += delegate { ExitThread(); };
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(quit);
            menu.Opening += delegate { RebuildCustomMenu(); };

            // The Control Hub app can start the same things as this menu.
            Reg("addProgram", addProgram); Reg("addWebsite", addWebsite); Reg("addCalendar", addCalendar);
            Reg("connectDiscord", connectDiscord); Reg("sayIntentionsKey", siKey); Reg("connectSpotify", connectSpotify);
            Reg("connectTwitch", connectTwitch); Reg("steamKey", steamKey); Reg("cs2", cs2Item); Reg("simconnect", simDll);
            Reg("addPicture", addPicture); Reg("openPictures", openPictures); Reg("openBackups", openBackups); Reg("openLog", logItem);
            Hub.Actions["autostartOn"] = delegate { startupItem.Checked = true; };
            Hub.Actions["autostartOff"] = delegate { startupItem.Checked = false; };
            menu.Opening += delegate { if (startupItem.Checked != IsAutostart()) startupItem.Checked = IsAutostart(); };

            tray = new NotifyIcon
            {
                Icon = TrayIcon.Create(),
                Text = Program.AppName,
                ContextMenuStrip = menu,
                Visible = true
            };
            tray.DoubleClick += delegate { Hub.OpenApp(); };

            LayoutFile.Ui = ui;
            Sim.Start();
            try { ProcWatch.Start(ui); } catch (Exception ex) { Log.Write("Program watcher: " + ex.Message); }
            ThreadPool.QueueUserWorkItem(delegate { Notifs.Start(); });
            try { AutoBackup.Start(); } catch (Exception ex) { Log.Write("Automatic backup: " + ex.Message); }
            try { PageKeys.Start(); } catch (Exception ex) { Log.Write("Page shortcuts: " + ex.Message); }
            try { GameFocus.Start(); } catch (Exception ex) { Log.Write("Game focus: " + ex.Message); }
            try { FlightRec.Start(); } catch (Exception ex) { Log.Write("FlightLine: " + ex.Message); }
            try { ClipHistory.Start(ui); } catch (Exception ex) { Log.Write("Clipboard listener: " + ex.Message); }

            server = new Server(Settings.Current.Port);
            try
            {
                server.Start();
            }
            catch (Exception ex)
            {
                Log.Write("Server start failed: " + ex.Message);
                tray.ShowBalloonTip(8000, Program.AppName,
                    "Could not start on port " + Settings.Current.Port + ". Is another copy running?", ToolTipIcon.Warning);
            }

            // Started by hand (not by Windows at sign-in): say where the icon is.
            if (!fromAutostart)
                tray.ShowBalloonTip(6000, Program.AppName + " is running",
                    "It lives here by the clock. If you don't see the icon, click the small ^ arrow. Right-click it for options.", ToolTipIcon.Info);

            // Warm up the installed-apps list in the background so the first picker opens fast.
            ThreadPool.QueueUserWorkItem(delegate { try { Apps.GetAll(false); } catch (Exception ex) { Log.Write("Apps: " + ex.Message); } });
        }

        static void Reg(string key, ToolStripMenuItem item)
        {
            Hub.Actions[key] = delegate { item.PerformClick(); };
        }

        void RebuildCustomMenu()
        {
            customMenu.DropDownItems.Clear();
            var list = Settings.Current.Custom;
            if (list.Count == 0)
            {
                customMenu.DropDownItems.Add(new ToolStripMenuItem("(none yet)") { Enabled = false });
                return;
            }
            foreach (var c in list.ToArray())
            {
                var item = new ToolStripMenuItem((c.Kind == "calendar" ? "Calendar: " : "") + c.Name + "  —  Remove");
                var captured = c;
                item.Click += delegate
                {
                    Settings.Current.Custom.Remove(captured);
                    Settings.Save();
                };
                customMenu.DropDownItems.Add(item);
            }
        }

        void AddProgram()
        {
            using (var dlg = new OpenFileDialog())
            {
                dlg.Title = "Pick a program for your Control Panel";
                dlg.Filter = "Programs and shortcuts (*.exe;*.lnk;*.bat;*.url)|*.exe;*.lnk;*.bat;*.url|All files (*.*)|*.*";
                dlg.InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
                if (dlg.ShowDialog() != DialogResult.OK) return;
                string path = dlg.FileName;
                string name = Path.GetFileNameWithoutExtension(path);
                try
                {
                    var info = System.Diagnostics.FileVersionInfo.GetVersionInfo(path);
                    if (!string.IsNullOrEmpty(info.FileDescription)) name = info.FileDescription.Trim();
                }
                catch { }
                name = InputForm.Ask("Name for the button", "Name:", name);
                if (name == null) return;
                Settings.Current.Custom.Add(new CustomShortcut { Id = Settings.NewId(), Name = Clip(name, 40), Kind = "file", Target = path });
                Settings.Save();
                tray.ShowBalloonTip(4000, Program.AppName, "Added \"" + name + "\". Pick it on your XENEON EDGE: ✏ on a shortcut tile → Apps.", ToolTipIcon.Info);
            }
        }

        void AddPicture()
        {
            using (var dlg = new OpenFileDialog())
            {
                dlg.Title = "Pick a picture for your buttons";
                dlg.Filter = "Pictures (*.png;*.jpg;*.jpeg;*.gif;*.webp;*.svg;*.ico;*.bmp)|*.png;*.jpg;*.jpeg;*.gif;*.webp;*.svg;*.ico;*.bmp";
                dlg.Multiselect = true;
                if (dlg.ShowDialog() != DialogResult.OK) return;
                int added = 0;
                foreach (var f in dlg.FileNames)
                {
                    try { Pictures.Add(f); added++; }
                    catch (Exception ex) { MessageBox.Show(Path.GetFileName(f) + ": " + ex.Message, Program.AppName); }
                }
                if (added > 0)
                    tray.ShowBalloonTip(4000, Program.AppName, "Added " + added + " picture" + (added == 1 ? "" : "s") +
                        ". On your XENEON EDGE: ✏ on a custom button → Look → Pictures.", ToolTipIcon.Info);
            }
        }

        /// <summary>Spotify share links become spotify: links so they open in the Spotify app.</summary>
        static string SpotifyUri(string url)
        {
            if (url.StartsWith("spotify:", StringComparison.OrdinalIgnoreCase)) return url;
            Uri u;
            if (!Uri.TryCreate(url, UriKind.Absolute, out u) || !u.Host.EndsWith("open.spotify.com", StringComparison.OrdinalIgnoreCase)) return null;
            var parts = u.AbsolutePath.Trim('/').Split('/');
            // Links can look like /playlist/ID or /intl-da/playlist/ID
            for (int i = 0; i + 1 < parts.Length; i++)
            {
                string kind = parts[i].ToLowerInvariant();
                if (kind == "playlist" || kind == "album" || kind == "track" || kind == "artist" || kind == "show" || kind == "episode")
                {
                    string id = parts[i + 1];
                    foreach (char c in id) if (!char.IsLetterOrDigit(c)) return null;
                    return "spotify:" + kind + ":" + id;
                }
            }
            return null;
        }

        void ConnectDiscord()
        {
            string id = InputForm.Ask("Connect Discord (1 of 2)",
                "Client ID (Discord Developer Portal → your app → OAuth2):", Settings.Current.DiscordClientId ?? "");
            if (id == null) return;
            id = id.Trim();
            foreach (char ch in id) if (!char.IsDigit(ch)) { MessageBox.Show("The Client ID is only numbers.", Program.AppName); return; }
            string secret = InputForm.Ask("Connect Discord (2 of 2)", "Client Secret (OAuth2 → Reset Secret → Copy):", "");
            if (secret == null) return;
            DiscordLink.Setup(id, secret);
            tray.ShowBalloonTip(6000, Program.AppName, "Now open Discord: it asks if Control Panel may connect. Click Authorize.", ToolTipIcon.Info);
        }

        void AddCalendar()
        {
            string url = InputForm.Ask("Add a calendar",
                "Private iCal link (Google: Settings → your calendar → Secret address in iCal format):", "https://");
            if (url == null) return;
            url = Calendars.Clean(url);
            if (url == null)
            {
                MessageBox.Show("That doesn't look like a calendar link. It should start with https:// or webcal:// and usually ends with .ics", Program.AppName);
                return;
            }
            string name = InputForm.Ask("Name for the calendar", "Name:", url.Contains("google.com") ? "Google" : url.Contains("outlook") ? "Outlook" : "Calendar");
            if (name == null) return;
            Settings.Current.Custom.Add(new CustomShortcut { Id = Settings.NewId(), Name = Clip(name, 40), Kind = "calendar", Target = url });
            Settings.Save();
            tray.ShowBalloonTip(4000, Program.AppName, "Added the calendar \"" + name + "\". Add a Calendar tile on your XENEON EDGE.", ToolTipIcon.Info);
        }

        void AddWebsite()
        {
            string url = InputForm.Ask("Add a website or Spotify playlist", "Web address, or a Spotify share link (Share → Copy link):", "https://");
            if (url == null) return;
            url = url.Trim();
            string spotify = SpotifyUri(url);
            if (spotify != null)
            {
                string sname = InputForm.Ask("Name for the button", "Name:", "Spotify playlist");
                if (sname == null) return;
                Settings.Current.Custom.Add(new CustomShortcut { Id = Settings.NewId(), Name = Clip(sname, 40), Kind = "url", Target = spotify });
                Settings.Save();
                tray.ShowBalloonTip(4000, Program.AppName, "Added \"" + sname + "\". Use it in a shortcut (Websites) or a custom button.", ToolTipIcon.Info);
                return;
            }
            if (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                url = "https://" + url;
            Uri uri;
            if (!Uri.TryCreate(url, UriKind.Absolute, out uri) || (uri.Scheme != "http" && uri.Scheme != "https"))
            {
                MessageBox.Show("That doesn't look like a web address.", Program.AppName);
                return;
            }
            string host = uri.Host.StartsWith("www.") ? uri.Host.Substring(4) : uri.Host;
            string name = InputForm.Ask("Name for the button", "Name:", host);
            if (name == null) return;
            Settings.Current.Custom.Add(new CustomShortcut { Id = Settings.NewId(), Name = Clip(name, 40), Kind = "url", Target = uri.AbsoluteUri });
            Settings.Save();
            tray.ShowBalloonTip(4000, Program.AppName, "Added \"" + name + "\". Pick it on your XENEON EDGE: ✏ on a shortcut tile → Websites.", ToolTipIcon.Info);
        }

        static string Clip(string s, int n) { s = (s ?? "").Trim(); return s.Length > n ? s.Substring(0, n) : s; }

        static bool IsAutostart()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(RunKey, false))
                    return key != null && key.GetValue(RunName) != null;
            }
            catch { return false; }
        }

        static void SetAutostart(bool on)
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(RunKey, true) ?? Registry.CurrentUser.CreateSubKey(RunKey))
                {
                    if (on) key.SetValue(RunName, "\"" + Application.ExecutablePath + "\" --autostart");
                    else if (key.GetValue(RunName) != null) key.DeleteValue(RunName, false);
                }
            }
            catch (Exception ex) { Log.Write("Autostart: " + ex.Message); }
        }

        protected override void ExitThreadCore()
        {
            try { server.Stop(); } catch { }
            KeepAwake.Set(false);
            Keys.ReleaseHeld();
            MicTest.Cancel();
            tray.Visible = false;
            tray.Dispose();
            base.ExitThreadCore();
        }
    }

    /// <summary>Draws the tray icon at runtime (no icon file needed).</summary>
    static class TrayIcon
    {
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern bool DestroyIcon(IntPtr handle);

        public static Icon Create()
        {
            // The Control Hub logo (built into the program); the drawn tiles below are only a fallback.
            try
            {
                var s = typeof(TrayIcon).Assembly.GetManifestResourceStream("ControlHub.ico");
                if (s != null) using (s) return new Icon(s, SystemInformation.SmallIconSize);
            }
            catch { }
            int size = SystemInformation.SmallIconSize.Width;
            if (size < 16) size = 16;
            using (var bmp = new Bitmap(size, size))
            {
                using (var g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.Clear(Color.Transparent);
                    float pad = size * 0.06f, gap = size * 0.1f;
                    float cell = (size - 2 * pad - gap) / 2f;
                    var colors = new[] { Color.FromArgb(255, 45, 212, 191), Color.White, Color.White, Color.FromArgb(255, 45, 212, 191) };
                    for (int i = 0; i < 4; i++)
                    {
                        float x = pad + (i % 2) * (cell + gap), y = pad + (i / 2) * (cell + gap);
                        using (var path = RoundRect(x, y, cell, cell, cell * 0.3f))
                        using (var brush = new SolidBrush(colors[i]))
                            g.FillPath(brush, path);
                    }
                }
                IntPtr h = bmp.GetHicon();
                Icon icon = (Icon)Icon.FromHandle(h).Clone();
                DestroyIcon(h);
                return icon;
            }
        }

        static GraphicsPath RoundRect(float x, float y, float w, float h, float r)
        {
            var p = new GraphicsPath();
            p.AddArc(x, y, r * 2, r * 2, 180, 90);
            p.AddArc(x + w - r * 2, y, r * 2, r * 2, 270, 90);
            p.AddArc(x + w - r * 2, y + h - r * 2, r * 2, r * 2, 0, 90);
            p.AddArc(x, y + h - r * 2, r * 2, r * 2, 90, 90);
            p.CloseFigure();
            return p;
        }
    }

    /// <summary>A small text-input dialog.</summary>
    class InputForm : Form
    {
        readonly TextBox box;

        InputForm(string title, string label, string value)
        {
            Text = title;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen;
            MinimizeBox = false; MaximizeBox = false; ShowInTaskbar = true; TopMost = true;
            ClientSize = new Size(460, 130);
            Font = new Font("Segoe UI", 10f);
            var lbl = new Label { Text = label, Left = 14, Top = 14, Width = 430, AutoSize = false, Height = 22 };
            box = new TextBox { Text = value, Left = 14, Top = 42, Width = 430 };
            var ok = new Button { Text = "OK", DialogResult = DialogResult.OK, Left = 268, Top = 84, Width = 84, Height = 30 };
            var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, Left = 360, Top = 84, Width = 84, Height = 30 };
            Controls.AddRange(new Control[] { lbl, box, ok, cancel });
            AcceptButton = ok; CancelButton = cancel;
            Shown += delegate { box.Focus(); box.SelectAll(); Activate(); };
        }

        public static string Ask(string title, string label, string value)
        {
            using (var f = new InputForm(title, label, value))
            {
                if (f.ShowDialog() != DialogResult.OK) return null;
                string v = f.box.Text.Trim();
                return v.Length == 0 ? null : v;
            }
        }
    }

    /// <summary>Tiny log file in %APPDATA%\ControlHub (kept small).</summary>
    static class Log
    {
        public static string FilePath;
        static readonly object Gate = new object();

        public static void Init()
        {
            FilePath = Path.Combine(Settings.Folder, "service.log");
            try
            {
                Directory.CreateDirectory(Settings.Folder);
                if (File.Exists(FilePath) && new FileInfo(FilePath).Length > 256 * 1024) File.Delete(FilePath);
            }
            catch { }
            Write("Started " + Program.AppName + " " + Program.Version);
        }

        public static void Write(string msg)
        {
            lock (Gate)
            {
                try { File.AppendAllText(FilePath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + msg + Environment.NewLine); }
                catch { }
            }
        }
    }
}
