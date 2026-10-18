// FlightLine's black box: records every flight in MSFS by itself (Control Hub Service, in the background).
//
// Sim.cs reads MSFS through SimConnect about 3 times a second and works out block out, takeoff, landing and block in.
// This keeps, for each flight: a point every few seconds (position, altitude, speeds, heading), what happened when
// (engines, gear, flaps, lights, autopilot, takeoff, touchdown), the landing and the airports.
// Each flight is one file in %APPDATA%\ControlHub\FlightLine\flights, with a short list of all of them in logbook.json.
// The flight that's being flown is saved every minute too, so a crash or closing MSFS doesn't lose it.
// C# 5 / .NET Framework 4.x.
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Diagnostics;
using System.Windows.Forms;
using Microsoft.Win32;

namespace ControlPanelHelper
{
    static class FlightRec
    {
        public static readonly string Folder = Path.Combine(Settings.Folder, "FlightLine");
        static readonly string FlightsDir = Path.Combine(Folder, "flights");
        static readonly string IndexPath = Path.Combine(Folder, "logbook.json");
        static readonly string CurrentPath = Path.Combine(Folder, "current.json");
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 };
        static readonly object Gate = new object();     // the flight being recorded
        static readonly object Disk = new object();     // the files

        // A point: [seconds since block out, lat, lon, altitude ft, above ground ft, IAS kt, ground speed kt, vertical speed fpm, heading true]
        public const int P_T = 0, P_LAT = 1, P_LON = 2, P_ALT = 3, P_AGL = 4, P_IAS = 5, P_GS = 6, P_VS = 7, P_HDG = 8;

        public class Sample
        {
            public double Lat, Lon, Alt, Agl, Ias, Gs, Vs, Hdg, Fuel, Gear, Flaps, Spoilers;
            public bool Ground, Engines, Park, LightLanding, LightBeacon, LightStrobe, LightTaxi, LightNav, Autopilot;
            public string Aircraft;
        }

        // ------------------------------------------------------------------ the flight being recorded

        static Dictionary<string, object> cur;          // meta of the flight being recorded (null = none)
        static List<double[]> pts;
        static List<object[]> events;
        static long startMs, lastPointMs, lastSaveMs;
        static Sample last;
        static double maxAlt, distNm;

        static long Now() { return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds; }
        static double Sec(long ms) { return Math.Round((ms - startMs) / 1000.0); }

        /// <summary>Block out: a new flight starts.</summary>
        public static void Begin(long blockOut, Sample s, string planFrom, string planTo, string flightNo)
        {
            lock (Gate)
            {
                if (cur != null) EndLocked(false);   // the last one never finished
                startMs = blockOut;
                cur = new Dictionary<string, object>();
                cur["id"] = blockOut.ToString();
                cur["start"] = blockOut;
                cur["aircraft"] = s.Aircraft ?? "";
                cur["planFrom"] = planFrom ?? "";
                cur["planTo"] = planTo ?? "";
                cur["flightNo"] = flightNo ?? "";
                cur["fuelStartKg"] = Math.Round(s.Fuel * 0.453592);
                cur["startLat"] = Math.Round(s.Lat, 5);
                cur["startLon"] = Math.Round(s.Lon, 5);
                pts = new List<double[]>();
                events = new List<object[]>();
                maxAlt = 0; distNm = 0;
                last = null;
                lastPointMs = 0;
                lastSaveMs = Now();
                Event(blockOut, "blockOut", "Pushback / taxi out");
                AddPoint(blockOut, s);
                last = s;
            }
            // Which airport you left from (reads the runway list, so not on the sim thread).
            double la = s.Lat, lo = s.Lon;
            string id = blockOut.ToString();
            ThreadPool.QueueUserWorkItem(delegate
            {
                string apt = Runways.Nearest(la, lo, 6000);
                if (apt == null) return;
                lock (Gate) { if (cur != null && (string)cur["id"] == id) cur["from"] = apt; }
            });
            Log.Write("FlightLine: recording a new flight");
        }

