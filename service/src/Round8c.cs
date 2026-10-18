using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace ControlPanelHelper
{
    /// <summary>
    /// Add-on airports installed in MSFS (Community folder and Marketplace), found from each package's manifest.json.
    /// Only reads; nothing in the sim folders is changed.
    /// </summary>
    static class Scenery
    {
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };
        static readonly object Gate = new object();
        static Dictionary<string, object> cached;
        static DateTime cachedAt = DateTime.MinValue;
        static readonly Regex Code = new Regex(@"(?<![A-Z0-9])[A-Z][A-Z0-9]{3}(?![A-Z0-9])");
        static readonly HashSet<string> NotAirports = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "ORBX", "MSFS", "FS20", "FS24", "PACK", "MESH", "CITY", "LIVE", "FREE", "PLUS", "LITE", "BETA", "DEMO", "TEST", "MODS", "FSDT", "FLYT", "AERO",
            "BASE", "CORE", "DATA", "HDR1", "LODS", "TREE", "ROAD", "PORT", "LAND", "LAKE", "PARK", "BRIDGE", "GATE", "TAXI", "APRON", "PBR1", "FSTL", "GSXR",
        };

        /// <summary>Where MSFS keeps its packages (from UserCfg.opt). 2024 first, then 2020.</summary>
        static List<string> PackageRoots()
        {
            string app = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var cfgs = new[]
            {
                Path.Combine(app, @"Microsoft Flight Simulator 2024\UserCfg.opt"),
                Path.Combine(local, @"Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\UserCfg.opt"),
                Path.Combine(app, @"Microsoft Flight Simulator\UserCfg.opt"),
                Path.Combine(local, @"Packages\Microsoft.FlightSimulator_8wekyb3d8bbwe\LocalCache\UserCfg.opt"),
            };
            var roots = new List<string>();
            foreach (var c in cfgs)
            {
                try
                {
                    if (!File.Exists(c)) continue;
                    foreach (var line in File.ReadAllLines(c))
                    {
                        var t = line.Trim();
                        if (!t.StartsWith("InstalledPackagesPath", StringComparison.OrdinalIgnoreCase)) continue;
                        int a = t.IndexOf('"'), b = t.LastIndexOf('"');
                        if (a >= 0 && b > a)
                        {
                            string path = t.Substring(a + 1, b - a - 1);
                            if (Directory.Exists(path) && !roots.Contains(path)) roots.Add(path);
                        }
                    }
                }
                catch (Exception ex) { Log.Write("Scenery: " + ex.Message); }
            }
            return roots;
        }

        public static Dictionary<string, object> List(bool fresh)
        {
            lock (Gate)
            {
                if (!fresh && cached != null && (DateTime.UtcNow - cachedAt).TotalMinutes < 10) return cached;
                var res = new Dictionary<string, object>();
                var list = new List<Dictionary<string, object>>();
                var roots = PackageRoots();
                res["found"] = roots.Count > 0;
                var known = Runways.Idents();
                var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var root in roots)
                {
                    foreach (var sub in new[] { "Community", @"Official\OneStore", @"Official\Steam", @"Official2024\OneStore", @"Official2024\Steam" })
                    {
                        string dir = Path.Combine(root, sub);
                        if (!Directory.Exists(dir)) continue;
                        string source = sub == "Community" ? "Community" : "Marketplace";
                        string[] pkgs;
                        try { pkgs = Directory.GetDirectories(dir); } catch { continue; }
                        foreach (var pkg in pkgs)
                        {
                            try
                            {
                                string man = Path.Combine(pkg, "manifest.json");
                                if (!File.Exists(man)) continue;
                                var m = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(man, Encoding.UTF8));
                                string type = Str(m, "content_type");
                                if (!string.Equals(type, "SCENERY", StringComparison.OrdinalIgnoreCase)) continue;
                                string title = Str(m, "title") ?? "", folder = Path.GetFileName(pkg);
                                // Default (Asobo) airports aren't add-ons.
                                string creator = Str(m, "creator") ?? "";
                                if (source == "Marketplace" && folder.StartsWith("fs-base", StringComparison.OrdinalIgnoreCase)) continue;
                                if (source == "Marketplace" && folder.StartsWith("asobo-", StringComparison.OrdinalIgnoreCase) && creator.IndexOf("asobo", StringComparison.OrdinalIgnoreCase) >= 0) continue;
                                var codes = new List<string>();
                                foreach (Match mt in Code.Matches((title + " " + folder.Replace('-', ' ').Replace('_', ' ')).ToUpperInvariant()))
                                {
                                    string c = mt.Value;
                                    if (NotAirports.Contains(c) || codes.Contains(c)) continue;
                                    if (known.Count > 1000 && !known.Contains(c)) continue;
                                    codes.Add(c);
                                }
                                foreach (var c in codes)
                                {
                                    if (!seen.Add(c + "|" + folder)) continue;
                                    var d = new Dictionary<string, object>();
                                    d["icao"] = c; d["title"] = title; d["creator"] = creator; d["folder"] = folder; d["source"] = source;
                                    list.Add(d);
                                }
                            }
                            catch { }
                        }
                    }
                }
                list.Sort(delegate (Dictionary<string, object> x, Dictionary<string, object> y) { return string.CompareOrdinal((string)x["icao"], (string)y["icao"]); });
                res["airports"] = list;
                res["roots"] = roots.Count;
                cached = res;
                cachedAt = DateTime.UtcNow;
                return res;
            }
        }

        static string Str(Dictionary<string, object> d, string k)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : null;
        }
    }

    /// <summary>
    /// Game-mode clean-up: close programs you chose before playing, and open them again afterwards.
    /// Remembers what it closed (in closed-programs.json) so "open again" also works after a restart.
    /// </summary>
    static class GameClean
    {
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        static readonly string FilePath = Path.Combine(Settings.Folder, "closed-programs.json");
        static readonly object Gate = new object();
        static readonly HashSet<string> Skip = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "explorer", "svchost", "dwm", "csrss", "winlogon", "lsass", "services", "smss", "wininit", "fontdrvhost", "sihost", "ctfmon", "conhost",
            "taskhostw", "runtimebroker", "searchhost", "startmenuexperiencehost", "shellexperiencehost", "textinputhost", "applicationframehost",
            "systemsettings", "securityhealthsystray", "securityhealthservice", "dllhost", "audiodg", "smartscreen", "lockapp", "widgets", "widgetservice",
            "icue", "corsair.service", "control panel helper", "control hub service", "control hub", "qtwebengineprocess", "msedgewebview2", "system", "idle", "registry", "memory compression",
            "spoolsv", "wudfhost", "nvcontainer", "nvdisplay.container", "rtkauduservice64", "searchindexer", "msmpeng", "nissrv", "useroobebroker", "crashpad_handler",
        };

        /// <summary>Programs running for you right now (no Windows parts), for picking what to close.</summary>
        public static List<Dictionary<string, object>> Programs()
        {
            var byName = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);
            int session = Process.GetCurrentProcess().SessionId;
            string win = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            foreach (var p in Process.GetProcesses())
            {
                try
                {
                    if (p.SessionId != session || Skip.Contains(p.ProcessName)) continue;
                    string path = ProcessInfo.ExePath(p.Id);
                    if (path == null || path.StartsWith(win, StringComparison.OrdinalIgnoreCase)) continue;
                    Dictionary<string, object> d;
                    if (!byName.TryGetValue(p.ProcessName, out d))
                    {
                        d = new Dictionary<string, object>();
                        d["exe"] = p.ProcessName.ToLowerInvariant() + ".exe";
                        d["name"] = ProcessInfo.FriendlyName(p.Id, path) ?? p.ProcessName;
                        d["icon"] = Icons.Register(path);
                        d["window"] = false;
                        d["memMB"] = 0L;
                        byName[p.ProcessName] = d;
                    }
                    if (p.MainWindowHandle != IntPtr.Zero) d["window"] = true;
                    d["memMB"] = (long)d["memMB"] + p.WorkingSet64 / 1048576;
                }
                catch { }
                finally { p.Dispose(); }
            }
            var list = new List<Dictionary<string, object>>(byName.Values);
            list.Sort(delegate (Dictionary<string, object> a, Dictionary<string, object> b)
            {
                int w = ((bool)b["window"]).CompareTo((bool)a["window"]);
                return w != 0 ? w : ((long)b["memMB"]).CompareTo((long)a["memMB"]);
            });
            return list.Count > 80 ? list.GetRange(0, 80) : list;
        }

        static List<string> Remembered()
        {
            try { return File.Exists(FilePath) ? Json.Deserialize<List<string>>(File.ReadAllText(FilePath)) ?? new List<string>() : new List<string>(); }
            catch { return new List<string>(); }
        }

        /// <summary>Closes the programs (by exe name). force = end it even if it has no window (tray apps).</summary>
        public static int Close(System.Collections.IEnumerable apps)
        {
            if (apps == null) return 0;
            int n = 0;
            lock (Gate)
            {
                var paths = Remembered();
                foreach (var o in apps)
                {
                    var a = o as Dictionary<string, object>;
                    if (a == null) continue;
                    object exeO, forceO;
                    a.TryGetValue("exe", out exeO);
                    a.TryGetValue("force", out forceO);
                    string exe = Convert.ToString(exeO ?? "");
                    if (exe.Length == 0 || exe.Length > 80) continue;
                    string name = exe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? exe.Substring(0, exe.Length - 4) : exe;
                    if (Skip.Contains(name)) continue;
                    string path = null;
                    bool hasWindow = false;
                    foreach (var p in Process.GetProcessesByName(name))
                    {
                        try { if (path == null) path = ProcessInfo.ExePath(p.Id); if (p.MainWindowHandle != IntPtr.Zero) hasWindow = true; } catch { }
                        finally { p.Dispose(); }
                    }
                    if (path == null) continue; // not running
                    bool force = forceO is bool && (bool)forceO;
                    if (TopApps.Close(exe, force || !hasWindow))
                    {
                        n++;
                        if (!paths.Contains(path)) paths.Add(path);
                    }
                }
                try { Directory.CreateDirectory(Settings.Folder); File.WriteAllText(FilePath, Json.Serialize(paths)); } catch { }
            }
            Log.Write("Game mode: closed " + n + " program(s)");
            return n;
        }

        /// <summary>Opens again what Close closed.</summary>
        public static int Reopen()
        {
            int n = 0;
            lock (Gate)
            {
                foreach (var path in Remembered())
                {
                    try
                    {
                        if (!File.Exists(path)) continue;
                        string name = Path.GetFileNameWithoutExtension(path);
                        var running = Process.GetProcessesByName(name);
                        bool already = running.Length > 0;
                        foreach (var p in running) p.Dispose();
                        if (already) continue;
                        Process.Start(new ProcessStartInfo(path) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(path) });
                        n++;
                    }
                    catch (Exception ex) { Log.Write("Game mode reopen: " + ex.Message); }
                }
                try { if (File.Exists(FilePath)) File.Delete(FilePath); } catch { }
            }
            Log.Write("Game mode: opened " + n + " program(s) again");
            return n;
        }
    }
}
