// Control Hub updates from GitHub.
//
// On purpose this part only checks, downloads and unpacks. The actual installing is done by
// "Install Control Hub.bat" from the NEW version (started with /update). So how things are installed —
// new parts, new projects, a new widget, even this updater — can change with any update.
// C# 5 / .NET Framework 4.x.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Text;

namespace ControlHub
{
    static class Updater
    {
        public class Info
        {
            public string Version;        // the new version, e.g. "1.1.0"
            public List<string> Notes = new List<string>();
            public bool Newer;            // newer than what's installed
            public string Error;          // why checking didn't work
        }

        /// <summary>Where updates come from: update.json in the program folder (owner/repo/branch), else the defaults.</summary>
        public static string Owner = "Madsah", Repo = "Control-Hub", Branch = "main";

        static readonly string WorkRoot = Path.Combine(Path.GetTempPath(), "ControlHubUpdate");

        static Updater()
        {
            // GitHub only accepts TLS 1.2 or newer; .NET Framework doesn't always offer it by itself.
            try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; } catch { }
            try
            {
                string f = Path.Combine(HubApp.Folder, "update.json");
                if (File.Exists(f))
                {
                    var d = HubApi.Parse(File.ReadAllText(f, Encoding.UTF8));
                    string o = HubApi.Str(d, "owner"), r = HubApi.Str(d, "repo"), b = HubApi.Str(d, "branch");
                    if (Safe(o)) Owner = o;
                    if (Safe(r)) Repo = r;
                    if (Safe(b)) Branch = b;
                }
            }
            catch { }
        }

        static bool Safe(string s)
        {
            if (string.IsNullOrEmpty(s) || s.Length > 100) return false;
            foreach (char c in s) if (!(char.IsLetterOrDigit(c) || c == '-' || c == '_' || c == '.')) return false;
            return true;
        }

        /// <summary>The installed version (version.json next to the program).</summary>
        public static string Installed()
        {
            try
            {
                string f = Path.Combine(HubApp.Folder, "version.json");
                if (File.Exists(f)) return HubApi.Str(HubApi.Parse(File.ReadAllText(f, Encoding.UTF8)), "version") ?? "0.0.0";
            }
            catch { }
            return "0.0.0";
        }

        static WebClient Client()
        {
            var w = new WebClient();
            w.Headers[HttpRequestHeader.UserAgent] = "ControlHub/" + HubApp.Version;
            w.Headers[HttpRequestHeader.CacheControl] = "no-cache";
            w.Encoding = Encoding.UTF8;
            return w;
        }

        /// <summary>Reads version.json on GitHub. Runs on a background thread.</summary>
        public static Info Check()
        {
            var info = new Info();
            try
            {
                string url = "https://raw.githubusercontent.com/" + Owner + "/" + Repo + "/" + Branch + "/version.json?t=" + DateTime.UtcNow.Ticks;
                string text;
                using (var w = Client()) text = w.DownloadString(url);
                var d = HubApi.Parse(text);
                info.Version = HubApi.Str(d, "version");
                info.Notes = HubApi.Strings(d, "notes");
                if (string.IsNullOrEmpty(info.Version)) { info.Error = "GitHub's version file looks wrong."; return info; }
                info.Newer = Compare(info.Version, Installed()) > 0;
            }
            catch (WebException ex)
            {
                info.Error = ex.Response == null ? "Couldn't reach GitHub. Is the PC online?" : "GitHub answered: " + ex.Message;
            }
            catch (Exception ex) { info.Error = ex.Message; }
            return info;
        }

        /// <summary>1 if a is newer than b, -1 if older, 0 if the same ("1.10.0" is newer than "1.9.2").</summary>
        public static int Compare(string a, string b)
        {
            string[] x = (a ?? "0").Split('.'), y = (b ?? "0").Split('.');
            for (int i = 0; i < Math.Max(x.Length, y.Length); i++)
            {
                int p = 0, q = 0;
                if (i < x.Length) int.TryParse(x[i], out p);
                if (i < y.Length) int.TryParse(y[i], out q);
                if (p != q) return p > q ? 1 : -1;
            }
            return 0;
        }

