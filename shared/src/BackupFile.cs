// Control Hub backups: everything in one .zip file.
// Used by both Control Hub (backup now, restore) and Control Hub Service (the weekly automatic backup).
//
// Inside the file:
//   backup.json          what it is: when, from which PC, versions, panel pages/tiles, whether logins are inside
//   data\...             the whole settings folder (%APPDATA%\ControlHub): settings, panel layout and its backups,
//                        button pictures, flight tracks, SimConnect.dll… (not the log)
//   program\...          projects.json and update.json from the program folder
//   logins.dat           only when you chose a password: your Spotify/Discord/Twitch logins, encrypted with it
//
// Logins in settings.json are locked to this Windows user (Windows DPAPI), so they only work on the same PC and user.
// With a password they also work after reinstalling Windows or on a new PC.
// C# 5 / .NET Framework 4.x.
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace ControlHubShared
{
    static class BackupFile
    {
        public const int Format = 1;
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024 };

        /// <summary>Logins kept encrypted in settings.json (the same names as the service's settings).</summary>
        public static readonly string[] SecretFields = { "DiscordSecret", "DiscordAccess", "DiscordRefresh", "SpotifyAccess", "SpotifyRefresh", "TwitchAccess", "TwitchRefresh" };

        public static string DataFolder
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ControlHub"); }
        }

        /// <summary>OneDrive if you use it (so backups also live outside this PC), else Documents.</summary>
        public static string DefaultFolder()
        {
            foreach (var v in new[] { "OneDrive", "OneDriveConsumer" })
            {
                string od = Environment.GetEnvironmentVariable(v);
                if (!string.IsNullOrEmpty(od) && Directory.Exists(od)) return Path.Combine(od, "Control Hub backups");
            }
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Control Hub backups");
        }

        public class Info
        {
            public DateTime Created;
            public string Machine, User, Version, Kind;
            public long Pages, Tiles;
            public bool Logins;           // logins.dat is inside (needs the password)
            public bool SamePc;           // made on this PC by this Windows user (its settings' logins work as they are)
        }

        // ------------------------------------------------------------------ making a backup

        /// <summary>
        /// Makes a backup file in folder. kind: "manual" or "auto". password: null/empty = no logins.dat.
        /// Returns the file's path, or null with the reason in error.
        /// </summary>
        public static string Create(string folder, string kind, string password, string programFolder, string version, out string error)
        {
            error = null;
            string temp = null;
            try
            {
                Directory.CreateDirectory(folder);
                string name = "Control Hub backup " + DateTime.Now.ToString("yyyy-MM-dd HHmm") + (kind == "auto" ? " (auto)" : "") + ".zip";
                string path = Path.Combine(folder, name);
                temp = path + ".part";
                if (File.Exists(temp)) File.Delete(temp);

                long pages = 0, tiles = 0;
                ReadLayoutCounts(out pages, out tiles);

                using (var zip = ZipFile.Open(temp, ZipArchiveMode.Create))
                {
                    if (Directory.Exists(DataFolder)) AddFolder(zip, DataFolder, "data/");
                    foreach (var f in new[] { "projects.json", "update.json" })
                    {
                        string full = programFolder == null ? null : Path.Combine(programFolder, f);
                        if (full != null && File.Exists(full)) AddFile(zip, full, "program/" + f);
                    }
                    bool logins = !string.IsNullOrEmpty(password);
                    if (logins)
                    {
                        string secrets = ExportLogins();
                        WriteText(zip, "logins.dat", Encrypt(secrets, password));
                    }
                    var info = new Dictionary<string, object>();
                    info["format"] = Format;
                    info["created"] = DateTime.UtcNow.ToString("o");
                    info["machine"] = Environment.MachineName;
                    info["user"] = Environment.UserName;
                    info["version"] = version;
                    info["kind"] = kind;
                    info["pages"] = pages;
                    info["tiles"] = tiles;
                    info["logins"] = logins;
                    WriteText(zip, "backup.json", Json.Serialize(info));
                }
                if (File.Exists(path)) File.Delete(path);
                File.Move(temp, path);
                return path;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                try { if (temp != null && File.Exists(temp)) File.Delete(temp); } catch { }
                return null;
            }
        }

        static void AddFolder(ZipArchive zip, string folder, string prefix)
        {
            foreach (var f in Directory.GetFiles(folder))
            {
                string n = Path.GetFileName(f);
                if (n.EndsWith(".log", StringComparison.OrdinalIgnoreCase) || n.EndsWith(".part", StringComparison.OrdinalIgnoreCase) || n.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase)) continue;
                try { if (new FileInfo(f).Length > 100L * 1024 * 1024) continue; } catch { continue; }
                AddFile(zip, f, prefix + n);
            }
            foreach (var d in Directory.GetDirectories(folder))
                AddFolder(zip, d, prefix + Path.GetFileName(d) + "/");
        }

        static void AddFile(ZipArchive zip, string file, string entry)
        {
            try
            {
                // The service may be writing the file right now: read it while allowing that.
                using (var src = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (var dst = zip.CreateEntry(entry, CompressionLevel.Optimal).Open())
                    src.CopyTo(dst);
            }
            catch { }
        }

        static void WriteText(ZipArchive zip, string entry, string text)
        {
            using (var w = new StreamWriter(zip.CreateEntry(entry, CompressionLevel.Optimal).Open(), new UTF8Encoding(false)))
                w.Write(text);
        }

        /// <summary>Pages and tiles of the panel's current layout (the service's copy, backups\live.json).</summary>
        static void ReadLayoutCounts(out long pages, out long tiles)
        {
            pages = 0; tiles = 0;
            try
            {
                string live = Path.Combine(DataFolder, "backups", "live.json");
                if (!File.Exists(live)) return;
                var d = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(live, Encoding.UTF8));
                object v;
                if (d.TryGetValue("pages", out v) && v != null) pages = Convert.ToInt64(v);
                if (d.TryGetValue("tiles", out v) && v != null) tiles = Convert.ToInt64(v);
            }
            catch { }
        }

        /// <summary>The logins from settings.json, unlocked (only possible as this Windows user), as JSON.</summary>
        static string ExportLogins()
        {
            var outd = new Dictionary<string, object>();
            string file = Path.Combine(DataFolder, "settings.json");
            if (File.Exists(file))
            {
                var s = Json.Deserialize<Dictionary<string, object>>(ReadShared(file));
                foreach (var k in SecretFields)
                {
                    object v;
                    if (s != null && s.TryGetValue(k, out v) && v is string && ((string)v).Length > 0)
                    {
                        string plain = Unprotect((string)v);
                        if (plain != null) outd[k] = plain;
                    }
                }
            }
            return Json.Serialize(outd);
        }

        // ------------------------------------------------------------------ reading and restoring

        public static Info Read(string path, out string error)
        {
            error = null;
            try
            {
                using (var zip = ZipFile.OpenRead(path))
                {
                    var e = zip.GetEntry("backup.json");
                    if (e == null) { error = "This isn't a Control Hub backup file."; return null; }
                    Dictionary<string, object> d;
                    using (var r = new StreamReader(e.Open(), Encoding.UTF8)) d = Json.Deserialize<Dictionary<string, object>>(r.ReadToEnd());
                    var info = new Info();
                    object v;
                    DateTime created;
                    if (d.TryGetValue("created", out v) && DateTime.TryParse(Convert.ToString(v), null, System.Globalization.DateTimeStyles.RoundtripKind, out created)) info.Created = created.ToLocalTime();
                    info.Machine = d.TryGetValue("machine", out v) ? Convert.ToString(v) : "";
                    info.User = d.TryGetValue("user", out v) ? Convert.ToString(v) : "";
                    info.Version = d.TryGetValue("version", out v) ? Convert.ToString(v) : "";
                    info.Kind = d.TryGetValue("kind", out v) ? Convert.ToString(v) : "";
                    info.Pages = d.TryGetValue("pages", out v) && v != null ? Convert.ToInt64(v) : 0;
                    info.Tiles = d.TryGetValue("tiles", out v) && v != null ? Convert.ToInt64(v) : 0;
                    info.Logins = zip.GetEntry("logins.dat") != null;
                    info.SamePc = string.Equals(info.Machine, Environment.MachineName, StringComparison.OrdinalIgnoreCase) &&
                                  string.Equals(info.User, Environment.UserName, StringComparison.OrdinalIgnoreCase);
                    return info;
                }
            }
            catch (Exception ex) { error = ex.Message; return null; }
        }

        /// <summary>True if the password opens the backup's logins.</summary>
        public static bool CheckPassword(string path, string password)
        {
            try
            {
                using (var zip = ZipFile.OpenRead(path))
                {
                    var e = zip.GetEntry("logins.dat");
                    if (e == null) return false;
                    using (var r = new StreamReader(e.Open(), Encoding.UTF8)) return Decrypt(r.ReadToEnd(), password) != null;
                }
            }
            catch { return false; }
        }

        /// <summary>
        /// Puts a backup back. Control Hub Service must be closed first (it would write its settings over it).
        /// The current settings folder is kept next to it as "ControlHub before restore …" and can be put back by hand.
        /// password: opens logins.dat (null = keep the logins that are in the backup's settings, which only work on the same PC).
        /// </summary>
        public static bool Restore(string path, string password, string programFolder, out string error, out string keptAs)
        {
            error = null;
            keptAs = null;
            string work = Path.Combine(Path.GetTempPath(), "ControlHubRestore");
            try
            {
                if (Directory.Exists(work)) Directory.Delete(work, true);
                ZipFile.ExtractToDirectory(path, work);
                if (!File.Exists(Path.Combine(work, "backup.json"))) { error = "This isn't a Control Hub backup file."; return false; }

                string logins = null;
                if (!string.IsNullOrEmpty(password) && File.Exists(Path.Combine(work, "logins.dat")))
                {
                    logins = Decrypt(File.ReadAllText(Path.Combine(work, "logins.dat"), Encoding.UTF8), password);
                    if (logins == null) { error = "The password doesn't match this backup."; return false; }
                }

                // Keep the current settings folder, then put the backup's in its place.
                string data = DataFolder;
                if (Directory.Exists(data))
                {
                    keptAs = data + " before restore " + DateTime.Now.ToString("yyyy-MM-dd HHmmss");
                    Directory.Move(data, keptAs);
                }
                string fromData = Path.Combine(work, "data");
                if (Directory.Exists(fromData)) CopyFolder(fromData, data);
                else Directory.CreateDirectory(data);
                // The log stays with the current version.
                if (keptAs != null)
                    foreach (var f in Directory.GetFiles(keptAs, "*.log"))
                        try { File.Copy(f, Path.Combine(data, Path.GetFileName(f)), true); } catch { }

                string fromProgram = Path.Combine(work, "program");
                if (programFolder != null && Directory.Exists(fromProgram))
                    foreach (var f in Directory.GetFiles(fromProgram))
                        File.Copy(f, Path.Combine(programFolder, Path.GetFileName(f)), true);

                // Logins from logins.dat: locked again for this Windows user.
                if (logins != null) ImportLogins(logins);
                return true;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                // Something failed halfway: put the settings from before back.
                if (keptAs != null && Directory.Exists(keptAs))
                {
                    try
                    {
                        if (Directory.Exists(DataFolder)) Directory.Delete(DataFolder, true);
                        Directory.Move(keptAs, DataFolder);
                        keptAs = null;
                    }
                    catch { }
                }
                return false;
            }
            finally { try { if (Directory.Exists(work)) Directory.Delete(work, true); } catch { } }
        }

        static void ImportLogins(string json)
        {
            var secrets = Json.Deserialize<Dictionary<string, object>>(json);
            string file = Path.Combine(DataFolder, "settings.json");
            var s = File.Exists(file) ? Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file, Encoding.UTF8)) : new Dictionary<string, object>();
            if (s == null) s = new Dictionary<string, object>();
            foreach (var kv in secrets)
            {
                string plain = kv.Value as string;
                if (Array.IndexOf(SecretFields, kv.Key) < 0 || string.IsNullOrEmpty(plain)) continue;
                s[kv.Key] = Protect(plain);
            }
            File.WriteAllText(file, Json.Serialize(s), new UTF8Encoding(false));
        }

        static void CopyFolder(string from, string to)
        {
            Directory.CreateDirectory(to);
            foreach (var f in Directory.GetFiles(from)) File.Copy(f, Path.Combine(to, Path.GetFileName(f)), true);
            foreach (var d in Directory.GetDirectories(from)) CopyFolder(d, Path.Combine(to, Path.GetFileName(d)));
        }

        static string ReadShared(string file)
        {
            using (var fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var r = new StreamReader(fs, Encoding.UTF8)) return r.ReadToEnd();
        }

        // ------------------------------------------------------------------ automatic backups

        /// <summary>Deletes the oldest automatic backups in folder, keeping the newest "keep".</summary>
        public static void PruneAuto(string folder, int keep)
        {
            try
            {
                var files = new List<string>(Directory.GetFiles(folder, "Control Hub backup * (auto).zip"));
                files.Sort(StringComparer.Ordinal);   // the date in the name sorts oldest first
                for (int i = 0; i < files.Count - keep; i++)
                    try { File.Delete(files[i]); } catch { }
            }
            catch { }
        }

        // ------------------------------------------------------------------ encryption

        public static string Protect(string plain)
        {
            return Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(plain), null, DataProtectionScope.CurrentUser));
        }

        public static string Unprotect(string b64)
        {
            try { return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(b64), null, DataProtectionScope.CurrentUser)); }
            catch { return null; }
        }

        /// <summary>AES-256 with a key made from the password (PBKDF2, 200 000 rounds) and a check value (HMAC-SHA256).</summary>
        public static string Encrypt(string plain, string password)
        {
            byte[] salt = new byte[16], iv = new byte[16];
            using (var rng = new RNGCryptoServiceProvider()) { rng.GetBytes(salt); rng.GetBytes(iv); }
            byte[] key, mac;
            Keys(password, salt, out key, out mac);
            byte[] data;
            using (var aes = new AesCryptoServiceProvider { Key = key, IV = iv, Mode = CipherMode.CBC, Padding = PaddingMode.PKCS7 })
            using (var enc = aes.CreateEncryptor())
            {
                byte[] p = Encoding.UTF8.GetBytes(plain);
                data = enc.TransformFinalBlock(p, 0, p.Length);
            }
            byte[] check;
            using (var h = new HMACSHA256(mac)) check = h.ComputeHash(Concat(salt, iv, data));
            return "CHL1:" + Convert.ToBase64String(salt) + ":" + Convert.ToBase64String(iv) + ":" + Convert.ToBase64String(data) + ":" + Convert.ToBase64String(check);
        }

        /// <summary>The text, or null if the password is wrong or the data is damaged.</summary>
        public static string Decrypt(string text, string password)
        {
            try
            {
                var parts = (text ?? "").Trim().Split(':');
                if (parts.Length != 5 || parts[0] != "CHL1") return null;
                byte[] salt = Convert.FromBase64String(parts[1]), iv = Convert.FromBase64String(parts[2]),
                       data = Convert.FromBase64String(parts[3]), check = Convert.FromBase64String(parts[4]);
                byte[] key, mac;
                Keys(password, salt, out key, out mac);
                byte[] want;
                using (var h = new HMACSHA256(mac)) want = h.ComputeHash(Concat(salt, iv, data));
                if (want.Length != check.Length) return null;
                int diff = 0;
                for (int i = 0; i < want.Length; i++) diff |= want[i] ^ check[i];
                if (diff != 0) return null;
                using (var aes = new AesCryptoServiceProvider { Key = key, IV = iv, Mode = CipherMode.CBC, Padding = PaddingMode.PKCS7 })
                using (var dec = aes.CreateDecryptor())
                    return Encoding.UTF8.GetString(dec.TransformFinalBlock(data, 0, data.Length));
            }
            catch { return null; }
        }

        static void Keys(string password, byte[] salt, out byte[] key, out byte[] mac)
        {
            using (var kdf = new Rfc2898DeriveBytes(Encoding.UTF8.GetBytes(password ?? ""), salt, 200000))
            {
                key = kdf.GetBytes(32);
                mac = kdf.GetBytes(32);
            }
        }

        static byte[] Concat(byte[] a, byte[] b, byte[] c)
        {
            var r = new byte[a.Length + b.Length + c.Length];
            Buffer.BlockCopy(a, 0, r, 0, a.Length);
            Buffer.BlockCopy(b, 0, r, a.Length, b.Length);
            Buffer.BlockCopy(c, 0, r, a.Length + b.Length, c.Length);
            return r;
        }
    }
}
