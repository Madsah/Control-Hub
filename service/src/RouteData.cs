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
        public class Search
        {
            public string From = "";
            public int MinMin = 60, MaxMin = 120, Kt = 450, Overhead = 25, MinRwyFt = 0, Count = 12;
            public bool NewOnly, Surprise;
            public HashSet<string> Regions;        // null or empty = anywhere
            public string Scenery = "any";        // "any", "prefer" or "only" (destination has your scenery)
        }

        // ------------------------------------------------------------------ regions

        static readonly HashSet<string> EU = new HashSet<string>("AL AD AM AT AZ BY BE BA BG HR CY CZ DK EE FO FI FR GE DE GI GR GL HU IS IE IT XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH TR UA GB VA IM JE GG AX SJ".Split(' '));
        static readonly HashSet<string> ME = new HashSet<string>("AE SA QA BH KW OM JO IL PS LB IQ IR SY YE".Split(' '));
        static readonly HashSet<string> NAF = new HashSet<string>("MA DZ TN LY EG EH".Split(' '));

        /// <summary>EU (Europe), ME (Middle East), NAF (North Africa), AF (rest of Africa), AS (Asia), NA (North and Central America), SA (South America), OC (Oceania).</summary>
        public static string Region(string country, double lat, double lon)
        {
            string c = (country ?? "").ToUpperInvariant();
            if (EU.Contains(c)) return "EU";
            if (ME.Contains(c)) return "ME";
            if (NAF.Contains(c)) return "NAF";
            if (lon <= -30) return lat >= 8 ? "NA" : "SA";
            if (lon >= 110 && lat <= -10 || lon >= 160) return "OC";
            if (lon >= 25 && lat >= -12) return "AS";
            return "AF";
        }

        static bool InRegions(Airport a, HashSet<string> regions)
        {
            return regions == null || regions.Count == 0 || regions.Contains(Region(a.Country, a.Lat, a.Lon));
        }

        // ------------------------------------------------------------------ searching

        /// <summary>
        /// Real routes that fit a flight time, from an airport (or from anywhere in your regions). Destinations are kept to your regions,
        /// need a long enough runway, and are marked with your scenery and scenery on sale.
        /// </summary>
        public static Dictionary<string, object> Find(Search q)
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
            int kt = Math.Max(60, Math.Min(600, q.Kt)), overhead = Math.Max(0, Math.Min(60, q.Overhead));
            double minNm = Math.Max(0, (q.MinMin - overhead) * kt / 60.0), maxNm = Math.Max(minNm + 20, (q.MaxMin - overhead) * kt / 60.0);
            var visited = Visited();
            var lengths = Runways.MaxLengths();
            var mine = AddonScenery.InstalledAirports();
            var deals = DealsByAirport();
            var rnd = new Random();

            string from = (q.From ?? "").Trim().ToUpperInvariant();
            Airport origin = null;
            List<Dictionary<string, object>> hits = null;
            if (from == "ANY")
            {
                // A random airport in your regions with routes that fit (tries up to 40 airports).
                var pool = new List<string>();
                foreach (var kv in rts)
                {
                    Airport a;
                    if (kv.Value.Count >= 4 && apts.TryGetValue(kv.Key, out a) && InRegions(a, q.Regions) && Long(lengths, a.Icao, q.MinRwyFt)) pool.Add(kv.Key);
                }
                for (int tries = 0; tries < 40 && pool.Count > 0; tries++)
                {
                    int i = rnd.Next(pool.Count);
                    var a = apts[pool[i]];
                    pool.RemoveAt(i);
                    var h = Hits(a, rts, apts, lines, q, minNm, maxNm, kt, overhead, visited, lengths, mine, deals);
                    if (h.Count > 0) { origin = a; hits = h; break; }
                }
                if (origin == null)
                {
                    res["ok"] = false;
                    res["error"] = "No airport in your regions has real routes that fit. Try another flight time or more regions.";
                    return res;
                }
            }
            else
            {
                if (!apts.TryGetValue(from, out origin))
                {
                    res["ok"] = false;
                    res["error"] = from.Length == 0 ? "Choose where to fly from." : "No real airline routes from " + from + ".";
                    // Airports nearby that do have routes.
                    var pos = from.Length > 0 ? Runways.Position(from) : null;
                    if (pos != null) res["nearby"] = Nearby(apts, rts, pos[0], pos[1], 6);
                    return res;
                }
                hits = Hits(origin, rts, apts, lines, q, minNm, maxNm, kt, overhead, visited, lengths, mine, deals);
            }
            var fromInfo = AirportInfo(origin, null);
            AddScenery(fromInfo, origin.Icao, mine, deals);
            res["from"] = fromInfo;
            res["total"] = hits.Count;
            // A different mix each time: your scenery first if you like, then airports you haven't been to.
            var keyed = new List<KeyValuePair<double, Dictionary<string, object>>>();
            foreach (var h in hits)
            {
                double k = rnd.NextDouble() + ((bool)h["visited"] ? 1 : 0);
                if (q.Scenery == "prefer" && h.ContainsKey("scenery")) k -= 2;
                keyed.Add(new KeyValuePair<double, Dictionary<string, object>>(k, h));
            }
            keyed.Sort((p1, p2) => p1.Key.CompareTo(p2.Key));
            var outList = new List<Dictionary<string, object>>();
            int max = q.Surprise ? 1 : Math.Max(1, Math.Min(40, q.Count));
            foreach (var k in keyed) { if (outList.Count >= max) break; outList.Add(k.Value); }
            res["flights"] = outList;
            res["routesDate"] = IndexDate.ToString("yyyy-MM-dd", Inv);
            return res;
        }

        static bool Long(Dictionary<string, double> lengths, string icao, int minRwyFt)
        {
            double rwy;
            return lengths == null || !lengths.TryGetValue(icao, out rwy) || rwy >= minRwyFt;
        }

        static List<Dictionary<string, object>> Hits(Airport origin, Dictionary<string, List<Route>> rts, Dictionary<string, Airport> apts, Dictionary<string, string> lines,
            Search q, double minNm, double maxNm, int kt, int overhead, HashSet<string> visited, Dictionary<string, double> lengths,
            Dictionary<string, AddonScenery.Installed> mine, Dictionary<string, List<AddonScenery.Deal>> deals)
        {
            var hits = new List<Dictionary<string, object>>();
            List<Route> list;
            if (!rts.TryGetValue(origin.Icao, out list)) return hits;
            foreach (var r in list)
            {
                Airport dest;
                if (!apts.TryGetValue(r.To, out dest)) continue;
                if (!InRegions(dest, q.Regions)) continue;
                double nm = FlightRec.Nm(origin.Lat, origin.Lon, dest.Lat, dest.Lon);
                if (nm < minNm || nm > maxNm) continue;
                double rwy;
                bool knownRwy = lengths != null && lengths.TryGetValue(dest.Icao, out rwy);
                if (!knownRwy) rwy = 0;
                if (knownRwy && rwy < q.MinRwyFt) continue;
                bool been = visited.Contains(dest.Icao);
                if (q.NewOnly && been) continue;
                if (q.Scenery == "only" && !mine.ContainsKey(dest.Icao)) continue;
                var d = AirportInfo(dest, lines);
                d["distNm"] = Math.Round(nm);
                d["estMin"] = (int)Math.Round(overhead + nm / kt * 60);
                d["rwyFt"] = knownRwy ? Math.Round(rwy) : 0;
                d["visited"] = been;
                AddScenery(d, dest.Icao, mine, deals);
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
            return hits;
        }

        /// <summary>Your scenery for an airport, or else the best scenery deal for it (MSFS 2024 first, then the biggest discount).</summary>
        static void AddScenery(Dictionary<string, object> d, string icao, Dictionary<string, AddonScenery.Installed> mine, Dictionary<string, List<AddonScenery.Deal>> deals)
        {
            AddonScenery.Installed s;
            if (mine.TryGetValue(icao, out s))
            {
                var e = new Dictionary<string, object>();
                e["title"] = s.Title; e["creator"] = s.Creator;
                d["scenery"] = e;
                return;
            }
            List<AddonScenery.Deal> list;
            if (deals.TryGetValue(icao, out list) && list.Count > 0) d["deal"] = DealInfo(list[0]);
        }

        public static Dictionary<string, object> DealInfo(AddonScenery.Deal x)
        {
            var e = new Dictionary<string, object>();
            e["icao"] = x.Icao; e["store"] = x.Store; e["title"] = x.Title; e["url"] = x.Url; e["currency"] = x.Currency;
            e["price"] = x.Price; e["was"] = x.Was; e["msfs2024"] = x.Msfs2024;
            e["pct"] = x.Was > 0 ? Math.Round((1 - x.Price / x.Was) * 100) : 0;
            return e;
        }

        static Dictionary<string, List<AddonScenery.Deal>> DealsByAirport()
        {
            var map = new Dictionary<string, List<AddonScenery.Deal>>(StringComparer.OrdinalIgnoreCase);
            foreach (var x in AddonScenery.Deals())
            {
                List<AddonScenery.Deal> l;
                if (!map.TryGetValue(x.Icao, out l)) map[x.Icao] = l = new List<AddonScenery.Deal>();
                l.Add(x);
            }
            foreach (var l in map.Values)
                l.Sort((a, b) => a.Msfs2024 != b.Msfs2024 ? (a.Msfs2024 ? -1 : 1) : (b.Was - b.Price).CompareTo(a.Was - a.Price));
            return map;
        }

        /// <summary>Airport scenery on sale now, in your regions (airports you have scenery for left out), biggest discount first.</summary>
        public static List<Dictionary<string, object>> DealList(HashSet<string> regions, int max)
        {
            Dictionary<string, Airport> apts;
            lock (Gate)
            {
                Load();
                apts = airports ?? new Dictionary<string, Airport>();
                if (airports != null) drop.Change(600000, Timeout.Infinite);
            }
            var mine = AddonScenery.InstalledAirports();
            var visited = Visited();
            var best = new Dictionary<string, AddonScenery.Deal>(StringComparer.OrdinalIgnoreCase);
            foreach (var kv in DealsByAirport()) if (!mine.ContainsKey(kv.Key)) best[kv.Key] = kv.Value[0];
            var list = new List<Dictionary<string, object>>();
            foreach (var x in best.Values)
            {
                Airport a;
                bool knownApt = apts.TryGetValue(x.Icao, out a);
                if (regions != null && regions.Count > 0 && (!knownApt || !InRegions(a, regions))) continue;
                var e = DealInfo(x);
                if (knownApt) { e["name"] = a.Name; e["city"] = a.City; e["country"] = a.Country; }
                e["visited"] = visited.Contains(x.Icao);
                list.Add(e);
            }
            list.Sort((p1, p2) => Convert.ToDouble(p2["pct"]).CompareTo(Convert.ToDouble(p1["pct"])));
            if (list.Count > max) list.RemoveRange(max, list.Count - max);
            return list;
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
