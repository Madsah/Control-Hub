// FlightLine's "Start session": starts your flight programs one at a time and switches the panel to your flight page.
// "End session" switches the panel back, and closes only the programs you ticked.
// The list lives in %APPDATA%\ControlHub\FlightLine\session.json and is edited in the FlightLine window.
// C# 5 / .NET Framework 4.x.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

namespace ControlPanelHelper
{
    static class FlightSession
    {
        static readonly string FilePath = Path.Combine(FlightRec.Folder, "session.json");
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        static readonly object Gate = new object();
        static readonly Regex ProcName = new Regex(@"^[A-Za-z0-9 _.\-()+]{1,80}$");

        // Steam games whose program name is known (so "already running" and "close" work for them).
        static readonly Dictionary<string, string> SteamProcess = new Dictionary<string, string>
        {
            { "2537590", "FlightSimulator2024" }, { "1250410", "FlightSimulator" }, { "730", "cs2" }
        };

        // ------------------------------------------------------------------ the list

        public static Dictionary<string, object> Config()
        {
            lock (Gate)
            {
                try
                {
                    if (File.Exists(FilePath))
                    {
                        var d = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(FilePath, Encoding.UTF8));
                        if (d != null) return d;
                    }
                }
                catch (Exception ex) { Log.Write("Session: " + ex.Message); }
            }
            return null;
        }

        /// <summary>Checks and saves the list from the FlightLine window. Returns false if it doesn't look right.</summary>
        public static bool Save(Dictionary<string, object> c)
        {
            var clean = Clean(c);
            if (clean == null) return false;
            lock (Gate)
            {
                try
                {
                    Directory.CreateDirectory(FlightRec.Folder);
                    File.WriteAllText(FilePath, Json.Serialize(clean), new UTF8Encoding(false));
                    return true;
                }
                catch (Exception ex) { Log.Write("Session save: " + ex.Message); return false; }
            }
        }

        static Dictionary<string, object> Clean(Dictionary<string, object> c)
        {
            if (c == null) return null;
            var outD = new Dictionary<string, object>();
            outD["v"] = 1;
            outD["page"] = Short(Str(c, "page"), 40) ?? "";
            outD["homePage"] = Short(Str(c, "homePage"), 40) ?? "";
            var steps = new List<Dictionary<string, object>>();
            object so;
            var list = c.TryGetValue("steps", out so) ? so as IEnumerable : null;
            if (list != null)
                foreach (var o in list)
                {
                    var s = o as Dictionary<string, object>;
                    if (s == null || steps.Count >= 12) continue;
                    string kind = Str(s, "kind");
                    if (kind != "app" && kind != "steam" && kind != "url") continue;
                    var t = new Dictionary<string, object>();
                    t["kind"] = kind;
                    t["name"] = Short(Str(s, "name"), 80) ?? "Program";
                    t["wait"] = Math.Max(0, Math.Min(300, Num(s, "wait", 5)));
                    t["on"] = Bool(s, "on", true);
                    t["close"] = Bool(s, "close", false);
                    string id = Short(Str(s, "id"), 400), icon = Short(Str(s, "icon"), 80), proc = Str(s, "process");
                    if (kind == "url")
                    {
                        Uri u;
                        string url = Str(s, "url");
                        if (url == null || !Uri.TryCreate(url, UriKind.Absolute, out u) || (u.Scheme != "http" && u.Scheme != "https")) continue;
                        t["url"] = u.AbsoluteUri;
                        t["close"] = false;
                    }
                    else
                    {
                        if (string.IsNullOrEmpty(id)) continue;
                        if (kind == "steam") { foreach (char ch in id) if (!char.IsDigit(ch)) { id = null; break; } if (id == null) continue; }
                        t["id"] = id;
                    }
                    if (icon != null) t["icon"] = icon;
                    if (proc != null && ProcName.IsMatch(proc)) t["process"] = proc;
                    steps.Add(t);
                }
            outD["steps"] = steps;
            return outD;
        }

