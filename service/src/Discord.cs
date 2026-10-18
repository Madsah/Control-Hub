using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace ControlPanelHelper
{
    /// <summary>
    /// Talks to the Discord app on this PC (its local "RPC" connection), the same way Stream Deck's
    /// Discord plugin does: real mute/deafen, who is in your voice channel, and who is talking.
    /// Needs your own Discord application (client ID + secret), added from the tray menu.
    /// Discord asks you once to allow it; the login is kept encrypted for your Windows user only.
    /// </summary>
    static class DiscordLink
    {
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
        static readonly object Gate = new object();
        static readonly object WriteGate = new object();

        static NamedPipeClientStream pipe;
        static Thread reader, keeper;
        static volatile bool wanted;
        static DateTime lastWanted = DateTime.MinValue;

        // What the widget sees.
        static bool connected, authorized, waitingForAllow;
        static string error, userId, userName;
        static bool mute, deaf;
        static string channelId, channelName, guildId;
        static readonly Dictionary<string, Member> members = new Dictionary<string, Member>();
        static readonly List<string> order = new List<string>();
        static long version = 1;

        class Member { public string Id, Name, Avatar; public bool Speaking, Mute, Deaf, LocalMute; public int Volume = 100; }

        static readonly ManualResetEvent ready = new ManualResetEvent(false);
        static readonly Dictionary<string, Pending> pending = new Dictionary<string, Pending>();
        class Pending { public ManualResetEvent Done = new ManualResetEvent(false); public Dictionary<string, object> Result; }

        public static bool Configured
        {
            get { return !string.IsNullOrEmpty(Settings.Current.DiscordClientId) && !string.IsNullOrEmpty(Settings.Current.DiscordSecret); }
        }

        // ------------------------------------------------------------------ settings (secret and tokens encrypted with Windows DPAPI)

        public static void Setup(string clientId, string secret)
        {
            Settings.Current.DiscordClientId = clientId.Trim();
            Settings.Current.DiscordSecret = Protect(secret.Trim());
            Settings.Current.DiscordAccess = null;
            Settings.Current.DiscordRefresh = null;
            Settings.Save();
            Disconnect("set up again");
            lock (Gate) { error = null; version++; Monitor.PulseAll(Gate); }
            Want();
        }

        public static void Forget()
        {
            Settings.Current.DiscordClientId = null;
            Settings.Current.DiscordSecret = null;
            Settings.Current.DiscordAccess = null;
            Settings.Current.DiscordRefresh = null;
            Settings.Save();
            Disconnect("removed");
        }

        static string Protect(string s)
        {
            if (string.IsNullOrEmpty(s)) return null;
            return Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(s), null, DataProtectionScope.CurrentUser));
        }

        static string Unprotect(string s)
        {
            if (string.IsNullOrEmpty(s)) return null;
            try { return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(s), null, DataProtectionScope.CurrentUser)); }
            catch { return null; }
        }

        // ------------------------------------------------------------------ connection

        /// <summary>The widget has a Discord tile on screen: keep (or get) a connection.</summary>
        public static void Want()
        {
            lastWanted = DateTime.UtcNow;
            if (!Configured || wanted) return;
            wanted = true;
            keeper = new Thread(KeepLoop) { IsBackground = true, Name = "discord" };
            keeper.Start();
        }

        static void KeepLoop()
        {
            while (wanted)
            {
                if (!connected)
                {
                    try { Connect(); }
                    catch (Exception ex)
                    {
                        lock (Gate)
                        {
                            if (error == null || !error.StartsWith("Discord said no")) error = ex.Message;
                            version++; Monitor.PulseAll(Gate);
                        }
                        Disconnect(null);
                    }
                }
                // Nobody has looked for 10 minutes: let go of Discord until a Discord tile is shown again.
                if ((DateTime.UtcNow - lastWanted).TotalMinutes > 10) { wanted = false; Disconnect(null); break; }
                Thread.Sleep(connected ? 5000 : 10000);
            }
        }

        static void Connect()
        {
            string clientId = Settings.Current.DiscordClientId;
            NamedPipeClientStream p = null;
            for (int i = 0; i < 10 && p == null; i++)
            {
                var tryPipe = new NamedPipeClientStream(".", "discord-ipc-" + i, PipeDirection.InOut, PipeOptions.Asynchronous);
                try { tryPipe.Connect(300); p = tryPipe; }
                catch { tryPipe.Dispose(); }
            }
            // Opened "asynchronous" so reading and writing can happen at the same time
            // (otherwise Windows makes a write wait until the read finishes, and nothing is ever sent).
            if (p == null) throw new Exception("Discord isn't running");
            pipe = p;
            ready.Reset();
            reader = new Thread(ReadLoop) { IsBackground = true, Name = "discord-read" };
            reader.Start();
            Log.Write("Discord: found the Discord app, saying hello");
            Write(0, "{\"v\":1,\"client_id\":" + Json.Serialize(clientId) + "}");
            // Discord ignores everything sent before its READY answer.
            if (!ready.WaitOne(8000))
            {
                string why;
                lock (Gate) why = error;
                throw new Exception(why ?? "Discord didn't answer (is the Client ID right?)");
            }
            Log.Write("Discord: ready");
            Login();
        }

        static void Login()
        {
            string token = Unprotect(Settings.Current.DiscordAccess);
            if (token != null && DateTime.UtcNow.Ticks < Settings.Current.DiscordExpires)
            {
                var r = Call("AUTHENTICATE", Args("access_token", token), 8000);
                if (r != null && r.ContainsKey("data") && !IsError(r)) { Authenticated(r); return; }
            }
            // Try a refresh first, then ask Discord to allow it.
            string refresh = Unprotect(Settings.Current.DiscordRefresh);
            if (refresh != null && TokenRequest("grant_type=refresh_token&refresh_token=" + Uri.EscapeDataString(refresh)))
            {
                var r = Call("AUTHENTICATE", Args("access_token", Unprotect(Settings.Current.DiscordAccess)), 8000);
                if (r != null && !IsError(r)) { Authenticated(r); return; }
            }
            lock (Gate) { waitingForAllow = true; version++; Monitor.PulseAll(Gate); }
            Log.Write("Discord: asking you to allow Control Panel (look at Discord)");
            // The Authorize box shows inside the Discord window, so bring that window up (it's often hidden in the tray).
            try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("discord://-/channels/@me") { UseShellExecute = true }); }
            catch (Exception ex) { Log.Write("Discord: couldn't bring the window up: " + ex.Message); }
            var auth = new Dictionary<string, object>();
            auth["client_id"] = Settings.Current.DiscordClientId;
            auth["response_type"] = "code";   // Discord ignores the request without this
            auth["prompt"] = "consent";
            auth["scopes"] = new[] { "rpc", "rpc.voice.read", "rpc.voice.write", "identify" };
            var a = Call("AUTHORIZE", auth, 120000);
            lock (Gate) { waitingForAllow = false; version++; Monitor.PulseAll(Gate); }
            if (a == null) Log.Write("Discord: no answer to the Authorize request within 2 minutes");
            if (a == null || IsError(a))
            {
                Log.Write("Discord: authorize answer: " + (a == null ? "(none)" : Json.Serialize(a)));
                throw new Exception(ErrorText(a, "Discord didn't allow it"));
            }
            string code = Str(Dict(a, "data"), "code");
            // The code is exchanged without a redirect address first (that's how it works over the local connection), then with http://localhost.
            if (code == null || (!TokenRequest("grant_type=authorization_code&code=" + Uri.EscapeDataString(code)) &&
                                 !TokenRequest("grant_type=authorization_code&code=" + Uri.EscapeDataString(code) + "&redirect_uri=" + Uri.EscapeDataString("http://localhost"))))
                throw new Exception("Couldn't log in to Discord. Check the client ID, secret and the redirect http://localhost");
            var r2 = Call("AUTHENTICATE", Args("access_token", Unprotect(Settings.Current.DiscordAccess)), 8000);
            if (r2 == null || IsError(r2)) throw new Exception(ErrorText(r2, "Discord login failed"));
            Authenticated(r2);
        }

        static bool TokenRequest(string body)
        {
            try
            {
                ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072;
                var req = (HttpWebRequest)WebRequest.Create("https://discord.com/api/oauth2/token");
                req.Method = "POST";
                req.ContentType = "application/x-www-form-urlencoded";
                req.Timeout = 10000;
                string full = body + "&client_id=" + Uri.EscapeDataString(Settings.Current.DiscordClientId) +
                    "&client_secret=" + Uri.EscapeDataString(Unprotect(Settings.Current.DiscordSecret) ?? "");
                var bytes = Encoding.UTF8.GetBytes(full);
                req.ContentLength = bytes.Length;
                using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
                using (var res = req.GetResponse())
                using (var sr = new StreamReader(res.GetResponseStream()))
                {
                    var d = Json.Deserialize<Dictionary<string, object>>(sr.ReadToEnd());
                    string access = Str(d, "access_token");
                    if (access == null) return false;
                    Settings.Current.DiscordAccess = Protect(access);
                    string refresh = Str(d, "refresh_token");
                    if (refresh != null) Settings.Current.DiscordRefresh = Protect(refresh);
                    double exp = d.ContainsKey("expires_in") ? Convert.ToDouble(d["expires_in"]) : 3600;
                    Settings.Current.DiscordExpires = DateTime.UtcNow.AddSeconds(exp - 120).Ticks;
                    Settings.Save();
                    return true;
                }
            }
            catch (WebException ex)
            {
                string detail = "";
                try { if (ex.Response != null) using (var sr = new StreamReader(ex.Response.GetResponseStream())) detail = sr.ReadToEnd(); } catch { }
                Log.Write("Discord token: " + ex.Message + " " + detail);
                return false;
            }
            catch (Exception ex) { Log.Write("Discord token: " + ex.Message); return false; }
        }

        static void Authenticated(Dictionary<string, object> r)
        {
            var user = Dict(Dict(r, "data"), "user");
            lock (Gate)
            {
                connected = true;
                authorized = true;
                error = null;
                userId = Str(user, "id");
                userName = Str(user, "global_name") ?? Str(user, "username");
                version++; Monitor.PulseAll(Gate);
            }
            Log.Write("Discord connected as " + userName);
            Call("SUBSCRIBE", null, 5000, "VOICE_SETTINGS_UPDATE");
            Call("SUBSCRIBE", null, 5000, "VOICE_CHANNEL_SELECT");
            var vs = Call("GET_VOICE_SETTINGS", new Dictionary<string, object>(), 5000);
            if (vs != null) VoiceSettings(Dict(vs, "data"));
            LoadChannel();
        }

        static void LoadChannel()
        {
            var r = Call("GET_SELECTED_VOICE_CHANNEL", new Dictionary<string, object>(), 5000);
            var data = r == null ? null : Dict(r, "data");
            string old;
            lock (Gate) old = channelId;
            if (old != null)
                foreach (var ev in new[] { "VOICE_STATE_CREATE", "VOICE_STATE_UPDATE", "VOICE_STATE_DELETE", "SPEAKING_START", "SPEAKING_STOP" })
                    Call("UNSUBSCRIBE", Args("channel_id", old), 3000, ev);
            lock (Gate)
            {
                members.Clear();
                order.Clear();
                channelId = data == null ? null : Str(data, "id");
                channelName = data == null ? null : Str(data, "name");
                guildId = data == null ? null : Str(data, "guild_id");
                if (data != null && data.ContainsKey("voice_states"))
                    foreach (var vsObj in AsList(data["voice_states"])) UpsertMember(vsObj as Dictionary<string, object>);
                version++; Monitor.PulseAll(Gate);
            }
            if (channelId != null)
                foreach (var ev in new[] { "VOICE_STATE_CREATE", "VOICE_STATE_UPDATE", "VOICE_STATE_DELETE", "SPEAKING_START", "SPEAKING_STOP" })
                    Call("SUBSCRIBE", Args("channel_id", channelId), 3000, ev);
        }

        // Call with Gate held.
        static void UpsertMember(Dictionary<string, object> vs)
        {
            if (vs == null) return;
            var user = Dict(vs, "user");
            string id = Str(user, "id");
            if (id == null) return;
            Member m;
            if (!members.TryGetValue(id, out m)) { m = new Member { Id = id }; members[id] = m; order.Add(id); }
            m.Name = Str(vs, "nick") ?? Str(user, "global_name") ?? Str(user, "username") ?? "Someone";
            m.Avatar = Str(user, "avatar");
            // Your own settings for this person (only you hear the difference).
            if (vs.ContainsKey("mute")) m.LocalMute = Bool(vs, "mute");
            if (vs.ContainsKey("volume") && vs["volume"] != null)
            {
                try { m.Volume = (int)Math.Round(Convert.ToDouble(vs["volume"])); } catch { }
            }
            var state = Dict(vs, "voice_state");
            if (state != null)
            {
                m.Mute = Bool(state, "mute") || Bool(state, "self_mute") || Bool(state, "suppress");
                m.Deaf = Bool(state, "deaf") || Bool(state, "self_deaf");
            }
        }

        static void VoiceSettings(Dictionary<string, object> d)
        {
            if (d == null) return;
            lock (Gate)
            {
                if (d.ContainsKey("mute")) mute = Bool(d, "mute");
                if (d.ContainsKey("deaf")) deaf = Bool(d, "deaf");
                version++; Monitor.PulseAll(Gate);
                Monitor.PulseAll(Gate);
            }
        }

        static void Disconnect(string why)
        {
            var p = pipe;
            pipe = null;
            if (p != null) try { p.Dispose(); } catch { }
            lock (pending)
            {
                foreach (var x in pending.Values) x.Done.Set();
                pending.Clear();
            }
            lock (Gate)
            {
                connected = false;
                channelId = null;
                members.Clear();
                order.Clear();
                version++; Monitor.PulseAll(Gate);
                Monitor.PulseAll(Gate);
            }
            if (why != null) Log.Write("Discord: " + why);
        }

        // ------------------------------------------------------------------ pipe frames: [op int32][length int32][json]

        static void Write(int op, string json)
        {
            var p = pipe;
            if (p == null) throw new Exception("not connected");
            var body = Encoding.UTF8.GetBytes(json);
            var frame = new byte[8 + body.Length];
            BitConverter.GetBytes(op).CopyTo(frame, 0);
            BitConverter.GetBytes(body.Length).CopyTo(frame, 4);
            body.CopyTo(frame, 8);
            lock (WriteGate) { p.Write(frame, 0, frame.Length); p.Flush(); }
        }

        static bool ReadFull(Stream s, byte[] buf, int len)
        {
            int got = 0;
            while (got < len)
            {
                int n = s.Read(buf, got, len - got);
                if (n <= 0) return false;
                got += n;
            }
            return true;
        }

        static void ReadLoop()
        {
            var p = pipe;
            var head = new byte[8];
            try
            {
                while (p != null && p == pipe)
                {
                    if (!ReadFull(p, head, 8)) break;
                    int op = BitConverter.ToInt32(head, 0), len = BitConverter.ToInt32(head, 4);
                    if (len < 0 || len > 16 * 1024 * 1024) break;
                    var body = new byte[len];
                    if (!ReadFull(p, body, len)) break;
                    string json = Encoding.UTF8.GetString(body);
                    // While setting up, write what Discord says to the log (helps when the Authorize box doesn't show).
                    if (!authorized) Log.Write("Discord says: " + (json.Length > 400 ? json.Substring(0, 400) + "…" : json));
                    if (op == 3) { Write(4, json); continue; } // ping -> pong
                    if (op == 2)
                    {
                        Log.Write("Discord closed the connection: " + json);
                        lock (Gate) { error = "Discord said no: " + ErrorText(SafeParse(json), json); }
                        break;
                    }
                    Dictionary<string, object> msg;
                    try { msg = Json.Deserialize<Dictionary<string, object>>(json); } catch { continue; }
                    Handle(msg);
                }
            }
            catch (Exception ex) { if (p == pipe) Log.Write("Discord read: " + ex.Message); }
            if (p == pipe) Disconnect("connection closed");
        }

        static void Handle(Dictionary<string, object> msg)
        {
            string nonce = Str(msg, "nonce"), evt = Str(msg, "evt"), cmd = Str(msg, "cmd");
            if (nonce != null)
            {
                Pending pd;
                lock (pending) if (pending.TryGetValue(nonce, out pd)) { pd.Result = msg; pd.Done.Set(); }
                if (cmd != "DISPATCH") return;
            }
            var data = Dict(msg, "data");
            if (evt == "ERROR" && nonce == null) Log.Write("Discord error: " + Json.Serialize(msg));
            switch (evt)
            {
                case "READY": ready.Set(); break;
                case "VOICE_SETTINGS_UPDATE": VoiceSettings(data); break;
                case "VOICE_CHANNEL_SELECT": ThreadPool.QueueUserWorkItem(delegate { try { LoadChannel(); } catch { } }); break;
                case "VOICE_STATE_CREATE":
                case "VOICE_STATE_UPDATE":
                    lock (Gate) { UpsertMember(data); version++; Monitor.PulseAll(Gate); Monitor.PulseAll(Gate); }
                    break;
                case "VOICE_STATE_DELETE":
                    lock (Gate)
                    {
                        string id = Str(Dict(data, "user"), "id");
                        if (id != null) { members.Remove(id); order.Remove(id); }
                        version++; Monitor.PulseAll(Gate);
                        Monitor.PulseAll(Gate);
                    }
                    break;
                case "SPEAKING_START":
                case "SPEAKING_STOP":
                    lock (Gate)
                    {
                        Member m;
                        string id = Str(data, "user_id");
                        if (id != null && members.TryGetValue(id, out m)) m.Speaking = evt == "SPEAKING_START";
                        version++; Monitor.PulseAll(Gate);
                        Monitor.PulseAll(Gate);
                    }
                    break;
            }
        }

        static int nonceCounter;

        static Dictionary<string, object> Call(string cmd, Dictionary<string, object> args, int timeoutMs, string evt = null)
        {
            string nonce = "n" + Interlocked.Increment(ref nonceCounter);
            var msg = new Dictionary<string, object>();
            msg["cmd"] = cmd;
            msg["nonce"] = nonce;
            msg["args"] = args ?? new Dictionary<string, object>();
            if (evt != null) msg["evt"] = evt;
            var pd = new Pending();
            lock (pending) pending[nonce] = pd;
            try
            {
                string text = Json.Serialize(msg);
            if (!authorized && cmd != "AUTHENTICATE") Log.Write("Discord ask: " + cmd);
            Write(1, text);
            if (!authorized && cmd != "AUTHENTICATE") Log.Write("Discord ask sent, waiting for an answer");
                pd.Done.WaitOne(timeoutMs);
                return pd.Result;
            }
            catch { return null; }
            finally { lock (pending) pending.Remove(nonce); }
        }

        // ------------------------------------------------------------------ for the widget

        public static bool SetMute(bool value)
        {
            if (!connected) return false;
            var r = Call("SET_VOICE_SETTINGS", Args("mute", value), 4000);
            if (r == null || IsError(r)) return false;
            VoiceSettings(Dict(r, "data"));
            return true;
        }

        public static bool SetDeaf(bool value)
        {
            if (!connected) return false;
            var r = Call("SET_VOICE_SETTINGS", Args("deaf", value), 4000);
            if (r == null || IsError(r)) return false;
            VoiceSettings(Dict(r, "data"));
            return true;
        }

        public static bool Toggle(string what)
        {
            bool m, d;
            lock (Gate) { m = mute; d = deaf; }
            if (what == "deaf") return SetDeaf(!d);
            return SetMute(!m);
        }

        public static bool Leave()
        {
            if (!connected) return false;
            var r = Call("SELECT_VOICE_CHANNEL", Args("channel_id", null), 4000);
            return r != null && !IsError(r);
        }

        /// <summary>Volume (0-200 %) and/or mute for one person in the call, only for you (like right-clicking them in Discord).</summary>
        public static bool SetUser(string id, int? volume, bool? muteThem)
        {
            if (!connected || string.IsNullOrEmpty(id) || id == userId) return false;
            var args = new Dictionary<string, object>();
            args["user_id"] = id;
            if (volume.HasValue) args["volume"] = Math.Max(0, Math.Min(200, volume.Value));
            if (muteThem.HasValue) args["mute"] = muteThem.Value;
            var r = Call("SET_USER_VOICE_SETTINGS", args, 4000);
            if (r == null || IsError(r)) { Log.Write("Discord user volume: " + (r == null ? "no answer" : ErrorText(r, "error"))); return false; }
            lock (Gate)
            {
                Member m;
                if (members.TryGetValue(id, out m))
                {
                    if (volume.HasValue) m.Volume = Math.Max(0, Math.Min(200, volume.Value));
                    if (muteThem.HasValue) m.LocalMute = muteThem.Value;
                }
                version++; Monitor.PulseAll(Gate);
            }
            return true;
        }

        /// <summary>Your servers (for picking a favourite voice channel).</summary>
        public static List<Dictionary<string, object>> Guilds()
        {
            var list = new List<Dictionary<string, object>>();
            if (!connected) return null;
            var r = Call("GET_GUILDS", new Dictionary<string, object>(), 6000);
            if (r == null || IsError(r)) return null;
            foreach (var g in AsList(Dict(r, "data") != null && Dict(r, "data").ContainsKey("guilds") ? Dict(r, "data")["guilds"] : null))
            {
                var gd = g as Dictionary<string, object>;
                if (gd == null) continue;
                var o = new Dictionary<string, object>();
                o["id"] = Str(gd, "id"); o["name"] = Str(gd, "name"); o["icon"] = Str(gd, "icon_url");
                list.Add(o);
            }
            return list;
        }

        /// <summary>The voice channels of one server.</summary>
        public static List<Dictionary<string, object>> VoiceChannels(string guild)
        {
            if (!connected || string.IsNullOrEmpty(guild)) return null;
            var r = Call("GET_CHANNELS", Args("guild_id", guild), 6000);
            if (r == null || IsError(r)) return null;
            var list = new List<Dictionary<string, object>>();
            var data = Dict(r, "data");
            foreach (var c in AsList(data != null && data.ContainsKey("channels") ? data["channels"] : null))
            {
                var cd = c as Dictionary<string, object>;
                if (cd == null) continue;
                int type = 0;
                try { type = Convert.ToInt32(cd.ContainsKey("type") ? cd["type"] : 0); } catch { }
                if (type != 2 && type != 13) continue; // voice and stage channels
                var o = new Dictionary<string, object>();
                o["id"] = Str(cd, "id"); o["name"] = Str(cd, "name");
                list.Add(o);
            }
            return list;
        }

        /// <summary>Join a voice channel (moves you if you're already in another one).</summary>
        public static bool Join(string channel)
        {
            if (!connected || string.IsNullOrEmpty(channel)) return false;
            foreach (char ch in channel) if (ch < '0' || ch > '9') return false;
            var args = new Dictionary<string, object>();
            args["channel_id"] = channel;
            args["force"] = true;
            var r = Call("SELECT_VOICE_CHANNEL", args, 8000);
            if (r == null || IsError(r)) { Log.Write("Discord join: " + (r == null ? "no answer" : ErrorText(r, "error"))); return false; }
            return true;
        }

        /// <summary>The state; with since = the version the widget already has, waits up to 15 s for a change.</summary>
        public static Dictionary<string, object> State(long since)
        {
            Want();
            lock (Gate)
            {
                if (since > 0 && since == version) Monitor.Wait(Gate, 15000);
                var d = new Dictionary<string, object>();
                d["v"] = version;
                d["configured"] = Configured;
                d["connected"] = connected;
                d["waiting"] = waitingForAllow;
                if (error != null) d["error"] = error;
                d["mute"] = mute;
                d["deaf"] = deaf;
                if (userName != null) d["user"] = userName;
                if (channelId != null)
                {
                    d["channel"] = channelName ?? "Voice channel";
                    var list = new List<Dictionary<string, object>>();
                    foreach (var id in order)
                    {
                        Member m;
                        if (!members.TryGetValue(id, out m)) continue;
                        var o = new Dictionary<string, object>();
                        o["id"] = m.Id; o["name"] = m.Name; o["avatar"] = m.Avatar;
                        o["speaking"] = m.Speaking; o["mute"] = m.Mute; o["deaf"] = m.Deaf;
                        o["me"] = m.Id == userId;
                        o["vol"] = m.Volume; o["lmute"] = m.LocalMute;
                        list.Add(o);
                    }
                    d["members"] = list;
                }
                return d;
            }
        }

        // ------------------------------------------------------------------ small JSON helpers

        static Dictionary<string, object> SafeParse(string json)
        {
            try
            {
                var d = Json.Deserialize<Dictionary<string, object>>(json);
                // Close frames carry {code, message} at the top level.
                if (d != null && !d.ContainsKey("data")) { var w = new Dictionary<string, object>(); w["data"] = d; return w; }
                return d;
            }
            catch { return null; }
        }

        static Dictionary<string, object> Args(string k, object v)
        {
            var d = new Dictionary<string, object>();
            d[k] = v;
            return d;
        }

        static bool IsError(Dictionary<string, object> r) { return Str(r, "evt") == "ERROR"; }

        static string ErrorText(Dictionary<string, object> r, string fallback)
        {
            var d = r == null ? null : Dict(r, "data");
            return Str(d, "message") ?? fallback;
        }

        static Dictionary<string, object> Dict(Dictionary<string, object> d, string k)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) ? v as Dictionary<string, object> : null;
        }

        static string Str(Dictionary<string, object> d, string k)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : null;
        }

        static bool Bool(Dictionary<string, object> d, string k)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) && v is bool && (bool)v;
        }

        static IEnumerable AsList(object o)
        {
            return o as IEnumerable ?? new object[0];
        }
    }
}
