// FlightLine's flight finder: real airline routes.
//
// The routes come from Virtual Radar Server's standing data (github.com/vradarserver/standing-data, CC0): flight numbers
// and the airports they fly between, sent in by people who track real flights. It's updated every day; Control Hub
// downloads it once a month in the background and keeps a small index of it:
// %APPDATA%\ControlHub\FlightLine\routes.idx  (A = airport, L = airline, R = route).
// C# 5 / .NET Framework 4.x.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Text;
using System.Threading;

namespace ControlPanelHelper
{
    static class RouteData
    {
        const string ZipUrl = "https://codeload.github.com/vradarserver/standing-data/zip/refs/heads/main";
        static readonly string IndexPath = Path.Combine(FlightRec.Folder, "routes.idx");
        static readonly object Gate = new object();
        static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        public class Airport { public string Icao, Name, City, Country; public double Lat, Lon; }
        public class Route { public string To; public string[] Airlines; public string[] Flights; }

        static Dictionary<string, Airport> airports;
        static Dictionary<string, string> airlines;
        static Dictionary<string, List<Route>> routes;
        static DateTime loadedFrom = DateTime.MinValue;
        static volatile bool building;
        static string lastError;
        // Let go of the index 10 minutes after the last search (it's some MB, and only needed while you look for a flight).
        static readonly Timer drop = new Timer(delegate { lock (Gate) { airports = null; airlines = null; routes = null; } }, null, Timeout.Infinite, Timeout.Infinite);

        public static bool Building { get { return building; } }
        public static string LastError { get { return lastError; } }
        public static bool HaveIndex { get { return File.Exists(IndexPath); } }
        public static DateTime IndexDate { get { return File.Exists(IndexPath) ? File.GetLastWriteTime(IndexPath) : DateTime.MinValue; } }

        /// <summary>On start (and when the finder is used): a fresh copy once a month, in the background.</summary>
        public static void Refresh(bool evenIfFresh)
        {
            if (building) return;
            if (!evenIfFresh && File.Exists(IndexPath) && (DateTime.UtcNow - File.GetLastWriteTimeUtc(IndexPath)).TotalDays < 30) return;
            building = true;
            var t = new Thread(Build) { IsBackground = true, Name = "routes", Priority = ThreadPriority.BelowNormal };
            t.Start();
        }