        /// <summary>A first list from what's on this PC: MSFS 2024, SayIntentions, Navigraph and SimBrief.</summary>
        public static Dictionary<string, object> Suggest()
        {
            var steps = new List<Dictionary<string, object>>();
            bool steamMsfs = false;
            try
            {
                foreach (var g in Steam.Games())
                    if (Convert.ToString(g["id"]) == "2537590")
                    {
                        steps.Add(Step("steam", "2537590", "Microsoft Flight Simulator 2024", null, 25));
                        steamMsfs = true;
                        break;
                    }
            }
            catch { }
            var apps = Apps.GetAll(false);
            Func<string, AppEntry> find = delegate (string words)
            {
                foreach (var a in apps)
                    if (a.Kind != "url" && a.Name.IndexOf(words, StringComparison.OrdinalIgnoreCase) >= 0) return a;
                return null;
            };
            if (!steamMsfs)
            {
                var m = find("Flight Simulator 2024");
                if (m != null) steps.Add(Step("app", m.Id, m.Name, m.Icon, 25));
            }
            foreach (var words in new[] { "SayIntentions", "Navigraph Simlink", "Navigraph Charts", "Navigraph Hub" })
            {
                var a = find(words);
                if (a != null && !steps.Exists(x => (string)x["name"] == a.Name)) steps.Add(Step("app", a.Id, a.Name, a.Icon, 5));
            }
            var sb = Step("url", null, "SimBrief", null, 0);
            sb["url"] = "https://dispatch.simbrief.com/";
            steps.Add(sb);

            var c = new Dictionary<string, object>();
            c["v"] = 1;
            c["steps"] = steps;
            // The panel page for flying: one named like "Flight", "MSFS", "Cockpit" or "Sim".
            string page = "", home = "";
            foreach (var p in PanelPages())
            {
                string name = (string)p["name"], id = (string)p["id"];
                if (home == "") home = id;
                if (page == "" && Regex.IsMatch(name, "flight|msfs|cockpit|sim|fly", RegexOptions.IgnoreCase)) page = id;
            }
            c["page"] = page;
            c["homePage"] = home;
            return c;
        }

        static Dictionary<string, object> Step(string kind, string id, string name, string icon, int wait)
        {
            var s = new Dictionary<string, object>();
            s["kind"] = kind;
            if (id != null) s["id"] = id;
            s["name"] = name;
            if (icon != null) s["icon"] = icon;
            s["wait"] = wait;
            s["on"] = true;
            s["close"] = false;
            return s;
        }

        /// <summary>The panel's pages (id and name), from its newest layout.</summary>
        public static List<Dictionary<string, object>> PanelPages()
        {
            var list = new List<Dictionary<string, object>>();
            try
            {
                string layout = Backups.LiveLayout();
                if (string.IsNullOrEmpty(layout)) return list;
                var d = Server.ParseJson(layout);
                object po;
                var pages = d != null && d.TryGetValue("pages", out po) ? po as IEnumerable : null;
                if (pages == null) return list;
                foreach (var o in pages)
                {
                    var p = o as Dictionary<string, object>;
                    if (p == null) continue;
                    var e = new Dictionary<string, object>();
                    e["id"] = Str(p, "id") ?? "";
                    e["name"] = Str(p, "name") ?? "Page";
                    if ((string)e["id"] != "") list.Add(e);
                }
            }
            catch (Exception ex) { Log.Write("Session pages: " + ex.Message); }
            return list;
        }

        // ------------------------------------------------------------------ running it

        static Thread runner;
        static volatile bool stopRun;
        static List<Dictionary<string, object>> progress = new List<Dictionary<string, object>>();
        static bool active;          // started, not ended yet
        static long startedAt;
        static string phase = "";    // "starting", "started", "ending", ""

        public static Dictionary<string, object> State()
        {
            var d = new Dictionary<string, object>();
            lock (Gate)
            {
                d["active"] = active;
                d["phase"] = phase;
                d["startedAt"] = startedAt;
                var steps = new List<Dictionary<string, object>>();
                foreach (var p in progress) steps.Add(new Dictionary<string, object>(p));
                d["steps"] = steps;
            }
            return d;
        }

        public static bool Start()
        {
            var c = Config() ?? Suggest();
            var steps = new List<Dictionary<string, object>>();
            object so;
            var list = c.TryGetValue("steps", out so) ? so as IEnumerable : null;
            if (list != null) foreach (var o in list) { var s = o as Dictionary<string, object>; if (s != null && Bool(s, "on", true)) steps.Add(s); }
            lock (Gate)
            {
                if (runner != null && runner.IsAlive) return false;
                progress = new List<Dictionary<string, object>>();
                foreach (var s in steps)
                {
                    var p = new Dictionary<string, object>();
                    p["name"] = Str(s, "name") ?? "Program";
                    p["state"] = "waiting";
                    progress.Add(p);
                }
                active = true;
                phase = "starting";
                startedAt = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds;
                stopRun = false;
                string page = Str(c, "page");
                runner = new Thread(delegate () { RunSteps(steps, page); }) { IsBackground = true, Name = "flight session" };
                runner.Start();
            }
            Log.Write("Session: starting (" + steps.Count + " programs)");
            return true;
        }

        static void RunSteps(List<Dictionary<string, object>> steps, string page)
        {
            for (int i = 0; i < steps.Count && !stopRun; i++)
            {
                var s = steps[i];
                SetState(i, "starting");
                string proc = ProcessFor(s);
                if (proc != null && Running(proc)) { SetState(i, "already"); continue; }
                bool ok = false;
                try
                {
                    string kind = Str(s, "kind");
                    if (kind == "app") ok = Apps.Launch(Str(s, "id"));
                    else if (kind == "steam") ok = Steam.Run(Str(s, "id"));
                    else if (kind == "url") ok = Apps.OpenUrl(Str(s, "url"));
                }
                catch (Exception ex) { Log.Write("Session: " + Str(s, "name") + ": " + ex.Message); }
                SetState(i, ok ? "started" : "failed");
                if (!ok) continue;
                // Give it a moment before the next one (not after the last).
                int wait = Num(s, "wait", 5);
                for (int w = 0; w < wait * 4 && i < steps.Count - 1 && !stopRun; w++) Thread.Sleep(250);
            }
            if (!string.IsNullOrEmpty(page)) RequestPage(page);
            lock (Gate) { if (phase == "starting") phase = "started"; }
            Log.Write("Session: started");
        }

