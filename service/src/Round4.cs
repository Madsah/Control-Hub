using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace ControlPanelHelper
{
    /// <summary>Ping to a fixed list of targets (the widget can't make the helper ping anything else).</summary>
    static class Pinger
    {
        public static Dictionary<string, object> Run(string target)
        {
            string host;
            if (target == "google") host = "8.8.8.8";
            else if (target == "router") host = Gateway();
            else { target = "cloudflare"; host = "1.1.1.1"; }
            var d = new Dictionary<string, object>();
            d["target"] = target;
            d["host"] = host ?? "";
            d["ms"] = -1;
            if (host == null) return d;
            try
            {
                using (var p = new Ping())
                {
                    var r = p.Send(host, 1000);
                    if (r != null && r.Status == IPStatus.Success) d["ms"] = (int)r.RoundtripTime;
                }
            }
            catch { }
            return d;
        }

        static string gateway;
        static DateTime gatewayAt = DateTime.MinValue;

        static string Gateway()
        {
            if (gateway != null && (DateTime.UtcNow - gatewayAt).TotalMinutes < 5) return gateway;
            gatewayAt = DateTime.UtcNow;
            try
            {
                foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    foreach (var g in ni.GetIPProperties().GatewayAddresses)
                        if (g.Address != null && g.Address.AddressFamily == AddressFamily.InterNetwork && !g.Address.Equals(IPAddress.Any))
                            return gateway = g.Address.ToString();
                }
            }
            catch { }
            return gateway = null;
        }
    }

    /// <summary>
    /// A real internet speed test against Cloudflare's speed test servers (speed.cloudflare.com),
    /// only when you tap Start. About 10 seconds download, 8 seconds upload, then it stops.
    /// </summary>
    static class SpeedTest
    {
        static readonly object Gate = new object();
        static bool running;
        static string phase = "idle";
        static double down, up, progress;
        static int ping = -1;
        static long finishedAt;
        static string error;
        static long bytes;
        static volatile bool stop;
        static readonly List<HttpWebRequest> open = new List<HttpWebRequest>();

        public static bool Start()
        {
            lock (Gate)
            {
                if (running) return true;
                running = true;
                phase = "ping"; down = 0; up = 0; ping = -1; progress = 0; error = null;
            }
            new Thread(Run) { IsBackground = true, Name = "speedtest" }.Start();
            return true;
        }

        public static Dictionary<string, object> State()
        {
            lock (Gate)
            {
                var d = new Dictionary<string, object>();
                d["running"] = running; d["phase"] = phase; d["progress"] = Math.Round(progress, 2);
                d["down"] = Math.Round(down); d["up"] = Math.Round(up); d["ping"] = ping;
                if (finishedAt > 0) d["at"] = finishedAt;
                if (error != null) d["error"] = error;
                return d;
            }
        }

        static void Set(string ph, double prog)
        {
            lock (Gate) { phase = ph; progress = prog; }
        }

        static void Run()
        {
            try
            {
                ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; // TLS 1.2
                ServicePointManager.DefaultConnectionLimit = Math.Max(ServicePointManager.DefaultConnectionLimit, 16);
                ServicePointManager.Expect100Continue = false;

                // Ping: best of a few.
                var times = new List<int>();
                using (var p = new Ping())
                    for (int i = 0; i < 5; i++)
                    {
                        try { var r = p.Send("speed.cloudflare.com", 1500); if (r.Status == IPStatus.Success) times.Add((int)r.RoundtripTime); } catch { }
                    }
                if (times.Count > 0) { times.Sort(); lock (Gate) ping = times[0]; }

                double d = Measure(true, 10, 6);
                lock (Gate) down = d;
                double u = Measure(false, 8, 4);
                lock (Gate) up = u;
                lock (Gate) { phase = "done"; progress = 1; }
            }
            catch (Exception ex)
            {
                Log.Write("Speed test: " + ex.Message);
                lock (Gate) { phase = "error"; error = "The speed test couldn't reach the internet"; }
            }
            finally
            {
                lock (Gate) { running = false; finishedAt = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds; }
            }
        }

        /// <summary>Bits per second, measured after a 2 second warm-up, with live values while running.</summary>
        static double Measure(bool download, int seconds, int streams)
        {
            Interlocked.Exchange(ref bytes, 0);
            stop = false;
            var threads = new List<Thread>();
            for (int i = 0; i < streams; i++)
            {
                var t = new Thread(download ? (ThreadStart)DownloadLoop : UploadLoop) { IsBackground = true };
                threads.Add(t);
                t.Start();
            }
            var sw = Stopwatch.StartNew();
            long warmBytes = 0;
            double warmAt = 0, result = 0;
            long lastBytes = 0;
            double lastAt = 0;
            while (sw.Elapsed.TotalSeconds < seconds)
            {
                Thread.Sleep(250);
                double now = sw.Elapsed.TotalSeconds;
                long b = Interlocked.Read(ref bytes);
                if (warmAt == 0 && now >= 2) { warmAt = now; warmBytes = b; }
                if (now - lastAt >= 0.5)
                {
                    double live = (b - lastBytes) * 8 / (now - lastAt);
                    lastBytes = b; lastAt = now;
                    lock (Gate)
                    {
                        if (download) down = live; else up = live;
                        progress = download ? now / seconds * 0.55 : 0.55 + now / seconds * 0.45;
                        phase = download ? "down" : "up";
                    }
                }
            }
            double end = sw.Elapsed.TotalSeconds;
            long total = Interlocked.Read(ref bytes);
            result = warmAt > 0 && end > warmAt ? (total - warmBytes) * 8 / (end - warmAt) : total * 8 / Math.Max(end, 0.1);
            stop = true;
            lock (open) { foreach (var r in open) { try { r.Abort(); } catch { } } open.Clear(); }
            foreach (var t in threads) t.Join(3000);
            if (total == 0) throw new Exception("no data");
            return result;
        }

        static HttpWebRequest NewRequest(string url)
        {
            var r = (HttpWebRequest)WebRequest.Create(url);
            r.Timeout = 15000;
            r.ReadWriteTimeout = 15000;
            r.UserAgent = "ControlHubService/" + Program.Version;
            r.KeepAlive = true;
            lock (open) open.Add(r);
            return r;
        }

        static void Done(HttpWebRequest r) { lock (open) open.Remove(r); }

        static void DownloadLoop()
        {
            var buf = new byte[65536];
            while (!stop)
            {
                HttpWebRequest r = null;
                try
                {
                    r = NewRequest("https://speed.cloudflare.com/__down?bytes=50000000");
                    using (var res = r.GetResponse())
                    using (var s = res.GetResponseStream())
                    {
                        int n;
                        while (!stop && (n = s.Read(buf, 0, buf.Length)) > 0) Interlocked.Add(ref bytes, n);
                    }
                }
                catch { if (!stop) Thread.Sleep(200); }
                finally { if (r != null) Done(r); }
            }
        }

        static void UploadLoop()
        {
            var buf = new byte[65536];
            new Random().NextBytes(buf);
            const int size = 16 * 1024 * 1024;
            while (!stop)
            {
                HttpWebRequest r = null;
                try
                {
                    r = NewRequest("https://speed.cloudflare.com/__up");
                    r.Method = "POST";
                    r.ContentType = "application/octet-stream";
                    r.ContentLength = size;
                    r.AllowWriteStreamBuffering = false;
                    using (var s = r.GetRequestStream())
                    {
                        int sent = 0;
                        while (!stop && sent < size)
                        {
                            int n = Math.Min(buf.Length, size - sent);
                            s.Write(buf, 0, n);
                            sent += n;
                            Interlocked.Add(ref bytes, n);
                        }
                    }
                    if (!stop) using (var res = r.GetResponse()) { }
                }
                catch { if (!stop) Thread.Sleep(200); }
                finally { if (r != null) Done(r); }
            }
        }
    }

    /// <summary>The program in front (for "Now playing"). iCUE itself is skipped, since touching the panel can bring it forward.</summary>
    static class Foreground
    {
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

        static readonly HashSet<string> Skip = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "icue", "control panel helper", "control hub service", "control hub", "applicationframehost", "shellexperiencehost", "searchhost",
            "startmenuexperiencehost", "textinputhost", "lockapp", "idle",
        };
        static Dictionary<string, object> last;
        static int lastPid;

        public static Dictionary<string, object> Get()
        {
            try
            {
                uint pid;
                GetWindowThreadProcessId(GetForegroundWindow(), out pid);
                if (pid != 0 && (int)pid != lastPid)
                {
                    using (var p = Process.GetProcessById((int)pid))
                    {
                        if (!Skip.Contains(p.ProcessName))
                        {
                            string path = ProcessInfo.ExePath((int)pid);
                            var d = new Dictionary<string, object>();
                            d["exe"] = p.ProcessName.ToLowerInvariant() + ".exe";
                            d["name"] = ProcessInfo.FriendlyName((int)pid, path) ?? p.ProcessName;
                            if (path != null) d["icon"] = Icons.Register(path);
                            try { d["started"] = (long)(p.StartTime.ToUniversalTime() - new DateTime(1970, 1, 1)).TotalMilliseconds; } catch { }
                            last = d;
                            lastPid = (int)pid;
                        }
                    }
                }
            }
            catch { }
            return last;
        }
    }

    /// <summary>Programs using the most CPU and memory, and closing one.</summary>
    static class TopApps
    {
        static readonly object Gate = new object();
        static readonly Dictionary<int, TimeSpan> lastCpu = new Dictionary<int, TimeSpan>();
        static DateTime lastAt = DateTime.MinValue;
        static Dictionary<string, object> cached;
        static readonly Dictionary<string, string> pathByName = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        static readonly HashSet<string> Protected = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "system", "idle", "registry", "memory compression", "smss", "csrss", "wininit", "winlogon", "services", "lsass",
            "svchost", "dwm", "explorer", "fontdrvhost", "sihost", "ctfmon", "audiodg", "runtimebroker", "searchhost",
            "startmenuexperiencehost", "shellexperiencehost", "textinputhost", "securityhealthservice", "msmpeng",
            "icue", "control panel helper", "control hub service", "control hub", "conhost", "spoolsv", "wudfhost", "dllhost", "taskhostw",
        };

        class Row { public string Proc, Name, Exe, Icon; public double Cpu; public long Mem; }

        public static Dictionary<string, object> Get()
        {
            lock (Gate)
            {
                var now = DateTime.UtcNow;
                if (cached != null && (now - lastAt).TotalSeconds < 2.5) return cached;
                double elapsed = lastAt == DateTime.MinValue ? 0 : (now - lastAt).TotalMilliseconds;
                lastAt = now;
                var byName = new Dictionary<string, Row>(StringComparer.OrdinalIgnoreCase);
                var seen = new HashSet<int>();
                int self = Process.GetCurrentProcess().Id;
                foreach (var p in Process.GetProcesses())
                {
                    try
                    {
                        if (p.Id == 0 || p.Id == 4) continue;
                        string name = p.ProcessName;
                        Row r;
                        if (!byName.TryGetValue(name, out r))
                        {
                            r = new Row { Proc = name, Name = name, Exe = name.ToLowerInvariant() + ".exe" };
                            byName[name] = r;
                        }
                        r.Mem += p.WorkingSet64;
                        seen.Add(p.Id);
                        try
                        {
                            var cpu = p.TotalProcessorTime;
                            TimeSpan before;
                            if (elapsed > 0 && lastCpu.TryGetValue(p.Id, out before))
                                r.Cpu += (cpu - before).TotalMilliseconds / elapsed / Environment.ProcessorCount * 100;
                            lastCpu[p.Id] = cpu;
                        }
                        catch { }
                        if (!pathByName.ContainsKey(name)) pathByName[name] = ProcessInfo.ExePath(p.Id);
                    }
                    catch { }
                    finally { p.Dispose(); }
                }
                foreach (var pid in new List<int>(lastCpu.Keys)) if (!seen.Contains(pid)) lastCpu.Remove(pid);
                var rows = new List<Row>(byName.Values);
                foreach (var r in rows)
                {
                    string path;
                    if (pathByName.TryGetValue(r.Proc, out path) && path != null)
                    {
                        r.Icon = Icons.Register(path);
                        r.Name = ProcessInfo.FriendlyName(0, path) ?? r.Proc;
                    }
                }
                var cpuList = new List<Row>(rows);
                cpuList.Sort(delegate (Row a, Row b) { return b.Cpu.CompareTo(a.Cpu); });
                var memList = new List<Row>(rows);
                memList.Sort(delegate (Row a, Row b) { return b.Mem.CompareTo(a.Mem); });
                var d = new Dictionary<string, object>();
                d["cpu"] = Pack(cpuList);
                d["memory"] = Pack(memList);
                d["ready"] = elapsed > 0;
                cached = d;
                return d;
            }
        }

        static List<Dictionary<string, object>> Pack(List<Row> rows)
        {
            var list = new List<Dictionary<string, object>>();
            foreach (var r in rows)
            {
                if (list.Count >= 8) break;
                if (r.Exe == "idle.exe" || r.Exe == "memory compression.exe") continue;
                var d = new Dictionary<string, object>();
                d["exe"] = r.Exe; d["name"] = r.Name; d["cpu"] = Math.Round(Math.Max(0, r.Cpu), 1);
                d["memMB"] = (int)(r.Mem / (1024 * 1024));
                d["canClose"] = !Protected.Contains(Path.GetFileNameWithoutExtension(r.Exe));
                if (r.Icon != null) d["icon"] = r.Icon;
                list.Add(d);
            }
            return list;
        }

        /// <summary>Close a program like clicking its X (force = end it right away, unsaved work is lost).</summary>
        public static bool Close(string exe, bool force)
        {
            if (string.IsNullOrEmpty(exe)) return false;
            string name = exe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? exe.Substring(0, exe.Length - 4) : exe;
            if (Protected.Contains(name) || name.IndexOfAny(new[] { '\\', '/', ':' }) >= 0) return false;
            bool any = false;
            foreach (var p in Process.GetProcessesByName(name))
            {
                try
                {
                    if (p.Id == Process.GetCurrentProcess().Id) continue;
                    if (force) { p.Kill(); any = true; }
                    else if (p.MainWindowHandle != IntPtr.Zero) { p.CloseMainWindow(); any = true; }
                }
                catch (Exception ex) { Log.Write("Close " + name + ": " + ex.Message); }
                finally { p.Dispose(); }
            }
            Log.Write((force ? "Force closed " : "Asked to close ") + name + (any ? "" : " (nothing to close)"));
            lock (Gate) cached = null;
            return any;
        }
    }

    static class Uptime
    {
        [DllImport("kernel32.dll")] static extern ulong GetTickCount64();
        public static long Seconds() { return (long)(GetTickCount64() / 1000); }
    }

    /// <summary>Read and write speed per physical drive (Windows performance counters).</summary>
    static class DiskActivity
    {
        class Drive { public string Name; public PerformanceCounter Read, Write, Idle; }
        static readonly object Gate = new object();
        static List<Drive> drives;
        static DateTime builtAt = DateTime.MinValue;
        static bool broken;

        public static List<Dictionary<string, object>> Get()
        {
            var list = new List<Dictionary<string, object>>();
            lock (Gate)
            {
                if (broken) return list;
                try
                {
                    if (drives == null || (DateTime.UtcNow - builtAt).TotalMinutes > 5) Build();
                    foreach (var d in drives)
                    {
                        var o = new Dictionary<string, object>();
                        o["name"] = d.Name;
                        o["read"] = Math.Round(d.Read.NextValue());
                        o["write"] = Math.Round(d.Write.NextValue());
                        o["busy"] = Math.Round(Math.Max(0, Math.Min(100, 100 - d.Idle.NextValue())));
                        list.Add(o);
                    }
                }
                catch (Exception ex)
                {
                    Log.Write("Disk activity: " + ex.Message);
                    broken = true;
                }
            }
            return list;
        }

        static void Build()
        {
            if (drives != null) foreach (var d in drives) { d.Read.Dispose(); d.Write.Dispose(); d.Idle.Dispose(); }
            drives = new List<Drive>();
            builtAt = DateTime.UtcNow;
            var cat = new PerformanceCounterCategory("PhysicalDisk");
            var names = cat.GetInstanceNames();
            Array.Sort(names, StringComparer.Ordinal);
            foreach (var inst in names)
            {
                if (inst == "_Total") continue;
                // "0 C: D:" -> "C: D:"
                int sp = inst.IndexOf(' ');
                string label = sp > 0 ? inst.Substring(sp + 1).Trim() : inst;
                if (label.Length == 0) label = "Disk " + inst;
                var d = new Drive
                {
                    Name = label,
                    Read = new PerformanceCounter("PhysicalDisk", "Disk Read Bytes/sec", inst, true),
                    Write = new PerformanceCounter("PhysicalDisk", "Disk Write Bytes/sec", inst, true),
                    Idle = new PerformanceCounter("PhysicalDisk", "% Idle Time", inst, true),
                };
                d.Read.NextValue(); d.Write.NextValue(); d.Idle.NextValue();
                drives.Add(d);
            }
        }
    }

    /// <summary>Monitor brightness over DDC/CI (works with most external monitors).</summary>
    static class Brightness
    {
        [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct PHYSICAL_MONITOR
        {
            public IntPtr hPhysicalMonitor;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szPhysicalMonitorDescription;
        }
        delegate bool MonitorEnumProc(IntPtr hMon, IntPtr hdc, ref RECT rc, IntPtr data);

        [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
        [DllImport("dxva2.dll")] static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr hMon, out uint count);
        [DllImport("dxva2.dll")] static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr hMon, uint count, [Out] PHYSICAL_MONITOR[] arr);
        [DllImport("dxva2.dll")] static extern bool DestroyPhysicalMonitors(uint count, PHYSICAL_MONITOR[] arr);
        [DllImport("dxva2.dll")] static extern bool GetMonitorBrightness(IntPtr h, out uint min, out uint cur, out uint max);
        [DllImport("dxva2.dll")] static extern bool SetMonitorBrightness(IntPtr h, uint value);

        static readonly object Gate = new object();
        static List<Dictionary<string, object>> cached;
        static DateTime cachedAt = DateTime.MinValue;

        delegate void Visit(int index, IntPtr handle, string description, int width, int height);

        static void Each(Visit visit)
        {
            var mons = new List<KeyValuePair<IntPtr, RECT>>();
            EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr h, IntPtr dc, ref RECT rc, IntPtr data)
            {
                mons.Add(new KeyValuePair<IntPtr, RECT>(h, rc));
                return true;
            }, IntPtr.Zero);
            int index = 0;
            foreach (var m in mons)
            {
                uint count;
                if (!GetNumberOfPhysicalMonitorsFromHMONITOR(m.Key, out count) || count == 0) continue;
                var arr = new PHYSICAL_MONITOR[count];
                if (!GetPhysicalMonitorsFromHMONITOR(m.Key, count, arr)) continue;
                try
                {
                    foreach (var pm in arr)
                        visit(index++, pm.hPhysicalMonitor, pm.szPhysicalMonitorDescription, m.Value.Right - m.Value.Left, m.Value.Bottom - m.Value.Top);
                }
                finally { DestroyPhysicalMonitors(count, arr); }
            }
        }

        /// <summary>Slow (the monitors are asked over the cable), so the answer is kept for 20 seconds.</summary>
        public static List<Dictionary<string, object>> Get()
        {
            lock (Gate)
            {
                if (cached != null && (DateTime.UtcNow - cachedAt).TotalSeconds < 20) return cached;
                var list = new List<Dictionary<string, object>>();
                try
                {
                    Each(delegate (int i, IntPtr h, string desc, int w, int hgt)
                    {
                        uint min, cur, max;
                        var d = new Dictionary<string, object>();
                        d["id"] = i;
                        string nice = string.IsNullOrEmpty(desc) || desc.IndexOf("Generic", StringComparison.OrdinalIgnoreCase) >= 0 ? "Monitor " + (i + 1) : desc;
                        d["name"] = nice + " (" + w + "×" + hgt + ")";
                        // The XENEON EDGE is a very wide (or tall) screen, 2560×720.
                        double ratio = hgt > 0 ? (double)w / hgt : 1;
                        bool edge = ratio >= 3 || ratio <= 1 / 3.0 || (desc ?? "").IndexOf("XENEON", StringComparison.OrdinalIgnoreCase) >= 0;
                        d["edge"] = edge;
                        if (edge) d["name"] = "XENEON EDGE";
                        if (GetMonitorBrightness(h, out min, out cur, out max) && max > min)
                        {
                            d["supported"] = true;
                            d["brightness"] = (int)Math.Round((cur - min) * 100.0 / (max - min));
                        }
                        else d["supported"] = false;
                        list.Add(d);
                    });
                }
                catch (Exception ex) { Log.Write("Brightness: " + ex.Message); }
                cached = list;
                cachedAt = DateTime.UtcNow;
                return list;
            }
        }

        public static bool Set(int id, int percent)
        {
            percent = Math.Max(0, Math.Min(100, percent));
            bool ok = false;
            lock (Gate)
            {
                try
                {
                    Each(delegate (int i, IntPtr h, string desc, int w, int hgt)
                    {
                        if (i != id) return;
                        // Only the XENEON EDGE: the main monitor is never changed from the panel.
                        double ratio = hgt > 0 ? (double)w / hgt : 1;
                        if (!(ratio >= 3 || ratio <= 1 / 3.0 || (desc ?? "").IndexOf("XENEON", StringComparison.OrdinalIgnoreCase) >= 0)) return;
                        uint min, cur, max;
                        if (!GetMonitorBrightness(h, out min, out cur, out max) || max <= min) return;
                        ok = SetMonitorBrightness(h, (uint)(min + (max - min) * percent / 100));
                    });
                }
                catch (Exception ex) { Log.Write("Brightness: " + ex.Message); }
                if (ok && cached != null)
                    foreach (var d in cached) if ((int)d["id"] == id) d["brightness"] = percent;
            }
            return ok;
        }
    }
}
