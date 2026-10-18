using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace ControlPanelHelper
{
    /// <summary>
    /// Gets news feeds and weather for the widget. Only these sites can be fetched,
    /// so the widget can't use the helper to reach anything else.
    /// </summary>
    static class WebGet
    {
        static readonly HashSet<string> Hosts = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "api.open-meteo.com", "geocoding-api.open-meteo.com",
            "www.dr.dk", "api.rainviewer.com", "feeds.tv2.dk", "feeds.services.tv2.dk", "www.simbrief.com", "aviationweather.gov", "feeds.bbci.co.uk", "www.pcgamer.com", "www.theverge.com", "fselite.net",
            "api.energidataservice.dk", "air-quality-api.open-meteo.com", "api.frankfurter.dev",
        };
        static readonly Dictionary<string, KeyValuePair<DateTime, byte[]>> cache = new Dictionary<string, KeyValuePair<DateTime, byte[]>>();
        const int MaxBytes = 3 * 1024 * 1024;

        public static bool Allowed(string url)
        {
            Uri u;
            return Uri.TryCreate(url, UriKind.Absolute, out u) && u.Scheme == "https" && Hosts.Contains(u.Host);
        }

        /// <summary>Downloads a page (kept for 5 minutes). Null if it failed.</summary>
        public static byte[] Get(string url, out string contentType)
        {
            contentType = "text/plain; charset=utf-8";
            lock (cache)
            {
                KeyValuePair<DateTime, byte[]> hit;
                if (cache.TryGetValue(url, out hit) && (DateTime.UtcNow - hit.Key).TotalMinutes < 5)
                {
                    contentType = url.Contains("open-meteo") ? "application/json; charset=utf-8" : "text/xml; charset=utf-8";
                    return hit.Value;
                }
            }
            var data = Download(url, out contentType);
            if (data != null)
                lock (cache)
                {
                    if (cache.Count > 60) cache.Clear();
                    cache[url] = new KeyValuePair<DateTime, byte[]>(DateTime.UtcNow, data);
                }
            return data;
        }

        public static byte[] Download(string url, out string contentType)
        {
            contentType = "text/plain; charset=utf-8";
            try
            {
                ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072;
                var r = (HttpWebRequest)WebRequest.Create(url);
                r.Timeout = 10000;
                r.ReadWriteTimeout = 10000;
                r.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ControlPanelHelper/" + Program.Version;
                r.AutomaticDecompression = DecompressionMethods.GZip;
                using (var res = (HttpWebResponse)r.GetResponse())
                using (var s = res.GetResponseStream())
                using (var ms = new MemoryStream())
                {
                    var buf = new byte[32768];
                    int n;
                    while ((n = s.Read(buf, 0, buf.Length)) > 0)
                    {
                        ms.Write(buf, 0, n);
                        if (ms.Length > MaxBytes) return null;
                    }
                    contentType = string.IsNullOrEmpty(res.ContentType) ? "text/plain; charset=utf-8" : res.ContentType;
                    return ms.ToArray();
                }
            }
            catch (Exception ex)
            {
                Log.Write("Fetch " + new Uri(url).Host + ": " + ex.Message);
                return null;
            }
        }
    }

    /// <summary>Calendars added from the tray menu (private iCal links from Google or Outlook).</summary>
    static class Calendars
    {
        public static List<Dictionary<string, object>> Get()
        {
            var list = new List<Dictionary<string, object>>();
            foreach (var c in Settings.Current.Custom.ToArray())
            {
                if (c.Kind != "calendar") continue;
                string type;
                var data = WebGet.Get(c.Target, out type);
                var d = new Dictionary<string, object>();
                d["name"] = c.Name;
                d["ok"] = data != null;
                if (data != null) d["ics"] = Encoding.UTF8.GetString(data);
                list.Add(d);
            }
            return list;
        }

        /// <summary>webcal:// links work too. Only https links are accepted.</summary>
        public static string Clean(string url)
        {
            if (url == null) return null;
            url = url.Trim();
            if (url.StartsWith("webcal://", StringComparison.OrdinalIgnoreCase)) url = "https://" + url.Substring(9);
            Uri u;
            if (!Uri.TryCreate(url, UriKind.Absolute, out u) || u.Scheme != "https") return null;
            return u.AbsoluteUri;
        }
    }

    /// <summary>Your newest screenshots (Pictures\Screenshots, Videos\Captures), with small previews.</summary>
    static class Screens
    {
        static readonly Dictionary<string, string> byId = new Dictionary<string, string>();
        static readonly Dictionary<string, byte[]> thumbs = new Dictionary<string, byte[]>();
        static readonly string[] Ext = { ".png", ".jpg", ".jpeg" };

        static IEnumerable<string> Folders()
        {
            string pics = Environment.GetFolderPath(Environment.SpecialFolder.MyPictures);
            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            yield return Path.Combine(pics, "Screenshots");
            yield return Path.Combine(home, "Videos", "Captures");
            yield return Path.Combine(home, "OneDrive", "Pictures", "Screenshots");
            yield return Path.Combine(home, "OneDrive", "Billeder", "Skærmbilleder");
            yield return Path.Combine(pics, "Skærmbilleder");
        }

        public static List<Dictionary<string, object>> List(int max)
        {
            var files = new List<FileInfo>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var dir in Folders())
            {
                try
                {
                    if (!Directory.Exists(dir) || !seen.Add(dir)) continue;
                    foreach (var f in new DirectoryInfo(dir).GetFiles())
                        if (Array.IndexOf(Ext, f.Extension.ToLowerInvariant()) >= 0) files.Add(f);
                }
                catch { }
            }
            files.Sort(delegate (FileInfo a, FileInfo b) { return b.LastWriteTimeUtc.CompareTo(a.LastWriteTimeUtc); });
            var list = new List<Dictionary<string, object>>();
            foreach (var f in files)
            {
                if (list.Count >= max) break;
                string id = Hash(f.FullName.ToLowerInvariant() + "|" + f.LastWriteTimeUtc.Ticks);
                lock (byId) byId[id] = f.FullName;
                var d = new Dictionary<string, object>();
                d["id"] = id;
                d["name"] = f.Name;
                d["time"] = (long)(f.LastWriteTimeUtc - new DateTime(1970, 1, 1)).TotalMilliseconds;
                list.Add(d);
            }
            return list;
        }

        public static byte[] Thumb(string id)
        {
            if (id == null) return null;
            string path;
            lock (byId) if (!byId.TryGetValue(id, out path)) return null;
            lock (thumbs)
            {
                byte[] hit;
                if (thumbs.TryGetValue(id, out hit)) return hit;
            }
            try
            {
                using (var src = Image.FromFile(path))
                {
                    double scale = Math.Min(1.0, 480.0 / Math.Max(src.Width, src.Height));
                    int w = Math.Max(1, (int)(src.Width * scale)), h = Math.Max(1, (int)(src.Height * scale));
                    using (var bmp = new Bitmap(w, h))
                    using (var g = Graphics.FromImage(bmp))
                    using (var ms = new MemoryStream())
                    {
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.DrawImage(src, 0, 0, w, h);
                        bmp.Save(ms, ImageFormat.Jpeg);
                        var bytes = ms.ToArray();
                        lock (thumbs)
                        {
                            if (thumbs.Count > 80) thumbs.Clear();
                            thumbs[id] = bytes;
                        }
                        return bytes;
                    }
                }
            }
            catch (Exception ex) { Log.Write("Screenshot preview: " + ex.Message); return null; }
        }

        public static bool Open(string id)
        {
            string path;
            lock (byId) if (id == null || !byId.TryGetValue(id, out path)) return false;
            if (!File.Exists(path)) return false;
            Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
            return true;
        }

        public static bool OpenFolder()
        {
            foreach (var dir in Folders())
                if (Directory.Exists(dir)) { Process.Start(new ProcessStartInfo(dir) { UseShellExecute = true }); return true; }
            return false;
        }

        static string Hash(string s)
        {
            using (var sha = SHA1.Create())
            {
                var b = sha.ComputeHash(Encoding.UTF8.GetBytes(s));
                var sb = new StringBuilder();
                for (int i = 0; i < 8; i++) sb.Append(b[i].ToString("x2"));
                return sb.ToString();
            }
        }
    }

    /// <summary>
    /// Clipboard history: only when switched on from the widget. The last 10 copied texts,
    /// kept in memory only (never written to disk), forgotten when switched off or the helper closes.
    /// </summary>
    class ClipHistory : NativeWindow
    {
        [DllImport("user32.dll", SetLastError = true)] static extern bool AddClipboardFormatListener(IntPtr hwnd);
        [DllImport("user32.dll", SetLastError = true)] static extern bool RemoveClipboardFormatListener(IntPtr hwnd);
        const int WM_CLIPBOARDUPDATE = 0x031D;

        static ClipHistory instance;
        static SynchronizationContext ui;
        static readonly List<string> items = new List<string>();
        static string ignoreNext;

        public static void Start(SynchronizationContext context)
        {
            ui = context;
            instance = new ClipHistory();
            instance.CreateHandle(new CreateParams());
            AddClipboardFormatListener(instance.Handle);
        }

        public static bool On { get { return Settings.Current.ClipboardHistory; } }

        public static void SetOn(bool on)
        {
            Settings.Current.ClipboardHistory = on;
            Settings.Save();
            if (!on) lock (items) items.Clear();
        }

        public static List<string> Items()
        {
            lock (items) return new List<string>(items);
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_CLIPBOARDUPDATE && On)
            {
                try
                {
                    if (Clipboard.ContainsText())
                    {
                        string t = Clipboard.GetText();
                        if (!string.IsNullOrEmpty(t) && t.Length <= 20000 && t != ignoreNext)
                        {
                            lock (items)
                            {
                                items.Remove(t);
                                items.Insert(0, t);
                                while (items.Count > 10) items.RemoveAt(items.Count - 1);
                            }
                        }
                        ignoreNext = null;
                    }
                }
                catch { /* another program has the clipboard open */ }
            }
            base.WndProc(ref m);
        }

        /// <summary>Puts an earlier text back on the clipboard (runs on the tray app's thread).</summary>
        /// <summary>Puts a text on the clipboard (copy board tile).</summary>
        public static bool SetText(string t)
        {
            if (string.IsNullOrEmpty(t) || t.Length > 20000 || ui == null) return false;
            bool ok = false;
            ui.Send(delegate
            {
                try { Clipboard.SetText(t); ok = true; }
                catch (Exception ex) { Log.Write("Clipboard: " + ex.Message); }
            }, null);
            return ok;
        }

        public static bool Copy(int index)
        {
            string t;
            lock (items)
            {
                if (index < 0 || index >= items.Count) return false;
                t = items[index];
            }
            bool ok = false;
            ui.Send(delegate
            {
                try
                {
                    ignoreNext = null;
                    Clipboard.SetText(t);
                    ok = true;
                }
                catch (Exception ex) { Log.Write("Clipboard: " + ex.Message); }
            }, null);
            return ok;
        }

        public static void Clear()
        {
            lock (items) items.Clear();
        }
    }
}
