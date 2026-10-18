// Control Hub (the app window): talking to Control Hub Service on this PC.
// C# 5 / .NET Framework 4.x (built with the compiler that ships with Windows).
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Web.Script.Serialization;

namespace ControlHub
{
    static class HubApi
    {
        public const int Port = 39812;
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };

        static string Base { get { return "http://127.0.0.1:" + Port; } }

        /// <summary>GET a JSON answer from the service, or null if it isn't running / didn't answer.</summary>
        public static Dictionary<string, object> Get(string path, int timeoutMs)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(Base + path);
                req.Method = "GET";
                req.Timeout = timeoutMs;
                req.ReadWriteTimeout = timeoutMs;
                req.Proxy = null;
                req.UserAgent = "ControlHub/" + HubApp.Version;
                using (var res = (HttpWebResponse)req.GetResponse())
                using (var r = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                    return Json.Deserialize<Dictionary<string, object>>(r.ReadToEnd());
            }
            catch { return null; }
        }

        /// <summary>Asks the service to do something (same as its tray menu). Returns true if it said ok.</summary>
        public static bool Do(Dictionary<string, object> body)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(Base + "/api/hub/do");
                req.Method = "POST";
                req.Timeout = 5000;
                req.ReadWriteTimeout = 5000;
                req.Proxy = null;
                req.UserAgent = "ControlHub/" + HubApp.Version;
                req.ContentType = "application/json";
                req.Headers["X-Control-Panel"] = "1";
                byte[] data = Encoding.UTF8.GetBytes(Json.Serialize(body));
                req.ContentLength = data.Length;
                using (var s = req.GetRequestStream()) s.Write(data, 0, data.Length);
                using (var res = (HttpWebResponse)req.GetResponse())
                using (var r = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                {
                    var d = Json.Deserialize<Dictionary<string, object>>(r.ReadToEnd());
                    return d != null && d.ContainsKey("ok") && d["ok"] is bool && (bool)d["ok"];
                }
            }
            catch { return false; }
        }

        public static bool Run(string what)
        {
            var b = new Dictionary<string, object>();
            b["what"] = what;
            return Do(b);
        }

        public static Dictionary<string, object> Parse(string text)
        {
            try { return Json.Deserialize<Dictionary<string, object>>(text); } catch { return null; }
        }

        public static string Serialize(object o) { return Json.Serialize(o); }

        // ------------------------------------------------------------------ small JSON helpers

        public static string Str(Dictionary<string, object> d, string k)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : null;
        }

        public static bool Bool(Dictionary<string, object> d, string k)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) && v is bool && (bool)v;
        }

        public static long Long(Dictionary<string, object> d, string k)
        {
            object v;
            if (d == null || !d.TryGetValue(k, out v) || v == null) return 0;
            try { return Convert.ToInt64(v); } catch { return 0; }
        }

        public static Dictionary<string, object> Obj(Dictionary<string, object> d, string k)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) ? v as Dictionary<string, object> : null;
        }

        public static List<Dictionary<string, object>> List(Dictionary<string, object> d, string k)
        {
            var list = new List<Dictionary<string, object>>();
            object v;
            if (d == null || !d.TryGetValue(k, out v) || v == null) return list;
            var e = v as IEnumerable;
            if (e == null || v is string) return list;
            foreach (var x in e) { var o = x as Dictionary<string, object>; if (o != null) list.Add(o); }
            return list;
        }

        public static List<string> Strings(Dictionary<string, object> d, string k)
        {
            var list = new List<string>();
            object v;
            if (d == null || !d.TryGetValue(k, out v) || v == null) return list;
            var e = v as IEnumerable;
            if (e == null || v is string) return list;
            foreach (var x in e) if (x != null) list.Add(Convert.ToString(x));
            return list;
        }
    }
}
