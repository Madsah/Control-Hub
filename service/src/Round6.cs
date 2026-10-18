using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace ControlPanelHelper
{
    // ======================================================================= window switcher
    /// <summary>Open windows, bring one to the front, or close it (like clicking its X).</summary>
    static class WindowList
    {
        delegate bool EnumProc(IntPtr h, IntPtr l);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
        [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
        [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
        [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);

        static readonly HashSet<string> Skip = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "icue", "control panel helper", "control hub service", "control hub", "textinputhost", "shellexperiencehost", "searchhost", "startmenuexperiencehost", "lockapp",
        };

        static List<IntPtr> Handles()
        {
            var list = new List<IntPtr>();
            int self = Process.GetCurrentProcess().Id;
            EnumWindows(delegate (IntPtr h, IntPtr l)
            {
                if (!IsWindowVisible(h) || GetWindow(h, 4 /* GW_OWNER */) != IntPtr.Zero) return true;
                if ((GetWindowLong(h, -20) & 0x80 /* WS_EX_TOOLWINDOW */) != 0) return true;
                if (GetWindowTextLength(h) == 0) return true;
                int cloaked;
                if (DwmGetWindowAttribute(h, 14 /* DWMWA_CLOAKED */, out cloaked, 4) == 0 && cloaked != 0) return true;
                uint pid;
                GetWindowThreadProcessId(h, out pid);
                if ((int)pid == self) return true;
                list.Add(h);
                return true;
            }, IntPtr.Zero);
            return list;
        }

        public static List<Dictionary<string, object>> List()
        {
            var outList = new List<Dictionary<string, object>>();
            IntPtr fg = GetForegroundWindow();
            foreach (var h in Handles())
            {
                if (outList.Count >= 40) break;
                try
                {
                    uint pid;
                    GetWindowThreadProcessId(h, out pid);
                    string path = ProcessInfo.ExePath((int)pid);
                    string proc = path != null ? Path.GetFileNameWithoutExtension(path) : "";
                    if (Skip.Contains(proc)) continue;
                    var sb = new StringBuilder(260);
                    GetWindowText(h, sb, sb.Capacity);
                    string title = sb.ToString();
                    if (title == "Program Manager") continue;
                    var d = new Dictionary<string, object>();
                    d["id"] = h.ToInt64().ToString();
                    d["title"] = title;
                    d["name"] = ProcessInfo.FriendlyName((int)pid, path) ?? proc;
                    d["exe"] = proc.ToLowerInvariant() + ".exe";
                    if (path != null) d["icon"] = Icons.Register(path);
                    d["active"] = h == fg;
                    d["min"] = IsIconic(h);
                    outList.Add(d);
                }
                catch { }
            }
            return outList;
        }

        static IntPtr Known(string id)
        {
            long v;
            if (!long.TryParse(id, out v)) return IntPtr.Zero;
            var h = new IntPtr(v);
            return IsWindow(h) && Handles().Contains(h) ? h : IntPtr.Zero;
        }

        public static bool Focus(string id)
        {
            var h = Known(id);
            if (h == IntPtr.Zero) return false;
            if (IsIconic(h)) ShowWindow(h, 9 /* SW_RESTORE */);
            // Windows only lets the program you last used change the front window; a short Alt press allows it.
            keybd_event(0x12, 0, 0, UIntPtr.Zero);
            keybd_event(0x12, 0, 2, UIntPtr.Zero);
            return SetForegroundWindow(h);
        }

        public static bool Close(string id)
        {
            var h = Known(id);
            return h != IntPtr.Zero && PostMessage(h, 0x0010 /* WM_CLOSE */, IntPtr.Zero, IntPtr.Zero);
        }
    }

    // ======================================================================= per-app audio output
    [ComImport, Guid("ab3d4648-e242-459f-b02f-541c70306324"), InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
    interface IAudioPolicyConfigFactory
    {
        [PreserveSig] int u1(); [PreserveSig] int u2(); [PreserveSig] int u3(); [PreserveSig] int u4(); [PreserveSig] int u5();
        [PreserveSig] int u6(); [PreserveSig] int u7(); [PreserveSig] int u8(); [PreserveSig] int u9(); [PreserveSig] int u10();
        [PreserveSig] int u11(); [PreserveSig] int u12(); [PreserveSig] int u13(); [PreserveSig] int u14(); [PreserveSig] int u15();
        [PreserveSig] int u16(); [PreserveSig] int u17(); [PreserveSig] int u18(); [PreserveSig] int u19();
        [PreserveSig] int SetPersistedDefaultAudioEndpoint(uint processId, int flow, int role, IntPtr deviceId);
        [PreserveSig] int GetPersistedDefaultAudioEndpoint(uint processId, int flow, int role, out IntPtr deviceId);
        [PreserveSig] int ClearAllPersistedApplicationDefaultEndpoints();
    }

    /// <summary>
    /// Which speakers/headphones each app plays on (the same setting as Windows' "App volume and device preferences").
    /// Windows doesn't offer this to programs officially; this uses the same hidden part of Windows that EarTrumpet uses.
    /// </summary>
    static class AppOutput
    {
        [DllImport("combase.dll")] static extern int RoGetActivationFactory(IntPtr classId, ref Guid iid, out IntPtr factory);
        [DllImport("combase.dll", CharSet = CharSet.Unicode)] static extern int WindowsCreateString(string s, int length, out IntPtr hstring);
        [DllImport("combase.dll")] static extern int WindowsDeleteString(IntPtr hstring);
        [DllImport("combase.dll")] static extern IntPtr WindowsGetStringRawBuffer(IntPtr hstring, out uint length);

        const string RenderSuffix = "#{e6327cad-dcec-4949-ae8a-991e976a79d2}";
        static IAudioPolicyConfigFactory factory;

        static IAudioPolicyConfigFactory Factory()
        {
            if (factory != null) return factory;
            IntPtr name;
            WindowsCreateString("Windows.Media.Internal.AudioPolicyConfig", 40, out name);
            try
            {
                Guid iid = typeof(IAudioPolicyConfigFactory).GUID;
                IntPtr p;
                if (RoGetActivationFactory(name, ref iid, out p) != 0 || p == IntPtr.Zero) { Log.Write("App output: not available on this Windows"); return null; }
                factory = (IAudioPolicyConfigFactory)Marshal.GetObjectForIUnknown(p);
                Marshal.Release(p);
                return factory;
            }
            finally { WindowsDeleteString(name); }
        }

        static List<int> Pids(string exePath)
        {
            var pids = new List<int>();
            string name = Path.GetFileNameWithoutExtension(exePath);
            foreach (var p in Process.GetProcessesByName(name))
            {
                try
                {
                    string path = ProcessInfo.ExePath(p.Id);
                    if (path != null && string.Equals(path, exePath, StringComparison.OrdinalIgnoreCase)) pids.Add(p.Id);
                }
                catch { }
                finally { p.Dispose(); }
            }
            return pids;
        }

        /// <summary>The device an app is set to ("" = follows the Windows default).</summary>
        public static string Get(string exePath)
        {
            var f = Factory();
            if (f == null) return "";
            foreach (int pid in Pids(exePath))
            {
                IntPtr h;
                if (f.GetPersistedDefaultAudioEndpoint((uint)pid, 0, 1, out h) == 0 && h != IntPtr.Zero)
                {
                    uint len;
                    string s = Marshal.PtrToStringUni(WindowsGetStringRawBuffer(h, out len), (int)len);
                    WindowsDeleteString(h);
                    int a = s.IndexOf("MMDEVAPI#", StringComparison.OrdinalIgnoreCase), b = s.LastIndexOf("#{", StringComparison.Ordinal);
                    if (a >= 0 && b > a) return s.Substring(a + 9, b - a - 9);
                }
            }
            return "";
        }

        public static bool Set(string exePath, string deviceId)
        {
            var f = Factory();
            if (f == null || string.IsNullOrEmpty(exePath)) return false;
            var pids = Pids(exePath);
            if (pids.Count == 0) return false;
            IntPtr h = IntPtr.Zero;
            if (!string.IsNullOrEmpty(deviceId))
            {
                string full = @"\\?\SWD#MMDEVAPI#" + deviceId + RenderSuffix;
                WindowsCreateString(full, full.Length, out h);
            }
            try
            {
                bool ok = false;
                foreach (int pid in pids)
                    for (int role = 0; role <= 1; role++)
                        if (f.SetPersistedDefaultAudioEndpoint((uint)pid, 0, role, h) == 0) ok = true;
                Log.Write("App output: " + Path.GetFileName(exePath) + " -> " + (string.IsNullOrEmpty(deviceId) ? "default" : deviceId) + (ok ? "" : " (failed)"));
                return ok;
            }
            finally { if (h != IntPtr.Zero) WindowsDeleteString(h); }
        }

        public static List<Dictionary<string, object>> Apps()
        {
            var list = new List<Dictionary<string, object>>();
            foreach (var a in Audio.GetApps())
            {
                if (a.Key == "system" || a.Key.StartsWith("pid:")) continue;
                var d = new Dictionary<string, object>();
                d["key"] = a.Key; d["name"] = a.Name;
                if (a.Icon != null) d["icon"] = a.Icon;
                try { d["device"] = Get(a.Key); } catch { d["device"] = ""; }
                list.Add(d);
            }
            return list;
        }
    }

    // ======================================================================= mic level
    [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioMeterInformation
    {
        [PreserveSig] int GetPeakValue(out float peak);
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint padding);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long def, out long min);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
    }

    /// <summary>
    /// How loud your microphone is right now. While the Mic level tile is on screen the helper listens to the mic
    /// (Windows shows its "microphone in use" icon); nothing is recorded or saved. It stops 3 seconds after the tile is gone.
    /// </summary>
    static class MicMeter
    {
        [DllImport("ole32.dll")] static extern void CoTaskMemFree(IntPtr p);
        static readonly object Gate = new object();
        static IMMDevice dev;
        static IAudioMeterInformation meter;
        static IAudioClient client;
        static string devId, devName;
        static DateTime lastAsk;
        static System.Threading.Timer stopper;

        public static Dictionary<string, object> Peak(string deviceId)
        {
            var d = new Dictionary<string, object>();
            lock (Gate)
            {
                lastAsk = DateTime.UtcNow;
                try
                {
                    if (meter == null || (deviceId ?? "") != (devId ?? "")) Open(deviceId);
                    float p = 0;
                    if (meter != null) meter.GetPeakValue(out p);
                    d["peak"] = Math.Round(p, 3);
                    d["name"] = devName ?? "";
                }
                catch (Exception ex) { d["peak"] = 0; d["error"] = ex.Message; Close(); }
                if (stopper == null) stopper = new System.Threading.Timer(delegate { lock (Gate) { if ((DateTime.UtcNow - lastAsk).TotalSeconds > 3) Close(); } }, null, 1000, 1000);
            }
            return d;
        }

        static void Open(string deviceId)
        {
            Close();
            var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
            try
            {
                IMMDevice dv = null;
                if (!string.IsNullOrEmpty(deviceId)) en.GetDevice(deviceId, out dv);
                if (dv == null) en.GetDefaultAudioEndpoint(1, 0, out dv);
                if (dv == null) return;
                dev = dv;
                devId = deviceId;
                foreach (var e in Audio.List(true)) if (e.Id == (deviceId ?? "") || (string.IsNullOrEmpty(deviceId) && e.IsDefault)) devName = e.Name;
                object o;
                Guid iidMeter = typeof(IAudioMeterInformation).GUID, iidClient = typeof(IAudioClient).GUID;
                if (dv.Activate(ref iidMeter, 23, IntPtr.Zero, out o) == 0) meter = (IAudioMeterInformation)o;
                // The level only moves while something listens to the mic, so the helper listens too.
                if (dv.Activate(ref iidClient, 23, IntPtr.Zero, out o) == 0)
                {
                    client = (IAudioClient)o;
                    IntPtr fmt;
                    if (client.GetMixFormat(out fmt) == 0)
                    {
                        client.Initialize(0 /* shared */, 0, 2000000 /* 200 ms */, 0, fmt, IntPtr.Zero);
                        CoTaskMemFree(fmt);
                        client.Start();
                    }
                }
            }
            finally { Marshal.ReleaseComObject(en); }
        }

        static void Close()
        {
            try { if (client != null) { client.Stop(); Marshal.ReleaseComObject(client); } } catch { }
            try { if (meter != null) Marshal.ReleaseComObject(meter); } catch { }
            try { if (dev != null) Marshal.ReleaseComObject(dev); } catch { }
            client = null; meter = null; dev = null; devId = null;
            if (stopper != null) { stopper.Dispose(); stopper = null; }
        }
    }

    // ======================================================================= Do Not Disturb
    /// <summary>Windows' "Notifications" switch (Settings → System → Notifications).</summary>
    static class Dnd
    {
        const string Key = @"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings";
        const string Name = "NOC_GLOBAL_SETTING_TOASTS_ENABLED";

        public static bool On
        {
            get
            {
                using (var k = Registry.CurrentUser.OpenSubKey(Key))
                {
                    object v = k == null ? null : k.GetValue(Name);
                    return v is int && (int)v == 0;
                }
            }
        }

        public static bool Set(bool on)
        {
            try
            {
                using (var k = Registry.CurrentUser.CreateSubKey(Key)) k.SetValue(Name, on ? 0 : 1, RegistryValueKind.DWord);
                Log.Write("Do Not Disturb " + (on ? "on" : "off"));
                return true;
            }
            catch (Exception ex) { Log.Write("Do Not Disturb: " + ex.Message); return false; }
        }
    }

    // ======================================================================= clean-up
    static class Cleanup
    {
        [StructLayout(LayoutKind.Sequential, Pack = 4)]
        struct SHQUERYRBINFO { public int cbSize; public long i64Size; public long i64NumItems; }
        [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHQueryRecycleBin(string root, ref SHQUERYRBINFO info);
        [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHEmptyRecycleBin(IntPtr hwnd, string root, uint flags);

        static readonly object Gate = new object();
        static bool running;
        static long lastFreed = -1;
        static Dictionary<string, object> info;
        static DateTime infoAt = DateTime.MinValue;

        static long RecycleBin(out long items)
        {
            var i = new SHQUERYRBINFO { cbSize = Marshal.SizeOf(typeof(SHQUERYRBINFO)) };
            items = 0;
            if (SHQueryRecycleBin(null, ref i) != 0) return 0;
            items = i.i64NumItems;
            return i.i64Size;
        }

        // Temporary files older than a day (newer ones may still be in use).
        static long TempSize(bool delete)
        {
            long total = 0;
            int n = 0;
            var cutoff = DateTime.Now.AddDays(-1);
            foreach (var root in new[] { Path.GetTempPath() })
            {
                var stack = new Stack<string>();
                stack.Push(root);
                while (stack.Count > 0 && n < 100000)
                {
                    string dir = stack.Pop();
                    try
                    {
                        foreach (var f in Directory.GetFiles(dir))
                        {
                            n++;
                            try
                            {
                                var fi = new FileInfo(f);
                                if (fi.LastWriteTime > cutoff) continue;
                                long len = fi.Length;
                                if (delete) { fi.Delete(); }
                                total += len;
                            }
                            catch { }
                        }
                        foreach (var d in Directory.GetDirectories(dir)) stack.Push(d);
                        if (delete && dir != root) { try { if (Directory.GetFileSystemEntries(dir).Length == 0) Directory.Delete(dir); } catch { } }
                    }
                    catch { }
                }
            }
            return total;
        }

        public static Dictionary<string, object> State()
        {
            lock (Gate)
            {
                if (!running && (info == null || (DateTime.UtcNow - infoAt).TotalSeconds > 60))
                {
                    long items;
                    var d = new Dictionary<string, object>();
                    d["bin"] = RecycleBin(out items);
                    d["binItems"] = items;
                    d["temp"] = TempSize(false);
                    info = d;
                    infoAt = DateTime.UtcNow;
                }
                var r = new Dictionary<string, object>(info);
                r["running"] = running;
                if (lastFreed >= 0) r["freed"] = lastFreed;
                return r;
            }
        }

        public static bool Run()
        {
            lock (Gate) { if (running) return true; running = true; }
            new Thread(delegate ()
            {
                long freed = 0;
                try
                {
                    long items;
                    freed += RecycleBin(out items);
                    SHEmptyRecycleBin(IntPtr.Zero, null, 0x1 | 0x2 | 0x4); // no confirmation, no progress, no sound
                    freed += TempSize(true);
                }
                catch (Exception ex) { Log.Write("Clean-up: " + ex.Message); }
                lock (Gate) { running = false; lastFreed = freed; info = null; }
                Log.Write("Clean-up freed " + (freed / 1048576) + " MB");
            }) { IsBackground = true }.Start();
            return true;
        }
    }

    // ======================================================================= Steam
    /// <summary>Your installed Steam games (read from Steam's own files), and optionally which friends are online.</summary>
    static class Steam
    {
        static string Root()
        {
            using (var k = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam"))
            {
                var p = k == null ? null : k.GetValue("SteamPath") as string;
                return p == null ? null : p.Replace('/', '\\');
            }
        }

        // Valve's simple text format: "key" "value" and "key" { ... }
        public static Dictionary<string, object> Vdf(string text)
        {
            int i = 0;
            return Block(text, ref i);
        }

        static Dictionary<string, object> Block(string s, ref int i)
        {
            var d = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            string key = null;
            while (i < s.Length)
            {
                char c = s[i];
                if (c == '"')
                {
                    var sb = new StringBuilder();
                    i++;
                    while (i < s.Length && s[i] != '"') { if (s[i] == '\\' && i + 1 < s.Length) { i++; sb.Append(s[i] == 'n' ? '\n' : s[i]); } else sb.Append(s[i]); i++; }
                    i++;
                    if (key == null) key = sb.ToString(); else { d[key] = sb.ToString(); key = null; }
                }
                else if (c == '{') { i++; var sub = Block(s, ref i); if (key != null) { d[key] = sub; key = null; } }
                else if (c == '}') { i++; return d; }
                else i++;
            }
            return d;
        }

        static Dictionary<string, object> Child(Dictionary<string, object> d, params string[] path)
        {
            foreach (var p in path)
            {
                object o;
                if (d == null || !d.TryGetValue(p, out o)) return null;
                d = o as Dictionary<string, object>;
            }
            return d;
        }

        static string Read(string path) { try { return File.Exists(path) ? File.ReadAllText(path) : null; } catch { return null; } }

        static string MostRecentUser(string root)
        {
            var users = Vdf(Read(Path.Combine(root, @"config\loginusers.vdf")) ?? "");
            var u = Child(users, "users");
            if (u == null) return null;
            string first = null;
            foreach (var kv in u)
            {
                var v = kv.Value as Dictionary<string, object>;
                if (first == null) first = kv.Key;
                object mr;
                if (v != null && v.TryGetValue("MostRecent", out mr) && Convert.ToString(mr) == "1") return kv.Key;
            }
            return first;
        }

        static List<Dictionary<string, object>> cache;
        static DateTime cacheAt = DateTime.MinValue;
        static readonly System.Text.RegularExpressions.Regex Tools = new System.Text.RegularExpressions.Regex(
            "Redistributable|Steamworks|Proton|Steam Linux Runtime|SteamVR|Dedicated Server|DirectX", System.Text.RegularExpressions.RegexOptions.IgnoreCase);

        public static List<Dictionary<string, object>> Games()
        {
            if (cache != null && (DateTime.UtcNow - cacheAt).TotalMinutes < 2) return cache;
            var list = new List<Dictionary<string, object>>();
            string root = Root();
            if (root == null) return list;
            var libs = new List<string> { root };
            var lf = Child(Vdf(Read(Path.Combine(root, @"steamapps\libraryfolders.vdf")) ?? ""), "libraryfolders");
            if (lf != null)
                foreach (var kv in lf)
                {
                    var v = kv.Value as Dictionary<string, object>;
                    object p;
                    if (v != null && v.TryGetValue("path", out p)) { string s = Convert.ToString(p).Replace(@"\\", @"\"); if (!libs.Contains(s)) libs.Add(s); }
                }
            // Play time and last played from your Steam user's settings.
            Dictionary<string, object> apps = null;
            string user = MostRecentUser(root);
            if (user != null)
            {
                long id64;
                if (long.TryParse(user, out id64))
                {
                    string id3 = (id64 - 76561197960265728L).ToString();
                    apps = Child(Vdf(Read(Path.Combine(root, @"userdata\" + id3 + @"\config\localconfig.vdf")) ?? ""), "UserLocalConfigStore", "Software", "Valve", "Steam", "apps");
                }
            }
            var seen = new HashSet<string>();
            foreach (var lib in libs)
            {
                string dir = Path.Combine(lib, "steamapps");
                if (!Directory.Exists(dir)) continue;
                foreach (var f in Directory.GetFiles(dir, "appmanifest_*.acf"))
                {
                    var st = Child(Vdf(Read(f) ?? ""), "AppState");
                    if (st == null) continue;
                    object idO, nameO;
                    if (!st.TryGetValue("appid", out idO) || !st.TryGetValue("name", out nameO)) continue;
                    string id = Convert.ToString(idO), name = Convert.ToString(nameO);
                    if (id == "228980" || Tools.IsMatch(name) || !seen.Add(id)) continue;
                    var g = new Dictionary<string, object>();
                    g["id"] = id; g["name"] = name;
                    g["lastPlayed"] = 0L; g["minutes"] = 0;
                    var a = apps == null ? null : Child(apps, id);
                    if (a != null)
                    {
                        object lp, pt;
                        long l; int m;
                        if (a.TryGetValue("LastPlayed", out lp) && long.TryParse(Convert.ToString(lp), out l)) g["lastPlayed"] = l * 1000;
                        if (a.TryGetValue("Playtime", out pt) && int.TryParse(Convert.ToString(pt), out m)) g["minutes"] = m;
                    }
                    list.Add(g);
                }
            }
            list.Sort(delegate (Dictionary<string, object> x, Dictionary<string, object> y) { return ((long)y["lastPlayed"]).CompareTo((long)x["lastPlayed"]); });
            cache = list;
            cacheAt = DateTime.UtcNow;
            return list;
        }

        /// <summary>The install folder of a Steam game (e.g. "730" = Counter-Strike 2), or null.</summary>
        public static string AppFolder(string appId)
        {
            string root = Root();
            if (root == null) return null;
            var libs = new List<string> { root };
            var lf = Child(Vdf(Read(Path.Combine(root, @"steamapps\libraryfolders.vdf")) ?? ""), "libraryfolders");
            if (lf != null)
                foreach (var kv in lf)
                {
                    var v = kv.Value as Dictionary<string, object>;
                    object p;
                    if (v != null && v.TryGetValue("path", out p)) { string s = Convert.ToString(p).Replace(@"\\", @"\"); if (!libs.Contains(s)) libs.Add(s); }
                }
            foreach (var lib in libs)
            {
                var st = Child(Vdf(Read(Path.Combine(lib, @"steamapps\appmanifest_" + appId + ".acf")) ?? ""), "AppState");
                object dir;
                if (st == null || !st.TryGetValue("installdir", out dir)) continue;
                string full = Path.Combine(lib, @"steamapps\common\" + Convert.ToString(dir));
                if (Directory.Exists(full)) return full;
            }
            return null;
        }

        // ------------------------------------------------------------------ downloads and updates (Round 8C)
        // Steam's AppState flags (from its app manifests).
        const int UpdateRequired = 2, UpdateRunning = 256, UpdatePaused = 512, UpdateStarted = 1024, Validating = 131072,
            Preallocating = 524288, Downloading = 1048576, Staging = 2097152, Committing = 4194304;
        static readonly Dictionary<string, KeyValuePair<DateTime, long>> lastBytes = new Dictionary<string, KeyValuePair<DateTime, long>>();
        static readonly Dictionary<string, double> lastSpeed = new Dictionary<string, double>();
        static List<Dictionary<string, object>> dlCache;
        static DateTime dlAt = DateTime.MinValue;
        // App manifests are only read again when Steam changed them (there can be hundreds).
        static readonly Dictionary<string, KeyValuePair<DateTime, Dictionary<string, object>>> acfCache = new Dictionary<string, KeyValuePair<DateTime, Dictionary<string, object>>>(StringComparer.OrdinalIgnoreCase);
        static Dictionary<string, object> AppState(string f)
        {
            DateTime m;
            try { m = File.GetLastWriteTimeUtc(f); } catch { return null; }
            KeyValuePair<DateTime, Dictionary<string, object>> hit;
            if (acfCache.TryGetValue(f, out hit) && hit.Key == m) return hit.Value;
            var st = Child(Vdf(Read(f) ?? ""), "AppState");
            acfCache[f] = new KeyValuePair<DateTime, Dictionary<string, object>>(m, st);
            return st;
        }

        static long Num(Dictionary<string, object> d, string k)
        {
            object o;
            long n;
            return d.TryGetValue(k, out o) && long.TryParse(Convert.ToString(o), out n) ? n : 0;
        }

        /// <summary>Games Steam is downloading, updating or has queued, with progress and speed.</summary>
        public static List<Dictionary<string, object>> Downloads()
        {
            lock (lastBytes)
            {
                if (dlCache != null && (DateTime.UtcNow - dlAt).TotalSeconds < 3) return dlCache;
                var list = new List<Dictionary<string, object>>();
                string root = Root();
                if (root != null)
                {
                    var libs = new List<string> { root };
                    var lf = Child(Vdf(Read(Path.Combine(root, @"steamapps\libraryfolders.vdf")) ?? ""), "libraryfolders");
                    if (lf != null)
                        foreach (var kv in lf)
                        {
                            var v = kv.Value as Dictionary<string, object>;
                            object p;
                            if (v != null && v.TryGetValue("path", out p)) { string x = Convert.ToString(p).Replace(@"\\", @"\"); if (!libs.Contains(x)) libs.Add(x); }
                        }
                    foreach (var lib in libs)
                    {
                        string dir = Path.Combine(lib, "steamapps");
                        if (!Directory.Exists(dir)) continue;
                        foreach (var f in Directory.GetFiles(dir, "appmanifest_*.acf"))
                        {
                            var st = AppState(f);
                            if (st == null) continue;
                            long flags = Num(st, "StateFlags");
                            long toDl = Num(st, "BytesToDownload"), dl = Num(st, "BytesDownloaded"), toStage = Num(st, "BytesToStage"), staged = Num(st, "BytesStaged");
                            bool active = (flags & (UpdateRunning | UpdateStarted | Downloading | Staging | Committing | Preallocating | Validating)) != 0;
                            bool paused = (flags & UpdatePaused) != 0;
                            bool queued = (flags & UpdateRequired) != 0;
                            if (!active && !paused && !queued) continue;
                            object nameO, idO;
                            st.TryGetValue("name", out nameO);
                            st.TryGetValue("appid", out idO);
                            string id = Convert.ToString(idO);
                            if (id == "228980" || Tools.IsMatch(Convert.ToString(nameO) ?? "")) continue;
                            var g = new Dictionary<string, object>();
                            g["id"] = id; g["name"] = Convert.ToString(nameO);
                            g["state"] = (flags & Validating) != 0 ? "verifying" : (flags & (Staging | Committing)) != 0 ? "installing" : active ? "downloading" : paused ? "paused" : "queued";
                            g["total"] = toDl; g["done"] = dl;
                            g["stageTotal"] = toStage; g["staged"] = staged;
                            // Speed from how much more was downloaded since the last look (Steam writes the file every few seconds).
                            var now = DateTime.UtcNow;
                            KeyValuePair<DateTime, long> prev;
                            double speed;
                            lastSpeed.TryGetValue(id, out speed);
                            if (lastBytes.TryGetValue(id, out prev) && dl > prev.Value && (now - prev.Key).TotalSeconds > 0.5)
                            {
                                speed = (dl - prev.Value) / (now - prev.Key).TotalSeconds;
                                lastSpeed[id] = speed;
                            }
                            if (!lastBytes.ContainsKey(id) || dl != lastBytes[id].Value) lastBytes[id] = new KeyValuePair<DateTime, long>(now, dl);
                            else if ((now - lastBytes[id].Key).TotalSeconds > 60) { speed = 0; lastSpeed[id] = 0; }
                            g["speed"] = active ? Math.Round(speed) : 0;
                            list.Add(g);
                        }
                    }
                }
                dlCache = list;
                dlAt = DateTime.UtcNow;
                return list;
            }
        }

        public static bool OpenDownloads()
        {
            Process.Start(new ProcessStartInfo("steam://open/downloads") { UseShellExecute = true });
            return true;
        }

        public static bool Run(string appId)
        {
            if (string.IsNullOrEmpty(appId) || appId.Length > 12) return false;
            foreach (char c in appId) if (!char.IsDigit(c)) return false;
            Process.Start(new ProcessStartInfo("steam://rungameid/" + appId) { UseShellExecute = true });
            return true;
        }

        static List<Dictionary<string, object>> friends;
        static DateTime friendsAt = DateTime.MinValue;

        /// <summary>Friends online (needs a free Steam Web API key, added from the tray menu).</summary>
        public static List<Dictionary<string, object>> Friends()
        {
            string key = Settings.Current.SteamKey;
            if (string.IsNullOrEmpty(key)) return null;
            if (friends != null && (DateTime.UtcNow - friendsAt).TotalSeconds < 60) return friends;
            friendsAt = DateTime.UtcNow;
            var outList = new List<Dictionary<string, object>>();
            try
            {
                string root = Root(), me = root == null ? null : MostRecentUser(root);
                if (me == null) return outList;
                var js = new System.Web.Script.Serialization.JavaScriptSerializer();
                string type;
                var raw = WebGet.Download("https://api.steampowered.com/ISteamUser/GetFriendList/v1/?relationship=friend&key=" + Uri.EscapeDataString(key) + "&steamid=" + me, out type);
                if (raw == null) return friends = outList;
                var fl = js.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(raw));
                var ids = new List<string>();
                var fr = fl.ContainsKey("friendslist") ? fl["friendslist"] as Dictionary<string, object> : null;
                if (fr != null && fr.ContainsKey("friends"))
                    foreach (var o in (IEnumerable)fr["friends"]) { var x = o as Dictionary<string, object>; if (x != null && ids.Count < 100) ids.Add(Convert.ToString(x["steamid"])); }
                if (ids.Count == 0) return friends = outList;
                raw = WebGet.Download("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=" + Uri.EscapeDataString(key) + "&steamids=" + string.Join(",", ids.ToArray()), out type);
                if (raw == null) return friends = outList;
                var ps = js.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(raw));
                var resp = ps["response"] as Dictionary<string, object>;
                foreach (var o in (IEnumerable)resp["players"])
                {
                    var p = o as Dictionary<string, object>;
                    if (p == null) continue;
                    int state = p.ContainsKey("personastate") ? Convert.ToInt32(p["personastate"]) : 0;
                    if (state == 0) continue;
                    var d = new Dictionary<string, object>();
                    d["name"] = p.ContainsKey("personaname") ? p["personaname"] : "";
                    d["avatar"] = p.ContainsKey("avatarmedium") ? p["avatarmedium"] : "";
                    d["game"] = p.ContainsKey("gameextrainfo") ? p["gameextrainfo"] : "";
                    d["state"] = state;
                    outList.Add(d);
                }
                outList.Sort(delegate (Dictionary<string, object> a, Dictionary<string, object> b) { return (Convert.ToString(b["game"]) != "").CompareTo(Convert.ToString(a["game"]) != ""); });
            }
            catch (Exception ex) { Log.Write("Steam friends: " + ex.Message); }
            return friends = outList;
        }
    }

    // ======================================================================= keyboard shortcuts for pages
    /// <summary>Ctrl+Alt+1…9 shows that page on the panel, Ctrl+Alt+← / → the previous / next page.</summary>
    class PageKeys : NativeWindow
    {
        [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
        [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
        static PageKeys instance;
        static readonly object Gate = new object();
        static long seq;
        static string cmd = "";

        public static void Start()
        {
            instance = new PageKeys();
            instance.CreateHandle(new CreateParams());
            Apply();
        }

        public static void Apply()
        {
            if (instance == null) return;
            // Removed in 2.4.0: Ctrl+Alt+number is the same as AltGr+number on Danish (and many other) keyboards,
            // so it stole @, $, {, [, ] and } from typing. Nothing is registered any more.
            for (int id = 1; id <= 11; id++) UnregisterHotKey(instance.Handle, id);
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == 0x0312 /* WM_HOTKEY */)
            {
                int id = m.WParam.ToInt32();
                lock (Gate)
                {
                    cmd = id == 10 ? "prev" : id == 11 ? "next" : "page:" + (id - 1);
                    seq++;
                    Monitor.PulseAll(Gate);
                }
            }
            base.WndProc(ref m);
        }

        /// <summary>Waits (up to 25 s) for the next shortcut after "since".</summary>
        public static Dictionary<string, object> Wait(long since)
        {
            lock (Gate)
            {
                if (since >= 0 && since == seq) Monitor.Wait(Gate, 25000);
                var d = new Dictionary<string, object>();
                d["seq"] = seq;
                d["cmd"] = since >= 0 && since != seq ? cmd : "";
                return d;
            }
        }
    }
}