        static void Build()
        {
            string zip = Path.Combine(Path.GetTempPath(), "ControlHubRoutes.zip");
            try
            {
                Log.Write("Routes: downloading the real airline routes");
                ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072;
                var req = (HttpWebRequest)WebRequest.Create(ZipUrl);
                req.Timeout = 60000;
                req.ReadWriteTimeout = 60000;
                req.UserAgent = "ControlHub/" + Program.Version;
                using (var res = req.GetResponse())
                using (var s = res.GetResponseStream())
                using (var f = File.Create(zip)) s.CopyTo(f);

                var apts = new Dictionary<string, Airport>(StringComparer.OrdinalIgnoreCase);
                var lines = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                // from → to → (airlines, a few flight numbers)
                var pairs = new Dictionary<string, Dictionary<string, KeyValuePair<List<string>, List<string>>>>(StringComparer.OrdinalIgnoreCase);
                int routeRows = 0;
                using (var z = ZipFile.OpenRead(zip))
                {
                    foreach (var e in z.Entries)
                    {
                        string n = e.FullName.Replace('\\', '/');
                        if (!n.EndsWith(".csv", StringComparison.OrdinalIgnoreCase)) continue;
                        bool isRoute = n.Contains("/routes/schema-01/"), isAirport = n.Contains("/airports/schema-01/"), isAirline = n.EndsWith("/airlines/schema-01/airlines.csv");
                        if (!isRoute && !isAirport && !isAirline) continue;
                        using (var r = new StreamReader(e.Open(), Encoding.UTF8))
                        {
                            string header = r.ReadLine();
                            if (header == null) continue;
                            string line;
                            while ((line = r.ReadLine()) != null)
                            {
                                var f = Freqs.SplitCsv(line);
                                if (isRoute)
                                {
                                    // Callsign,Code,Number,AirlineCode,AirportCodes
                                    if (f.Count < 5) continue;
                                    var stops = f[4].Split('-');
                                    for (int i = 0; i + 1 < stops.Length; i++)
                                    {
                                        string a = stops[i].Trim().ToUpperInvariant(), b = stops[i + 1].Trim().ToUpperInvariant();
                                        if (a.Length != 4 || b.Length != 4 || a == b) continue;
                                        Dictionary<string, KeyValuePair<List<string>, List<string>>> to;
                                        if (!pairs.TryGetValue(a, out to)) pairs[a] = to = new Dictionary<string, KeyValuePair<List<string>, List<string>>>(StringComparer.OrdinalIgnoreCase);
                                        KeyValuePair<List<string>, List<string>> info;
                                        if (!to.TryGetValue(b, out info)) to[b] = info = new KeyValuePair<List<string>, List<string>>(new List<string>(), new List<string>());
                                        string al = f[3].Trim().ToUpperInvariant();
                                        if (al.Length > 0 && !info.Key.Contains(al) && info.Key.Count < 8) info.Key.Add(al);
                                        if (info.Value.Count < 4 && f[0].Length > 0) info.Value.Add(f[0].Trim());
                                    }
                                    routeRows++;
                                }
                                else if (isAirport)
                                {
                                    // Code,Name,ICAO,IATA,Location,CountryISO2,Latitude,Longitude,AltitudeFeet
                                    if (f.Count < 8 || f[2].Length != 4) continue;
                                    double la, lo;
                                    if (!double.TryParse(f[6], NumberStyles.Float, Inv, out la) || !double.TryParse(f[7], NumberStyles.Float, Inv, out lo)) continue;
                                    apts[f[2].ToUpperInvariant()] = new Airport { Icao = f[2].ToUpperInvariant(), Name = f[1], City = f[4], Country = f[5], Lat = la, Lon = lo };
                                }
                                else
                                {
                                    // Code,Name,ICAO,IATA,...
                                    if (f.Count < 3 || f[2].Length != 3) continue;
                                    lines[f[2].ToUpperInvariant()] = f[1];
                                }
                            }
                        }
                    }
                }
                if (routeRows < 10000) throw new Exception("the route list looks incomplete (" + routeRows + " routes)");

                // The index: only airports that have routes.
                var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var kv in pairs) { used.Add(kv.Key); foreach (var t in kv.Value.Keys) used.Add(t); }
                var sb = new StringBuilder(4 * 1024 * 1024);
                sb.Append("# Real airline routes from Virtual Radar Server's standing data (CC0), ").Append(DateTime.UtcNow.ToString("yyyy-MM-dd", Inv)).Append('\n');
                foreach (var a in apts.Values)
                {
                    if (!used.Contains(a.Icao)) continue;
                    sb.Append("A\t").Append(a.Icao).Append('\t').Append(Clean(a.Name)).Append('\t').Append(Clean(a.City)).Append('\t').Append(Clean(a.Country))
                      .Append('\t').Append(a.Lat.ToString("0.#####", Inv)).Append('\t').Append(a.Lon.ToString("0.#####", Inv)).Append('\n');
                }
                foreach (var l in lines) sb.Append("L\t").Append(l.Key).Append('\t').Append(Clean(l.Value)).Append('\n');
                int n2 = 0;
                foreach (var kv in pairs)
                    foreach (var t in kv.Value)
                    {
                        if (!apts.ContainsKey(kv.Key) || !apts.ContainsKey(t.Key)) continue;
                        sb.Append("R\t").Append(kv.Key).Append('\t').Append(t.Key).Append('\t').Append(string.Join("|", t.Value.Key.ToArray()))
                          .Append('\t').Append(string.Join("|", t.Value.Value.ToArray())).Append('\n');
                        n2++;
                    }
                Directory.CreateDirectory(FlightRec.Folder);
                string tmp = IndexPath + ".tmp";
                File.WriteAllText(tmp, sb.ToString(), new UTF8Encoding(false));
                if (File.Exists(IndexPath)) File.Delete(IndexPath);
                File.Move(tmp, IndexPath);
                lock (Gate) { routes = null; airports = null; airlines = null; }
                lastError = null;
                Log.Write("Routes: " + n2 + " real routes between " + used.Count + " airports");
            }
            catch (Exception ex)
            {
                lastError = ex.Message;
                Log.Write("Routes: couldn't get the route list: " + ex.Message);
            }
            finally
            {
                try { File.Delete(zip); } catch { }
                building = false;
            }
        }