        /// <summary>
        /// Downloads the newest version and unpacks it. Returns the folder that holds "Install Control Hub.bat",
        /// or null (with the reason in error). Runs on a background thread.
        /// </summary>
        public static string Download(Action<string> progress, out string error)
        {
            error = null;
            try
            {
                // Each update gets its own folder: an older one may still be in use (a program started from it).
                CleanOld();
                string Work = Path.Combine(WorkRoot, DateTime.Now.ToString("yyyyMMdd-HHmmss"));
                Directory.CreateDirectory(Work);
                string zip = Path.Combine(Work, "update.zip");
                string url = "https://codeload.github.com/" + Owner + "/" + Repo + "/zip/refs/heads/" + Branch;
                if (progress != null) progress("Downloading the new version…");
                using (var w = Client()) w.DownloadFile(url, zip);
                if (new FileInfo(zip).Length < 1000) { error = "The download was empty."; return null; }
                if (progress != null) progress("Unpacking…");
                string dir = Path.Combine(Work, "files");
                ZipFile.ExtractToDirectory(zip, dir);
                // GitHub puts everything in one folder named like "control-hub-main".
                foreach (var d in Directory.GetDirectories(dir))
                    if (File.Exists(Path.Combine(d, "Install Control Hub.bat"))) return d;
                if (File.Exists(Path.Combine(dir, "Install Control Hub.bat"))) return dir;
                error = "The download doesn't contain the installer.";
                return null;
            }
            catch (WebException ex) { error = ex.Response == null ? "Couldn't reach GitHub. Is the PC online?" : "GitHub answered: " + ex.Message; }
            catch (Exception ex) { error = ex.Message; }
            return null;
        }

        /// <summary>Removes earlier update folders (and the old single folder); ones still in use are left for next time.</summary>
        static void CleanOld()
        {
            try
            {
                if (!Directory.Exists(WorkRoot)) return;
                foreach (var d in Directory.GetDirectories(WorkRoot))
                    try { Directory.Delete(d, true); } catch { }
                foreach (var f in Directory.GetFiles(WorkRoot))
                    try { File.Delete(f); } catch { }
            }
            catch { }
        }

        /// <summary>Starts the new version's installer in update mode. Control Hub closes right after.</summary>
        public static bool RunInstaller(string folder)
        {
            try
            {
                string bat = Path.Combine(folder, "Install Control Hub.bat");
                var psi = new ProcessStartInfo("cmd.exe", "/c \"\"" + bat + "\" /update\"")
                {
                    UseShellExecute = true,
                    WorkingDirectory = folder
                };
                Process.Start(psi);
                return true;
            }
            catch { return false; }
        }

        /// <summary>The previous version, kept by the installer, can be put back.</summary>
        public static bool CanGoBack()
        {
            return File.Exists(Path.Combine(HubApp.Folder, "previous", "Control Hub Service.exe")) &&
                   File.Exists(Path.Combine(HubApp.Folder, "Restore previous version.bat"));
        }

        public static string PreviousVersion()
        {
            try
            {
                string f = Path.Combine(HubApp.Folder, "previous", "version.json");
                if (File.Exists(f)) return HubApi.Str(HubApi.Parse(File.ReadAllText(f, Encoding.UTF8)), "version");
            }
            catch { }
            return null;
        }

        public static bool GoBack()
        {
            try
            {
                string bat = Path.Combine(HubApp.Folder, "Restore previous version.bat");
                Process.Start(new ProcessStartInfo("cmd.exe", "/c \"\"" + bat + "\"\"") { UseShellExecute = true, WorkingDirectory = HubApp.Folder });
                return true;
            }
            catch { return false; }
        }
    }
}
