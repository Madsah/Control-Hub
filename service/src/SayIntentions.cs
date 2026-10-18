using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

namespace ControlPanelHelper
{
    /// <summary>
    /// SayIntentions.AI: reads its flight file on this PC (which also holds your API key), and asks
    /// SayIntentions for the radio history (what ATC said, what you said). The key never leaves the helper.
    /// </summary>
    static class SayIntentions
    {
        static readonly string FlightFile = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SayIntentionsAI", "flight.json");
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
        static readonly object Gate = new object();
        static Dictionary<string, object> lastComms;
        static DateTime commsAt = DateTime.MinValue;
        static string lastKeyError;

        static Dictionary<string, object> ReadFlight()
        {
            try
            {
                if (!File.Exists(FlightFile)) return null;
                string text;
                using (var fs = new FileStream(FlightFile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (var sr = new StreamReader(fs, Encoding.UTF8)) text = sr.ReadToEnd();
                var root = Json.Deserialize<Dictionary<string, object>>(text);
                object fd;
                return root != null && root.TryGetValue("flight_details", out fd) ? fd as Dictionary<string, object> : root;
            }
            catch { return null; }
        }

        static string Str(Dictionary<string, object> d, string k)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : null;
        }

        public static Dictionary<string, object> State()
        {
            var d = new Dictionary<string, object>();
            var f = ReadFlight();
            string key = Str(f, "api_key");
            if (string.IsNullOrEmpty(key)) key = Settings.Current.SayIntentionsKey;
            d["running"] = f != null;
            d["key"] = !string.IsNullOrEmpty(key);
            if (f != null)
            {
                d["callsign"] = Str(f, "callsign") ?? "";
                d["airport"] = Str(f, "current_airport") ?? "";
                d["runway"] = Str(f, "runway") ?? "";
                d["clearedTakeoff"] = Str(f, "cleared_for_takeoff") ?? "";
                d["clearedLanding"] = Str(f, "cleared_for_landing") ?? "";
                d["toRunway"] = Str(f, "distance_to_runway") ?? "";
                object atis;
                if (f.TryGetValue("atis_airports", out atis) && atis != null) d["atis"] = atis is string ? atis : Json.Serialize(atis);
                object cf;
                var cur = f.TryGetValue("current_flight", out cf) ? cf as Dictionary<string, object> : null;
                if (cur != null)
                {
                    d["from"] = Str(cur, "flight_origin") ?? "";
                    d["to"] = Str(cur, "flight_destination") ?? "";
                    d["gate"] = Str(cur, "assigned_gate") ?? "";
                    d["sid"] = Str(cur, "flight_plan_sid") ?? "";
                    d["star"] = Str(cur, "flight_plan_star") ?? "";
                    d["depRwy"] = Str(cur, "flight_plan_departing_runway") ?? "";
                    d["arrRwy"] = Str(cur, "flight_plan_arriving_runway") ?? "";
                    d["arrRunways"] = Str(cur, "destination_arriving_runways") ?? "";
                    object tp;
                    if (cur.TryGetValue("taxi_path", out tp) && tp != null) d["taxi"] = tp is string ? tp : Json.Serialize(tp);
                }
            }
            if (!string.IsNullOrEmpty(key))
            {
                var c = Comms(key);
                if (c != null) d["comms"] = c;
                if (lastKeyError != null) d["error"] = lastKeyError;
            }
            return d;
        }

        static string Key()
        {
            string key = Str(ReadFlight(), "api_key");
            return string.IsNullOrEmpty(key) ? Settings.Current.SayIntentionsKey : key;
        }

        static readonly string[] Channels = { "COM1", "COM2", "INTERCOM1", "INTERCOM2", "INTERCOM3" };

        static Dictionary<string, object> Get(string endpoint, string query)
        {
            string key = Key();
            if (string.IsNullOrEmpty(key)) return null;
            string type;
            var data = WebGet.Download("https://apipri.sayintentions.ai/sapi/" + endpoint + "?api_key=" + Uri.EscapeDataString(key) + (query ?? ""), out type);
            if (data == null) return null;
            string text = Encoding.UTF8.GetString(data);
            var d = new Dictionary<string, object>();
            try { d["data"] = Json.DeserializeObject(text); }
            catch { d["data"] = text; }
            return d;
        }

        /// <summary>Send a radio call as you (COM1/COM2) or to the cabin (intercom).</summary>
        public static bool Say(string channel, string message)
        {
            if (Array.IndexOf(Channels, channel) < 0 || string.IsNullOrEmpty(message) || message.Length > 255) return false;
            var r = Get("sayAs", "&channel=" + Uri.EscapeDataString(channel) + "&message=" + Uri.EscapeDataString(message));
            Log.Write("SayIntentions: sent on " + channel + (r == null ? " (failed)" : ""));
            lock (Gate) commsAt = DateTime.MinValue; // show it soon
            return r != null;
        }

        public static bool SetFreq(double mhz, int com, string mode)
        {
            if (mhz < 108 || mhz > 137) return false;
            if (com != 2) com = 1;
            if (mode != "standby") mode = "active";
            return Get("setFreq", "&freq=" + mhz.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture) + "&com=" + com + "&mode=" + mode) != null;
        }