        static string Clean(string s) { return (s ?? "").Replace('\t', ' ').Replace('\n', ' ').Replace('\r', ' ').Trim(); }

        /// <summary>Loads the index (if it isn't already). False if there isn't one yet.</summary>
        static bool Load()
        {
            if (routes != null && File.GetLastWriteTimeUtc(IndexPath) <= loadedFrom) return true;
            if (!File.Exists(IndexPath)) return false;
            var a = new Dictionary<string, Airport>(StringComparer.OrdinalIgnoreCase);
            var l = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var r = new Dictionary<string, List<Route>>(StringComparer.OrdinalIgnoreCase);
            foreach (var line in File.ReadLines(IndexPath, Encoding.UTF8))
            {
                if (line.Length < 3 || line[1] != '\t') continue;
                var f = line.Split('\t');
                if (f[0] == "A" && f.Length >= 7)
                {
                    double la, lo;
                    if (!double.TryParse(f[5], NumberStyles.Float, Inv, out la) || !double.TryParse(f[6], NumberStyles.Float, Inv, out lo)) continue;
                    a[f[1]] = new Airport { Icao = f[1], Name = f[2], City = f[3], Country = f[4], Lat = la, Lon = lo };
                }
                else if (f[0] == "L" && f.Length >= 3) l[f[1]] = f[2];
                else if (f[0] == "R" && f.Length >= 5)
                {
                    List<Route> list;
                    if (!r.TryGetValue(f[1], out list)) r[f[1]] = list = new List<Route>();
                    list.Add(new Route { To = f[2], Airlines = f[3].Length > 0 ? f[3].Split('|') : new string[0], Flights = f[4].Length > 0 ? f[4].Split('|') : new string[0] });
                }
            }
            airports = a; airlines = l; routes = r;
            loadedFrom = File.GetLastWriteTimeUtc(IndexPath);
            return true;
        }

        // ------------------------------------------------------------------ searching

        /// <summary>
        /// Real routes from an airport that fit a flight time. kt = cruise speed, overhead = minutes for taxi, climb and descent,
        /// minRwyFt = the shortest runway the plane needs. Airports you've been to are marked (and left out with newOnly).
        /// </summary>
        public static Dictionary<string, object> Find(string from, int minMin, int maxMin, int kt, int overhead, int minRwyFt, bool newOnly, bool surprise, int count)
        {
            var res = new Dictionary<string, object>();
            res["ok"] = true;
            Refresh(false);
            Dictionary<string, Airport> apts;
            Dictionary<string, string> lines;
            Dictionary<string, List<Route>> rts;
            lock (Gate)
            {
                if (!Load())
                {
                    res["ok"] = false;
                    res["preparing"] = building;
                    res["error"] = building ? "Getting the real airline routes for the first time (a minute or two)…" : "The route list isn't there yet" + (lastError != null ? ": " + lastError : ".");
                    return res;
                }
                drop.Change(600000, Timeout.Infinite);
                apts = airports; lines = airlines; rts = routes;
            }
            from = (from ?? "").Trim().ToUpperInvariant();
            Airport origin;
            if (!apts.TryGetValue(from, out origin))
            {
                res["ok"] = false;
                res["error"] = from.Length == 0 ? "Choose where to fly from." : "No real airline routes from " + from + ".";
                // Airports nearby that do have routes.
                var pos = from.Length > 0 ? Runways.Position(from) : null;
                if (pos != null) res["nearby"] = Nearby(apts, rts, pos[0], pos[1], 6);
                return res;
            }
            res["from"] = AirportInfo(origin, null);
            kt = Math.Max(60, Math.Min(600, kt));
            overhead = Math.Max(0, Math.Min(60, overhead));
            double minNm = Math.Max(0, (minMin - overhead) * kt / 60.0), maxNm = Math.Max(minNm + 20, (maxMin - overhead) * kt / 60.0);
            var visited = Visited();
            var lengths = Runways.MaxLengths();
            var hits = new List<Dictionary<string, object>>();
            List<Route> list;
            if (rts.TryGetValue(from, out list))
                foreach (var r in list)
                {
                    Airport dest;
                    if (!apts.TryGetValue(r.To, out dest)) continue;
                    double nm = FlightRec.Nm(origin.Lat, origin.Lon, dest.Lat, dest.Lon);
                    if (nm < minNm || nm > maxNm) continue;
                    double rwy;
                    bool knownRwy = lengths != null && lengths.TryGetValue(dest.Icao, out rwy);
                    if (!knownRwy) rwy = 0;
                    if (knownRwy && rwy < minRwyFt) continue;
                    bool been = visited.Contains(dest.Icao);
                    if (newOnly && been) continue;
                    var d = AirportInfo(dest, lines);
                    d["distNm"] = Math.Round(nm);
                    d["estMin"] = (int)Math.Round(overhead + nm / kt * 60);
                    d["rwyFt"] = knownRwy ? Math.Round(rwy) : 0;
                    d["visited"] = been;
                    var al = new List<Dictionary<string, object>>();
                    foreach (var code in r.Airlines)
                    {
                        var x = new Dictionary<string, object>();
                        x["code"] = code;
                        string name;
                        x["name"] = lines.TryGetValue(code, out name) ? name : code;
                        al.Add(x);
                    }
                    d["airlines"] = al;
                    d["flights"] = r.Flights;
                    hits.Add(d);
                }
            res["total"] = hits.Count;
            // A different mix each time, new airports first.
            var rnd = new Random();
            var keyed = new List<KeyValuePair<double, Dictionary<string, object>>>();
            foreach (var h in hits) keyed.Add(new KeyValuePair<double, Dictionary<string, object>>(rnd.NextDouble() + ((bool)h["visited"] ? 1 : 0), h));
            keyed.Sort((p1, p2) => p1.Key.CompareTo(p2.Key));
            var outList = new List<Dictionary<string, object>>();
            int max = surprise ? 1 : Math.Max(1, Math.Min(40, count));
            foreach (var k in keyed) { if (outList.Count >= max) break; outList.Add(k.Value); }
            res["flights"] = outList;
            res["routesDate"] = IndexDate.ToString("yyyy-MM-dd", Inv);
            return res;
        }