        /// <summary>About 3 times a second while a flight is being recorded.</summary>
        public static void Tick(Sample s, bool airborneThisFlight)
        {
            lock (Gate)
            {
                if (cur == null) return;
                long now = Now();
                if (last != null)
                {
                    if (s.Engines != last.Engines) Event(now, "engines", s.Engines ? "Engines started" : "Engines off");
                    if (Math.Abs(s.Gear - last.Gear) > 0.5) Event(now, "gear", s.Gear > 0.5 ? "Gear down" : "Gear up");
                    if (Math.Round(s.Flaps) != Math.Round(last.Flaps)) Event(now, "flaps", "Flaps " + Math.Round(s.Flaps));
                    if (s.LightLanding != last.LightLanding) Event(now, "light", "Landing lights " + (s.LightLanding ? "on" : "off"));
                    if (s.LightBeacon != last.LightBeacon) Event(now, "light", "Beacon " + (s.LightBeacon ? "on" : "off"));
                    if (s.LightStrobe != last.LightStrobe) Event(now, "light", "Strobes " + (s.LightStrobe ? "on" : "off"));
                    if (s.LightTaxi != last.LightTaxi) Event(now, "light", "Taxi light " + (s.LightTaxi ? "on" : "off"));
                    if (s.LightNav != last.LightNav) Event(now, "light", "Nav lights " + (s.LightNav ? "on" : "off"));
                    if (s.Autopilot != last.Autopilot) Event(now, "ap", "Autopilot " + (s.Autopilot ? "on" : "off"));
                    if (s.Park != last.Park) Event(now, "brake", "Parking brake " + (s.Park ? "set" : "released"));
                    if ((s.Spoilers > 50) != (last.Spoilers > 50) && airborneThisFlight) Event(now, "spoilers", s.Spoilers > 50 ? "Spoilers out" : "Spoilers in");
                    // A jump of more than 20 nm in a moment: the flight was moved in the sim (new flight, or slew).
                    if (Nm(last.Lat, last.Lon, s.Lat, s.Lon) > 20)
                    {
                        Event(now, "jump", "Moved in the sim");
                    }
                    else if (!s.Ground || s.Gs > 1) distNm += Nm(last.Lat, last.Lon, s.Lat, s.Lon);
                }
                maxAlt = Math.Max(maxAlt, s.Alt);
                // A point every 2 s near the ground in the air, 4 s higher up, 5 s on the ground.
                long every = s.Ground ? 5000 : s.Agl < 3000 ? 2000 : 4000;
                if (now - lastPointMs >= every && pts.Count < 20000) AddPoint(now, s);
                last = s;
                if (now - lastSaveMs > 60000)
                {
                    lastSaveMs = now;
                    var snap = Snapshot(false, now);
                    ThreadPool.QueueUserWorkItem(delegate { WriteFile(CurrentPath, snap); });
                }
            }
        }

        public static void Takeoff(long at)
        {
            lock (Gate) { if (cur != null) { cur["takeoff"] = at; Event(at, "takeoff", "Takeoff"); } }
        }

        public static void Touchdown(long at)
        {
            lock (Gate) { if (cur != null) { cur["landing"] = at; Event(at, "touchdown", "Touchdown"); } }
        }

        /// <summary>The landing's numbers (landing rate, G, grade, runway, where on it). Can come a moment after the touchdown.</summary>
        public static void Landing(Dictionary<string, object> l)
        {
            if (l == null) return;
            lock (Gate)
            {
                if (cur == null) return;
                var copy = new Dictionary<string, object>(l);
                cur["landingInfo"] = copy;
                object a;
                if (copy.TryGetValue("airport", out a) && a != null) cur["to"] = a;
            }
        }

        /// <summary>Block in: parked at the end. The flight is saved.</summary>
        public static void End(long blockIn, double fuelKg)
        {
            lock (Gate)
            {
                if (cur == null) return;
                cur["end"] = blockIn;
                cur["fuelUsedKg"] = Math.Max(0, Convert.ToDouble(cur["fuelStartKg"]) - Math.Round(fuelKg * 0.453592));
                Event(blockIn, "blockIn", "Parked");
                EndLocked(true);
            }
        }

        /// <summary>MSFS closed (or the flight was left) in the middle: what was recorded is kept, marked unfinished.</summary>
        public static void Abort(string why)
        {
            lock (Gate)
            {
                if (cur == null) return;
                if (last != null) cur["end"] = Now();
                Event(Now(), "stop", why);
                EndLocked(false);
            }
        }