        public static bool End()
        {
            stopRun = true;
            var c = Config();
            var closeNames = new List<string>();
            lock (Gate)
            {
                phase = "ending";
                progress = new List<Dictionary<string, object>>();
            }
            object so;
            var list = c != null && c.TryGetValue("steps", out so) ? so as IEnumerable : null;
            if (list != null)
                foreach (var o in list)
                {
                    var s = o as Dictionary<string, object>;
                    if (s == null || !Bool(s, "close", false)) continue;
                    string proc = ProcessFor(s);
                    var p = new Dictionary<string, object>();
                    p["name"] = Str(s, "name") ?? "Program";
                    p["state"] = proc == null ? "cantclose" : Running(proc) ? "closing" : "notrunning";
                    lock (Gate) progress.Add(p);
                    if (proc != null) closeNames.Add(proc);
                }
            string home = c != null ? Str(c, "homePage") : null;
            ThreadPool.QueueUserWorkItem(delegate
            {
                for (int i = 0; i < closeNames.Count; i++)
                {
                    bool closed = Close(closeNames[i]);
                    lock (Gate)
                    {
                        // The progress rows for closing are in the same order, skipping ones that can't be closed.
                        int n = -1;
                        foreach (var p in progress)
                        {
                            if ((string)p["state"] == "cantclose") continue;
                            if (++n == i) { if ((string)p["state"] == "closing") p["state"] = closed ? "closed" : "stillopen"; break; }
                        }
                    }
                }
                if (!string.IsNullOrEmpty(home)) RequestPage(home);
                lock (Gate) { active = false; phase = ""; }
                Log.Write("Session: ended");
            });
            return true;
        }

        static void SetState(int i, string state)
        {
            lock (Gate) { if (i < progress.Count) progress[i]["state"] = state; }
        }

        /// <summary>The program name to look for: set on the step, known for some Steam games, or the .exe an app starts.</summary>
        static string ProcessFor(Dictionary<string, object> s)
        {
            string p = Str(s, "process");
            if (!string.IsNullOrEmpty(p)) return p;
            string kind = Str(s, "kind"), id = Str(s, "id");
            if (kind == "steam") { string n; return id != null && SteamProcess.TryGetValue(id, out n) ? n : null; }
            if (kind == "app")
            {
                var a = Apps.Find(id);
                if (a != null && a.Launch != null && a.Launch.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                    return Path.GetFileNameWithoutExtension(a.Launch);
            }
            return null;
        }

        static bool Running(string proc)
        {
            var ps = Process.GetProcessesByName(proc);
            bool any = ps.Length > 0;
            foreach (var x in ps) x.Dispose();
            return any;
        }

        // Asks the program to close like clicking its X (so it can save); never forced.
        static bool Close(string proc)
        {
            var ps = Process.GetProcessesByName(proc);
            try
            {
                foreach (var x in ps) { try { x.CloseMainWindow(); } catch { } }
                for (int t = 0; t < 40; t++)
                {
                    Thread.Sleep(250);
                    if (!Running(proc)) return true;
                }
                return false;
            }
            finally { foreach (var x in ps) x.Dispose(); }
        }

        // ------------------------------------------------------------------ the panel page (sent with the panel's live channel)

        static string pendingPage;
        static DateTime pendingAt;

        static void RequestPage(string id)
        {
            lock (Gate) { pendingPage = id; pendingAt = DateTime.UtcNow; }
            Events.Bump();
        }

        /// <summary>A page the panel should switch to (given out once), or null. Requests older than a minute are dropped.</summary>
        public static string TakePage()
        {
            lock (Gate)
            {
                if (pendingPage == null) return null;
                string p = pendingPage;
                pendingPage = null;
                return (DateTime.UtcNow - pendingAt).TotalSeconds > 60 ? null : p;
            }
        }

        // ------------------------------------------------------------------ helpers

        static string Str(Dictionary<string, object> d, string k)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : null;
        }

        static string Short(string s, int max) { return s == null ? null : s.Length > max ? s.Substring(0, max) : s; }

        static int Num(Dictionary<string, object> d, string k, int def)
        {
            object v;
            if (d == null || !d.TryGetValue(k, out v) || v == null) return def;
            try { return (int)Math.Round(Convert.ToDouble(v)); } catch { return def; }
        }

        static bool Bool(Dictionary<string, object> d, string k, bool def)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) && v is bool ? (bool)v : def;
        }
    }
}
