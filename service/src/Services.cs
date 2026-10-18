using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace ControlPanelHelper
{
    /// <summary>Small helpers shared by the Spotify and Twitch connections.</summary>
    static class Http
    {
        public static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };

        public static string Protect(string s)
        {
            if (string.IsNullOrEmpty(s)) return null;
            return Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(s), null, DataProtectionScope.CurrentUser));
        }

        public static string Unprotect(string s)
        {
            if (string.IsNullOrEmpty(s)) return null;
            try { return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(s), null, DataProtectionScope.CurrentUser)); }
            catch { return null; }
        }

        /// <summary>Returns (status, body). Status 0 = no connection.</summary>
        public static KeyValuePair<int, string> Send(string method, string url, string body, string contentType, Dictionary<string, string> headers)
        {
            try
            {
                ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072;
                var r = (HttpWebRequest)WebRequest.Create(url);
                r.Method = method;
                r.Timeout = 10000;
                r.ReadWriteTimeout = 10000;
                r.UserAgent = "ControlHubService/" + Program.Version;
                if (headers != null) foreach (var h in headers) r.Headers[h.Key] = h.Value;
                if (body != null || method == "PUT" || method == "POST" || method == "DELETE")
                {
                    var bytes = Encoding.UTF8.GetBytes(body ?? "");
                    if (body != null) r.ContentType = contentType ?? "application/json";
                    r.ContentLength = bytes.Length;
                    if (bytes.Length > 0) using (var s = r.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
                }
                using (var res = (HttpWebResponse)r.GetResponse())
                using (var sr = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                    return new KeyValuePair<int, string>((int)res.StatusCode, sr.ReadToEnd());
            }
            catch (WebException ex)
            {
                var res = ex.Response as HttpWebResponse;
                if (res == null) return new KeyValuePair<int, string>(0, ex.Message);
                string text = "";
                try { using (var sr = new StreamReader(res.GetResponseStream())) text = sr.ReadToEnd(); } catch { }
                return new KeyValuePair<int, string>((int)res.StatusCode, text);
            }
            catch (Exception ex) { return new KeyValuePair<int, string>(0, ex.Message); }
        }

        public static string Form(params string[] kv)
        {
            var sb = new StringBuilder();
            for (int i = 0; i + 1 < kv.Length; i += 2)
            {
                if (sb.Length > 0) sb.Append('&');
                sb.Append(Uri.EscapeDataString(kv[i])).Append('=').Append(Uri.EscapeDataString(kv[i + 1] ?? ""));
            }
            return sb.ToString();
        }

        public static Dictionary<string, object> Parse(string s)
        {
            try { return Json.Deserialize<Dictionary<string, object>>(s); } catch { return null; }
        }

        public static string Str(Dictionary<string, object> d, string k)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : null;
        }

        public static string RandomText(int n)
        {
            const string chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
            var b = new byte[n];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(b);
            var sb = new StringBuilder();
            foreach (var x in b) sb.Append(chars[x % chars.Length]);
            return sb.ToString();
        }

        public static void Open(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch (Exception ex) { Log.Write("Open browser: " + ex.Message); }
        }
    }

    // ======================================================================= Spotify
    /// <summary>
    /// Spotify Web API with your own (free) Spotify developer app. Login happens once in your browser;
    /// the login is kept encrypted for your Windows user. Changing what plays needs Spotify Premium (Spotify's rule).
    /// </summary>
    static partial class Spotify
    {
        static readonly object Gate = new object();
        static string verifier, state;
        static Dictionary<string, object> player, queue;
        static DateTime playerAt = DateTime.MinValue, queueAt = DateTime.MinValue;
        static List<Dictionary<string, object>> playlists;
        static DateTime playlistsAt = DateTime.MinValue;
        static string likedFor; static bool liked;
        public static string LastError;

        public static string Redirect { get { return "http://127.0.0.1:" + Settings.Current.Port + "/spotify/callback"; } }
        public static bool Configured { get { return !string.IsNullOrEmpty(Settings.Current.SpotifyClientId); } }
        public static bool Connected { get { return Configured && !string.IsNullOrEmpty(Settings.Current.SpotifyRefresh); } }

        public static void Connect(string clientId)
        {
            Settings.Current.SpotifyClientId = clientId.Trim();
            Settings.Current.SpotifyRefresh = null;
            Settings.Current.SpotifyAccess = null;
            Settings.Save();
            verifier = Http.RandomText(64);
            state = Http.RandomText(16);
            string challenge;
            using (var sha = SHA256.Create())
                challenge = Convert.ToBase64String(sha.ComputeHash(Encoding.ASCII.GetBytes(verifier))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
            string scopes = "user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative user-library-read user-library-modify user-read-recently-played playlist-modify-public playlist-modify-private";
            Http.Open("https://accounts.spotify.com/authorize?" + Http.Form("client_id", clientId.Trim(), "response_type", "code", "redirect_uri", Redirect,
                "code_challenge_method", "S256", "code_challenge", challenge, "scope", scopes, "state", state));
        }

        /// <summary>Spotify sends your browser back here after you click Agree.</summary>
        public static string Callback(string code, string st, string error)
        {
            if (!string.IsNullOrEmpty(error)) return "Spotify said: " + error;
            if (string.IsNullOrEmpty(code) || st != state || verifier == null) return "This login link is old. Start again from Control Hub → Connections → Spotify";
            var r = Http.Send("POST", "https://accounts.spotify.com/api/token", Http.Form("grant_type", "authorization_code", "code", code, "redirect_uri", Redirect,
                "client_id", Settings.Current.SpotifyClientId, "code_verifier", verifier), "application/x-www-form-urlencoded", null);
            if (!SaveTokens(r)) return "Couldn't log in to Spotify (" + r.Key + "). Check the Client ID and the Redirect URI " + Redirect;
            verifier = null;
            Log.Write("Spotify connected");
            return null;
        }

        static bool SaveTokens(KeyValuePair<int, string> r)
        {
            var d = r.Key == 200 ? Http.Parse(r.Value) : null;
            string access = Http.Str(d, "access_token");
            if (access == null) { Log.Write("Spotify token: " + r.Key + " " + r.Value); return false; }
            Settings.Current.SpotifyAccess = Http.Protect(access);
            string refresh = Http.Str(d, "refresh_token");
            if (refresh != null) Settings.Current.SpotifyRefresh = Http.Protect(refresh);
            string granted = Http.Str(d, "scope");
            if (!string.IsNullOrEmpty(granted)) Settings.Current.SpotifyScopes = granted;
            double exp; double.TryParse(Http.Str(d, "expires_in") ?? "3600", out exp);
            Settings.Current.SpotifyExpires = DateTime.UtcNow.AddSeconds(exp - 60).Ticks;
            Settings.Save();
            return true;
        }

        static string Token()
        {
            if (!Connected) return null;
            if (DateTime.UtcNow.Ticks < Settings.Current.SpotifyExpires) return Http.Unprotect(Settings.Current.SpotifyAccess);
            var r = Http.Send("POST", "https://accounts.spotify.com/api/token", Http.Form("grant_type", "refresh_token",
                "refresh_token", Http.Unprotect(Settings.Current.SpotifyRefresh), "client_id", Settings.Current.SpotifyClientId), "application/x-www-form-urlencoded", null);
            if (!SaveTokens(r)) { LastError = "Spotify login expired. Connect Spotify again in Control Hub → Connections."; if (r.Key == 400) Settings.Current.SpotifyRefresh = null; return null; }
            return Http.Unprotect(Settings.Current.SpotifyAccess);
        }

        static KeyValuePair<int, string> Api(string method, string path, string body)
        {
            string t = Token();
            if (t == null) return new KeyValuePair<int, string>(401, "");
            var h = new Dictionary<string, string>();
            h["Authorization"] = "Bearer " + t;
            var r = Http.Send(method, "https://api.spotify.com/v1" + path, body, "application/json", h);
            if (r.Key == 403 && r.Value.Contains("PREMIUM")) LastError = "Spotify only lets Premium accounts control playback from other apps";
            else if (r.Key >= 200 && r.Key < 300) LastError = null;
            return r;
        }

        public static Dictionary<string, object> State()
        {
            var d = new Dictionary<string, object>();
            d["configured"] = Configured;
            d["connected"] = Connected;
            d["redirect"] = Redirect;
            d["starting"] = Starting;
            if (!Connected) return d;
            d["missing"] = Missing();
            lock (Gate)
            {
                if ((DateTime.UtcNow - playerAt).TotalSeconds >= 2)
                {
                    playerAt = DateTime.UtcNow;
                    var r = Api("GET", "/me/player?additional_types=episode", null);
                    player = r.Key == 200 ? Http.Parse(r.Value) : r.Key == 204 ? new Dictionary<string, object>() : player;
                }
                if (player != null && player.Count > 0)
                {
                    var item = player.ContainsKey("item") ? player["item"] as Dictionary<string, object> : null;
                    var p = new Dictionary<string, object>();
                    p["playing"] = player.ContainsKey("is_playing") && player["is_playing"] is bool && (bool)player["is_playing"];
                    p["shuffle"] = player.ContainsKey("shuffle_state") && player["shuffle_state"] is bool && (bool)player["shuffle_state"];
                    p["repeat"] = Http.Str(player, "repeat_state") ?? "off";
                    p["progress"] = player.ContainsKey("progress_ms") ? player["progress_ms"] : 0;
                    var dev = player.ContainsKey("device") ? player["device"] as Dictionary<string, object> : null;
                    if (dev != null) { p["device"] = Http.Str(dev, "name"); p["volume"] = dev.ContainsKey("volume_percent") ? dev["volume_percent"] : null; }
                    if (item != null)
                    {
                        p["id"] = Http.Str(item, "id");
                        p["title"] = Http.Str(item, "name");
                        p["duration"] = item.ContainsKey("duration_ms") ? item["duration_ms"] : 0;
                        var artists = new List<string>();
                        if (item.ContainsKey("artists")) foreach (var a in (IEnumerable)item["artists"]) { var ad = a as Dictionary<string, object>; if (ad != null) artists.Add(Http.Str(ad, "name")); }
                        p["artist"] = string.Join(", ", artists.ToArray());
                        var album = item.ContainsKey("album") ? item["album"] as Dictionary<string, object> : null;
                        p["image"] = BestImage(album);
                        string id = Http.Str(item, "id");
                        if (id != null && id != likedFor)
                        {
                            likedFor = id;
                            var lr = Api("GET", "/me/library/contains?uris=" + Uri.EscapeDataString("spotify:track:" + id), null);
                            if (lr.Key == 404 || lr.Key == 410) lr = Api("GET", "/me/tracks/contains?ids=" + Uri.EscapeDataString(id), null);
                            liked = lr.Key == 200 && lr.Value.Contains("true");
                        }
                        p["liked"] = liked;
                    }
                    d["player"] = p;
                }
            }
            if (LastError != null) d["error"] = LastError;
            return d;
        }

        static string BestImage(Dictionary<string, object> o)
        {
            if (o == null || !o.ContainsKey("images")) return null;
            string best = null;
            foreach (var x in (IEnumerable)o["images"])
            {
                var im = x as Dictionary<string, object>;
                if (im == null) continue;
                best = Http.Str(im, "url");
                int w; int.TryParse(Http.Str(im, "width") ?? "0", out w);
                if (w > 0 && w <= 320) break;
            }
            return best;
        }

        public static List<Dictionary<string, object>> Playlists()
        {
            lock (Gate)
            {
                if (playlists != null && (DateTime.UtcNow - playlistsAt).TotalMinutes < 5) return playlists;
                var list = new List<Dictionary<string, object>>();
                var r = Api("GET", "/me/playlists?limit=50", null);
                var d = r.Key == 200 ? Http.Parse(r.Value) : null;
                if (d != null && d.ContainsKey("items"))
                    foreach (var x in (IEnumerable)d["items"])
                    {
                        var p = x as Dictionary<string, object>;
                        if (p == null) continue;
                        var o = new Dictionary<string, object>();
                        o["uri"] = Http.Str(p, "uri"); o["name"] = Http.Str(p, "name"); o["image"] = BestImage(p);
                        // Songs can only be added to your own playlists (or ones shared with you to edit).
                        var owner = p.ContainsKey("owner") ? p["owner"] as Dictionary<string, object> : null;
                        string me = MyId();
                        o["own"] = (owner != null && me != null && Http.Str(owner, "id") == me) || (p.ContainsKey("collaborative") && p["collaborative"] is bool && (bool)p["collaborative"]);
                        list.Add(o);
                    }
                var liked = new Dictionary<string, object>();
                liked["uri"] = "liked"; liked["name"] = "Liked Songs"; liked["image"] = null; liked["own"] = true;
                list.Insert(0, liked);
                playlists = list;
                playlistsAt = DateTime.UtcNow;
                return list;
            }
        }

        public static List<Dictionary<string, object>> Queue()
        {
            lock (Gate)
            {
                if (queue == null || (DateTime.UtcNow - queueAt).TotalSeconds > 10)
                {
                    queueAt = DateTime.UtcNow;
                    var r = Api("GET", "/me/player/queue", null);
                    queue = r.Key == 200 ? Http.Parse(r.Value) : queue;
                }
                var list = new List<Dictionary<string, object>>();
                if (queue != null && queue.ContainsKey("queue"))
                    foreach (var x in (IEnumerable)queue["queue"])
                    {
                        var t = x as Dictionary<string, object>;
                        if (t == null || list.Count >= 10) continue;
                        var o = new Dictionary<string, object>();
                        o["title"] = Http.Str(t, "name");
                        var artists = new List<string>();
                        if (t.ContainsKey("artists")) foreach (var a in (IEnumerable)t["artists"]) { var ad = a as Dictionary<string, object>; if (ad != null) artists.Add(Http.Str(ad, "name")); }
                        o["artist"] = string.Join(", ", artists.ToArray());
                        list.Add(o);
                    }
                return list;
            }
        }

        public static bool Do(string what, string uri, int value)
        {
            if (!Connected) return false;
            KeyValuePair<int, string> r;
            switch (what)
            {
                case "play": r = Api("PUT", "/me/player/play", null); break;
                case "pause": r = Api("PUT", "/me/player/pause", null); break;
                case "next": r = Api("POST", "/me/player/next", null); break;
                case "prev": r = Api("POST", "/me/player/previous", null); break;
                case "shuffle": r = Api("PUT", "/me/player/shuffle?state=" + (value != 0 ? "true" : "false"), null); break;
                case "repeat": r = Api("PUT", "/me/player/repeat?state=" + (value == 2 ? "track" : value == 1 ? "context" : "off"), null); break;
                case "volume": r = Api("PUT", "/me/player/volume?volume_percent=" + Math.Max(0, Math.Min(100, value)), null); break;
                case "like":
                case "unlike":
                    if (string.IsNullOrEmpty(likedFor)) return false;
                    // Spotify moved this in 2026 (/me/library); older setups still answer on /me/tracks.
                    r = Api(what == "like" ? "PUT" : "DELETE", "/me/library?uris=" + Uri.EscapeDataString("spotify:track:" + likedFor), null);
                    if (r.Key == 404 || r.Key == 410) r = Api(what == "like" ? "PUT" : "DELETE", "/me/tracks?ids=" + Uri.EscapeDataString(likedFor), null);
                    if (r.Key < 300) liked = what == "like";
                    break;
                case "playlist":
                    if (string.IsNullOrEmpty(uri)) return false;
                    if (uri == "liked")
                    {
                        // "Liked Songs" can't be started as a list through the API: play your newest liked songs instead.
                        var lr = Api("GET", "/me/tracks?limit=50", null);
                        var ld = lr.Key == 200 ? Http.Parse(lr.Value) : null;
                        var uris = new List<string>();
                        if (ld != null && ld.ContainsKey("items"))
                            foreach (var x in (IEnumerable)ld["items"]) { var it = x as Dictionary<string, object>; var tr = it == null ? null : it["track"] as Dictionary<string, object>; if (tr != null) uris.Add(Http.Str(tr, "uri")); }
                        r = Api("PUT", "/me/player/play", Http.Json.Serialize(new Dictionary<string, object> { { "uris", uris } }));
                    }
                    else
                    {
                        if (!uri.StartsWith("spotify:")) return false;
                        r = Api("PUT", "/me/player/play", Http.Json.Serialize(new Dictionary<string, object> { { "context_uri", uri } }));
                    }
                    break;
                case "uri":
                    // Play a song now, or start an album / playlist / artist.
                    if (!ValidUri(uri)) return false;
                    if (uri.StartsWith("spotify:track:") || uri.StartsWith("spotify:episode:"))
                        r = Api("PUT", "/me/player/play", Http.Json.Serialize(new Dictionary<string, object> { { "uris", new[] { uri } } }));
                    else
                        r = Api("PUT", "/me/player/play", Http.Json.Serialize(new Dictionary<string, object> { { "context_uri", uri } }));
                    break;
                case "queue":
                    if (!ValidUri(uri) || !(uri.StartsWith("spotify:track:") || uri.StartsWith("spotify:episode:"))) return false;
                    r = Api("POST", "/me/player/queue?uri=" + Uri.EscapeDataString(uri), null);
                    break;
                case "seek": r = Api("PUT", "/me/player/seek?position_ms=" + Math.Max(0, value), null); break;
                default: return false;
            }
            // Nothing to play on (the Spotify app is closed or not the active device): start it and play there.
            if (r.Key == 404 && WantsDevice(what) && StartInBackground(what, uri, value)) return true;
            lock (Gate) { playerAt = DateTime.MinValue; queueAt = DateTime.MinValue; recentAt = DateTime.MinValue; }
            if (r.Key >= 300) Log.Write("Spotify " + what + ": " + r.Key + " " + (r.Value.Length > 200 ? r.Value.Substring(0, 200) : r.Value));
            return r.Key >= 200 && r.Key < 300;
        }
    }

    // ======================================================================= Spotify (Round 8B: search, recently played, save to a playlist)
    static partial class Spotify
    {
        static string myId;
        static List<Dictionary<string, object>> recent;
        static DateTime recentAt = DateTime.MinValue;
        static readonly System.Text.RegularExpressions.Regex UriRx = new System.Text.RegularExpressions.Regex("^spotify:(track|album|playlist|artist|episode|show):[A-Za-z0-9]{10,40}$");

        static bool ValidUri(string uri) { return !string.IsNullOrEmpty(uri) && UriRx.IsMatch(uri); }

        /// <summary>Features that need a new login because they were added after you connected.</summary>
        public static List<string> Missing()
        {
            var m = new List<string>();
            string sc = Settings.Current.SpotifyScopes ?? "";
            if (sc.IndexOf("user-read-recently-played", StringComparison.Ordinal) < 0) m.Add("recent");
            if (sc.IndexOf("playlist-modify-p", StringComparison.Ordinal) < 0) m.Add("save");
            return m;
        }

        static string MyId()
        {
            if (myId != null) return myId;
            var r = Api("GET", "/me", null);
            if (r.Key == 200) myId = Http.Str(Http.Parse(r.Value), "id");
            return myId;
        }

        static Dictionary<string, object> Item(Dictionary<string, object> t)
        {
            if (t == null) return null;
            var o = new Dictionary<string, object>();
            o["uri"] = Http.Str(t, "uri");
            o["title"] = Http.Str(t, "name");
            string type = Http.Str(t, "type");
            o["type"] = type;
            var artists = new List<string>();
            if (t.ContainsKey("artists") && t["artists"] is IEnumerable)
                foreach (var a in (IEnumerable)t["artists"]) { var ad = a as Dictionary<string, object>; if (ad != null) artists.Add(Http.Str(ad, "name")); }
            if (type == "playlist")
            {
                var owner = t.ContainsKey("owner") ? t["owner"] as Dictionary<string, object> : null;
                if (owner != null) artists.Add(Http.Str(owner, "display_name") ?? "");
            }
            o["artist"] = string.Join(", ", artists.ToArray());
            var album = t.ContainsKey("album") ? t["album"] as Dictionary<string, object> : null;
            o["image"] = BestImage(album ?? t);
            if (t.ContainsKey("duration_ms")) o["ms"] = t["duration_ms"];
            return o;
        }

        static List<Dictionary<string, object>> Items(Dictionary<string, object> d, string key)
        {
            var list = new List<Dictionary<string, object>>();
            var box = d != null && d.ContainsKey(key) ? d[key] as Dictionary<string, object> : null;
            if (box == null || !box.ContainsKey("items") || !(box["items"] is IEnumerable)) return list;
            foreach (var x in (IEnumerable)box["items"])
            {
                var o = Item(x as Dictionary<string, object>);  // Spotify sometimes sends empty (null) entries
                if (o != null && o["uri"] != null) list.Add(o);
            }
            return list;
        }

        /// <summary>Songs, artists, albums and playlists for a search.</summary>
        public static Dictionary<string, object> Search(string q)
        {
            var res = new Dictionary<string, object>();
            q = (q ?? "").Trim();
            if (!Connected || q.Length == 0 || q.Length > 100) return res;
            var r = Api("GET", "/search?type=track,artist,album,playlist&limit=8&q=" + Uri.EscapeDataString(q), null);
            if (r.Key != 200) { res["error"] = LastError ?? ("Spotify answered " + r.Key); return res; }
            var d = Http.Parse(r.Value);
            res["tracks"] = Items(d, "tracks");
            res["artists"] = Items(d, "artists");
            res["albums"] = Items(d, "albums");
            res["playlists"] = Items(d, "playlists");
            return res;
        }

        /// <summary>What you played lately (newest first, each song once).</summary>
        public static List<Dictionary<string, object>> Recent()
        {
            lock (Gate)
            {
                if (recent != null && (DateTime.UtcNow - recentAt).TotalSeconds < 30) return recent;
                var list = new List<Dictionary<string, object>>();
                var r = Api("GET", "/me/player/recently-played?limit=40", null);
                if (r.Key != 200) { recentAt = DateTime.UtcNow; return recent ?? list; }
                var d = Http.Parse(r.Value);
                var seen = new HashSet<string>();
                if (d != null && d.ContainsKey("items") && d["items"] is IEnumerable)
                    foreach (var x in (IEnumerable)d["items"])
                    {
                        var it = x as Dictionary<string, object>;
                        var o = Item(it == null || !it.ContainsKey("track") ? null : it["track"] as Dictionary<string, object>);
                        if (o == null || o["uri"] == null || !seen.Add((string)o["uri"])) continue;
                        o["at"] = Http.Str(it, "played_at");
                        list.Add(o);
                        if (list.Count >= 25) break;
                    }
                recent = list;
                recentAt = DateTime.UtcNow;
                return list;
            }
        }

        /// <summary>Adds the song that's playing (or the given song) to one of your playlists.</summary>
        public static string Save(string playlist, string track)
        {
            if (!Connected) return "Spotify isn't connected";
            if (string.IsNullOrEmpty(track))
            {
                string id;
                lock (Gate) id = likedFor;
                if (string.IsNullOrEmpty(id)) return "Nothing is playing";
                track = "spotify:track:" + id;
            }
            if (!ValidUri(track) || !track.StartsWith("spotify:track:")) return "That isn't a song";
            KeyValuePair<int, string> r;
            if (playlist == "liked")
            {
                r = Api("PUT", "/me/library?uris=" + Uri.EscapeDataString(track), null);
                if (r.Key == 404 || r.Key == 410) r = Api("PUT", "/me/tracks?ids=" + Uri.EscapeDataString(track.Substring(14)), null);
                lock (Gate) if (track == "spotify:track:" + likedFor && r.Key < 300) liked = true;
            }
            else
            {
                if (!ValidUri(playlist) || !playlist.StartsWith("spotify:playlist:")) return "Pick one of your playlists";
                string pid = playlist.Substring(17);
                string body = Http.Json.Serialize(new Dictionary<string, object> { { "uris", new[] { track } } });
                r = Api("POST", "/playlists/" + pid + "/items", body);
                if (r.Key == 404 || r.Key == 410) r = Api("POST", "/playlists/" + pid + "/tracks", body);
            }
            if (r.Key >= 200 && r.Key < 300) return null;
            Log.Write("Spotify save: " + r.Key + " " + (r.Value.Length > 200 ? r.Value.Substring(0, 200) : r.Value));
            if (r.Key == 403 && r.Value.IndexOf("scope", StringComparison.OrdinalIgnoreCase) >= 0) return "Connect Spotify again (Control Hub → Connections) to allow saving to playlists";
            if (r.Key == 403) return "Spotify only lets you add songs to your own playlists";
            return LastError ?? "Spotify didn't save it (" + r.Key + ")";
        }
    }

    // ======================================================================= Twitch
    /// <summary>
    /// Which channels you follow are live. Uses your own (free) Twitch developer app ("Public" client) and
    /// Twitch's code login: you type a short code on twitch.tv/activate once.
    /// </summary>
    static class Twitch
    {
        static readonly object Gate = new object();
        static string userCode, verifyUrl;
        static List<Dictionary<string, object>> live;
        static DateTime liveAt = DateTime.MinValue;
        public static string LastError;

        public static bool Configured { get { return !string.IsNullOrEmpty(Settings.Current.TwitchClientId); } }
        public static bool Connected { get { return Configured && !string.IsNullOrEmpty(Settings.Current.TwitchRefresh); } }

        public static string Connect(string clientId)
        {
            Settings.Current.TwitchClientId = clientId.Trim();
            Settings.Current.TwitchRefresh = null;
            Settings.Current.TwitchAccess = null;
            Settings.Save();
            var r = Http.Send("POST", "https://id.twitch.tv/oauth2/device", Http.Form("client_id", clientId.Trim(), "scopes", "user:read:follows"), "application/x-www-form-urlencoded", null);
            var d = r.Key == 200 ? Http.Parse(r.Value) : null;
            string device = Http.Str(d, "device_code");
            if (device == null) { Log.Write("Twitch: " + r.Key + " " + r.Value); return null; }
            userCode = Http.Str(d, "user_code");
            verifyUrl = Http.Str(d, "verification_uri");
            int interval; int.TryParse(Http.Str(d, "interval") ?? "5", out interval);
            Http.Open(verifyUrl);
            new Thread(delegate ()
            {
                var until = DateTime.UtcNow.AddMinutes(10);
                while (DateTime.UtcNow < until)
                {
                    Thread.Sleep(Math.Max(2, interval) * 1000);
                    var t = Http.Send("POST", "https://id.twitch.tv/oauth2/token", Http.Form("client_id", Settings.Current.TwitchClientId, "scopes", "user:read:follows",
                        "device_code", device, "grant_type", "urn:ietf:params:oauth:grant-type:device_code"), "application/x-www-form-urlencoded", null);
                    if (t.Key == 200 && SaveTokens(t))
                    {
                        userCode = null;
                        var u = Api("/users");
                        var ud = u.Key == 200 ? Http.Parse(u.Value) : null;
                        if (ud != null && ud.ContainsKey("data")) foreach (var x in (IEnumerable)ud["data"]) { Settings.Current.TwitchUserId = Http.Str(x as Dictionary<string, object>, "id"); break; }
                        Settings.Save();
                        Log.Write("Twitch connected");
                        return;
                    }
                    if (!t.Value.Contains("authorization_pending")) { Log.Write("Twitch login: " + t.Value); break; }
                }
                userCode = null;
            }) { IsBackground = true }.Start();
            return userCode;
        }

        static bool SaveTokens(KeyValuePair<int, string> r)
        {
            var d = r.Key == 200 ? Http.Parse(r.Value) : null;
            string access = Http.Str(d, "access_token");
            if (access == null) return false;
            Settings.Current.TwitchAccess = Http.Protect(access);
            string refresh = Http.Str(d, "refresh_token");
            if (refresh != null) Settings.Current.TwitchRefresh = Http.Protect(refresh);
            double exp; double.TryParse(Http.Str(d, "expires_in") ?? "3600", out exp);
            Settings.Current.TwitchExpires = DateTime.UtcNow.AddSeconds(exp - 60).Ticks;
            Settings.Save();
            return true;
        }

        static string Token()
        {
            if (string.IsNullOrEmpty(Settings.Current.TwitchRefresh)) return null;
            if (DateTime.UtcNow.Ticks < Settings.Current.TwitchExpires) return Http.Unprotect(Settings.Current.TwitchAccess);
            var r = Http.Send("POST", "https://id.twitch.tv/oauth2/token", Http.Form("client_id", Settings.Current.TwitchClientId, "grant_type", "refresh_token",
                "refresh_token", Http.Unprotect(Settings.Current.TwitchRefresh)), "application/x-www-form-urlencoded", null);
            if (!SaveTokens(r)) { LastError = "Twitch login expired. Connect Twitch again from the helper icon."; if (r.Key == 400) Settings.Current.TwitchRefresh = null; return null; }
            return Http.Unprotect(Settings.Current.TwitchAccess);
        }

        static KeyValuePair<int, string> Api(string path)
        {
            string t = Token();
            if (t == null) return new KeyValuePair<int, string>(401, "");
            var h = new Dictionary<string, string>();
            h["Authorization"] = "Bearer " + t;
            h["Client-Id"] = Settings.Current.TwitchClientId;
            return Http.Send("GET", "https://api.twitch.tv/helix" + path, null, null, h);
        }

        public static Dictionary<string, object> State()
        {
            var d = new Dictionary<string, object>();
            d["configured"] = Configured;
            d["connected"] = Connected;
            if (userCode != null) { d["code"] = userCode; d["url"] = verifyUrl; }
            if (!Connected || string.IsNullOrEmpty(Settings.Current.TwitchUserId)) return d;
            lock (Gate)
            {
                if (live == null || (DateTime.UtcNow - liveAt).TotalSeconds > 60)
                {
                    liveAt = DateTime.UtcNow;
                    var r = Api("/streams/followed?first=30&user_id=" + Uri.EscapeDataString(Settings.Current.TwitchUserId));
                    var sd = r.Key == 200 ? Http.Parse(r.Value) : null;
                    if (sd != null && sd.ContainsKey("data"))
                    {
                        var list = new List<Dictionary<string, object>>();
                        foreach (var x in (IEnumerable)sd["data"])
                        {
                            var s = x as Dictionary<string, object>;
                            if (s == null) continue;
                            var o = new Dictionary<string, object>();
                            o["login"] = Http.Str(s, "user_login"); o["name"] = Http.Str(s, "user_name"); o["game"] = Http.Str(s, "game_name");
                            o["title"] = Http.Str(s, "title"); o["viewers"] = s.ContainsKey("viewer_count") ? s["viewer_count"] : 0;
                            o["thumb"] = (Http.Str(s, "thumbnail_url") ?? "").Replace("{width}", "320").Replace("{height}", "180");
                            o["started"] = Http.Str(s, "started_at");
                            list.Add(o);
                        }
                        live = list;
                        LastError = null;
                    }
                    else if (r.Key != 200) LastError = "Couldn't ask Twitch (" + r.Key + ")";
                }
                if (live != null) d["live"] = live;
            }
            if (LastError != null) d["error"] = LastError;
            return d;
        }
    }
}
