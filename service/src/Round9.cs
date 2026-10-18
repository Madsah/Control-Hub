using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

namespace ControlPanelHelper
{
    /// <summary>
    /// "On air": which apps use the microphone or the camera right now. Windows keeps this in the registry
    /// (the same list as Settings → Privacy → Microphone → "recently used"). Only read.
    /// </summary>
    static class OnAir
    {
        const string Root = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\";

        public static Dictionary<string, object> State()
        {
            var d = new Dictionary<string, object>();
            d["mic"] = InUse("microphone");
            d["cam"] = InUse("webcam");
            return d;
        }

        static List<Dictionary<string, object>> InUse(string what)
        {
            var list = new List<Dictionary<string, object>>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                using (var k = Registry.CurrentUser.OpenSubKey(Root + what))
                {
                    if (k == null) return list;
                    foreach (var name in k.GetSubKeyNames())
                    {
                        using (var sub = k.OpenSubKey(name))
                        {
                            if (sub == null) continue;
                            if (name == "NonPackaged")
                            {
                                foreach (var app in sub.GetSubKeyNames())
                                    using (var a = sub.OpenSubKey(app))
                                        if (Active(a))
                                        {
                                            string path = app.Replace('#', '\\');
                                            string nm = Path.GetFileNameWithoutExtension(path);
                                            if (!seen.Add(nm)) continue;
                                            var o = new Dictionary<string, object>();
                                            o["name"] = Pretty(nm);
                                            if (File.Exists(path)) o["icon"] = Icons.Register(path);
                                            list.Add(o);
                                        }
                            }
                            else if (Active(sub))
                            {
                                string nm = name.Split('_')[0];
                                int dot = nm.LastIndexOf('.');
                                if (dot >= 0 && dot < nm.Length - 1) nm = nm.Substring(dot + 1);
                                if (!seen.Add(nm)) continue;
                                var o = new Dictionary<string, object>();
                                o["name"] = Pretty(nm);
                                list.Add(o);
                            }
                        }
                    }
                }
            }
            catch (Exception ex) { Log.Write("On air: " + ex.Message); }
            return list;
        }

        // In use = started and not stopped yet.
        static bool Active(RegistryKey k)
        {
            if (k == null) return false;
            object start = k.GetValue("LastUsedTimeStart"), stop = k.GetValue("LastUsedTimeStop");
            long a = start is long ? (long)start : 0, b = stop is long ? (long)stop : 0;
            return a > 0 && b == 0;
        }