        static Dictionary<string, object> AirportInfo(Airport a, Dictionary<string, string> lines)
        {
            var d = new Dictionary<string, object>();
            d["icao"] = a.Icao; d["name"] = a.Name; d["city"] = a.City; d["country"] = a.Country;
            d["lat"] = a.Lat; d["lon"] = a.Lon;
            return d;
        }

        static List<Dictionary<string, object>> Nearby(Dictionary<string, Airport> apts, Dictionary<string, List<Route>> rts, double la, double lo, int n)
        {
            var best = new List<KeyValuePair<double, Airport>>();
            foreach (var kv in rts)
            {
                Airport a;
                if (!apts.TryGetValue(kv.Key, out a)) continue;
                double nm = FlightRec.Nm(la, lo, a.Lat, a.Lon);
                if (nm < 150) best.Add(new KeyValuePair<double, Airport>(nm, a));
            }
            best.Sort((p1, p2) => p1.Key.CompareTo(p2.Key));
            var outList = new List<Dictionary<string, object>>();
            foreach (var b in best) { if (outList.Count >= n) break; var d = AirportInfo(b.Value, null); d["distNm"] = Math.Round(b.Key); outList.Add(d); }
            return outList;
        }

        /// <summary>Airports in the logbook.</summary>
        static HashSet<string> Visited()
        {
            var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var f in FlightRec.Logbook())
                foreach (var k in new[] { "from", "to" })
                {
                    object v;
                    if (f.TryGetValue(k, out v) && v != null) set.Add(Convert.ToString(v));
                }
            return set;
        }

        /// <summary>Where to start: "here" (where you are in MSFS), "last" (where the last flight ended), or an airport code.</summary>
        public static string ResolveFrom(string from)
        {
            if (string.Equals(from, "here", StringComparison.OrdinalIgnoreCase))
            {
                var s = Sim.State();
                object la, lo;
                if (s.TryGetValue("lat", out la) && s.TryGetValue("lon", out lo))
                    return Runways.Nearest(Convert.ToDouble(la), Convert.ToDouble(lo), 8000) ?? "";
                return "";
            }
            if (string.Equals(from, "last", StringComparison.OrdinalIgnoreCase))
            {
                foreach (var f in FlightRec.Logbook())
                {
                    object v;
                    if (f.TryGetValue("to", out v) && v != null && Convert.ToString(v).Length == 4) return Convert.ToString(v);
                }
                return "";
            }
            return from ?? "";
        }
    }
}