        static void EndLocked(bool complete)
        {
            long end = cur.ContainsKey("end") ? Convert.ToInt64(cur["end"]) : Now();
            if (last != null) AddPoint(end, last);
            var rec = Snapshot(complete, end);
            cur = null; pts = null; events = null; last = null;
            // Too short to count (a few seconds of taxiing, never airborne): not kept.
            bool flew = rec.ContainsKey("takeoff");
            double mins = (end - startMs) / 60000.0;
            if (!flew && mins < 3)
            {
                lock (Disk) { try { File.Delete(CurrentPath); } catch { } }
                return;
            }
            ThreadPool.QueueUserWorkItem(delegate { Save(rec); });
        }

        static void AddPoint(long at, Sample s)
        {
            lastPointMs = at;
            pts.Add(new[] { Sec(at), Math.Round(s.Lat, 5), Math.Round(s.Lon, 5), Math.Round(s.Alt), Math.Round(s.Agl), Math.Round(s.Ias), Math.Round(s.Gs), Math.Round(s.Vs), Math.Round(s.Hdg) });
        }

        static void Event(long at, string kind, string text)
        {
            if (events == null || events.Count > 3000) return;
            events.Add(new object[] { Sec(at), kind, text });
        }

        static Dictionary<string, object> Snapshot(bool complete, long end)
        {
            var r = new Dictionary<string, object>(cur);
            r["v"] = 1;
            r["complete"] = complete;
            r["end"] = end;
            r["blockMin"] = Math.Round((end - startMs) / 60000.0);
            object t, l;
            if (cur.TryGetValue("takeoff", out t))
            {
                long lnd = cur.TryGetValue("landing", out l) ? Convert.ToInt64(l) : end;
                r["airMin"] = Math.Round((lnd - Convert.ToInt64(t)) / 60000.0);
            }
            r["distNm"] = Math.Round(distNm);
            r["maxAlt"] = Math.Round(maxAlt);
            r["pts"] = new List<double[]>(pts);
            r["events"] = new List<object[]>(events);
            return r;
        }

        // ------------------------------------------------------------------ live (for the FlightLine window)

        public static Dictionary<string, object> Live()
        {
            var d = new Dictionary<string, object>();
            lock (Gate)
            {
                d["recording"] = cur != null;
                if (cur == null) return d;
                d["id"] = cur["id"];
                d["start"] = startMs;
                d["aircraft"] = cur["aircraft"];
                object o;
                d["from"] = cur.TryGetValue("from", out o) ? o : cur["planFrom"];
                d["planTo"] = cur["planTo"];
                d["airborne"] = cur.ContainsKey("takeoff");
                d["landed"] = cur.ContainsKey("landing");
                d["distNm"] = Math.Round(distNm);
                d["points"] = pts.Count;
                // The path so far, thinned to at most about 400 points.
                int step = Math.Max(1, pts.Count / 400);
                var path = new List<double[]>();
                for (int i = 0; i < pts.Count; i += step) path.Add(new[] { pts[i][P_LAT], pts[i][P_LON], pts[i][P_ALT] });
                if (pts.Count > 0 && (pts.Count - 1) % step != 0) { var p = pts[pts.Count - 1]; path.Add(new[] { p[P_LAT], p[P_LON], p[P_ALT] }); }
                d["path"] = path;
                if (last != null)
                {
                    d["lat"] = last.Lat; d["lon"] = last.Lon; d["alt"] = Math.Round(last.Alt); d["agl"] = Math.Round(last.Agl);
                    d["ias"] = Math.Round(last.Ias); d["gs"] = Math.Round(last.Gs); d["vs"] = Math.Round(last.Vs); d["hdg"] = Math.Round(last.Hdg);
                    d["ground"] = last.Ground;
                }
            }
            return d;
        }

        // ------------------------------------------------------------------ files