        static string Pretty(string n)
        {
            switch (n.ToLowerInvariant())
            {
                case "discord": return "Discord";
                case "chrome": return "Chrome";
                case "msedge": return "Edge";
                case "firefox": return "Firefox";
                case "brave": return "Brave";
                case "ms-teams": case "teams": return "Teams";
                case "zoom": return "Zoom";
                case "obs64": return "OBS";
                case "steam": case "steamwebhelper": return "Steam";
                case "sayintentionsai": return "SayIntentions";
                default: return n.Length > 0 ? char.ToUpperInvariant(n[0]) + n.Substring(1) : n;
            }
        }
    }

    /// <summary>Your newest downloads and recently used files, and opening them (only files from these lists).</summary>
    static class RecentFiles
    {
        [DllImport("shell32.dll")]
        static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid id, uint flags, IntPtr token, out IntPtr path);

        static readonly Dictionary<string, string> known = new Dictionary<string, string>();
        static readonly Guid Downloads = new Guid("374DE290-123F-4565-9164-39C4925E467B");

        static string DownloadsFolder()
        {
            IntPtr p;
            if (SHGetKnownFolderPath(Downloads, 0, IntPtr.Zero, out p) == 0)
            {
                string s = Marshal.PtrToStringUni(p);
                Marshal.FreeCoTaskMem(p);
                return s;
            }
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        }

        static Dictionary<string, object> Entry(string path, DateTime when, bool folder)
        {
            var d = new Dictionary<string, object>();
            string id = Icons.Register(path);
            lock (known) known[id] = path;
            d["id"] = id;
            d["name"] = Path.GetFileName(path.TrimEnd('\\')) ?? path;
            d["time"] = (long)(when.ToUniversalTime() - new DateTime(1970, 1, 1)).TotalMilliseconds;
            d["icon"] = id;
            if (!folder) { try { d["size"] = new FileInfo(path).Length; } catch { } }
            d["folder"] = folder;
            return d;
        }

        public static List<Dictionary<string, object>> List(string which)
        {
            var list = new List<Dictionary<string, object>>();
            try
            {
                if (which == "downloads")
                {
                    string dir = DownloadsFolder();
                    if (!Directory.Exists(dir)) return list;
                    var items = new List<FileSystemInfo>();
                    var di = new DirectoryInfo(dir);
                    foreach (var f in di.GetFiles()) if ((f.Attributes & (FileAttributes.Hidden | FileAttributes.System)) == 0 && !f.Name.EndsWith(".crdownload") && !f.Name.EndsWith(".part") && !f.Name.EndsWith(".tmp")) items.Add(f);
                    foreach (var f in di.GetDirectories()) if ((f.Attributes & FileAttributes.Hidden) == 0) items.Add(f);
                    items.Sort(delegate (FileSystemInfo a, FileSystemInfo b) { return b.LastWriteTime.CompareTo(a.LastWriteTime); });
                    foreach (var f in items)
                    {
                        list.Add(Entry(f.FullName, f.LastWriteTime, f is DirectoryInfo));
                        if (list.Count >= 30) break;
                    }
                }
                else
                {
                    // Windows' "Recent items": shortcuts to the files you opened.
                    string dir = Environment.GetFolderPath(Environment.SpecialFolder.Recent);
                    var lnks = new List<FileInfo>(new DirectoryInfo(dir).GetFiles("*.lnk"));
                    lnks.Sort(delegate (FileInfo a, FileInfo b) { return b.LastWriteTime.CompareTo(a.LastWriteTime); });
                    Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                    dynamic shell = shellType == null ? null : Activator.CreateInstance(shellType);
                    if (shell == null) return list;
                    var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var l in lnks)
                    {
                        if (list.Count >= 30) break;
                        string target = null;
                        try { target = (string)shell.CreateShortcut(l.FullName).TargetPath; } catch { }
                        if (string.IsNullOrEmpty(target) || !File.Exists(target) || !seen.Add(target)) continue;
                        list.Add(Entry(target, l.LastWriteTime, false));
                    }
                }
            }
            catch (Exception ex) { Log.Write("Files (" + which + "): " + ex.Message); }
            return list;
        }

        public static bool Open(string id, bool reveal)
        {
            string path;
            lock (known) if (string.IsNullOrEmpty(id) || !known.TryGetValue(id, out path)) return false;
            if (!File.Exists(path) && !Directory.Exists(path)) return false;
            if (reveal) Process.Start("explorer.exe", "/select,\"" + path + "\"");
            else Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
            return true;
        }

        public static bool OpenDownloadsFolder()
        {
            Process.Start(new ProcessStartInfo(DownloadsFolder()) { UseShellExecute = true });
            return true;
        }
    }

    /// <summary>Is a website up, and how fast does it answer. Only the status and the time are returned.</summary>
    static class SiteCheck
    {
        static readonly Dictionary<string, KeyValuePair<DateTime, Dictionary<string, object>>> cache = new Dictionary<string, KeyValuePair<DateTime, Dictionary<string, object>>>();

        public static Dictionary<string, object> Check(string url)
        {
            Uri u;
            var d = new Dictionary<string, object>();
            if (string.IsNullOrEmpty(url) || url.Length > 300 || !Uri.TryCreate(url, UriKind.Absolute, out u) || (u.Scheme != "https" && u.Scheme != "http"))
            {
                d["up"] = false; d["error"] = "Not a web address";
                return d;
            }
            lock (cache)
            {
                KeyValuePair<DateTime, Dictionary<string, object>> hit;
                if (cache.TryGetValue(url, out hit) && (DateTime.UtcNow - hit.Key).TotalSeconds < 45) return hit.Value;
            }
            ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072;
            var sw = Stopwatch.StartNew();
            int code = 0;
            string err = null;
            foreach (var method in new[] { "HEAD", "GET" })
            {
                try
                {
                    var req = (HttpWebRequest)WebRequest.Create(u);
                    req.Method = method;
                    req.Timeout = 10000;
                    req.ReadWriteTimeout = 10000;
                    req.AllowAutoRedirect = true;
                    req.UserAgent = "ControlHubService/" + Program.Version + " (site check)";
                    using (var res = (HttpWebResponse)req.GetResponse()) code = (int)res.StatusCode;
                    err = null;
                    break;
                }
                catch (WebException ex)
                {
                    var r = ex.Response as HttpWebResponse;
                    code = r != null ? (int)r.StatusCode : 0;
                    err = r != null ? null : ex.Status == WebExceptionStatus.Timeout ? "No answer (timeout)" : ex.Status == WebExceptionStatus.NameResolutionFailure ? "Address not found" : "Can't connect";
                    if (r != null) r.Close();
                    if (code == 405 || code == 403 || code == 501) continue; // some sites don't like HEAD
                    break;
                }
                catch (Exception ex) { err = ex.Message; break; }
            }
            d["ms"] = sw.ElapsedMilliseconds;
            d["code"] = code;
            d["up"] = code >= 200 && code < 400;
            if (err != null) d["error"] = err;
            else if (code >= 400) d["error"] = "Answers with error " + code;
            lock (cache)
            {
                if (cache.Count > 40) cache.Clear();
                cache[url] = new KeyValuePair<DateTime, Dictionary<string, object>>(DateTime.UtcNow, d);
            }
            return d;
        }
    }

    /// <summary>Battery level of Bluetooth devices that tell Windows (mice, keyboards, controllers, some headsets).</summary>
    static class DeviceBatteries
    {
        [StructLayout(LayoutKind.Sequential)]
        struct SP_DEVINFO_DATA { public uint cbSize; public Guid ClassGuid; public uint DevInst; public IntPtr Reserved; }
        [StructLayout(LayoutKind.Sequential)]
        struct DEVPROPKEY { public Guid fmtid; public uint pid; }

        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr SetupDiGetClassDevsW(IntPtr classGuid, string enumerator, IntPtr hwnd, uint flags);
        [DllImport("setupapi.dll", SetLastError = true)]
        static extern bool SetupDiEnumDeviceInfo(IntPtr set, uint index, ref SP_DEVINFO_DATA data);
        [DllImport("setupapi.dll", SetLastError = true)]
        static extern bool SetupDiGetDevicePropertyW(IntPtr set, ref SP_DEVINFO_DATA data, ref DEVPROPKEY key, out uint type, byte[] buffer, uint size, out uint required, uint flags);
        [DllImport("setupapi.dll", SetLastError = true)]
        static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);

        const uint DIGCF_PRESENT = 0x2, DIGCF_ALLCLASSES = 0x4;
        static readonly Guid BatteryFmt = new Guid("104EA319-6EE2-4701-BD47-8DDBF425BBE5");
        static readonly Guid FriendlyFmt = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
        static readonly Guid NameFmt = new Guid("b725f130-47ef-101a-a5f1-02608c9eebac");

        static readonly object Gate = new object();
        static List<Dictionary<string, object>> cached;
        static DateTime cachedAt = DateTime.MinValue;

        public static List<Dictionary<string, object>> List()
        {
            lock (Gate)
            {
                if (cached != null && (DateTime.UtcNow - cachedAt).TotalSeconds < 60) return cached;
                var list = new List<Dictionary<string, object>>();
                var byName = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                IntPtr set = SetupDiGetClassDevsW(IntPtr.Zero, null, IntPtr.Zero, DIGCF_PRESENT | DIGCF_ALLCLASSES);
                if (set == IntPtr.Zero || set == new IntPtr(-1)) return list;
                try
                {
                    var data = new SP_DEVINFO_DATA();
                    data.cbSize = (uint)Marshal.SizeOf(typeof(SP_DEVINFO_DATA));
                    var buf = new byte[1024];
                    for (uint i = 0; i < 4000 && SetupDiEnumDeviceInfo(set, i, ref data); i++)
                    {
                        var key = new DEVPROPKEY { fmtid = BatteryFmt, pid = 2 };
                        uint type, req;
                        if (!SetupDiGetDevicePropertyW(set, ref data, ref key, out type, buf, (uint)buf.Length, out req, 0) || req < 1) continue;
                        int level = buf[0];
                        if (level > 100) continue;
                        string name = Text(set, ref data, FriendlyFmt, 14) ?? Text(set, ref data, NameFmt, 10) ?? "Device";
                        int prev;
                        if (byName.TryGetValue(name, out prev)) continue;
                        byName[name] = level;
                        var d = new Dictionary<string, object>();
                        d["name"] = name;
                        d["level"] = level;
                        list.Add(d);
                    }
                }
                catch (Exception ex) { Log.Write("Device batteries: " + ex.Message); }
                finally { SetupDiDestroyDeviceInfoList(set); }
                cached = list;
                cachedAt = DateTime.UtcNow;
                return list;
            }
        }

        static string Text(IntPtr set, ref SP_DEVINFO_DATA data, Guid fmt, uint pid)
        {
            var key = new DEVPROPKEY { fmtid = fmt, pid = pid };
            var buf = new byte[512];
            uint type, req;
            if (!SetupDiGetDevicePropertyW(set, ref data, ref key, out type, buf, (uint)buf.Length, out req, 0) || req < 2) return null;
            string s = Encoding.Unicode.GetString(buf, 0, (int)Math.Min(req, (uint)buf.Length)).TrimEnd('\0');
            return s.Length > 0 ? s : null;
        }
    }
}
