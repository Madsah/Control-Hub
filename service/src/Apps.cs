using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;

namespace ControlPanelHelper
{
    public class AppEntry
    {
        public string Id;        // what the widget stores
        public string Name;
        public string Kind;      // "app", "file", "url"
        public string Icon;      // icon id, or null
        public string Domain;    // for websites
        internal string Launch;  // shell:AppsFolder\…, path or URL (never sent out)
    }

    /// <summary>
    /// Installed apps (desktop + Microsoft Store), read from Windows' own "All apps" list,
    /// plus the programs and websites added from the tray menu.
    /// </summary>
    static class Apps
    {
        static List<AppEntry> cached;
        static DateTime cachedAt;
        static readonly object Gate = new object();

        static readonly string[] Junk = {
            "uninstall", "readme", "read me", "documentation", "help", "license", "release notes",
            "website", "support", "manual", "changelog", "what's new", "faq", "debug", "safe mode"
        };

        public static List<AppEntry> GetAll(bool refresh)
        {
            lock (Gate)
            {
                if (cached == null || refresh || (DateTime.Now - cachedAt).TotalMinutes > 10)
                {
                    List<AppEntry> list = null;
                    var t = new Thread(delegate () { list = ReadAppsFolder(); });
                    t.SetApartmentState(ApartmentState.STA);
                    t.IsBackground = true;
                    t.Start();
                    t.Join(15000);
                    if (list != null)
                    {
                        cached = list;
                        cachedAt = DateTime.Now;
                    }
                }
                var all = new List<AppEntry>();
                foreach (var c in Settings.Current.Custom.ToArray())
                {
                    if (c.Kind == "calendar") continue;
                    var e = new AppEntry { Id = "custom:" + c.Id, Name = c.Name, Kind = c.Kind == "url" ? "url" : "file", Launch = c.Target };
                    if (e.Kind == "file") e.Icon = Icons.Register(c.Target);
                    else
                    {
                        Uri u;
                        if (c.Target.StartsWith("spotify:", StringComparison.OrdinalIgnoreCase)) e.Domain = "open.spotify.com";
                        else if (Uri.TryCreate(c.Target, UriKind.Absolute, out u)) e.Domain = u.Host;
                    }
                    all.Add(e);
                }
                if (cached != null) all.AddRange(cached);
                return all;
            }
        }

        static List<AppEntry> ReadAppsFolder()
        {
            var list = new List<AppEntry>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                Type shellType = Type.GetTypeFromProgID("Shell.Application");
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic folder = shell.NameSpace("shell:AppsFolder");
                if (folder == null) return list;
                dynamic items = folder.Items();
                int count = items.Count;
                for (int i = 0; i < count; i++)
                {
                    try
                    {
                        dynamic item = items.Item(i);
                        string name = item.Name;
                        string path = item.Path;
                        if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(path)) continue;
                        string lower = name.ToLowerInvariant();
                        bool junk = false;
                        foreach (var j in Junk) if (lower.Contains(j)) { junk = true; break; }
                        if (junk) continue;
                        // Skip plain web links and documents in the Start menu.
                        string lp = path.ToLowerInvariant();
                        if (lp.StartsWith("http") || lp.EndsWith(".url") || lp.EndsWith(".txt") || lp.EndsWith(".pdf") || lp.EndsWith(".chm") || lp.EndsWith(".html")) continue;
                        if (!seen.Add(name)) continue;
                        string launch = "shell:AppsFolder\\" + path;
                        list.Add(new AppEntry
                        {
                            Id = "app:" + path,
                            Name = name,
                            Kind = "app",
                            Launch = launch,
                            Icon = Icons.Register(launch)
                        });
                    }
                    catch { }
                }
            }
            catch (Exception ex) { Log.Write("AppsFolder: " + ex.Message); }
            list.Sort(delegate (AppEntry a, AppEntry b) { return string.Compare(a.Name, b.Name, StringComparison.CurrentCultureIgnoreCase); });
            return list;
        }

        public static AppEntry Find(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            foreach (var a in GetAll(false)) if (a.Id == id) return a;
            // Apps installed after the list was read.
            foreach (var a in GetAll(true)) if (a.Id == id) return a;
            return null;
        }

        /// <summary>Starts an app the widget picked. Only ids from the list above are accepted.</summary>
        public static bool Launch(string id)
        {
            var a = Find(id);
            if (a == null) return false;
            try
            {
                if (a.Kind == "app")
                    Process.Start(new ProcessStartInfo("explorer.exe", "\"" + a.Launch + "\"") { UseShellExecute = true });
                else
                    Process.Start(new ProcessStartInfo(a.Launch) { UseShellExecute = true });
                return true;
            }
            catch (Exception ex)
            {
                Log.Write("Launch " + a.Name + ": " + ex.Message);
                return false;
            }
        }

        /// <summary>Opens a web address in the default browser (http/https only).</summary>
        /// <summary>Opens a page of Windows Settings (only "ms-settings:" names).</summary>
        public static bool OpenSettings(string page)
        {
            if (string.IsNullOrEmpty(page) || page.Length > 60 || !System.Text.RegularExpressions.Regex.IsMatch(page, "^ms-settings:[a-z0-9\\-]+$")) return false;
            try { Process.Start(new ProcessStartInfo(page) { UseShellExecute = true }); return true; }
            catch (Exception ex) { Log.Write("Settings: " + ex.Message); return false; }
        }

        public static bool OpenUrl(string url)
        {
            Uri u;
            if (!Uri.TryCreate(url, UriKind.Absolute, out u) || (u.Scheme != "http" && u.Scheme != "https")) return false;
            try { Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true }); return true; }
            catch (Exception ex) { Log.Write("Open URL: " + ex.Message); return false; }
        }
    }
}
