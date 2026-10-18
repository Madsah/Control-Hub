// Control Hub — the app window: overview, projects, connections, panel, updates, backup and help.
// Control Hub Service (the tray part) does the work; this window only asks it.
// C# 5 / .NET Framework 4.x (built with the compiler that ships with Windows).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace ControlHub
{
    static class HubApp
    {
        public const string Version = "1.2.2";
        public const string Name = "Control Hub";
        public const string ServiceExe = "Control Hub Service.exe";
        public const string ServiceProcess = "Control Hub Service";

        [DllImport("user32.dll")] static extern IntPtr FindWindow(string cls, string title);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);

        public static string Folder { get { return Path.GetDirectoryName(Application.ExecutablePath); } }
        public static string ServicePath { get { return Path.Combine(Folder, ServiceExe); } }

        [STAThread]
        static void Main()
        {
            bool createdNew;
            using (var mutex = new Mutex(true, "ControlHub.App.SingleInstance", out createdNew))
            {
                if (!createdNew)
                {
                    // Already open: bring that window to the front.
                    IntPtr h = FindWindow(null, Name);
                    if (h != IntPtr.Zero) { ShowWindow(h, 9); SetForegroundWindow(h); }
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
                Application.ThreadException += delegate (object s, ThreadExceptionEventArgs e) { Report(e.Exception, false); };
                AppDomain.CurrentDomain.UnhandledException += delegate (object s, UnhandledExceptionEventArgs e) { Report(e.ExceptionObject as Exception, true); };
                Step("Starting Control Hub " + Version);
                // If the window hasn't appeared after 25 seconds, say where it got stuck instead of hanging silently.
                var watchdog = new Thread(delegate ()
                {
                    Thread.Sleep(25000);
                    if (Started) return;
                    Step("Stuck while starting");
                    MessageBox.Show("Control Hub got stuck while starting.\n\nLast step: " + lastStep + "\n\nPlease send Claude a screenshot of this. Details are in " + LogPath + ".\nControl Hub closes now.", Name, MessageBoxButtons.OK, MessageBoxIcon.Error);
                    Environment.Exit(1);
                });
                watchdog.IsBackground = true;
                watchdog.Start();
                try
                {
                    T.Init();
                    Step("Fonts and icons ready");
                    var form = new MainForm();
                    Step("Window built");
                    Application.Run(form);
                }
                catch (Exception ex) { Report(ex, true); }
            }
        }

        // ------------------------------------------------------------------ startup log and error reports

        public static volatile bool Started;
        static string lastStep = "";
        static readonly object LogGate = new object();

        public static string LogPath
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ControlHub", "hub.log"); }
        }

        /// <summary>Writes a line to hub.log (kept small), so a crash or hang while starting shows how far it got.</summary>
        public static void Step(string what)
        {
            lastStep = what;
            lock (LogGate)
            {
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(LogPath));
                    if (File.Exists(LogPath) && new FileInfo(LogPath).Length > 200 * 1024) File.Delete(LogPath);
                    File.AppendAllText(LogPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + what + Environment.NewLine);
                }
                catch { }
            }
        }

        /// <summary>Shows what went wrong (and saves it in hub.log) instead of disappearing without a word.</summary>
        public static void Report(Exception ex, bool fatal)
        {
            string text = ex == null ? "Unknown error" : ex.ToString();
            Step((fatal ? "Crash" : "Error") + " after \"" + lastStep + "\": " + text);
            try
            {
                MessageBox.Show("Control Hub " + (fatal ? "couldn't start" : "hit an error") + ".\n\n" + (ex != null ? ex.GetType().Name + ": " + ex.Message : "") +
                    "\n\nLast step: " + lastStep + "\n\nPlease send Claude a screenshot of this. The full details are in " + LogPath + ".",
                    Name, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            catch { }
            if (fatal) Environment.Exit(1);
        }

        public static Icon AppIcon(int size)
        {
            try
            {
                var s = typeof(HubApp).Assembly.GetManifestResourceStream("ControlHub.ico");
                if (s != null) using (s) return new Icon(s, size, size);
            }
            catch { }
            return SystemIcons.Application;
        }

        public static bool ServiceRunning()
        {
            var ps = Process.GetProcessesByName(ServiceProcess);
            bool any = ps.Length > 0;
            foreach (var p in ps) p.Dispose();
            return any;
        }

        public static void StartService()
        {
            try
            {
                if (File.Exists(ServicePath)) Process.Start(new ProcessStartInfo(ServicePath) { UseShellExecute = true, WorkingDirectory = Folder });
                else MessageBox.Show("Control Hub Service isn't installed next to Control Hub.\nRun \"Install Control Hub.bat\" again.", Name);
            }
            catch (Exception ex) { MessageBox.Show("Couldn't start Control Hub Service: " + ex.Message, Name); }
        }

        /// <summary>Closes the service (it's started again with StartService).</summary>
        public static void StopService()
        {
            foreach (var p in Process.GetProcessesByName(ServiceProcess))
            {
                try { p.Kill(); p.WaitForExit(4000); } catch { }
                finally { p.Dispose(); }
            }
            Thread.Sleep(400);
        }

        /// <summary>Closes the service and starts it again (used after changes and for "Restart").</summary>
        public static void RestartService()
        {
            StopService();
            StartService();
        }

        public static void Open(string path)
        {
            try { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); }
            catch (Exception ex) { MessageBox.Show("Couldn't open " + path + "\n" + ex.Message, Name); }
        }
    }
}
