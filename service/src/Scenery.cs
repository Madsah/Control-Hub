// FlightLine: which airports you have add-on scenery for, and airport scenery on sale at iniBuilds and Contrail.
//
// Scenery: MSFS 2024's Community folder (and downloaded Marketplace packages), found through UserCfg.opt.
// Each package's folder name and manifest.json title are searched for an airport code (e.g. "inibuilds-airport-omdb-dubai").
// Deals: the shops' public product lists (both are Shopify shops: /products.json), checked once a day.
// Products with an airport code in their name and a lower price than before ("compare at") count as on sale.
// C# 5 / .NET Framework 4.x.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

namespace ControlPanelHelper
{
    static class Scenery
    {
        static readonly string ScanPath = Path.Combine(FlightRec.Folder, "scenery.json");
        static readonly string DealsPath = Path.Combine(FlightRec.Folder, "deals.json");
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024 };
        static readonly object Gate = new object();
        static readonly Regex Token = new Regex(@"[A-Za-z0-9]+");
        // 4-letter words that are airport codes somewhere but nearly always mean something else in a product name.
        static readonly HashSet<string> NotAirports = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "MSFS", "FS20", "FS24", "XP12", "XP11", "P3D4", "P3D5", "PACK", "LOOP", "CITY", "MESH", "LIVE", "DEMO", "FREE", "LITE", "FULL", "MINI",
            "MODS", "BASE", "ADDON", "PLUS", "HDR1", "TEXT", "DATA", "BOOK", "AERO", "SOFT", "DESIGN", "WORK", "SHOP", "PARK", "LAKE", "PORT",
            "BAYS", "BEST", "EAST", "WEST", "SOUTH", "NORTH", "GOLD", "BLUE", "PINK", "GREY", "GRAY", "DARK", "WIDE", "LONG", "HIGH", "EDGE",
            "MAIN", "FLAP", "GEAR", "TAXI", "HOME", "TOUR", "HELI", "BUSH", "TRIP", "NAVY", "BETA", "RAIN", "SNOW", "WIND", "IFRS", "PACKS",
        };

        public class Installed { public string Icao, Title, Creator; }
        public class Deal { public string Icao, Store, Title, Url, Currency; public double Price, Was; public bool Msfs2024; }

        // ------------------------------------------------------------------ installed scenery

        static Dictionary<string, Installed> installed;
        static DateTime installedAt = DateTime.MinValue;
        static volatile bool scanning;
        static string scanNote;

        /// <summary>Airport code → your scenery for it. Rescanned when the folders changed (checked at most every 2 minutes).</summary>
        public static Dictionary<string, Installed> InstalledAirports()
        {
            lock (Gate)
            {
                if (installed == null) LoadScan();
                if ((DateTime.UtcNow - installedAt).TotalMinutes > 2) { installedAt = DateTime.UtcNow; ThreadPool.QueueUserWorkItem(delegate { Scan(false); }); }
                return installed ?? new Dictionary<string, Installed>();
            }
        }

        public static string ScanNote { get { return scanNote; } }

        static void LoadScan()
        {
            try
            {
                if (!File.Exists(ScanPath)) { installed = new Dictionary<string, Installed>(); return; }
                var d = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(ScanPath, Encoding.UTF8));
                var map = new Dictionary<string, Installed>(StringComparer.OrdinalIgnoreCase);
                object o;
                if (d.TryGetValue("airports", out o) && o is IEnumerable)
                    foreach (var x in (IEnumerable)o)
                    {
                        var e = x as Dictionary<string, object>;
                        if (e == null) continue;
                        var i = new Installed { Icao = S(e, "icao"), Title = S(e, "title"), Creator = S(e, "creator") };
                        if (i.Icao != null) map[i.Icao] = i;
                    }
                installed = map;
                scanNote = S(d, "note");
            }
            catch { installed = new Dictionary<string, Installed>(); }
        }

        /// <summary>Finds the package folders and reads them again if anything changed since last time (or force).</summary>
        public static void Scan(bool force)
        {
            if (scanning) return;
            scanning = true;
            try
            {
                var roots = PackageFolders();
                if (roots.Count == 0)
                {
                    scanNote = "MSFS 2024's Community folder wasn't found.";
                    return;
                }
                // Folder dates as a fingerprint: installing or removing something changes them.
                var sig = new StringBuilder();
                foreach (var r in roots) sig.Append(r).Append('|').Append(Directory.GetLastWriteTimeUtc(r).Ticks).Append(';');
                string old = null;
                try { if (File.Exists(ScanPath)) old = S(Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(ScanPath, Encoding.UTF8)), "sig"); } catch { }
                if (!force && old == sig.ToString()) return;

                var known = Runways.Idents();
                var found = new Dictionary<string, Installed>(StringComparer.OrdinalIgnoreCase);
                int packages = 0;
                foreach (var root in roots)
                {
                    string[] dirs;
                    try { dirs = Directory.GetDirectories(root); } catch { continue; }
                    foreach (var dir in dirs)
                    {
                        packages++;
                        string name = Path.GetFileName(dir), title = null, creator = null, type = null;
                        try
                        {
                            string mf = Path.Combine(dir, "manifest.json");
                            if (File.Exists(mf))
                            {
                                var m = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(mf, Encoding.UTF8));
                                title = S(m, "title"); creator = S(m, "creator"); type = S(m, "content_type");
                            }
                        }
                        catch { }
                        // Aircraft, liveries and tools aren't airports.
                        if (type != null && !type.Equals("SCENERY", StringComparison.OrdinalIgnoreCase) && !type.Equals("MISC", StringComparison.OrdinalIgnoreCase)) continue;
                        foreach (var code in Codes(name + " " + (title ?? ""), known))
                            if (!found.ContainsKey(code))
                                found[code] = new Installed { Icao = code, Title = title ?? name, Creator = creator ?? "" };
                    }
                }
                var list = new List<Dictionary<string, object>>();
                foreach (var i in found.Values)
                {
                    var e = new Dictionary<string, object>();
                    e["icao"] = i.Icao; e["title"] = i.Title; e["creator"] = i.Creator;
                    list.Add(e);
                }
                scanNote = found.Count + " airports with add-on scenery in " + packages + " packages";
                var outD = new Dictionary<string, object>();
                outD["sig"] = sig.ToString();
                outD["note"] = scanNote;
                outD["airports"] = list;
                Directory.CreateDirectory(FlightRec.Folder);
                File.WriteAllText(ScanPath, Json.Serialize(outD), new UTF8Encoding(false));
                lock (Gate) installed = found;
                Log.Write("Scenery: " + scanNote);
            }
            catch (Exception ex) { Log.Write("Scenery scan: " + ex.Message); }
            finally { scanning = false; }
        }

        /// <summary>Airport codes in a text: 4-letter words that are real airport codes.</summary>
        static List<string> Codes(string text, HashSet<string> known)
        {
            var list = new List<string>();
            foreach (Match m in Token.Matches(text ?? ""))
            {
                string w = m.Value.ToUpperInvariant();
                if (w.Length != 4 || !char.IsLetter(w[0]) || NotAirports.Contains(w)) continue;
                if (known != null && known.Count > 1000 && !known.Contains(w)) continue;
                if (!list.Contains(w)) list.Add(w);
            }
            return list;
        }

        /// <summary>The Community folder (and downloaded Marketplace packages) of MSFS 2024, from its UserCfg.opt.</summary>
        static List<string> PackageFolders()
        {
            var roots = new List<string>();
            var cfgs = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Microsoft Flight Simulator 2024", "UserCfg.opt"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Packages", "Microsoft.Limitless_8wekyb3d8bbwe", "LocalCache", "UserCfg.opt"),
            };
            foreach (var cfg in cfgs)
            {
                try
                {
                    if (!File.Exists(cfg)) continue;
                    foreach (var line in File.ReadAllLines(cfg))
                    {
                        var m = Regex.Match(line, "^\\s*InstalledPackagesPath\\s+\"(.+)\"\\s*$");
                        if (!m.Success) continue;
                        string root = m.Groups[1].Value;
                        Add(roots, Path.Combine(root, "Community"));
                        try
                        {
                            foreach (var off in Directory.GetDirectories(root, "Official*"))
                            {
                                Add(roots, Path.Combine(off, "OneStore"));
                                Add(roots, Path.Combine(off, "Steam"));
                            }
                        }
                        catch { }
                    }
                }
                catch (Exception ex) { Log.Write("Scenery: " + cfg + ": " + ex.Message); }
            }
            return roots;
        }

        static void Add(List<string> roots, string dir)
        {
            if (Directory.Exists(dir) && !roots.Exists(r => string.Equals(r, dir, StringComparison.OrdinalIgnoreCase))) roots.Add(dir);
        }

        // ------------------------------------------------------------------ deals

        static readonly string[][] Shops =
        {
            new[] { "iniBuilds", "https://inibuilds.com" },
            new[] { "Contrail", "https://contrail.shop" },
        };

        static List<Deal> deals;
        static DateTime dealsLoadedFrom = DateTime.MinValue;
        static volatile bool fetching;
        static string dealsNote;

        public static string DealsNote { get { return dealsNote; } }

        /// <summary>Airport scenery on sale now (checked once a day in the background).</summary>
        public static List<Deal> Deals()
        {
            lock (Gate)
            {
                if (!File.Exists(DealsPath) || (DateTime.UtcNow - File.GetLastWriteTimeUtc(DealsPath)).TotalHours > 20) StartFetch();
                if (deals == null || (File.Exists(DealsPath) && File.GetLastWriteTimeUtc(DealsPath) > dealsLoadedFrom)) LoadDeals();
                return deals ?? new List<Deal>();
            }
        }

        static void LoadDeals()
        {
            var list = new List<Deal>();
            try
            {
                if (File.Exists(DealsPath))
                {
                    var d = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(DealsPath, Encoding.UTF8));
                    dealsNote = S(d, "note");
                    object o;
                    if (d.TryGetValue("deals", out o) && o is IEnumerable)
                        foreach (var x in (IEnumerable)o)
                        {
                            var e = x as Dictionary<string, object>;
                            if (e == null) continue;
                            list.Add(new Deal
                            {
                                Icao = S(e, "icao"), Store = S(e, "store"), Title = S(e, "title"), Url = S(e, "url"), Currency = S(e, "currency"),
                                Price = N(e, "price"), Was = N(e, "was"), Msfs2024 = e.ContainsKey("msfs2024") && e["msfs2024"] is bool && (bool)e["msfs2024"]
                            });
                        }
                    dealsLoadedFrom = File.GetLastWriteTimeUtc(DealsPath);
                }
            }
            catch (Exception ex) { Log.Write("Deals: " + ex.Message); }
            deals = list;
        }

        static void StartFetch()
        {
            if (fetching) return;
            fetching = true;
            var t = new Thread(FetchDeals) { IsBackground = true, Name = "deals", Priority = ThreadPriority.BelowNormal };
            t.Start();
        }

        static void FetchDeals()
        {
            try
            {
                var known = Runways.Idents();
                var found = new List<Dictionary<string, object>>();
                var notes = new List<string>();
                foreach (var shop in Shops)
                {
                    int products = 0, sale = 0;
                    try
                    {
                        string currency = Currency(shop[1]);
                        for (int page = 1; page <= 40; page++)
                        {
                            string text = GetText(shop[1] + "/products.json?limit=250&page=" + page);
                            var d = Json.Deserialize<Dictionary<string, object>>(text);
                            object po;
                            var items = d != null && d.TryGetValue("products", out po) ? po as IEnumerable : null;
                            int n = 0;
                            if (items != null)
                                foreach (var x in items)
                                {
                                    n++; products++;
                                    var p = x as Dictionary<string, object>;
                                    if (p == null) continue;
                                    string title = S(p, "title"), handle = S(p, "handle");
                                    var codes = Codes(title, known);
                                    if (codes.Count == 0) continue;
                                    // The cheapest variant that's on sale.
                                    double price = double.MaxValue, was = 0;
                                    object vo;
                                    if (p.TryGetValue("variants", out vo) && vo is IEnumerable)
                                        foreach (var v in (IEnumerable)vo)
                                        {
                                            var vd = v as Dictionary<string, object>;
                                            if (vd == null) continue;
                                            double pr = Num(S(vd, "price")), cmp = Num(S(vd, "compare_at_price"));
                                            if (pr > 0 && cmp > pr && pr < price) { price = pr; was = cmp; }
                                        }
                                    if (was <= 0) continue;
                                    sale++;
                                    foreach (var code in codes)
                                    {
                                        var e = new Dictionary<string, object>();
                                        e["icao"] = code; e["store"] = shop[0]; e["title"] = title;
                                        e["url"] = shop[1] + "/products/" + handle;
                                        e["price"] = price; e["was"] = was; e["currency"] = currency;
                                        e["msfs2024"] = title.IndexOf("2024", StringComparison.Ordinal) >= 0 || title.IndexOf("MSFS24", StringComparison.OrdinalIgnoreCase) >= 0;
                                        found.Add(e);
                                    }
                                }
                            if (n < 250) break;
                            Thread.Sleep(400); // be gentle with the shop
                        }
                        notes.Add(shop[0] + ": " + sale + " airports on sale (" + products + " products)");
                    }
                    catch (Exception ex) { notes.Add(shop[0] + ": couldn't be checked (" + ex.Message + ")"); }
                }
                var outD = new Dictionary<string, object>();
                outD["note"] = string.Join(" · ", notes.ToArray());
                outD["deals"] = found;
                Directory.CreateDirectory(FlightRec.Folder);
                File.WriteAllText(DealsPath, Json.Serialize(outD), new UTF8Encoding(false));
                Log.Write("Deals: " + outD["note"]);
            }
            catch (Exception ex) { Log.Write("Deals: " + ex.Message); }
            finally { fetching = false; }
        }

        static string Currency(string shop)
        {
            try
            {
                var d = Json.Deserialize<Dictionary<string, object>>(GetText(shop + "/meta.json"));
                return S(d, "currency") ?? "";
            }
            catch { return ""; }
        }

        static string GetText(string url)
        {
            ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072;
            var r = (HttpWebRequest)WebRequest.Create(url);
            r.Timeout = 20000;
            r.ReadWriteTimeout = 20000;
            r.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ControlHub/" + Program.Version;
            r.Accept = "application/json";
            r.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            using (var res = (HttpWebResponse)r.GetResponse())
            using (var s = new StreamReader(res.GetResponseStream(), Encoding.UTF8)) return s.ReadToEnd();
        }

        // ------------------------------------------------------------------ helpers

        static string S(Dictionary<string, object> d, string k)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : null;
        }

        static double N(Dictionary<string, object> d, string k)
        {
            object v;
            if (d == null || !d.TryGetValue(k, out v) || v == null) return 0;
            try { return Convert.ToDouble(v, CultureInfo.InvariantCulture); } catch { return 0; }
        }

        static double Num(string s)
        {
            double d;
            return s != null && double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out d) ? d : 0;
        }
    }
}
