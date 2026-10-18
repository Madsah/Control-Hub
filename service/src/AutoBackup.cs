// Control Hub Service: the weekly automatic backup (one file with everything, see shared\src\BackupFile.cs).
// It checks every half hour whether a week has passed, keeps the newest 5 automatic backups, and never includes
// the password-protected logins (those only go into backups you make yourself in Control Hub).
// C# 5 / .NET Framework 4.x.
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Windows.Forms;
using ControlHubShared;

namespace ControlPanelHelper
{
    static class AutoBackup
    {
        public const int Keep = 5;
        static System.Threading.Timer timer;
        static int busy;

        public static string Folder
        {
            get { return string.IsNullOrEmpty(Settings.Current.BackupFolder) ? BackupFile.DefaultFolder() : Settings.Current.BackupFolder; }
        }

        public static void Start()
        {
            timer = new System.Threading.Timer(delegate { Check(); }, null, TimeSpan.FromMinutes(3), TimeSpan.FromMinutes(30));
        }

        static void Check()
        {
            if (Settings.Current.AutoBackupOff) return;
            var last = Settings.Current.LastAutoBackup > 0 ? new DateTime(Settings.Current.LastAutoBackup, DateTimeKind.Utc) : DateTime.MinValue;
            if ((DateTime.UtcNow - last).TotalDays < 7) return;
            Run();
        }

        /// <summary>Makes an automatic backup now (on this thread). Returns the file, or null.</summary>
        public static string Run()
        {
            if (Interlocked.Exchange(ref busy, 1) == 1) return null;
            try
            {
                string error;
                string folder = Folder;
                string file = BackupFile.Create(folder, "auto", null, Path.GetDirectoryName(Application.ExecutablePath), Program.Version, out error);
                if (file == null) { Log.Write("Automatic backup failed: " + error); return null; }
                Settings.Current.LastAutoBackup = DateTime.UtcNow.Ticks;
                Settings.Save();
                BackupFile.PruneAuto(folder, Keep);
                Log.Write("Automatic backup: " + file);
                return file;
            }
            catch (Exception ex) { Log.Write("Automatic backup: " + ex.Message); return null; }
            finally { Interlocked.Exchange(ref busy, 0); }
        }

        /// <summary>For Control Hub: on/off and where.</summary>
        public static Dictionary<string, object> Status()
        {
            var d = new Dictionary<string, object>();
            d["auto"] = !Settings.Current.AutoBackupOff;
            d["folder"] = Folder;
            d["keep"] = Keep;
            d["last"] = Settings.Current.LastAutoBackup > 0
                ? (long)(new DateTime(Settings.Current.LastAutoBackup, DateTimeKind.Utc) - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds
                : 0L;
            return d;
        }

        /// <summary>Control Hub changed the settings. folder: null = unchanged, "" = back to the default.</summary>
        public static void Set(bool auto, string folder)
        {
            Settings.Current.AutoBackupOff = !auto;
            if (folder != null)
            {
                folder = folder.Trim();
                if (folder.Length == 0) Settings.Current.BackupFolder = null;
                else if (Path.IsPathRooted(folder)) Settings.Current.BackupFolder = folder;
            }
            Settings.Save();
        }
    }
}
