using System;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;

namespace ControlPanelHelper
{
    public class CustomShortcut
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Kind { get; set; }   // "file" or "url"
        public string Target { get; set; }
    }

    public class SettingsData
    {
        public int Port { get; set; }
        public bool AutostartAsked { get; set; }
        public List<CustomShortcut> Custom { get; set; }
        public bool ClipboardHistory { get; set; }
        public string DiscordClientId { get; set; }
        public string DiscordSecret { get; set; }     // encrypted (Windows DPAPI, this user only)
        public string DiscordAccess { get; set; }     // encrypted
        public string DiscordRefresh { get; set; }    // encrypted
        public long DiscordExpires { get; set; }
        public string SayIntentionsKey { get; set; } // only if it can't be read from SayIntentions' own file
        public string SteamKey { get; set; }
        public bool PageKeysOff { get; set; }
        public string SpotifyClientId { get; set; }
        public string SpotifyAccess { get; set; }     // encrypted
        public string SpotifyRefresh { get; set; }    // encrypted
        public long SpotifyExpires { get; set; }
        public string SpotifyScopes { get; set; }     // what Spotify allowed at the last login
        public string TwitchClientId { get; set; }
        public string TwitchAccess { get; set; }      // encrypted
        public string TwitchRefresh { get; set; }     // encrypted
        public long TwitchExpires { get; set; }
        public string TwitchUserId { get; set; }
        public string Cs2Token { get; set; }
        public string BackupFolder { get; set; }    // where automatic backups go (null = OneDrive or Documents)
        public bool AutoBackupOff { get; set; }
        public long LastAutoBackup { get; set; }    // UTC ticks
        public bool GameFocusOff { get; set; }      // don't give the focus back to the game after a touch on the panel

        public SettingsData()
        {
            Port = 39812;
            Custom = new List<CustomShortcut>();
        }
    }

    /// <summary>Settings saved as JSON in %APPDATA%\ControlPanelHelper\settings.json.</summary>
    static class Settings
    {
        public static readonly string Folder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ControlHub");
        static readonly string FilePath = Path.Combine(Folder, "settings.json");
        static readonly object Gate = new object();
        public static SettingsData Current = new SettingsData();

        public static void Load()
        {
            lock (Gate)
            {
                try
                {
                    if (File.Exists(FilePath))
                    {
                        var data = new JavaScriptSerializer().Deserialize<SettingsData>(File.ReadAllText(FilePath));
                        if (data != null)
                        {
                            if (data.Custom == null) data.Custom = new List<CustomShortcut>();
                            if (data.Port <= 0 || data.Port > 65535) data.Port = 39812;
                            Current = data;
                        }
                    }
                }
                catch (Exception ex) { Log.Write("Settings load: " + ex.Message); }
            }
        }

        public static void Save()
        {
            lock (Gate)
            {
                try
                {
                    Directory.CreateDirectory(Folder);
                    File.WriteAllText(FilePath, new JavaScriptSerializer().Serialize(Current));
                }
                catch (Exception ex) { Log.Write("Settings save: " + ex.Message); }
            }
        }

        public static string NewId()
        {
            return Guid.NewGuid().ToString("N").Substring(0, 10);
        }
    }
}
