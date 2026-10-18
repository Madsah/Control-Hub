using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace ControlPanelHelper
{
    /// <summary>
    /// Backups of the widget's layout in %APPDATA%\ControlPanelHelper\backups.
    /// The widget makes one by itself once a day, and when you tap "Back up now".
    /// Keeps the newest 10 automatic and the newest 20 other backups.
    /// </summary>
    static class Backups
    {
        public static readonly string Folder = Path.Combine(Settings.Folder, "backups");
        static readonly Regex Name = new Regex(@"^(auto|manual|before-restore)-\d{8}-\d{6}(-\d+)?\.json$");
        const int MaxSize = 4 * 1024 * 1024;
        static readonly object Gate = new object();

        static readonly string LiveFile = Path.Combine(Folder, "live.json");

        public static string Save(string kind, string layout, int pages, int tiles)
        {
            if (kind != "auto" && kind != "before-restore" && kind != "live") kind = "manual";
            if (string.IsNullOrEmpty(layout) || layout.Length > MaxSize || layout[0] != '{') return null;
            lock (Gate)
            {
                if (kind == "live")
                {
                    // The newest layout, saved a few seconds after every change. Restored by itself if iCUE ever loses it.
                    Directory.CreateDirectory(Folder);
                    var live = new StringBuilder();
                    live.Append("{\"pages\":").Append(Math.Max(0, pages)).Append(",\"tiles\":").Append(Math.Max(0, tiles));
                    live.Append(",\"layout\":").Append(Server.JsonString(layout)).Append("}");
                    string tmp = LiveFile + ".tmp";
                    File.WriteAllText(tmp, live.ToString(), new UTF8Encoding(false));
                    if (File.Exists(LiveFile)) File.Replace(tmp, LiveFile, null);
                    else File.Move(tmp, LiveFile);
                    return "live";
                }
                Directory.CreateDirectory(Folder);
                string stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);
                string name = kind + "-" + stamp + ".json";
                for (int i = 2; File.Exists(Path.Combine(Folder, name)); i++) name = kind + "-" + stamp + "-" + i + ".json";
                // A small header line with counts, then the layout itself.
                var sb = new StringBuilder();
                sb.Append("{\"pages\":").Append(Math.Max(0, pages)).Append(",\"tiles\":").Append(Math.Max(0, tiles));
                sb.Append(",\"layout\":").Append(Server.JsonString(layout)).Append("}");
                File.WriteAllText(Path.Combine(Folder, name), sb.ToString(), new UTF8Encoding(false));
                Trim("auto", 10);
                Trim("manual", 20);
                Trim("before-restore", 5);
                return name;
            }
        }

        static void Trim(string kind, int keep)
        {
            var files = new List<string>(Directory.GetFiles(Folder, kind + "-*.json"));
            files.Sort(StringComparer.Ordinal);
            for (int i = 0; i < files.Count - keep; i++)
            {
                try { File.Delete(files[i]); } catch { }
            }
        }

        /// <summary>The panel's newest layout (a JSON string), or null.</summary>
        public static string LiveLayout()
        {
            lock (Gate)
            {
                try
                {
                    if (!File.Exists(LiveFile)) return null;
                    var d = Server.ParseJson(File.ReadAllText(LiveFile, Encoding.UTF8));
                    object l;
                    return d != null && d.TryGetValue("layout", out l) ? l as string : null;
                }
                catch { return null; }
            }
        }

        public static List<Dictionary<string, object>> List()
        {
            var outList = new List<Dictionary<string, object>>();
            lock (Gate)
            {
                if (!Directory.Exists(Folder)) return outList;
                foreach (var f in Directory.GetFiles(Folder, "*.json"))
                {
                    string name = Path.GetFileName(f);
                    if (!Name.IsMatch(name)) continue;
                    var d = new Dictionary<string, object>();
                    d["name"] = name;
                    d["kind"] = name.Substring(0, name.IndexOf('-', name.StartsWith("before-") ? 7 : 0));
                    d["time"] = (long)(File.GetLastWriteTimeUtc(f) - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
                    try
                    {
                        var info = Server.ParseJson(ReadHead(f));
                        object v;
                        if (info != null && info.TryGetValue("pages", out v)) d["pages"] = v;
                        if (info != null && info.TryGetValue("tiles", out v)) d["tiles"] = v;
                    }
                    catch { }
                    outList.Add(d);
                }
            }
            outList.Sort(delegate (Dictionary<string, object> a, Dictionary<string, object> b) { return ((long)b["time"]).CompareTo((long)a["time"]); });
            return outList;
        }

        // Only the counts at the start of the file, without reading the whole layout.
        static string ReadHead(string f)
        {
            using (var r = new StreamReader(f, Encoding.UTF8))
            {
                var buf = new char[200];
                int n = r.Read(buf, 0, buf.Length);
                string s = new string(buf, 0, n);
                int cut = s.IndexOf(",\"layout\"");
                return cut > 0 ? s.Substring(0, cut) + "}" : "{}";
            }
        }

        /// <summary>The stored layout (as the JSON text the widget sent), or null.</summary>
        public static string Read(string name)
        {
            if (name == "live") name = "live.json";
            if (string.IsNullOrEmpty(name) || (!Name.IsMatch(name) && name != "live.json")) return null;
            string path = Path.Combine(Folder, name);
            lock (Gate)
            {
                if (!File.Exists(path)) return null;
                var info = Server.ParseJson(File.ReadAllText(path, Encoding.UTF8));
                object v;
                return info != null && info.TryGetValue("layout", out v) ? v as string : null;
            }
        }
    }
}
