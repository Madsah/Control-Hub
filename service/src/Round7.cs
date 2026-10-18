using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using System.Xml;
using Microsoft.Win32;

namespace ControlPanelHelper
{
    // ======================================================================= events (one long-poll for the widget)
    /// <summary>
    /// The widget keeps one request open at /api/events. It gets an answer the moment something happens
    /// (a game starts or closes, a notification arrives, CS2 sends an update), otherwise after 25 seconds.
    /// </summary>
    static class Events
    {
        static readonly object Gate = new object();
        static long seq = 1;

        public static long Seq { get { lock (Gate) return seq; } }

        public static void Bump()
        {
            lock (Gate) { seq++; Monitor.PulseAll(Gate); }
        }

        public static long Wait(long since, int ms)
        {
            lock (Gate)
            {
                if (since == seq) Monitor.Wait(Gate, ms);
                return seq;
            }
        }
    }

    // ======================================================================= programs starting / closing
    /// <summary>
    /// Notices right away when a watched program (a game) starts or closes. Windows tells the helper when
    /// windows appear or disappear; only then are the running programs looked at (a cheap list of names).
    /// </summary>
    static class ProcWatch
    {
        delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
        [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventProc proc, uint pid, uint tid, uint flags);
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snap, ref PROCESSENTRY32 e);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snap, ref PROCESSENTRY32 e);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct PROCESSENTRY32
        {
            public uint dwSize, cntUsage, th32ProcessID;
            public IntPtr th32DefaultHeapID;
            public uint th32ModuleID, cntThreads, th32ParentProcessID;
            public int pcPriClassBase;
            public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
        }

        static readonly object Gate = new object();
        static WinEventProc proc;
        static string watch = "";
        static List<string> running = new List<string>();
        static string key = "";
        static DateTime askedAt = DateTime.MinValue, lastCheck = DateTime.MinValue;
        static System.Threading.Timer debounce, fallback;
        static int scheduled;
        static readonly Regex ExeName = new Regex(@"^[a-z0-9 _.\-()+]{1,80}$");

        static SynchronizationContext ui;
        static bool hooked;

        /// <summary>Call on the UI thread. The window hooks themselves are only added once a page has a game rule.</summary>
        public static void Start(SynchronizationContext uiContext)
        {
            ui = uiContext;
            proc = OnEvent;
            debounce = new System.Threading.Timer(delegate { Interlocked.Exchange(ref scheduled, 0); Check(); }, null, Timeout.Infinite, Timeout.Infinite);
            // A safety net in case a program closes without any window event.
            fallback = new System.Threading.Timer(delegate { if (Active) Check(); }, null, 4000, 4000);
        }

        static bool Active { get { return watch.Length > 0 && (DateTime.UtcNow - askedAt).TotalSeconds < 90; } }

        static void OnEvent(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
        {
            if (idObject != 0 || idChild != 0 || !Active) return;
            if (Interlocked.Exchange(ref scheduled, 1) == 1) return;
            debounce.Change(300, Timeout.Infinite);
        }

        // Window shown, window destroyed, front window changed. Added on the UI thread (the hooks need its message loop).
        static void Hook()
        {
            if (hooked || ui == null) return;
            hooked = true;
            ui.Post(delegate
            {
                SetWinEventHook(0x8002, 0x8002, IntPtr.Zero, proc, 0, 0, 0x0002 /* OUTOFCONTEXT | SKIPOWNPROCESS */);
                SetWinEventHook(0x8001, 0x8001, IntPtr.Zero, proc, 0, 0, 0x0002);
                SetWinEventHook(0x0003, 0x0003, IntPtr.Zero, proc, 0, 0, 0x0002);
            }, null);
        }

        /// <summary>The widget says which programs it cares about (lowercase, comma separated).</summary>
        public static List<string> Watch(string list)
        {
            var clean = new List<string>();
            foreach (var raw in (list ?? "").Split(','))
            {
                string exe = raw.Trim().ToLowerInvariant();
                if (exe.Length == 0 || !ExeName.IsMatch(exe) || clean.Count >= 20) continue;
                if (!exe.EndsWith(".exe")) exe += ".exe";
                if (!clean.Contains(exe)) clean.Add(exe);
            }
            clean.Sort(StringComparer.Ordinal);
            string w = string.Join(",", clean.ToArray());
            bool changed;
            lock (Gate)
            {
                askedAt = DateTime.UtcNow;
                changed = w != watch;
                watch = w;
            }
            if (w.Length > 0) Hook();
            if (changed || (DateTime.UtcNow - lastCheck).TotalSeconds > 3) Check();
            lock (Gate) return new List<string>(running);
        }

        static void Check()
        {
            string w;
            lock (Gate) { w = watch; lastCheck = DateTime.UtcNow; }
            var found = new List<string>();
            if (w.Length > 0)
            {
                var names = Names();
                // A failed or half-empty list (Windows can refuse it for a moment) must not look like "the game closed".
                if (names == null) return;
                foreach (var exe in w.Split(',')) if (names.Contains(exe)) found.Add(exe);
            }
            string k = string.Join(",", found.ToArray());
            bool changed;
            lock (Gate)
            {
                changed = k != key;
                key = k;
                running = found;
            }
            if (changed) Events.Bump();
        }

        static HashSet<string> Names()
        {
            var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            IntPtr snap = IntPtr.Zero;
            for (int attempt = 0; attempt < 3; attempt++)
            {
                snap = CreateToolhelp32Snapshot(0x2 /* PROCESSES */, 0);
                if (snap != IntPtr.Zero && snap != new IntPtr(-1)) break;
                Thread.Sleep(30);
            }
            if (snap == IntPtr.Zero || snap == new IntPtr(-1)) return null;
            try
            {
                var e = new PROCESSENTRY32 { dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32)) };
                if (Process32FirstW(snap, ref e))
                    do { if (!string.IsNullOrEmpty(e.szExeFile)) set.Add(e.szExeFile.ToLowerInvariant()); }
                    while (Process32NextW(snap, ref e));
            }
            finally { CloseHandle(snap); }
            return set.Count >= 20 ? set : null; // a real Windows always has far more than 20 processes
        }
    }

    // ======================================================================= Windows notifications
    /// <summary>
    /// New Windows notifications, for the banner on the panel. Windows keeps every notification in a small
    /// database file; the helper is told when that file changes and then reads only the new ones.
    /// Nothing runs while no notifications arrive.
    /// </summary>
    static class Notifs
    {
        [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_open_v2", CallingConvention = CallingConvention.StdCall)] static extern int Open(byte[] file, out IntPtr db, int flags, IntPtr vfs);
        [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_close_v2", CallingConvention = CallingConvention.StdCall)] static extern int CloseDb(IntPtr db);
        [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_busy_timeout", CallingConvention = CallingConvention.StdCall)] static extern int BusyTimeout(IntPtr db, int ms);
        [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_prepare_v2", CallingConvention = CallingConvention.StdCall)] static extern int Prepare(IntPtr db, byte[] sql, int len, out IntPtr stmt, IntPtr tail);
        [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_step", CallingConvention = CallingConvention.StdCall)] static extern int Step(IntPtr stmt);
        [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_finalize", CallingConvention = CallingConvention.StdCall)] static extern int FinalizeStmt(IntPtr stmt);
        [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_bind_int64", CallingConvention = CallingConvention.StdCall)] static extern int BindInt64(IntPtr stmt, int i, long v);
        [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_column_int64", CallingConvention = CallingConvention.StdCall)] static extern long ColInt64(IntPtr stmt, int i);
        [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_column_blob", CallingConvention = CallingConvention.StdCall)] static extern IntPtr ColBlob(IntPtr stmt, int i);
        [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_column_bytes", CallingConvention = CallingConvention.StdCall)] static extern int ColBytes(IntPtr stmt, int i);
        [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_errmsg", CallingConvention = CallingConvention.StdCall)] static extern IntPtr ErrMsg(IntPtr db);

        static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\Windows\Notifications");
        static readonly string DbFile = Path.Combine(Dir, "wpndatabase.db");
        static readonly object Gate = new object();
        static FileSystemWatcher fsw;
        static System.Threading.Timer debounce;
        static long lastId = -1, seq;
        static readonly List<Dictionary<string, object>> recent = new List<Dictionary<string, object>>();
        static readonly Dictionary<string, string> openTargets = new Dictionary<string, string>();
        public static string Status = "starting";
        static bool loggedError;

        public static void Start()
        {
            try
            {
                if (!File.Exists(DbFile)) { Status = "Windows' notification list wasn't found"; Log.Write("Notifications: " + DbFile + " not found"); return; }
                lock (Gate) lastId = MaxId();
                if (lastId < 0) { Status = "Couldn't read Windows' notification list"; return; }
                debounce = new System.Threading.Timer(delegate { ReadNew(); }, null, Timeout.Infinite, Timeout.Infinite);
                fsw = new FileSystemWatcher(Dir, "wpndatabase.db*") { NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size, IncludeSubdirectories = false };
                FileSystemEventHandler h = delegate { debounce.Change(350, Timeout.Infinite); };
                fsw.Changed += h;
                fsw.Created += h;
                fsw.EnableRaisingEvents = true;
                Status = "ok";
                Log.Write("Notifications: watching (last id " + lastId + ")");
            }
            catch (Exception ex) { Status = "Couldn't watch notifications"; Log.Write("Notifications: " + ex.Message); }
        }

        static IntPtr OpenDb(out string copyDir)
        {
            copyDir = null;
            IntPtr db;
            if (Open(Encoding.UTF8.GetBytes(DbFile + "\0"), out db, 0x1 /* READONLY */, IntPtr.Zero) == 0 && Usable(db)) { BusyTimeout(db, 1500); return db; }
            if (db != IntPtr.Zero) CloseDb(db);
            // Windows is writing to it right now: read a copy instead.
            copyDir = Path.Combine(Path.GetTempPath(), "cp-notif-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(copyDir);
            foreach (var suffix in new[] { "", "-wal", "-shm" })
            {
                string src = DbFile + suffix;
                if (!File.Exists(src)) continue;
                using (var i = new FileStream(src, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (var o = File.Create(Path.Combine(copyDir, "wpndatabase.db" + suffix))) i.CopyTo(o);
            }
            if (Open(Encoding.UTF8.GetBytes(Path.Combine(copyDir, "wpndatabase.db") + "\0"), out db, 0x2 /* READWRITE (copy) */, IntPtr.Zero) != 0)
            {
                if (db != IntPtr.Zero) CloseDb(db);
                return IntPtr.Zero;
            }
            return db;
        }

        static bool Usable(IntPtr db)
        {
            IntPtr st;
            if (Prepare(db, Encoding.UTF8.GetBytes("SELECT 1 FROM Notification LIMIT 1\0"), -1, out st, IntPtr.Zero) != 0) return false;
            int r = Step(st);
            FinalizeStmt(st);
            return r == 100 || r == 101;
        }

        static void CloseAll(IntPtr db, string copyDir)
        {
            if (db != IntPtr.Zero) CloseDb(db);
            if (copyDir != null) try { Directory.Delete(copyDir, true); } catch { }
        }

        static long MaxId()
        {
            string copy = null;
            IntPtr db = IntPtr.Zero;
            try
            {
                db = OpenDb(out copy);
                if (db == IntPtr.Zero) return -1;
                IntPtr st;
                if (Prepare(db, Encoding.UTF8.GetBytes("SELECT IFNULL(MAX(Id),0) FROM Notification\0"), -1, out st, IntPtr.Zero) != 0) { LogErr(db); return -1; }
                long v = Step(st) == 100 ? ColInt64(st, 0) : 0;
                FinalizeStmt(st);
                return v;
            }
            catch (Exception ex) { Log.Write("Notifications: " + ex.Message); return -1; }
            finally { CloseAll(db, copy); }
        }

        static void LogErr(IntPtr db)
        {
            if (loggedError) return;
            loggedError = true;
            try { Log.Write("Notifications: " + Marshal.PtrToStringAnsi(ErrMsg(db))); } catch { }
        }

        static void ReadNew()
        {
            var found = new List<Dictionary<string, object>>();
            lock (Gate)
            {
                string copy = null;
                IntPtr db = IntPtr.Zero;
                try
                {
                    db = OpenDb(out copy);
                    if (db == IntPtr.Zero) return;
                    IntPtr st;
                    const string sql = "SELECT n.Id, n.ArrivalTime, n.Payload, h.PrimaryId FROM Notification n LEFT JOIN NotificationHandler h ON h.RecordId = n.HandlerId WHERE n.Id > ? AND n.Type = 'toast' ORDER BY n.Id LIMIT 20\0";
                    if (Prepare(db, Encoding.UTF8.GetBytes(sql), -1, out st, IntPtr.Zero) != 0) { LogErr(db); return; }
                    BindInt64(st, 1, lastId);
                    while (Step(st) == 100)
                    {
                        long id = ColInt64(st, 0);
                        if (id > lastId) lastId = id;
                        string payload = Text(st, 2), app = Text(st, 3);
                        var n = Make(id, ColInt64(st, 1), payload, app);
                        if (n != null) found.Add(n);
                    }
                    FinalizeStmt(st);
                }
                catch (Exception ex) { Log.Write("Notifications: " + ex.Message); }
                finally { CloseAll(db, copy); }
                foreach (var n in found)
                {
                    n["seq"] = ++seq;
                    recent.Insert(0, n);
                }
                if (recent.Count > 30) recent.RemoveRange(30, recent.Count - 30);
            }
            if (found.Count > 0) Events.Bump();
        }

        static string Text(IntPtr st, int i)
        {
            int len = ColBytes(st, i);
            IntPtr p = ColBlob(st, i);
            if (p == IntPtr.Zero || len <= 0) return "";
            var buf = new byte[len];
            Marshal.Copy(p, buf, 0, len);
            return Encoding.UTF8.GetString(buf);
        }

        static Dictionary<string, object> Make(long id, long arrival, string payload, string appId)
        {
            var texts = new List<string>();
            try
            {
                var doc = new XmlDocument { XmlResolver = null };
                doc.LoadXml(payload);
                var nodes = doc.SelectNodes("//binding/text");
                if (nodes != null)
                    foreach (XmlNode t in nodes)
                    {
                        string s = (t.InnerText ?? "").Trim();
                        if (s.Length > 0) texts.Add(s.Length > 300 ? s.Substring(0, 300) : s);
                        if (texts.Count >= 3) break;
                    }
            }
            catch { }
            if (texts.Count == 0) return null;
            string exe;
            string name = AppName(appId ?? "", out exe);
            var d = new Dictionary<string, object>();
            d["id"] = id;
            d["app"] = name;
            d["title"] = texts[0];
            d["text"] = texts.Count > 1 ? string.Join(" · ", texts.GetRange(1, texts.Count - 1).ToArray()) : "";
            d["time"] = arrival > 0 ? (long)(DateTime.FromFileTimeUtc(arrival) - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds : (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
            d["appKey"] = (appId ?? "").ToLowerInvariant();
            if (exe != null) d["icon"] = Icons.Register(exe);
            if (!string.IsNullOrEmpty(appId)) openTargets[(appId ?? "").ToLowerInvariant()] = exe ?? appId;
            return d;
        }

        static readonly Dictionary<string, string> KnownFolders = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "{6D809377-6AF0-444B-8957-A3773F02200E}", Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles).Replace(" (x86)", "") },
            { "{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}", Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) },
            { "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}", Environment.GetFolderPath(Environment.SpecialFolder.System) },
            { "{F38BF404-1D43-42F2-9305-67DE0B28FC23}", Environment.GetFolderPath(Environment.SpecialFolder.Windows) },
        };

        static readonly Dictionary<string, string> nameCache = new Dictionary<string, string>();
        static readonly Dictionary<string, string> exeCache = new Dictionary<string, string>();

        /// <summary>A readable app name from Windows' id for the app (and the program file, if there is one).</summary>
        static string AppName(string appId, out string exe)
        {
            string cached;
            if (nameCache.TryGetValue(appId, out cached)) { exeCache.TryGetValue(appId, out exe); return cached; }
            exe = null;
            string name = null;
            // Programs: "{known folder}\Some\app.exe"
            if (appId.StartsWith("{") && appId.IndexOf('}') > 0)
            {
                string folder;
                int close = appId.IndexOf('}');
                if (KnownFolders.TryGetValue(appId.Substring(0, close + 1), out folder))
                {
                    string path = folder + appId.Substring(close + 1);
                    if (File.Exists(path))
                    {
                        exe = path;
                        try { var vi = FileVersionInfo.GetVersionInfo(path); if (!string.IsNullOrEmpty(vi.FileDescription)) name = vi.FileDescription.Trim(); } catch { }
                        if (name == null) name = Path.GetFileNameWithoutExtension(path);
                    }
                }
            }
            if (name == null && appId.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && File.Exists(appId))
            {
                exe = appId;
                name = Path.GetFileNameWithoutExtension(appId);
            }
            if (name == null)
            {
                try
                {
                    using (var k = Registry.CurrentUser.OpenSubKey(@"Software\Classes\AppUserModelId\" + appId))
                    {
                        var v = k == null ? null : k.GetValue("DisplayName") as string;
                        if (!string.IsNullOrEmpty(v) && !v.StartsWith("@")) name = v;
                    }
                }
                catch { }
            }
            if (name == null)
            {
                // "Microsoft.WindowsStore_8wekyb3d8bbwe!App" → "Windows Store", "com.squirrel.Discord.Discord" → "Discord"
                string s = appId;
                int bang = s.IndexOf('!');
                if (bang > 0) s = s.Substring(0, bang);
                int us = s.IndexOf('_');
                if (us > 0) s = s.Substring(0, us);
                var parts = s.Split(new[] { '.', '\\' }, StringSplitOptions.RemoveEmptyEntries);
                s = parts.Length > 0 ? parts[parts.Length - 1] : appId;
                if (s.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) s = s.Substring(0, s.Length - 4);
                s = Regex.Replace(s, "([a-z])([A-Z])", "$1 $2");
                name = s.Length == 0 ? "Notification" : char.ToUpperInvariant(s[0]) + s.Substring(1);
            }
            nameCache[appId] = name;
            if (exe != null) exeCache[appId] = exe;
            return name;
        }

        public static List<Dictionary<string, object>> Since(long afterSeq)
        {
            var list = new List<Dictionary<string, object>>();
            lock (Gate)
                foreach (var n in recent)
                    if ((long)n["seq"] > afterSeq) list.Add(n);
            return list;
        }

        public static List<Dictionary<string, object>> Recent()
        {
            lock (Gate) return new List<Dictionary<string, object>>(recent);
        }

        public static long Seq { get { lock (Gate) return seq; } }

        /// <summary>Opens the app a notification came from (only apps that sent one).</summary>
        public static bool OpenApp(string appKey)
        {
            string target;
            lock (Gate) if (string.IsNullOrEmpty(appKey) || !openTargets.TryGetValue(appKey.ToLowerInvariant(), out target)) return false;
            try
            {
                if (target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && File.Exists(target))
                    Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
                else
                {
                    if (!Regex.IsMatch(target, @"^[A-Za-z0-9._!{}\\ \-]{1,200}$")) return false;
                    Process.Start(new ProcessStartInfo("explorer.exe", "shell:AppsFolder\\" + target) { UseShellExecute = true });
                }
                return true;
            }
            catch (Exception ex) { Log.Write("Notification open: " + ex.Message); return false; }
        }
    }

    // ======================================================================= Counter-Strike 2
    /// <summary>
    /// CS2's official Game State Integration: CS2 itself sends your score, health, money and so on to the helper.
    /// It only needs a small text file in CS2's cfg folder. No game files are changed and nothing reads the game.
    /// </summary>
    static class Cs2
    {
        public const string CfgName = "gamestate_integration_controlpanel.cfg";
        static readonly object Gate = new object();
        static Dictionary<string, object> last;
        static DateTime lastAt = DateTime.MinValue, wantedAt = DateTime.MinValue, phaseWantedAt = DateTime.MinValue;
        static string lastPhaseKey = "";
        static long ver;
        static string matchKey, recordedKey;
        static Dictionary<string, object> ownStats;
        static string ownTeam;
        public static readonly string LogFile = Path.Combine(Settings.Folder, "cs2matches.json");

        static string Token
        {
            get
            {
                if (string.IsNullOrEmpty(Settings.Current.Cs2Token))
                {
                    Settings.Current.Cs2Token = Settings.NewId() + Settings.NewId();
                    Settings.Save();
                }
                return Settings.Current.Cs2Token;
            }
        }

        public static string CfgFolder()
        {
            string game = Steam.AppFolder("730");
            if (game == null) return null;
            string cfg = Path.Combine(game, @"game\csgo\cfg");
            return Directory.Exists(cfg) ? cfg : null;
        }

        static string CfgText()
        {
            return "\"Control Panel\"\r\n{\r\n" +
                "\t\"uri\"\t\t\"http://127.0.0.1:" + Settings.Current.Port + "/cs2\"\r\n" +
                "\t\"timeout\"\t\"1.1\"\r\n\t\"buffer\"\t\"0.1\"\r\n\t\"throttle\"\t\"0.25\"\r\n\t\"heartbeat\"\t\"15.0\"\r\n" +
                "\t\"auth\"\r\n\t{\r\n\t\t\"token\"\t\"" + Token + "\"\r\n\t}\r\n" +
                "\t\"data\"\r\n\t{\r\n" +
                "\t\t\"provider\"\t\t\"1\"\r\n\t\t\"map\"\t\t\t\"1\"\r\n\t\t\"round\"\t\t\t\"1\"\r\n\t\t\"map_round_wins\"\t\"1\"\r\n" +
                "\t\t\"player_id\"\t\t\"1\"\r\n\t\t\"player_state\"\t\t\"1\"\r\n\t\t\"player_weapons\"\t\"1\"\r\n\t\t\"player_match_stats\"\t\"1\"\r\n" +
                "\t\t\"bomb\"\t\t\t\"1\"\r\n\t\t\"phase_countdowns\"\t\"1\"\r\n\t}\r\n}\r\n";
        }

        public static string State3()
        {
            string folder = CfgFolder();
            if (folder == null) return Steam.AppFolder("730") == null ? "nocs2" : "nocfg";
            string f = Path.Combine(folder, CfgName);
            try { return File.Exists(f) && File.ReadAllText(f) == CfgText() ? "installed" : "missing"; }
            catch { return "missing"; }
        }

        public static bool Install()
        {
            string folder = CfgFolder();
            if (folder == null) { Log.Write("CS2: game folder not found"); return false; }
            try
            {
                File.WriteAllText(Path.Combine(folder, CfgName), CfgText(), new UTF8Encoding(false));
                Log.Write("CS2: integration file written to " + folder);
                return true;
            }
            catch (Exception ex) { Log.Write("CS2: " + ex.Message); return false; }
        }

        public static void Remove()
        {
            string folder = CfgFolder();
            if (folder != null) try { File.Delete(Path.Combine(folder, CfgName)); } catch { }
        }

        /// <summary>full: CS2 tiles are on screen (every update). Otherwise only round changes (for quiet banners).</summary>
        public static void Wanted(bool full) { if (full) wantedAt = DateTime.UtcNow; else phaseWantedAt = DateTime.UtcNow; }

        /// <summary>An update from CS2. Returns false if it isn't from our CS2 file.</summary>
        public static bool Receive(string body)
        {
            Dictionary<string, object> d;
            try { d = Server.ParseJson(body); } catch { return false; }
            if (d == null) return false;
            var auth = Obj(d, "auth");
            if (auth == null || S(auth, "token") != Token) return false;
            string phaseKey;
            lock (Gate)
            {
                last = d;
                lastAt = DateTime.UtcNow;
                ver++;
                Track(d);
                phaseKey = (S(Obj(d, "map"), "phase") ?? "") + "|" + (S(Obj(d, "round"), "phase") ?? "");
            }
            bool phaseChanged = phaseKey != lastPhaseKey;
            lastPhaseKey = phaseKey;
            if ((DateTime.UtcNow - wantedAt).TotalSeconds < 60 || (phaseChanged && (DateTime.UtcNow - phaseWantedAt).TotalSeconds < 60)) Events.Bump();
            return true;
        }

        static Dictionary<string, object> Obj(Dictionary<string, object> d, string k)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) ? v as Dictionary<string, object> : null;
        }
        static string S(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : null; }
        static int I(Dictionary<string, object> d, string k)
        {
            object v;
            if (d == null || !d.TryGetValue(k, out v) || v == null) return 0;
            try { return Convert.ToInt32(Convert.ToDouble(v, System.Globalization.CultureInfo.InvariantCulture)); } catch { return 0; }
        }

        static bool IsOwn(Dictionary<string, object> d)
        {
            string me = S(Obj(d, "provider"), "steamid"), who = S(Obj(d, "player"), "steamid");
            return me != null && me == who;
        }

        // Remembers your match stats and saves the match to the history when it ends.
        static void Track(Dictionary<string, object> d)
        {
            var map = Obj(d, "map");
            if (map == null) { matchKey = null; return; }
            string name = S(map, "name") ?? "", mode = S(map, "mode") ?? "", phase = S(map, "phase") ?? "";
            int round = I(map, "round");
            if (matchKey == null || !matchKey.StartsWith(name + "|") || (phase == "warmup" && round == 0))
                matchKey = name + "|" + DateTime.UtcNow.Ticks;
            if (IsOwn(d))
            {
                var p = Obj(d, "player");
                ownStats = Obj(p, "match_stats");
                ownTeam = S(p, "team");
            }
            if (phase == "gameover" && recordedKey != matchKey && ownStats != null)
            {
                recordedKey = matchKey;
                int ct = I(Obj(map, "team_ct"), "score"), t = I(Obj(map, "team_t"), "score");
                int mine = ownTeam == "CT" ? ct : t, theirs = ownTeam == "CT" ? t : ct;
                var m = new Dictionary<string, object>();
                m["time"] = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
                m["map"] = name; m["mode"] = mode;
                m["us"] = mine; m["them"] = theirs;
                m["result"] = mine > theirs ? "win" : mine < theirs ? "loss" : "tie";
                m["k"] = I(ownStats, "kills"); m["d"] = I(ownStats, "deaths"); m["a"] = I(ownStats, "assists");
                m["mvps"] = I(ownStats, "mvps"); m["score"] = I(ownStats, "score");
                ThreadPool.QueueUserWorkItem(delegate { Save(m); });
            }
        }

        static void Save(Dictionary<string, object> m)
        {
            lock (LogFile)
            {
                var list = History();
                list.Insert(0, m);
                if (list.Count > 50) list.RemoveRange(50, list.Count - 50);
                try
                {
                    Directory.CreateDirectory(Settings.Folder);
                    File.WriteAllText(LogFile, new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(list), new UTF8Encoding(false));
                    Log.Write("CS2: saved match on " + m["map"] + " (" + m["result"] + ")");
                }
                catch (Exception ex) { Log.Write("CS2 history: " + ex.Message); }
            }
        }

        public static List<Dictionary<string, object>> History()
        {
            lock (LogFile)
            {
                try
                {
                    if (!File.Exists(LogFile)) return new List<Dictionary<string, object>>();
                    var list = new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<List<Dictionary<string, object>>>(File.ReadAllText(LogFile, Encoding.UTF8));
                    return list ?? new List<Dictionary<string, object>>();
                }
                catch { return new List<Dictionary<string, object>>(); }
            }
        }

        static readonly Dictionary<string, string> Names = new Dictionary<string, string>
        {
            { "ak47", "AK-47" }, { "m4a1", "M4A4" }, { "m4a1_silencer", "M4A1-S" }, { "awp", "AWP" }, { "deagle", "Desert Eagle" },
            { "glock", "Glock-18" }, { "hkp2000", "P2000" }, { "usp_silencer", "USP-S" }, { "p250", "P250" }, { "fiveseven", "Five-SeveN" },
            { "tec9", "Tec-9" }, { "cz75a", "CZ75-Auto" }, { "elite", "Dual Berettas" }, { "revolver", "R8 Revolver" },
            { "famas", "FAMAS" }, { "galilar", "Galil AR" }, { "aug", "AUG" }, { "sg556", "SG 553" }, { "ssg08", "SSG 08" },
            { "scar20", "SCAR-20" }, { "g3sg1", "G3SG1" }, { "mac10", "MAC-10" }, { "mp9", "MP9" }, { "mp7", "MP7" }, { "mp5sd", "MP5-SD" },
            { "ump45", "UMP-45" }, { "p90", "P90" }, { "bizon", "PP-Bizon" }, { "nova", "Nova" }, { "xm1014", "XM1014" },
            { "sawedoff", "Sawed-Off" }, { "mag7", "MAG-7" }, { "m249", "M249" }, { "negev", "Negev" }, { "taser", "Zeus x27" },
            { "c4", "C4" }, { "hegrenade", "HE" }, { "flashbang", "Flash" }, { "smokegrenade", "Smoke" }, { "molotov", "Molotov" },
            { "incgrenade", "Incendiary" }, { "decoy", "Decoy" }, { "knife", "Knife" }, { "knife_t", "Knife" },
        };

        static string Nice(string w)
        {
            if (string.IsNullOrEmpty(w)) return "";
            string k = w.StartsWith("weapon_") ? w.Substring(7) : w;
            string n;
            if (Names.TryGetValue(k, out n)) return n;
            if (k.StartsWith("knife") || k.StartsWith("bayonet")) return "Knife";
            return k.Replace('_', ' ').ToUpperInvariant();
        }

        /// <summary>What the CS2 tiles show.</summary>
        public static Dictionary<string, object> State()
        {
            var r = new Dictionary<string, object>();
            Dictionary<string, object> d;
            DateTime at;
            long v;
            lock (Gate) { d = last; at = lastAt; v = ver; }
            r["setup"] = State3();
            r["ver"] = v;
            bool live = d != null && (DateTime.UtcNow - at).TotalSeconds < 40 && Obj(d, "map") != null;
            r["live"] = live;
            r["running"] = d != null && (DateTime.UtcNow - at).TotalSeconds < 40;
            if (!live) return r;
            var map = Obj(d, "map");
            var m = new Dictionary<string, object>();
            m["name"] = (S(map, "name") ?? "").Replace("de_", "").Replace("cs_", "");
            m["mode"] = S(map, "mode") ?? "";
            m["phase"] = S(map, "phase") ?? "";
            m["round"] = I(map, "round");
            m["ct"] = I(Obj(map, "team_ct"), "score");
            m["t"] = I(Obj(map, "team_t"), "score");
            // Rounds lost in a row (the loss bonus), for the buy tip.
            m["ctLoss"] = I(Obj(map, "team_ct"), "consecutive_round_losses");
            m["tLoss"] = I(Obj(map, "team_t"), "consecutive_round_losses");
            r["map"] = m;
            var round = Obj(d, "round");
            if (round != null)
            {
                var rd = new Dictionary<string, object>();
                rd["phase"] = S(round, "phase") ?? "";
                rd["bomb"] = S(round, "bomb") ?? "";
                rd["win"] = S(round, "win_team") ?? "";
                r["round"] = rd;
            }
            var pc = Obj(d, "phase_countdowns");
            if (pc != null)
            {
                var c = new Dictionary<string, object>();
                c["phase"] = S(pc, "phase") ?? "";
                double ends;
                double.TryParse(S(pc, "phase_ends_in") ?? "0", System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out ends);
                c["endsIn"] = ends;
                r["countdown"] = c;
            }
            var bomb = Obj(d, "bomb");
            if (bomb != null)
            {
                var b = new Dictionary<string, object>();
                b["state"] = S(bomb, "state") ?? "";
                double cd;
                double.TryParse(S(bomb, "countdown") ?? "0", System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out cd);
                b["countdown"] = cd;
                r["bomb"] = b;
            }
            var p = Obj(d, "player");
            if (p != null)
            {
                var me = new Dictionary<string, object>();
                me["name"] = S(p, "name") ?? "";
                me["team"] = S(p, "team") ?? "";
                me["own"] = IsOwn(d);
                me["activity"] = S(p, "activity") ?? "";
                var st = Obj(p, "state");
                if (st != null)
                {
                    foreach (var k in new[] { "health", "armor", "money", "round_kills", "round_killhs", "flashed", "burning", "equip_value" }) me[k] = I(st, k);
                    me["helmet"] = S(st, "helmet") == "True" || S(st, "helmet") == "true";
                    me["defuse"] = S(st, "defusekit") == "True" || S(st, "defusekit") == "true";
                }
                var ms = Obj(p, "match_stats");
                if (ms != null) foreach (var k in new[] { "kills", "assists", "deaths", "mvps", "score" }) me[k] = I(ms, k);
                r["player"] = me;
                var ws = Obj(p, "weapons");
                if (ws != null)
                {
                    var nades = new List<string>();
                    foreach (var kv in ws)
                    {
                        var w = kv.Value as Dictionary<string, object>;
                        if (w == null) continue;
                        string type = S(w, "type") ?? "";
                        if (type == "Grenade") { int n = Math.Max(1, I(w, "ammo_reserve")); for (int i = 0; i < n && nades.Count < 6; i++) nades.Add(Nice(S(w, "name"))); }
                        if (S(w, "state") == "active")
                        {
                            var a = new Dictionary<string, object>();
                            a["name"] = Nice(S(w, "name"));
                            a["type"] = type;
                            a["clip"] = w.ContainsKey("ammo_clip") ? (object)I(w, "ammo_clip") : null;
                            a["clipMax"] = w.ContainsKey("ammo_clip_max") ? (object)I(w, "ammo_clip_max") : null;
                            a["reserve"] = w.ContainsKey("ammo_reserve") ? (object)I(w, "ammo_reserve") : null;
                            r["weapon"] = a;
                        }
                        if (S(w, "name") == "weapon_c4") me["bomb"] = true;
                    }
                    r["grenades"] = nades;
                }
            }
            return r;
        }
    }

    // ======================================================================= system health
    /// <summary>Things that need your attention: a drive almost full, a restart waiting for Windows updates, and so on.</summary>
    static class Health
    {
        static List<Dictionary<string, object>> cache;
        static DateTime cacheAt = DateTime.MinValue, updatesAt = DateTime.MinValue;
        static int updates = -1;
        static bool checkingUpdates;
        static readonly object Gate = new object();

        static Dictionary<string, object> Item(string level, string icon, string text, string sub, string fix)
        {
            var d = new Dictionary<string, object>();
            d["level"] = level; d["icon"] = icon; d["text"] = text; d["sub"] = sub ?? "";
            if (fix != null) d["fix"] = fix;
            return d;
        }

        static bool KeyExists(string path)
        {
            try { using (var k = Registry.LocalMachine.OpenSubKey(path)) return k != null; } catch { return false; }
        }

        public static List<Dictionary<string, object>> Get()
        {
            lock (Gate)
            {
                if (cache != null && (DateTime.UtcNow - cacheAt).TotalMinutes < 5) return cache;
                var list = new List<Dictionary<string, object>>();
                try
                {
                    foreach (var drive in DriveInfo.GetDrives())
                    {
                        try
                        {
                            if (drive.DriveType != DriveType.Fixed || !drive.IsReady || drive.TotalSize < 20L * 1073741824) continue;
                            double free = drive.TotalFreeSpace / 1073741824.0, pct = 100.0 * drive.TotalFreeSpace / drive.TotalSize;
                            if (pct < 10 || free < 15)
                                list.Add(Item(pct < 5 || free < 5 ? "bad" : "warn", "storage", "Drive " + drive.Name.TrimEnd('\\') + " is almost full", Math.Round(free) + " GB free of " + Math.Round(drive.TotalSize / 1073741824.0) + " GB", "storage"));
                        }
                        catch { }
                    }
                }
                catch { }
                if (KeyExists(@"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired") ||
                    KeyExists(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending"))
                    list.Add(Item("warn", "power", "Restart to finish Windows updates", "Windows is waiting for a restart", "winupdate"));
                else if (updates > 0)
                    list.Add(Item("info", "down", updates + " Windows update" + (updates == 1 ? "" : "s") + " waiting", "Install them when it suits you", "winupdate"));
                double days = Uptime.Seconds() / 86400.0;
                if (days >= 7) list.Add(Item("info", "clock", "Your PC hasn't restarted in " + Math.Floor(days) + " days", "A restart can make things snappier", null));
                try
                {
                    var c = Cleanup.State();
                    long bin = Convert.ToInt64(c["bin"]);
                    if (bin > 10L * 1073741824) list.Add(Item("info", "x", "The recycle bin holds " + Math.Round(bin / 1073741824.0) + " GB", "Empty it with the Clean-up tile", null));
                }
                catch { }
                cache = list;
                cacheAt = DateTime.UtcNow;
                if (!checkingUpdates && (DateTime.UtcNow - updatesAt).TotalHours > 6) CheckUpdates();
                return list;
            }
        }

        // Asks Windows Update (in the background, at most every 6 hours) how many updates wait.
        static void CheckUpdates()
        {
            checkingUpdates = true;
            updatesAt = DateTime.UtcNow;
            var t = new Thread(delegate ()
            {
                try
                {
                    var type = Type.GetTypeFromProgID("Microsoft.Update.Session");
                    object session = Activator.CreateInstance(type);
                    object searcher = type.InvokeMember("CreateUpdateSearcher", System.Reflection.BindingFlags.InvokeMethod, null, session, null);
                    searcher.GetType().InvokeMember("Online", System.Reflection.BindingFlags.SetProperty, null, searcher, new object[] { false });
                    object result = searcher.GetType().InvokeMember("Search", System.Reflection.BindingFlags.InvokeMethod, null, searcher, new object[] { "IsInstalled=0 and IsHidden=0 and Type='Software'" });
                    object ups = result.GetType().InvokeMember("Updates", System.Reflection.BindingFlags.GetProperty, null, result, null);
                    int n = (int)ups.GetType().InvokeMember("Count", System.Reflection.BindingFlags.GetProperty, null, ups, null);
                    lock (Gate) { updates = n; cache = null; }
                    Marshal.ReleaseComObject(session);
                }
                catch (Exception ex) { Log.Write("Windows Update check: " + ex.Message); }
                checkingUpdates = false;
            }) { IsBackground = true, Priority = ThreadPriority.BelowNormal };
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
        }
    }

    // ======================================================================= layout file (save / open on the PC)
    /// <summary>Saves the panel's layout to a file you choose, or opens one. The dialog appears on your main screen.</summary>
    static class LayoutFile
    {
        public static SynchronizationContext Ui;

        static T OnUi<T>(Func<T> f)
        {
            if (Ui == null) return default(T);
            T result = default(T);
            var done = new ManualResetEvent(false);
            Ui.Post(delegate { try { result = f(); } catch (Exception ex) { Log.Write("Layout file: " + ex.Message); } finally { done.Set(); } }, null);
            done.WaitOne(TimeSpan.FromMinutes(5));
            return result;
        }

        static Form Owner()
        {
            return new Form { TopMost = true, ShowInTaskbar = false, StartPosition = FormStartPosition.CenterScreen, Width = 1, Height = 1, Opacity = 0 };
        }

        public static string Export(string layout, string pageName = null)
        {
            if (string.IsNullOrEmpty(layout) || layout.Length > 4 * 1024 * 1024 || layout[0] != '{') return null;
            return OnUi<string>(delegate ()
            {
                using (var owner = Owner())
                using (var dlg = new SaveFileDialog())
                {
                    owner.Show();
                    owner.Activate();
                    string safe = pageName == null ? null : string.Join("", pageName.Split(Path.GetInvalidFileNameChars())).Trim();
                    dlg.Title = string.IsNullOrEmpty(safe) ? "Save your Control Panel layout" : "Save the page " + safe;
                    dlg.Filter = "Control Panel layout (*.cplayout)|*.cplayout|JSON (*.json)|*.json";
                    dlg.FileName = string.IsNullOrEmpty(safe) ? "Control Panel " + DateTime.Now.ToString("yyyy-MM-dd") + ".cplayout" : "Control Panel page - " + safe + ".cplayout";
                    dlg.InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
                    if (dlg.ShowDialog(owner) != DialogResult.OK) return "";
                    File.WriteAllText(dlg.FileName, "{\"controlPanelLayout\":1,\"layout\":" + Server.JsonString(layout) + "}", new UTF8Encoding(false));
                    Log.Write("Layout saved to " + dlg.FileName);
                    return Path.GetFileName(dlg.FileName);
                }
            });
        }

        public static string Import(out string fileName)
        {
            string name = null;
            string text = OnUi<string>(delegate ()
            {
                using (var owner = Owner())
                using (var dlg = new OpenFileDialog())
                {
                    owner.Show();
                    owner.Activate();
                    dlg.Title = "Open a Control Panel layout";
                    dlg.Filter = "Control Panel layout (*.cplayout;*.json)|*.cplayout;*.json";
                    dlg.InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
                    if (dlg.ShowDialog(owner) != DialogResult.OK) return "";
                    if (new FileInfo(dlg.FileName).Length > 5 * 1024 * 1024) return null;
                    name = Path.GetFileName(dlg.FileName);
                    var d = Server.ParseJson(File.ReadAllText(dlg.FileName, Encoding.UTF8));
                    object v;
                    if (d != null && d.TryGetValue("layout", out v) && v is string) return (string)v;
                    // A page file written by hand or by someone else: the pages are right there, not wrapped.
                    if (d != null && (d.ContainsKey("controlPanelPages") || d.ContainsKey("controlPanelPage"))) return File.ReadAllText(dlg.FileName, Encoding.UTF8).TrimStart('\uFEFF', ' ', '\r', '\n', '\t');
                    return null;
                }
            });
            fileName = name;
            return text;
        }
    }
}
