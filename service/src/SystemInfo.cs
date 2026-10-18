using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace ControlPanelHelper
{
    /// <summary>CPU, RAM, network and drives. Measured only when the widget asks.</summary>
    static class SystemInfo
    {
        [StructLayout(LayoutKind.Sequential)]
        struct FILETIME { public uint Low; public uint High; public ulong Value { get { return ((ulong)High << 32) | Low; } } }

        [DllImport("kernel32.dll")]
        static extern bool GetSystemTimes(out FILETIME idle, out FILETIME kernel, out FILETIME user);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        class MEMORYSTATUSEX
        {
            public uint dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
            public uint dwMemoryLoad;
            public ulong ullTotalPhys, ullAvailPhys, ullTotalPageFile, ullAvailPageFile, ullTotalVirtual, ullAvailVirtual, ullAvailExtendedVirtual;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        static extern bool GlobalMemoryStatusEx([In, Out] MEMORYSTATUSEX buffer);

        static readonly object Gate = new object();
        static ulong lastIdle, lastTotal;
        static int lastCpu;
        static long lastRx, lastTx;
        static DateTime lastNetAt = DateTime.MinValue;
        static double rxRate, txRate;

        public static int CpuLoad()
        {
            lock (Gate)
            {
                FILETIME idle, kernel, user;
                if (!GetSystemTimes(out idle, out kernel, out user)) return lastCpu;
                ulong total = kernel.Value + user.Value; // kernel time includes idle
                ulong dIdle = idle.Value - lastIdle, dTotal = total - lastTotal;
                lastIdle = idle.Value; lastTotal = total;
                if (dTotal > 0 && dTotal < ulong.MaxValue / 2)
                    lastCpu = (int)Math.Round(100.0 * (1.0 - (double)dIdle / dTotal));
                return Math.Max(0, Math.Min(100, lastCpu));
            }
        }

        public static Dictionary<string, object> Memory()
        {
            var m = new MEMORYSTATUSEX();
            var d = new Dictionary<string, object>();
            if (GlobalMemoryStatusEx(m))
            {
                d["percent"] = (int)m.dwMemoryLoad;
                d["usedGB"] = Math.Round((m.ullTotalPhys - m.ullAvailPhys) / 1073741824.0, 1);
                d["totalGB"] = Math.Round(m.ullTotalPhys / 1073741824.0, 1);
            }
            return d;
        }

        /// <summary>Download/upload speed in bytes per second across active network adapters.</summary>
        public static Dictionary<string, object> Network()
        {
            lock (Gate)
            {
                long rx = 0, tx = 0;
                try
                {
                    foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
                    {
                        if (nic.OperationalStatus != OperationalStatus.Up) continue;
                        if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback || nic.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;
                        var s = nic.GetIPStatistics();
                        rx += s.BytesReceived;
                        tx += s.BytesSent;
                    }
                }
                catch { }
                var now = DateTime.UtcNow;
                double secs = (now - lastNetAt).TotalSeconds;
                if (lastNetAt != DateTime.MinValue && secs > 0.2)
                {
                    rxRate = Math.Max(0, (rx - lastRx) / secs);
                    txRate = Math.Max(0, (tx - lastTx) / secs);
                }
                if (secs > 0.2 || lastNetAt == DateTime.MinValue)
                {
                    lastRx = rx; lastTx = tx; lastNetAt = now;
                }
                var d = new Dictionary<string, object>();
                d["down"] = (long)rxRate;
                d["up"] = (long)txRate;
                return d;
            }
        }

        public static List<Dictionary<string, object>> Drives()
        {
            var list = new List<Dictionary<string, object>>();
            try
            {
                foreach (var drive in DriveInfo.GetDrives())
                {
                    try
                    {
                        if (drive.DriveType != DriveType.Fixed || !drive.IsReady) continue;
                        var d = new Dictionary<string, object>();
                        d["name"] = drive.Name.TrimEnd('\\');
                        d["label"] = drive.VolumeLabel ?? "";
                        d["totalGB"] = Math.Round(drive.TotalSize / 1073741824.0, 0);
                        d["freeGB"] = Math.Round(drive.TotalFreeSpace / 1073741824.0, 0);
                        list.Add(d);
                    }
                    catch { }
                }
            }
            catch { }
            return list;
        }
    }

    /// <summary>Lock, sleep, restart, shut down, Windows shortcut keys and quick actions.</summary>
    static class Power
    {
        [DllImport("user32.dll")]
        static extern bool LockWorkStation();
        [DllImport("user32.dll")]
        static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

        const uint KEYUP = 0x2, EXTENDED = 0x1;
        const byte VK_LWIN = 0x5B, VK_D = 0x44;

        public static bool Run(string what)
        {
            try
            {
                switch (what)
                {
                    case "lock": return LockWorkStation();
                    case "sleep":
                        // Small delay so the widget's reply gets out first.
                        ThreadPool.QueueUserWorkItem(delegate { Thread.Sleep(600); Application.SetSuspendState(PowerState.Suspend, false, false); });
                        return true;
                    case "restart": return Shutdown("/r /t 0");
                    case "shutdown": return Shutdown("/s /t 0");
                    default: return false;
                }
            }
            catch (Exception ex) { Log.Write("Power " + what + ": " + ex.Message); return false; }
        }

        static bool Shutdown(string args)
        {
            Process.Start(new ProcessStartInfo("shutdown.exe", args) { CreateNoWindow = true, UseShellExecute = false });
            return true;
        }

        /// <summary>Built-in quick actions. Only these names are accepted.</summary>
        public static bool Quick(string what)
        {
            try
            {
                switch (what)
                {
                    case "desktop":
                        keybd_event(VK_LWIN, 0, EXTENDED, UIntPtr.Zero);
                        keybd_event(VK_D, 0, 0, UIntPtr.Zero);
                        keybd_event(VK_D, 0, KEYUP, UIntPtr.Zero);
                        keybd_event(VK_LWIN, 0, EXTENDED | KEYUP, UIntPtr.Zero);
                        return true;
                    case "screenshot": return Shell("ms-screenclip:");
                    case "taskmanager": return Shell("taskmgr.exe");
                    case "settings": return Shell("ms-settings:");
                    case "explorer": return Shell("explorer.exe");
                    case "calculator": return Shell("calc.exe");
                    case "sound": return Shell("ms-settings:sound");
                    case "nightlight": return Shell("ms-settings:nightlight");
                    case "display": return Shell("ms-settings:display");
                    case "winupdate": return Shell("ms-settings:windowsupdate");
                    case "storage": return Shell("ms-settings:storagesense");
                    case "notifications": return Shell("ms-settings:notifications");
                    case "lock": return LockWorkStation();
                    default: return false;
                }
            }
            catch (Exception ex) { Log.Write("Quick " + what + ": " + ex.Message); return false; }
        }

        static bool Shell(string target)
        {
            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
            return true;
        }
    }

    /// <summary>Keeps the PC and screen awake while switched on.</summary>
    static class KeepAwake
    {
        [DllImport("kernel32.dll")]
        static extern uint SetThreadExecutionState(uint flags);
        const uint ES_CONTINUOUS = 0x80000000, ES_SYSTEM_REQUIRED = 0x1, ES_DISPLAY_REQUIRED = 0x2;

        static Thread worker;
        static ManualResetEvent stop;
        public static bool On { get; private set; }

        public static void Set(bool on)
        {
            lock (typeof(KeepAwake))
            {
                if (on == On) return;
                On = on;
                if (on)
                {
                    stop = new ManualResetEvent(false);
                    var s = stop;
                    // The request lasts as long as the thread that made it, so keep one sleeping thread around.
                    worker = new Thread(delegate ()
                    {
                        SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED);
                        s.WaitOne();
                        SetThreadExecutionState(ES_CONTINUOUS);
                    });
                    worker.IsBackground = true;
                    worker.Start();
                }
                else if (stop != null)
                {
                    stop.Set();
                    stop = null;
                    worker = null;
                }
            }
        }
    }
}
