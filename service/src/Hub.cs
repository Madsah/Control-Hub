// Control Hub Service: taking over from the old "Control Panel Helper", and what the Control Hub app talks to.
// C# 5 / .NET Framework 4.x (built with the compiler that ships with Windows).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace ControlPanelHelper
{
    static class Hub
    {
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        const string OldRunName = "ControlPanelHelper";
        public const string RunName = "ControlHubService";
        public const string AppExe = "Control Hub.exe";

        static readonly string OldFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ControlPanelHelper");

        /// <summary>Tray menu actions the Control Hub app may start (same as clicking them in the tray menu).</summary>
        public static readonly Dictionary<string, Action> Actions = new Dictionary<string, Action>();
        public static SynchronizationContext Ui;
        public static readonly DateTime Started = DateTime.UtcNow;
        static long panelSeen; // ticks of the last request from the widget
        static readonly List<string> takeoverNotes = new List<string>();

        // ------------------------------------------------------------------ taking over from the old helper

        /// <summary>
        /// Runs once at every start, before anything else: closes an old "Control Panel Helper" that is still running
        /// (it holds the same port), and moves its "start with Windows" entry over to this service.
        /// Returns true if the old helper was set to start with Windows.
        /// </summary>
        public static bool TakeOver()
        {
            bool hadAutostart = false;
            try
            {
                foreach (var p in Process.GetProcessesByName("Control Panel Helper"))
                {
                    try
                    {
                        p.Kill();
                        p.WaitForExit(4000);
                        takeoverNotes.Add("Closed the old Control Panel Helper");
                    }
                    catch (Exception ex) { takeoverNotes.Add("Couldn't close the old helper: " + ex.Message); }
                    finally { p.Dispose(); }
                }
            }
            catch (Exception ex) { takeoverNotes.Add("Looking for the old helper: " + ex.Message); }
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(RunKey, true))
                {
                    if (key != null && key.GetValue(OldRunName) != null)
                    {
                        hadAutostart = true;
                        key.DeleteValue(OldRunName, false);
                        takeoverNotes.Add("Removed the old helper from startup");
                    }
                }
            }
            catch (Exception ex) { takeoverNotes.Add("Old startup entry: " + ex.Message); }
            return hadAutostart;
        }

        /// <summary>
        /// The first time: copies the old helper's folder (settings, logins, backups, pictures, flight tracks…) to the
        /// Control Hub folder. The old folder is left as it was, as a spare copy. Logins are encrypted for your Windows
        /// user, so they keep working after the copy.
        /// </summary>
        public static void Migrate()
        {
            try
            {
                string target = Settings.Folder;
                if (File.Exists(Path.Combine(target, "settings.json"))) return;
                if (!Directory.Exists(OldFolder)) return;
                CopyDir(OldFolder, target);
                takeoverNotes.Add("Copied your settings from Control Panel Helper");
            }
            catch (Exception ex) { takeoverNotes.Add("Copying settings failed: " + ex.Message); }
        }

        static void CopyDir(string from, string to)
        {
            Directory.CreateDirectory(to);
            foreach (var f in Directory.GetFiles(from))
            {
                string name = Path.GetFileName(f);
                if (name.Equals("helper.log", StringComparison.OrdinalIgnoreCase)) continue;
                try { File.Copy(f, Path.Combine(to, name), false); } catch { }
            }
            foreach (var d in Directory.GetDirectories(from))
                CopyDir(d, Path.Combine(to, Path.GetFileName(d)));
        }

        /// <summary>Writes what happened during the takeover to the log (the log only exists after Migrate).</summary>
        public static void LogTakeover()
        {
            foreach (var n in takeoverNotes) Log.Write("Takeover: " + n);
        }

        public static void SetRunValue(bool on)
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

        public static bool RunValueSet()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(RunKey, false))
                    return key != null && key.GetValue(RunName) != null;
            }
            catch { return false; }
        }

        // ------------------------------------------------------------------ the Control Hub app

        public static string AppPath
        {
            get { return Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), AppExe); }
        }

        public static void OpenApp()
        {
            try
            {
                if (File.Exists(AppPath)) Process.Start(new ProcessStartInfo(AppPath) { UseShellExecute = true });
                else MessageBox.Show("Control Hub (the app) isn't installed next to the service.\nRun \"Install Control Hub.bat\" again.", Program.AppName);
            }
            catch (Exception ex) { Log.Write("Open Control Hub: " + ex.Message); }
        }

        /// <summary>Runs a tray-menu action on the tray's own thread (dialogs belong there).</summary>
        public static bool Run(string what)
        {
            Action a;
            if (string.IsNullOrEmpty(what) || !Actions.TryGetValue(what, out a)) return false;
            if (Ui != null) Ui.Post(delegate { try { a(); } catch (Exception ex) { Log.Write("Hub action " + what + ": " + ex.Message); } }, null);
            else ThreadPool.QueueUserWorkItem(delegate { try { a(); } catch (Exception ex) { Log.Write("Hub action " + what + ": " + ex.Message); } });
            return true;
        }

        /// <summary>Signs out of a service (the login is removed from this PC).</summary>
        public static bool Forget(string what)
        {
            switch (what)
            {
                case "spotify":
                    Settings.Current.SpotifyAccess = null; Settings.Current.SpotifyRefresh = null; Settings.Current.SpotifyExpires = 0;
                    break;
                case "twitch":
                    Settings.Current.TwitchAccess = null; Settings.Current.TwitchRefresh = null; Settings.Current.TwitchExpires = 0;
                    break;
                case "discord":
                    DiscordLink.Forget();
                    break;
                case "steam":
                    Settings.Current.SteamKey = null;
                    break;
                case "sayintentions":
                    Settings.Current.SayIntentionsKey = null;
                    break;
                default: return false;
            }
            Settings.Save();
            Events.Bump();
            return true;
        }

        // ------------------------------------------------------------------ is the panel there?

        /// <summary>Called for every request; requests that don't come from the Control Hub app count as the panel.</summary>
        public static void Seen(string userAgent)
        {
            if (userAgent != null && userAgent.StartsWith("ControlHub/")) return;
            Interlocked.Exchange(ref panelSeen, DateTime.UtcNow.Ticks);
        }

        /// <summary>Seconds since the panel last asked for something, or -1 if never since the service started.</summary>
        public static int PanelSeconds()
        {
            long t = Interlocked.Read(ref panelSeen);
            if (t == 0) return -1;
            return (int)Math.Max(0, (DateTime.UtcNow - new DateTime(t, DateTimeKind.Utc)).TotalSeconds);
        }

        // ------------------------------------------------------------------ restoring a backup from the app

        static readonly object RestoreGate = new object();
        static string restoreName, restoreId;
        static DateTime restoreAt;

        /// <summary>The app asked to restore a backup: the panel picks it up with its next question.</summary>
        public static bool RequestRestore(string name)
        {
            if (Backups.Read(name) == null) return false;
            lock (RestoreGate)
            {
                restoreName = name;
                restoreId = Guid.NewGuid().ToString("N").Substring(0, 12);
                restoreAt = DateTime.UtcNow;
            }
            Events.Bump();
            return true;
        }

        /// <summary>A waiting restore for the panel (given out once), or null. Requests older than 2 minutes are dropped.</summary>
        public static Dictionary<string, object> TakeRestore()
        {
            lock (RestoreGate)
            {
                if (restoreName == null) return null;
                if ((DateTime.UtcNow - restoreAt).TotalMinutes > 2) { restoreName = null; return null; }
                var d = new Dictionary<string, object>();
                d["name"] = restoreName;
                d["id"] = restoreId;
                restoreName = null;
                return d;
            }
        }

        public static string PendingRestore()
        {
            lock (RestoreGate) return restoreName;
        }

        // ------------------------------------------------------------------ the panel's code, served to the widget
        // The widget in iCUE is a small starter: it loads the panel's files from here when this copy is the same
        // or newer, so panel updates arrive with Control Hub's Update button instead of an iCUE re-import.

        static readonly Dictionary<string, string> Types = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { ".js", "application/javascript; charset=utf-8" }, { ".css", "text/css; charset=utf-8" },
            { ".html", "text/html; charset=utf-8" }, { ".json", "application/json; charset=utf-8" },
            { ".svg", "image/svg+xml" }, { ".png", "image/png" }, { ".jpg", "image/jpeg" }, { ".webp", "image/webp" },
            { ".woff2", "font/woff2" }, { ".woff", "font/woff" }, { ".ttf", "font/ttf" }
        };
        static long panelCodeAt;
        static string panelCodeVersion;

        public static string WidgetDir
        {
            get { return Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "widget"); }
        }

        /// <summary>
        /// The version of the panel code Control Hub has: the "version" in its widget\files.js. (manifest.json's version
        /// only changes when the starter in iCUE changes, so ordinary panel updates need no import in iCUE.)
        /// </summary>
        public static Dictionary<string, object> WidgetVersion()
        {
            var d = new Dictionary<string, object>();
            d["ok"] = false;
            try
            {
                string f = Path.Combine(WidgetDir, "files.js");
                if (!File.Exists(f) || !File.Exists(Path.Combine(WidgetDir, "index.html"))) return d;
                var m = System.Text.RegularExpressions.Regex.Match(File.ReadAllText(f, Encoding.UTF8), "version\\s*:\\s*\"([0-9][0-9.]*)\"");
                if (m.Success)
                {
                    d["ok"] = true;
                    d["version"] = m.Groups[1].Value;
                }
            }
            catch (Exception ex) { Log.Write("Widget version: " + ex.Message); }
            return d;
        }

        /// <summary>A file of the panel's code (only inside the widget folder, only known file types).</summary>
        public static bool WidgetFile(string rel, out byte[] data, out string type)
        {
            data = null; type = null;
            try
            {
                rel = Uri.UnescapeDataString(rel ?? "");
                if (rel.Length == 0 || rel.Length > 200 || rel.Contains("..") || rel.Contains(":") || rel.Contains("\\") || rel.StartsWith("/")) return false;
                string ext = Path.GetExtension(rel);
                if (!Types.TryGetValue(ext, out type)) return false;
                string root = Path.GetFullPath(WidgetDir);
                string full = Path.GetFullPath(Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar)));
                if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !File.Exists(full)) return false;
                data = File.ReadAllBytes(full);
                if (rel == "files.js")
                {
                    Interlocked.Exchange(ref panelCodeAt, DateTime.UtcNow.Ticks);
                    var v = WidgetVersion();
                    object vv;
                    panelCodeVersion = v.TryGetValue("version", out vv) ? vv as string : null;
                }
                return true;
            }
            catch (Exception ex) { Log.Write("Widget file " + rel + ": " + ex.Message); return false; }
        }

        // ------------------------------------------------------------------ status for the app

        public static Dictionary<string, object> Status()
        {
            var d = new Dictionary<string, object>();
            d["ok"] = true;
            d["service"] = Program.AppName;
            d["version"] = Program.Version;
            d["started"] = (long)(Started - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
            d["port"] = Settings.Current.Port;
            d["autostart"] = RunValueSet();
            d["panelSeconds"] = PanelSeconds();
            d["restorePending"] = PendingRestore();
            d["folder"] = Settings.Folder;
            d["log"] = Log.FilePath;
            // Where the panel got its code: from here (since this service started), or its own built-in copy.
            d["panelFromHub"] = Interlocked.Read(ref panelCodeAt) != 0;
            d["panelCodeVersion"] = panelCodeVersion;
            object wv;
            d["widgetVersion"] = WidgetVersion().TryGetValue("version", out wv) ? wv : null;

            var c = new Dictionary<string, object>();
            c["spotify"] = Conn(Spotify.Connected, Spotify.Configured, Spotify.Connected ? "Connected" : Spotify.Configured ? "Not logged in" : "Not set up");
            bool dc = DiscordLink.Configured && !string.IsNullOrEmpty(Settings.Current.DiscordRefresh);
            c["discord"] = Conn(dc, DiscordLink.Configured, dc ? "Connected" : DiscordLink.Configured ? "Not logged in" : "Not set up");
            c["twitch"] = Conn(Twitch.Connected, Twitch.Configured, Twitch.Connected ? "Connected" : Twitch.Configured ? "Not logged in" : "Not set up");
            bool steam = !string.IsNullOrEmpty(Settings.Current.SteamKey);
            c["steam"] = Conn(steam, steam, steam ? "Key added" : "No key (only needed for friends online)");
            bool si = !string.IsNullOrEmpty(Settings.Current.SayIntentionsKey);
            c["sayintentions"] = Conn(si, si, si ? "Key added" : "Found by itself while you fly");
            string cs2;
            try { cs2 = Cs2.State3(); } catch { cs2 = "?"; }
            c["cs2"] = Conn(cs2 == "installed", cs2 != "nocs2", cs2 == "installed" ? "Set up" : cs2 == "nocs2" ? "CS2 not found" : "Not set up");
            d["connections"] = c;
            d["backup"] = AutoBackup.Status();
            return d;
        }

        static Dictionary<string, object> Conn(bool on, bool configured, string text)
        {
            var d = new Dictionary<string, object>();
            d["on"] = on;
            d["configured"] = configured;
            d["text"] = text;
            return d;
        }

        /// <summary>The last lines of the log, newest last.</summary>
        public static List<string> LogTail(int max)
        {
            var lines = new List<string>();
            try
            {
                if (string.IsNullOrEmpty(Log.FilePath) || !File.Exists(Log.FilePath)) return lines;
                using (var fs = new FileStream(Log.FilePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (var r = new StreamReader(fs, Encoding.UTF8))
                {
                    string line;
                    while ((line = r.ReadLine()) != null)
                    {
                        lines.Add(line);
                        if (lines.Count > max) lines.RemoveAt(0);
                    }
                }
            }
            catch (Exception ex) { lines.Add("(couldn't read the log: " + ex.Message + ")"); }
            return lines;
        }
    }
}
