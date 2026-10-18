using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace ControlPanelHelper
{
    /// <summary>
    /// Minimal HTTP server on 127.0.0.1 only. It sleeps until the widget asks for something,
    /// so it costs nothing while idle. Websites can't use it: requests from http(s) origins
    /// are refused, and actions need a custom header that browsers only send after permission.
    /// </summary>
    class Server
    {
        readonly int port;
        TcpListener listener;
        Thread acceptThread;
        volatile bool running;
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };

        public Server(int port) { this.port = port; }

        public void Start()
        {
            listener = new TcpListener(IPAddress.Loopback, port);
            listener.Start();
            running = true;
            acceptThread = new Thread(AcceptLoop) { IsBackground = true, Name = "http-accept" };
            acceptThread.Start();
            Log.Write("Listening on http://127.0.0.1:" + port);
        }

        public void Stop()
        {
            running = false;
            try { listener.Stop(); } catch { }
        }

        void AcceptLoop()
        {
            while (running)
            {
                TcpClient client;
                try { client = listener.AcceptTcpClient(); }
                catch { if (!running) return; continue; }
                ThreadPool.QueueUserWorkItem(delegate { Handle(client); });
            }
        }

        // ------------------------------------------------------------------ HTTP plumbing

        class Request
        {
            public string Method, Path, Query = "";
            public Dictionary<string, string> Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            public string Body = "";
            public string Header(string name) { string v; return Headers.TryGetValue(name, out v) ? v : null; }
            public string Param(string name)
            {
                foreach (var part in Query.Split('&'))
                {
                    int eq = part.IndexOf('=');
                    if (eq > 0 && Uri.UnescapeDataString(part.Substring(0, eq)) == name)
                        return Uri.UnescapeDataString(part.Substring(eq + 1).Replace('+', ' '));
                }
                return null;
            }
        }

        void Handle(TcpClient client)
        {
            using (client)
            {
                try
                {
                    client.ReceiveTimeout = 5000;
                    client.SendTimeout = 5000;
                    var stream = client.GetStream();
                    var req = Read(stream);
                    if (req == null) return;
                    Route(req, stream);
                }
                catch (IOException) { /* idle connection opened ahead of time by a browser */ }
                catch (Exception ex) { Log.Write("HTTP: " + ex.Message); }
            }
        }

        static Request Read(NetworkStream stream)
        {
            var buf = new byte[16384];
            int len = 0, headerEnd = -1;
            while (headerEnd < 0)
            {
                if (len == buf.Length) return null;
                int n = stream.Read(buf, len, buf.Length - len);
                if (n <= 0) return null;
                len += n;
                for (int i = 3; i < len; i++)
                    if (buf[i - 3] == '\r' && buf[i - 2] == '\n' && buf[i - 1] == '\r' && buf[i] == '\n') { headerEnd = i + 1; break; }
            }
            string head = Encoding.ASCII.GetString(buf, 0, headerEnd);
            var lines = head.Split(new[] { "\r\n" }, StringSplitOptions.None);
            var first = lines[0].Split(' ');
            if (first.Length < 2) return null;
            var req = new Request { Method = first[0].ToUpperInvariant() };
            string target = first[1];
            int q = target.IndexOf('?');
            req.Path = q >= 0 ? target.Substring(0, q) : target;
            if (q >= 0) req.Query = target.Substring(q + 1);
            for (int i = 1; i < lines.Length; i++)
            {
                int c = lines[i].IndexOf(':');
                if (c > 0) req.Headers[lines[i].Substring(0, c).Trim()] = lines[i].Substring(c + 1).Trim();
            }
            int contentLength = 0;
            int.TryParse(req.Header("Content-Length") ?? "0", out contentLength);
            int limit = req.Path == "/api/backup" || req.Path == "/api/layoutfile" ? 5 * 1024 * 1024 : req.Path == "/cs2" ? 512 * 1024 : 65536;
            if (contentLength < 0 || contentLength > limit) return null;
            var body = new MemoryStream();
            body.Write(buf, headerEnd, len - headerEnd);
            while (body.Length < contentLength)
            {
                int n = stream.Read(buf, 0, Math.Min(buf.Length, contentLength - (int)body.Length));
                if (n <= 0) break;
                body.Write(buf, 0, n);
            }
            req.Body = Encoding.UTF8.GetString(body.ToArray(), 0, (int)Math.Min(body.Length, contentLength));
            return req;
        }

        static void Send(NetworkStream stream, int status, string contentType, byte[] body, string allowOrigin, string extraHeaders)
        {
            var sb = new StringBuilder();
            sb.Append("HTTP/1.1 ").Append(status).Append(status == 200 ? " OK" : status == 204 ? " No Content" : " Error").Append("\r\n");
            sb.Append("Content-Type: ").Append(contentType).Append("\r\n");
            sb.Append("Content-Length: ").Append(body == null ? 0 : body.Length).Append("\r\n");
            sb.Append("Cache-Control: ").Append(contentType.StartsWith("image/") ? "max-age=86400" : "no-store").Append("\r\n");
            sb.Append("X-Content-Type-Options: nosniff\r\nVary: Origin\r\nConnection: close\r\n");
            // Chromium-based views (like iCUE's) ask permission before a page may talk to this PC.
            sb.Append("Access-Control-Allow-Private-Network: true\r\n");
            if (allowOrigin != null) sb.Append("Access-Control-Allow-Origin: ").Append(allowOrigin).Append("\r\n");
            if (extraHeaders != null) sb.Append(extraHeaders);
            sb.Append("\r\n");
            var head = Encoding.ASCII.GetBytes(sb.ToString());
            stream.Write(head, 0, head.Length);
            if (body != null && body.Length > 0) stream.Write(body, 0, body.Length);
        }

        static void SendJson(NetworkStream stream, int status, object obj, string allowOrigin)
        {
            Send(stream, status, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(Json.Serialize(obj)), allowOrigin, null);
        }

        // Websites always have an http(s) origin; the iCUE widget is a local page (file:, qrc:, "null").
        static bool OriginAllowed(string origin)
        {
            if (string.IsNullOrEmpty(origin) || origin == "null") return true;
            if (!origin.StartsWith("http:", StringComparison.OrdinalIgnoreCase) && !origin.StartsWith("https:", StringComparison.OrdinalIgnoreCase)) return true;
            Uri u;
            return Uri.TryCreate(origin, UriKind.Absolute, out u) && (u.Host == "127.0.0.1" || u.Host == "localhost");
        }

        bool HostAllowed(string host)
        {
            return host == "127.0.0.1:" + port || host == "localhost:" + port;
        }

        // ------------------------------------------------------------------ routes

        static readonly HashSet<string> seenCallers = new HashSet<string>();

        void Route(Request req, NetworkStream stream)
        {
            string origin = req.Header("Origin");
            string caller = (origin ?? "(no origin)") + " | " + (req.Header("User-Agent") ?? "");
            lock (seenCallers)
            {
                if (seenCallers.Add(caller))
                    Log.Write("New caller: " + req.Method + " " + req.Path + "  origin=" + (origin ?? "-") +
                        "  pna=" + (req.Header("Access-Control-Request-Private-Network") ?? "-") + "  ua=" + (req.Header("User-Agent") ?? "-"));
            }
            if (!HostAllowed(req.Header("Host")) || !OriginAllowed(origin))
            {
                Log.Write("Refused " + req.Method + " " + req.Path + " origin=" + (origin ?? "-"));
                SendJson(stream, 403, Err("forbidden"), null);
                return;
            }
            string allow = string.IsNullOrEmpty(origin) ? "*" : origin;
            Hub.Seen(req.Header("User-Agent"));

            if (req.Method == "OPTIONS")
            {
                Send(stream, 204, "text/plain", null, allow,
                    "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Control-Panel\r\nAccess-Control-Max-Age: 600\r\n");
                return;
            }

            if (req.Method == "GET" && req.Path == "/")
            {
                Send(stream, 200, "text/plain; charset=utf-8",
                    Encoding.UTF8.GetBytes(Program.AppName + " " + Program.Version + " is running."), allow, null);
                return;
            }

            // The panel's code for the widget's starter (see Hub.WidgetFile).
            if (req.Method == "GET" && req.Path == "/widget-version") { SendJson(stream, 200, Hub.WidgetVersion(), allow); return; }
            if (req.Method == "GET" && req.Path == "/widget-report")
            {
                Hub.PanelReport(req.Param("source"), req.Param("version"), req.Param("failed"));
                var ok = new Dictionary<string, object>();
                ok["ok"] = true;
                SendJson(stream, 200, ok, allow);
                return;
            }
            if (req.Method == "GET" && req.Path.StartsWith("/widget/"))
            {
                byte[] file;
                string type;
                if (Hub.WidgetFile(req.Path.Substring(8), out file, out type)) Send(stream, 200, type, file, allow, null);
                else SendJson(stream, 404, Err("not found"), allow);
                return;
            }

            // The Control Hub app (the window). Changes need the same header as the widget's.
            if (req.Path.StartsWith("/api/hub/"))
            {
                var res = new Dictionary<string, object>();
                if (req.Method == "GET" && req.Path == "/api/hub/status") { SendJson(stream, 200, Hub.Status(), allow); return; }
                if (req.Method == "GET" && req.Path == "/api/hub/log")
                {
                    res["ok"] = true;
                    res["lines"] = Hub.LogTail(300);
                    SendJson(stream, 200, res, allow);
                    return;
                }
                if (req.Method == "POST" && req.Path == "/api/hub/do")
                {
                    if (req.Header("X-Control-Panel") != "1") { SendJson(stream, 403, Err("missing header"), allow); return; }
                    Dictionary<string, object> body = null;
                    try { body = ParseJson(req.Body ?? "{}"); } catch { }
                    string what = body != null ? Str(body, "what") : null;
                    bool ok;
                    if (what == "restore") ok = Hub.RequestRestore(Str(body, "name"));
                    else if (what == "forget") ok = Hub.Forget(Str(body, "service"));
                    else if (what == "backupSettings")
                    {
                        object auto;
                        AutoBackup.Set(!body.TryGetValue("auto", out auto) || !(auto is bool) || (bool)auto, Str(body, "folder"));
                        ok = true;
                    }
                    else ok = Hub.Run(what);
                    res["ok"] = ok;
                    SendJson(stream, ok ? 200 : 400, res, allow);
                    return;
                }
                SendJson(stream, 404, Err("not found"), allow);
                return;
            }

            // Counter-Strike 2 sends its game state here (checked against the token in our CS2 file).
            if (req.Method == "POST" && req.Path == "/cs2")
            {
                bool ok = Cs2.Receive(req.Body);
                Send(stream, ok ? 200 : 403, "text/plain", null, null, null);
                return;
            }

            if (req.Method == "GET" && req.Path == "/api/events")
            {
                long since, nseq;
                long.TryParse(req.Param("since") ?? "0", out since);
                if (!long.TryParse(req.Param("nseq") ?? "-1", out nseq)) nseq = -1;
                string watch = req.Param("watch");
                string topics = req.Param("topics") ?? "";
                bool wantCs2 = topics.Contains("cs2");
                if (wantCs2) Cs2.Wanted(!topics.Contains("cs2q"));
                if (watch != null) ProcWatch.Watch(watch);
                long seq = since > 0 ? Events.Wait(since, 25000) : Events.Seq;
                var res = new Dictionary<string, object>();
                res["ok"] = true;
                res["seq"] = seq;
                if (watch != null) res["running"] = ProcWatch.Watch(watch);
                res["nseq"] = Notifs.Seq;
                res["notifs"] = nseq >= 0 ? Notifs.Since(nseq) : new List<Dictionary<string, object>>();
                res["dnd"] = Dnd.On;
                if (wantCs2) res["cs2"] = Cs2.State();
                var restore = Hub.TakeRestore();
                if (restore != null) res["restore"] = restore;
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Method == "GET" && (req.Path == "/api/notifs" || req.Path == "/api/cs2history" || req.Path == "/api/health"))
            {
                var res = new Dictionary<string, object>();
                res["ok"] = true;
                if (req.Path == "/api/notifs") { res["notifs"] = Notifs.Recent(); res["status"] = Notifs.Status; }
                else if (req.Path == "/api/cs2history") res["matches"] = Cs2.History();
                else res["items"] = Health.Get();
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Path == "/api/layoutfile" && (req.Method == "GET" || req.Method == "POST"))
            {
                if (req.Header("X-Control-Panel") != "1") { SendJson(stream, 403, Err("missing header"), allow); return; }
                var res = new Dictionary<string, object>();
                // The dialog waits for you on the PC, so this answer can take a while.
                if (req.Method == "POST")
                {
                    string layout = null, pageName = null;
                    try { var body = ParseJson(req.Body ?? "{}"); if (body != null) { layout = Str(body, "layout"); pageName = Str(body, "pageName"); } } catch { }
                    string saved = LayoutFile.Export(layout, pageName);
                    res["ok"] = saved != null;
                    res["file"] = saved ?? "";
                }
                else
                {
                    string file;
                    string layout = LayoutFile.Import(out file);
                    res["ok"] = layout != null;
                    res["layout"] = layout ?? "";
                    res["file"] = file ?? "";
                }
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Method == "GET" && req.Path == "/api/state")
            {
                SendJson(stream, 200, State(req.Param("parts") ?? "", req.Param("watch"), req.Param("ping")), allow);
                return;
            }

            if (req.Method == "GET" && req.Path == "/api/fetch")
            {
                string url = req.Param("url");
                if (!WebGet.Allowed(url)) { SendJson(stream, 403, Err("not allowed"), allow); return; }
                string type;
                var data = WebGet.Get(url, out type);
                if (data == null) { SendJson(stream, 502, Err("couldn't load"), allow); return; }
                Send(stream, 200, type, data, allow, null);
                return;
            }

            if (req.Method == "GET" && req.Path == "/api/discord")
            {
                long since;
                long.TryParse(req.Param("since") ?? "0", out since);
                var res = DiscordLink.State(since);
                res["ok"] = true;
                SendJson(stream, 200, res, allow);
                return;
            }

            // ---- Round 9
            if (req.Method == "GET" && (req.Path == "/api/onair" || req.Path == "/api/files" || req.Path == "/api/sitecheck" || req.Path == "/api/devbattery" || req.Path == "/api/airports"))
            {
                Dictionary<string, object> res;
                if (req.Path == "/api/onair") res = OnAir.State();
                else if (req.Path == "/api/sitecheck") res = SiteCheck.Check(req.Param("url"));
                else
                {
                    res = new Dictionary<string, object>();
                    if (req.Path == "/api/files") res["items"] = RecentFiles.List(req.Param("which") == "recent" ? "recent" : "downloads");
                    else if (req.Path == "/api/devbattery") res["items"] = DeviceBatteries.List();
                    else
                    {
                        var pos = new Dictionary<string, object>();
                        foreach (var kv in Runways.Locate((req.Param("ids") ?? "").Split(','))) pos[kv.Key] = kv.Value;
                        res["airports"] = pos;
                    }
                }
                var copy = new Dictionary<string, object>(res);
                copy["ok"] = true;
                SendJson(stream, 200, copy, allow);
                return;
            }

            // ---- Round 8C
            if (req.Method == "GET" && (req.Path == "/api/tracks" || req.Path == "/api/track" || req.Path == "/api/programs" || req.Path == "/api/steamdl"))
            {
                var res = new Dictionary<string, object>();
                res["ok"] = true;
                if (req.Path == "/api/tracks") res["items"] = Sim.TrackList();
                else if (req.Path == "/api/programs") res["items"] = GameClean.Programs();
                else if (req.Path == "/api/steamdl") res["items"] = Steam.Downloads();
                else
                {
                    var pts = Sim.TrackData(req.Param("id"));
                    res["ok"] = pts != null;
                    res["points"] = pts ?? new List<double[]>();
                }
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Method == "GET" && req.Path == "/api/scenery")
            {
                var res = Scenery.List(req.Param("fresh") == "1");
                var copy = new Dictionary<string, object>(res);
                copy["ok"] = true;
                SendJson(stream, 200, copy, allow);
                return;
            }

            // ---- Round 8B
            if (req.Method == "GET" && (req.Path == "/api/discord/guilds" || req.Path == "/api/discord/channels"))
            {
                var list = req.Path == "/api/discord/guilds" ? DiscordLink.Guilds() : DiscordLink.VoiceChannels(req.Param("guild"));
                var res = new Dictionary<string, object>();
                res["ok"] = list != null;
                res["items"] = list ?? new List<Dictionary<string, object>>();
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Method == "GET" && (req.Path == "/api/spotify/search" || req.Path == "/api/spotify/recent" || req.Path == "/api/mictest"))
            {
                Dictionary<string, object> res;
                if (req.Path == "/api/spotify/search") res = Spotify.Search(req.Param("q"));
                else if (req.Path == "/api/mictest") res = MicTest.State();
                else { res = new Dictionary<string, object>(); res["items"] = Spotify.Recent(); res["missing"] = Spotify.Missing(); }
                res["ok"] = true;
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Method == "POST" && req.Path == "/api/spotify/save")
            {
                if (req.Header("X-Control-Panel") != "1") { SendJson(stream, 403, Err("missing header"), allow); return; }
                Dictionary<string, object> b;
                try { b = Json.Deserialize<Dictionary<string, object>>(req.Body ?? "{}") ?? new Dictionary<string, object>(); }
                catch { SendJson(stream, 400, Err("bad json"), allow); return; }
                string problem = Spotify.Save(Str(b, "playlist"), Str(b, "track"));
                var res = new Dictionary<string, object>();
                res["ok"] = problem == null;
                if (problem != null) res["error"] = problem;
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Method == "GET" && req.Path == "/spotify/callback")
            {
                string problem = Spotify.Callback(req.Param("code"), req.Param("state"), req.Param("error"));
                string html = "<!doctype html><meta charset=utf-8><title>Control Panel</title><body style=\"font-family:Segoe UI,sans-serif;background:#0f1d2e;color:#eef1f5;display:grid;place-items:center;height:100vh;margin:0\"><div style=\"text-align:center\"><h1>" +
                    (problem == null ? "Spotify is connected" : "Spotify isn't connected") + "</h1><p>" + System.Net.WebUtility.HtmlEncode(problem ?? "You can close this tab. Your Spotify tile fills in by itself.") + "</p></div>";
                Send(stream, 200, "text/html; charset=utf-8", Encoding.UTF8.GetBytes(html), null, null);
                return;
            }

            if (req.Method == "GET" && req.Path == "/api/pagecmd")
            {
                long since;
                if (!long.TryParse(req.Param("since") ?? "-1", out since)) since = -1;
                var res = PageKeys.Wait(since);
                res["ok"] = true;
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Method == "GET" && (req.Path == "/api/windowlist" || req.Path == "/api/appout" || req.Path == "/api/steam" || req.Path == "/api/spotify/playlists" || req.Path == "/api/spotify/queue"))
            {
                var res = new Dictionary<string, object>();
                res["ok"] = true;
                if (req.Path == "/api/windowlist") res["windows"] = WindowList.List();
                else if (req.Path == "/api/appout") res["apps"] = AppOutput.Apps();
                else if (req.Path == "/api/steam") { var g = Steam.Games(); res["games"] = g.Count > 60 ? g.GetRange(0, 60) : g; res["hasKey"] = !string.IsNullOrEmpty(Settings.Current.SteamKey); var f = Steam.Friends(); if (f != null) res["friends"] = f; }
                else if (req.Path == "/api/spotify/playlists") res["playlists"] = Spotify.Playlists();
                else res["queue"] = Spotify.Queue();
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Method == "GET" && (req.Path == "/api/micpeak" || req.Path == "/api/spotify" || req.Path == "/api/twitch"))
            {
                var res = req.Path == "/api/micpeak" ? MicMeter.Peak(req.Param("device")) : req.Path == "/api/spotify" ? Spotify.State() : Twitch.State();
                res["ok"] = true;
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Method == "GET" && req.Path == "/api/si")
            {
                var res = SayIntentions.State();
                res["ok"] = true;
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Method == "GET" && (req.Path == "/api/si/freqs" || req.Path == "/api/si/parking"))
            {
                var data = req.Path == "/api/si/freqs" ? SayIntentions.Frequencies() : SayIntentions.Parking();
                var res = data ?? new Dictionary<string, object>();
                res["ok"] = data != null;
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Method == "GET" && req.Path == "/api/flightlog")
            {
                var res = new Dictionary<string, object>();
                res["ok"] = true; res["flights"] = Sim.ReadLog();
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Method == "GET" && req.Path == "/api/freqs")
            {
                var res = new Dictionary<string, object>();
                res["ok"] = true; res["freqs"] = Freqs.For(req.Param("icao"));
                if (req.Param("runways") == "1") res["runways"] = Runways.For(req.Param("icao"));
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Method == "GET" && req.Path == "/api/calendars")
            {
                var res = new Dictionary<string, object>();
                res["ok"] = true; res["calendars"] = Calendars.Get();
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Method == "GET" && req.Path == "/api/screens")
            {
                var res = new Dictionary<string, object>();
                res["ok"] = true; res["screens"] = Screens.List(12);
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Method == "GET" && req.Path == "/api/screen")
            {
                var jpg = Screens.Thumb(req.Param("id"));
                if (jpg == null) { Send(stream, 404, "text/plain", null, allow, null); return; }
                Send(stream, 200, "image/jpeg", jpg, allow, null);
                return;
            }

            if (req.Method == "GET" && req.Path == "/api/windows")
            {
                var res = new Dictionary<string, object>();
                res["ok"] = true; res["windows"] = Running.Windows();
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Method == "GET" && req.Path == "/api/backups")
            {
                var res = new Dictionary<string, object>();
                res["ok"] = true; res["backups"] = Backups.List();
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Method == "GET" && req.Path == "/api/backup")
            {
                string layout = Backups.Read(req.Param("name"));
                if (layout == null) { SendJson(stream, 404, Err("not found"), allow); return; }
                var res = new Dictionary<string, object>();
                res["ok"] = true; res["layout"] = layout;
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Method == "POST" && req.Path == "/api/backup")
            {
                if (req.Header("X-Control-Panel") != "1") { SendJson(stream, 403, Err("missing header"), allow); return; }
                string name = null;
                try
                {
                    var body = ParseJson(req.Body ?? "{}");
                    if (body != null) name = Backups.Save(Str(body, "kind"), Str(body, "layout"), Int(body, "pages"), Int(body, "tiles"));
                }
                catch (Exception ex) { Log.Write("Backup: " + ex.Message); }
                var res = new Dictionary<string, object>();
                res["ok"] = name != null;
                if (name != null) res["name"] = name;
                SendJson(stream, name != null ? 200 : 400, res, allow);
                return;
            }

            if (req.Method == "GET" && req.Path == "/api/apps")
            {
                var list = Apps.GetAll(req.Param("refresh") == "1");
                var outList = new List<Dictionary<string, object>>();
                foreach (var a in list)
                {
                    var d = new Dictionary<string, object>();
                    d["id"] = a.Id; d["name"] = a.Name; d["kind"] = a.Kind;
                    if (a.Icon != null) d["icon"] = a.Icon;
                    if (a.Domain != null) d["domain"] = a.Domain;
                    outList.Add(d);
                }
                var res = new Dictionary<string, object>();
                res["ok"] = true; res["apps"] = outList;
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Method == "GET" && req.Path == "/api/pictures")
            {
                var res = new Dictionary<string, object>();
                res["ok"] = true; res["pictures"] = Pictures.List();
                SendJson(stream, 200, res, allow);
                return;
            }

            if (req.Method == "GET" && req.Path == "/api/picture")
            {
                string type;
                var bytes = Pictures.Read(req.Param("name"), out type);
                if (bytes == null) { Send(stream, 404, "text/plain", null, allow, null); return; }
                Send(stream, 200, type, bytes, allow, null);
                return;
            }

            if (req.Method == "GET" && req.Path == "/api/icon")
            {
                var png = Icons.GetPng(req.Param("id"));
                if (png == null) { Send(stream, 404, "text/plain", null, allow, null); return; }
                Send(stream, 200, "image/png", png, allow, null);
                return;
            }

            if (req.Method == "POST" && req.Path == "/api/action")
            {
                if (req.Header("X-Control-Panel") != "1") { SendJson(stream, 403, Err("missing header"), allow); return; }
                Dictionary<string, object> body;
                try { body = Json.Deserialize<Dictionary<string, object>>(req.Body ?? "{}") ?? new Dictionary<string, object>(); }
                catch { SendJson(stream, 400, Err("bad json"), allow); return; }
                bool ok;
                try { ok = Act(body); }
                catch (Exception ex) { Log.Write("Action: " + ex.Message); ok = false; }
                var res = new Dictionary<string, object>();
                res["ok"] = ok;
                SendJson(stream, ok ? 200 : 400, res, allow);
                return;
            }

            SendJson(stream, 404, Err("not found"), allow);
        }

        public static string JsonString(string s) { return Json.Serialize(s); }
        public static Dictionary<string, object> ParseJson(string s) { return Json.Deserialize<Dictionary<string, object>>(s); }

        static Dictionary<string, object> Err(string msg)
        {
            var d = new Dictionary<string, object>();
            d["ok"] = false; d["error"] = msg;
            return d;
        }

        static string Str(Dictionary<string, object> d, string k) { object v; return d.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : null; }
        static int Int(Dictionary<string, object> d, string k) { object v; return d.TryGetValue(k, out v) && v != null ? Convert.ToInt32(Convert.ToDouble(v)) : 0; }
        static bool Bool(Dictionary<string, object> d, string k) { object v; return d.TryGetValue(k, out v) && v is bool && (bool)v; }

        static bool Act(Dictionary<string, object> b)
        {
            GameFocus.Acting(Str(b, "action"));
            switch (Str(b, "action"))
            {
                case "speakersVolume": Audio.SetVolume(false, Str(b, "device"), Int(b, "value")); return true;
                case "speakersMute": Audio.SetMute(false, Str(b, "device"), Bool(b, "value")); return true;
                case "micVolume": Audio.SetVolume(true, Str(b, "device"), Int(b, "value")); return true;
                case "micMute": Audio.SetMute(true, Str(b, "device"), Bool(b, "value")); return true;
                case "appVolume": Audio.SetApp(Str(b, "key"), Int(b, "value"), null); return true;
                case "appMute": Audio.SetApp(Str(b, "key"), null, Bool(b, "value")); return true;
                case "setDefaultDevice": return Audio.SetDefault(Bool(b, "mic"), Str(b, "device"));
                case "keys": return Keys.Press(Str(b, "combo"));
                case "powerPlan": return PowerPlans.Set(Str(b, "plan"));
                case "launch": return Apps.Launch(Str(b, "id"));
                case "openUrl": return Apps.OpenUrl(Str(b, "url"));
                case "quick": return Power.Quick(Str(b, "what"));
                case "power": return Power.Run(Str(b, "what"));
                case "keepAwake": KeepAwake.Set(Bool(b, "value")); return true;
                case "gameFocus": GameFocus.Set(Bool(b, "value")); return true;
                case "speedTest": return SpeedTest.Start();
                case "closeApp": return TopApps.Close(Str(b, "exe"), Bool(b, "force"));
                case "brightness": return Brightness.Set(Int(b, "monitor"), Int(b, "value"));
                case "openScreen": return Screens.Open(Str(b, "id"));
                case "sim": return Sim.Do(Str(b, "what"), Int(b, "value"));
                case "siSay": return SayIntentions.Say(Str(b, "channel"), Str(b, "message"));
                case "winFocus": return WindowList.Focus(Str(b, "id"));
                case "winClose": return WindowList.Close(Str(b, "id"));
                case "appOut": return AppOutput.Set(Str(b, "key"), Str(b, "device"));
                case "dnd": return Dnd.Set(Bool(b, "on"));
                case "cleanup": return Cleanup.Run();
                case "steamRun": return Steam.Run(Str(b, "id"));
                case "spotify": return Spotify.Do(Str(b, "what"), Str(b, "uri"), Int(b, "value"));
                case "siFreq":
                    {
                        double mhz;
                        if (!double.TryParse(Str(b, "freq"), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out mhz)) return false;
                        return SayIntentions.SetFreq(mhz, Int(b, "com"), Str(b, "mode"));
                    }
                case "siGate": return SayIntentions.AssignGate(Str(b, "gate"), Str(b, "airport"));
                case "simPlan":
                    {
                        var plan = new Dictionary<string, object>();
                        plan["from"] = Str(b, "from"); plan["to"] = Str(b, "to"); plan["flight"] = Str(b, "flight");
                        Sim.Plan = plan;
                        return true;
                    }
                case "discord":
                    switch (Str(b, "what"))
                    {
                        case "mute": return b.ContainsKey("value") ? DiscordLink.SetMute(Bool(b, "value")) : DiscordLink.Toggle("mute");
                        case "deaf": return b.ContainsKey("value") ? DiscordLink.SetDeaf(Bool(b, "value")) : DiscordLink.Toggle("deaf");
                        case "leave": return DiscordLink.Leave();
                        case "join": return DiscordLink.Join(Str(b, "channel"));
                        case "user":
                            return DiscordLink.SetUser(Str(b, "id"),
                                b.ContainsKey("volume") ? (int?)Int(b, "volume") : null,
                                b.ContainsKey("mute") ? (bool?)Bool(b, "mute") : null);
                        default: return false;
                    }
                case "screensFolder": return Screens.OpenFolder();
                case "clipboard": ClipHistory.SetOn(Bool(b, "on")); return true;
                case "clipCopy": return ClipHistory.Copy(Int(b, "index"));
                case "clipClear": ClipHistory.Clear(); return true;
                case "notifOpen": return Notifs.OpenApp(Str(b, "key"));
                case "cs2Setup": return Cs2.Install();
                case "cs2Remove": Cs2.Remove(); return true;
                case "hold": return Keys.Hold(Str(b, "combo"), Bool(b, "down"));
                case "gameClose": { object a; b.TryGetValue("apps", out a); GameClean.Close(a as System.Collections.IEnumerable); return true; }
                case "gameReopen": GameClean.Reopen(); return true;
                case "steamDownloads": return Steam.OpenDownloads();
                case "fileOpen": return RecentFiles.Open(Str(b, "id"), Bool(b, "reveal"));
                case "downloadsFolder": return RecentFiles.OpenDownloadsFolder();
                case "copyText": return ClipHistory.SetText(Str(b, "text"));
                case "openSettings": return Apps.OpenSettings(Str(b, "page"));
                case "micTest":
                    if (Bool(b, "stop")) { MicTest.Cancel(); return true; }
                    return MicTest.Start(Int(b, "secs"));
                default: return false;
            }
        }

        /// <summary>Only the parts the widget's visible tiles need are measured.</summary>
        static Dictionary<string, object> State(string parts, string watch, string pingTarget)
        {
            var want = new HashSet<string>(parts.Split(','), StringComparer.OrdinalIgnoreCase);
            var s = new Dictionary<string, object>();
            s["ok"] = true;
            s["app"] = "control-panel-helper";
            s["version"] = Program.Version;
            s["keepAwake"] = KeepAwake.On;
            s["gameFocus"] = GameFocus.On;
            s["powerPlan"] = PowerPlans.Current();
            if (want.Contains("audio"))
            {
                // Every active device, so each tile can follow the one you picked.
                var outs = Audio.List(false);
                var ins = Audio.List(true);
                var outList = new List<Dictionary<string, object>>();
                var inList = new List<Dictionary<string, object>>();
                foreach (var e in outs) outList.Add(Endpoint(e));
                foreach (var e in ins) inList.Add(Endpoint(e));
                s["outputs"] = outList;
                s["inputs"] = inList;
                s["speakers"] = outs.Count > 0 ? Endpoint(outs[0]) : Endpoint(new EndpointState());
                s["mic"] = ins.Count > 0 ? Endpoint(ins[0]) : Endpoint(new EndpointState());
            }
            if (want.Contains("mixer"))
            {
                var list = new List<Dictionary<string, object>>();
                foreach (var a in Audio.GetApps())
                {
                    var d = new Dictionary<string, object>();
                    d["key"] = a.Key; d["name"] = a.Name; d["volume"] = a.Volume; d["muted"] = a.Muted;
                    if (a.Icon != null) d["icon"] = a.Icon;
                    list.Add(d);
                }
                s["mixer"] = list;
            }
            if (want.Contains("system"))
            {
                s["cpu"] = SystemInfo.CpuLoad();
                s["memory"] = SystemInfo.Memory();
            }
            if (want.Contains("network")) s["network"] = SystemInfo.Network();
            if (want.Contains("storage")) s["storage"] = SystemInfo.Drives();
            if (want.Contains("running")) s["running"] = Running.Which(watch);
            if (want.Contains("ping")) s["ping"] = Pinger.Run(pingTarget);
            if (want.Contains("speedtest")) s["speedtest"] = SpeedTest.State();
            if (want.Contains("foreground")) s["foreground"] = Foreground.Get();
            if (want.Contains("top")) s["top"] = TopApps.Get();
            if (want.Contains("uptime")) s["uptime"] = Uptime.Seconds();
            if (want.Contains("disk")) s["disk"] = DiskActivity.Get();
            if (want.Contains("brightness")) s["monitors"] = Brightness.Get();
            if (want.Contains("sim")) s["sim"] = Sim.State();
            if (want.Contains("traffic")) s["traffic"] = Sim.Traffic();
            if (want.Contains("dnd")) s["dnd"] = Dnd.On;
            if (want.Contains("cleanup")) s["cleanup"] = Cleanup.State();
            if (want.Contains("clipboard"))
            {
                var c = new Dictionary<string, object>();
                c["on"] = ClipHistory.On;
                c["items"] = ClipHistory.Items();
                s["clipboard"] = c;
            }
            return s;
        }

        static Dictionary<string, object> Endpoint(EndpointState e)
        {
            var d = new Dictionary<string, object>();
            d["available"] = e.Available; d["volume"] = e.Volume; d["muted"] = e.Muted;
            d["id"] = e.Id; d["name"] = e.Name; d["isDefault"] = e.IsDefault;
            return d;
        }
    }
}