        public static bool AssignGate(string gate, string airport)
        {
            if (string.IsNullOrEmpty(gate) || gate.Length > 30 || string.IsNullOrEmpty(airport) || airport.Length > 6) return false;
            foreach (char c in gate) if (!char.IsLetterOrDigit(c) && c != ' ' && c != '-') return false;
            return Get("assignGate", "&gate=" + Uri.EscapeDataString(gate) + "&airport=" + Uri.EscapeDataString(airport)) != null;
        }

        static Dictionary<string, object> freqCache, parkCache;
        static DateTime freqAt = DateTime.MinValue, parkAt = DateTime.MinValue;

        public static Dictionary<string, object> Frequencies()
        {
            lock (Gate)
            {
                if (freqCache == null || (DateTime.UtcNow - freqAt).TotalSeconds > 20) { freqCache = Get("getCurrentFrequencies", null); freqAt = DateTime.UtcNow; }
                return freqCache;
            }
        }

        public static Dictionary<string, object> Parking()
        {
            lock (Gate)
            {
                if (parkCache == null || (DateTime.UtcNow - parkAt).TotalSeconds > 60) { parkCache = Get("getParking", null); parkAt = DateTime.UtcNow; }
                return parkCache;
            }
        }

        /// <summary>The last radio calls, asked at most every 4 seconds.</summary>
        static List<Dictionary<string, object>> Comms(string key)
        {
            lock (Gate)
            {
                if (lastComms == null || (DateTime.UtcNow - commsAt).TotalSeconds >= 4)
                {
                    commsAt = DateTime.UtcNow;
                    string type;
                    var data = WebGet.Download("https://apipri.sayintentions.ai/sapi/getCommsHistory?api_key=" + Uri.EscapeDataString(key), out type);
                    if (data == null) lastKeyError = "Couldn't reach SayIntentions";
                    else
                    {
                        try
                        {
                            lastComms = Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(data));
                            lastKeyError = null;
                        }
                        catch { lastKeyError = "SayIntentions sent something unexpected"; }
                    }
                }
                var outList = new List<Dictionary<string, object>>();
                object h;
                if (lastComms == null || !lastComms.TryGetValue("comm_history", out h) || !(h is IEnumerable)) return outList;
                foreach (var o in (IEnumerable)h)
                {
                    var e = o as Dictionary<string, object>;
                    if (e == null) continue;
                    var x = new Dictionary<string, object>();
                    x["id"] = Str(e, "id") ?? "";
                    x["time"] = Str(e, "stamp_zulu") ?? "";
                    x["station"] = Str(e, "station_name") ?? "";
                    x["freq"] = Str(e, "frequency") ?? "";
                    x["channel"] = Str(e, "channel") ?? "";
                    x["in"] = Str(e, "incoming_message") ?? "";
                    x["out"] = Str(e, "outgoing_message") ?? "";
                    x["acars"] = Str(e, "is_acars") ?? "";
                    outList.Add(x);
                }
                return outList;
            }
        }
    }
}