        static void WriteFile(string path, object data)
        {
            lock (Disk)
            {
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(path));
                    string tmp = path + ".tmp";
                    File.WriteAllText(tmp, Json.Serialize(data), new UTF8Encoding(false));
                    if (File.Exists(path)) File.Delete(path);
                    File.Move(tmp, path);
                }
                catch (Exception ex) { Log.Write("FlightLine save: " + ex.Message); }
            }
        }

        static void Save(Dictionary<string, object> rec)
        {
            try
            {
                // The arrival airport, if the runway check didn't find one: the airport nearest to where you stopped.
                if (!rec.ContainsKey("to") && rec.ContainsKey("takeoff"))
                {
                    var p = ((List<double[]>)rec["pts"]);
                    if (p.Count > 0) { string a = Runways.Nearest(p[p.Count - 1][P_LAT], p[p.Count - 1][P_LON], 6000); if (a != null) rec["to"] = a; }
                }
                if (!rec.ContainsKey("from"))
                {
                    string a = Runways.Nearest(Convert.ToDouble(rec["startLat"]), Convert.ToDouble(rec["startLon"]), 6000);
                    if (a != null) rec["from"] = a;
                }
                string id = Convert.ToString(rec["id"]);
                WriteFile(Path.Combine(FlightsDir, id + ".json"), rec);
                lock (Disk)
                {
                    var index = ReadIndex();
                    index.RemoveAll(e => Convert.ToString(e["id"]) == id);
                    index.Insert(0, Summary(rec));
                    index.Sort((a, b) => Convert.ToInt64(b["start"]).CompareTo(Convert.ToInt64(a["start"])));
                    WriteIndexLocked(index);
                    try { File.Delete(CurrentPath); } catch { }
                }
                Log.Write("FlightLine: saved " + (rec.ContainsKey("from") ? rec["from"] : "?") + " - " + (rec.ContainsKey("to") ? rec["to"] : "?") +
                    ", " + rec["blockMin"] + " min" + (Convert.ToBoolean(rec["complete"]) ? "" : " (unfinished)"));
            }
            catch (Exception ex) { Log.Write("FlightLine save: " + ex.Message); }
        }

        static Dictionary<string, object> Summary(Dictionary<string, object> rec)
        {
            var s = new Dictionary<string, object>();
            foreach (var k in new[] { "id", "start", "end", "takeoff", "landing", "aircraft", "from", "to", "planFrom", "planTo", "flightNo",
                                      "complete", "blockMin", "airMin", "distNm", "maxAlt", "fuelUsedKg", "imported" })
            {
                object o;
                if (rec.TryGetValue(k, out o) && o != null) s[k] = o;
            }
            object li;
            if (rec.TryGetValue("landingInfo", out li) && li is Dictionary<string, object>)
            {
                var l = (Dictionary<string, object>)li;
                foreach (var k in new[] { "fpm", "g", "grade", "rating", "rwy", "distM", "clM" })
                {
                    object o;
                    if (l.TryGetValue(k, out o) && o != null) s[k == "distM" ? "tdM" : k] = o;
                }
            }
            return s;
        }

        static List<Dictionary<string, object>> ReadIndex()
        {
            try
            {
                if (!File.Exists(IndexPath)) return new List<Dictionary<string, object>>();
                return Json.Deserialize<List<Dictionary<string, object>>>(File.ReadAllText(IndexPath, Encoding.UTF8)) ?? new List<Dictionary<string, object>>();
            }
            catch (Exception ex) { Log.Write("FlightLine logbook: " + ex.Message); return new List<Dictionary<string, object>>(); }
        }

        static void WriteIndexLocked(List<Dictionary<string, object>> index)
        {
            Directory.CreateDirectory(Folder);
            string tmp = IndexPath + ".tmp";
            File.WriteAllText(tmp, Json.Serialize(index), new UTF8Encoding(false));
            if (File.Exists(IndexPath)) File.Delete(IndexPath);
            File.Move(tmp, IndexPath);
        }

        // ------------------------------------------------------------------ for the FlightLine window

        public static List<Dictionary<string, object>> Logbook()
        {
            lock (Disk) return ReadIndex();
        }

        public static string FlightJson(string id)
        {
            if (!SafeId(id)) return null;
            lock (Disk)
            {
                string f = Path.Combine(FlightsDir, id + ".json");
                return File.Exists(f) ? File.ReadAllText(f, Encoding.UTF8) : null;
            }
        }

        public static bool Delete(string id)
        {
            if (!SafeId(id)) return false;
            lock (Disk)
            {
                try
                {
                    var index = ReadIndex();
                    int n = index.RemoveAll(e => Convert.ToString(e["id"]) == id);
                    WriteIndexLocked(index);
                    string f = Path.Combine(FlightsDir, id + ".json");
                    if (File.Exists(f)) File.Delete(f);
                    Log.Write("FlightLine: deleted flight " + id);
                    return n > 0;
                }
                catch (Exception ex) { Log.Write("FlightLine delete: " + ex.Message); return false; }
            }
        }

        static bool SafeId(string id)
        {
            if (string.IsNullOrEmpty(id) || id.Length > 20) return false;
            foreach (char c in id) if (c < '0' || c > '9') return false;
            return true;
        }

        // ------------------------------------------------------------------ start-up

        /// <summary>
        /// On start: a flight that was being recorded when the service stopped is saved as unfinished, and the flights
        /// in the old flight log (from before FlightLine) are added to the logbook once.
        /// </summary>
        public static void Start()
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    if (File.Exists(CurrentPath))
                    {
                        var rec = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(CurrentPath, Encoding.UTF8));
                        if (rec != null && rec.ContainsKey("id"))
                        {
                            rec["complete"] = false;
                            rec["pts"] = ToPoints(rec["pts"]);
                            Save(rec);
                        }
                        else File.Delete(CurrentPath);
                    }
                    ImportOld();
                }
                catch (Exception ex) { Log.Write("FlightLine start: " + ex.Message); }
            });
        }

        static List<double[]> ToPoints(object o)
        {
            var list = new List<double[]>();
            var arr = o as System.Collections.ArrayList;
            if (arr == null) return list;
            foreach (var row in arr)
            {
                var r = row as System.Collections.ArrayList;
                if (r == null) continue;
                var p = new double[r.Count];
                for (int i = 0; i < r.Count; i++) p[i] = Convert.ToDouble(r[i]);
                list.Add(p);
            }
            return list;
        }

        static void ImportOld()
        {
            string mark = Path.Combine(Folder, "imported-old-log");
            if (File.Exists(mark)) return;
            int n = 0;
            foreach (var o in Sim.ReadLog())
            {
                var e = o as Dictionary<string, object>;
                if (e == null || !e.ContainsKey("blockOut")) continue;
                try
                {
                    long start = Convert.ToInt64(e["blockOut"]);
                    if (start <= 0 || File.Exists(Path.Combine(FlightsDir, start + ".json"))) continue;
                    var rec = new Dictionary<string, object>();
                    rec["v"] = 1;
                    rec["id"] = start.ToString();
                    rec["start"] = start;
                    rec["imported"] = true;
                    rec["complete"] = true;
                    object x;
                    if (e.TryGetValue("blockIn", out x)) rec["end"] = x;
                    if (e.TryGetValue("takeoff", out x) && Convert.ToInt64(x) > 0) rec["takeoff"] = x;
                    if (e.TryGetValue("landing", out x) && Convert.ToInt64(x) > 0) rec["landing"] = x;
                    if (e.TryGetValue("aircraft", out x)) rec["aircraft"] = x;
                    if (e.TryGetValue("from", out x) && Convert.ToString(x) != "") { rec["from"] = x; rec["planFrom"] = x; }
                    if (e.TryGetValue("to", out x) && Convert.ToString(x) != "") { rec["to"] = x; rec["planTo"] = x; }
                    if (e.TryGetValue("flight", out x)) rec["flightNo"] = x;
                    if (e.TryGetValue("blockMin", out x)) rec["blockMin"] = x;
                    if (e.TryGetValue("airMin", out x)) rec["airMin"] = x;
                    if (e.TryGetValue("fuelKg", out x)) rec["fuelUsedKg"] = x;
                    var li = new Dictionary<string, object>();
                    foreach (var k in new[] { "fpm", "g", "grade", "rating", "rwy", "clM" }) if (e.TryGetValue(k, out x)) li[k] = x;
                    if (e.TryGetValue("tdM", out x)) li["distM"] = x;
                    if (li.Count > 0) rec["landingInfo"] = li;
                    // The old track: [seconds, lat, lon, alt, ground speed, vertical speed] every 10 s.
                    var p = new List<double[]>();
                    double dist = 0, maxA = 0;
                    if (e.TryGetValue("track", out x))
                    {
                        var old = Sim.TrackData(Convert.ToString(x));
                        if (old != null)
                            foreach (var q in old)
                            {
                                if (q.Length < 6) continue;
                                if (p.Count > 0) dist += Nm(p[p.Count - 1][P_LAT], p[p.Count - 1][P_LON], q[1], q[2]);
                                maxA = Math.Max(maxA, q[3]);
                                p.Add(new[] { q[0], q[1], q[2], q[3], -1, -1, q[4], q[5], -1 });
                            }
                    }
                    rec["pts"] = p;
                    rec["events"] = new List<object[]>();
                    rec["distNm"] = Math.Round(dist);
                    rec["maxAlt"] = Math.Round(maxA);
                    Save(rec);
                    n++;
                }
                catch (Exception ex) { Log.Write("FlightLine import: " + ex.Message); }
            }
            try { Directory.CreateDirectory(Folder); File.WriteAllText(mark, DateTime.Now.ToString("s")); } catch { }
            if (n > 0) Log.Write("FlightLine: added " + n + " flights from the old flight log");
        }

        // ------------------------------------------------------------------ helpers

        public static double Nm(double la1, double lo1, double la2, double lo2)
        {
            double r = Math.PI / 180;
            double dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
            double a = Math.Sin(dLa / 2) * Math.Sin(dLa / 2) + Math.Cos(la1 * r) * Math.Cos(la2 * r) * Math.Sin(dLo / 2) * Math.Sin(dLo / 2);
            return 3440.065 * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
        }
    }

    /// <summary>The FlightLine window: its files (the flightline folder next to the service) and opening it.</summary>
    static class FlightLineApp
    {
        public static string Dir { get { return Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "flightline"); } }

        public static bool File(string rel, out byte[] data, out string type)
        {
            data = null; type = null;
            try
            {
                rel = Uri.UnescapeDataString(rel ?? "");
                if (rel.Length == 0 || rel.Length > 200 || rel.Contains("..") || rel.Contains(":") || rel.Contains("\\") || rel.StartsWith("/")) return false;
                if (!Hub.Types.TryGetValue(Path.GetExtension(rel), out type)) return false;
                string root = Path.GetFullPath(Dir);
                string full = Path.GetFullPath(Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar)));
                if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !System.IO.File.Exists(full)) return false;
                data = System.IO.File.ReadAllBytes(full);
                return true;
            }
            catch (Exception ex) { Log.Write("FlightLine file " + rel + ": " + ex.Message); return false; }
        }

        /// <summary>
        /// Opens FlightLine in its own window: Microsoft Edge's app mode (no address bar or tabs), which every Windows 10/11 PC has.
        /// Without Edge, the default browser opens it.
        /// </summary>
        public static bool Open()
        {
            string url = "http://127.0.0.1:" + Settings.Current.Port + "/flightline/";
            try
            {
                string edge = EdgePath();
                if (edge != null)
                {
                    // A proper window size, in the middle of the main screen (Edge remembers it after you change it yourself).
                    var wa = Screen.PrimaryScreen.WorkingArea;
                    int w = Math.Min(1480, wa.Width - 80), h = Math.Min(940, wa.Height - 60);
                    int x = wa.Left + (wa.Width - w) / 2, y = wa.Top + (wa.Height - h) / 2;
                    Process.Start(new ProcessStartInfo(edge, "--app=" + url + " --window-size=" + w + "," + h + " --window-position=" + x + "," + y) { UseShellExecute = false });
                    return true;
                }
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                return true;
            }
            catch (Exception ex) { Log.Write("FlightLine open: " + ex.Message); return false; }
        }

        static string EdgePath()
        {
            foreach (var hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                try
                {
                    using (var k = hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"))
                    {
                        string p = k == null ? null : k.GetValue("") as string;
                        if (!string.IsNullOrEmpty(p) && System.IO.File.Exists(p)) return p;
                    }
                }
                catch { }
            }
            foreach (var env in new[] { "ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA" })
            {
                string root = Environment.GetEnvironmentVariable(env);
                if (string.IsNullOrEmpty(root)) continue;
                string p = Path.Combine(root, "Microsoft", "Edge", "Application", "msedge.exe");
                if (System.IO.File.Exists(p)) return p;
            }
            return null;
        }
    }
}
