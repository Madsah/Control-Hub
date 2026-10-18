using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;

namespace ControlPanelHelper
{
    /// <summary>
    /// Running programs, for the widget's automatic pages ("show the Flight sim page when MSFS starts").
    /// Only checked when the widget asks, which it only does when a page has such a rule.
    /// </summary>
    static class Running
    {
        static readonly Regex ExeName = new Regex(@"^[A-Za-z0-9 _.\-()+]{1,80}$");
        static readonly HashSet<string> Skip = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "explorer", "ApplicationFrameHost", "TextInputHost", "SystemSettings", "ShellExperienceHost",
            "SearchHost", "StartMenuExperienceHost", "LockApp", "iCUE", "Control Panel Helper", "Control Hub Service", "Control Hub",
        };

        /// <summary>Which of the given program names (like "flightsimulator2024.exe") are running now.</summary>
        public static List<string> Which(string watch)
        {
            var found = new List<string>();
            if (string.IsNullOrEmpty(watch)) return found;
            int n = 0;
            foreach (var raw in watch.Split(','))
            {
                string exe = raw.Trim().ToLowerInvariant();
                if (exe.Length == 0 || !ExeName.IsMatch(exe) || ++n > 20) continue;
                string name = exe.EndsWith(".exe") ? exe.Substring(0, exe.Length - 4) : exe;
                Process[] list = null;
                try
                {
                    list = Process.GetProcessesByName(name);
                    if (list.Length > 0 && !found.Contains(exe)) found.Add(exe);
                }
                catch { }
                finally
                {
                    if (list != null) foreach (var p in list) p.Dispose();
                }
            }
            return found;
        }

        /// <summary>Programs with an open window, for picking one in the widget.</summary>
        public static List<Dictionary<string, object>> Windows()
        {
            var outList = new List<Dictionary<string, object>>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            int self = Process.GetCurrentProcess().Id;
            foreach (var p in Process.GetProcesses())
            {
                try
                {
                    if (p.Id == self || p.MainWindowHandle == IntPtr.Zero || string.IsNullOrEmpty(p.MainWindowTitle)) continue;
                    if (Skip.Contains(p.ProcessName)) continue;
                    string exe = p.ProcessName.ToLowerInvariant() + ".exe";
                    if (!seen.Add(exe)) continue;
                    string path = ProcessInfo.ExePath(p.Id);
                    var d = new Dictionary<string, object>();
                    d["exe"] = exe;
                    d["name"] = ProcessInfo.FriendlyName(p.Id, path) ?? p.ProcessName;
                    if (!string.IsNullOrEmpty(path)) d["icon"] = Icons.Register(path);
                    outList.Add(d);
                }
                catch { }
                finally { p.Dispose(); }
            }
            outList.Sort(delegate (Dictionary<string, object> a, Dictionary<string, object> b)
            {
                return string.Compare((string)a["name"], (string)b["name"], StringComparison.OrdinalIgnoreCase);
            });
            return outList;
        }
    }
}
