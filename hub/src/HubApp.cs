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
        public const string Version = "1.2.0";
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
                T.Init();
                Application.Run(new MainForm());
            }
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
