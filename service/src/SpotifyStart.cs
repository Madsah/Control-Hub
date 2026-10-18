// Start Spotify from the panel: when nothing can play because the Spotify app isn't running (or isn't the active
// device), start it hidden, wait until Spotify lists this PC as a device, move playback here and play.
// C# 5 / .NET Framework 4.x.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace ControlPanelHelper
{
    static partial class Spotify
    {
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
        const int SW_MINIMIZE = 6;

        static volatile bool starting;
        [ThreadStatic] static bool inStart;

        /// <summary>True while Spotify is being started for you (the panel shows "Starting Spotify…").</summary>
        public static bool Starting { get { return starting; } }

        static bool WantsDevice(string what) { return what == "play" || what == "playlist" || what == "uri"; }

        /// <summary>
        /// Called when Spotify answered "no active device" (404). Starts Spotify (if needed) and plays in the background,
        /// so the panel's request returns right away.
        /// </summary>
        static bool StartInBackground(string what, string uri, int value)
        {
            if (inStart) return false;   // already the second try inside the background job
            if (starting) return true;   // a start is already on its way
            starting = true;
            Events.Bump();
            var t = new Thread(delegate ()
            {
                inStart = true;
                try { StartAndPlay(what, uri, value); }
                catch (Exception ex) { Log.Write("Spotify start: " + ex.Message); }
                finally
                {
                    inStart = false;
                    starting = false;
                    lock (Gate) { playerAt = DateTime.MinValue; }
                    Events.Bump();
                }
            });
            t.IsBackground = true;
            t.Name = "Spotify start";
            t.Start();
            return true;
        }

        static void StartAndPlay(string what, string uri, int value)
        {
            bool wasRunning = SpotifyRunning();
            if (!wasRunning)
            {
                if (!LaunchHidden()) { LastError = "Couldn't start Spotify. Is the Spotify app installed on this PC?"; return; }
                Log.Write("Spotify: started the app for the panel");
            }

            // Spotify needs a few seconds after starting before it shows up as a device.
            string id = null;
            for (int i = 0; i < 25 && id == null; i++)
            {
                id = FindPcDevice();
                if (id == null)
                {
                    if (!wasRunning && i < 8) MinimizeWindow();
                    Thread.Sleep(1000);
                }
            }

            if (id != null)
            {
                var body = new Dictionary<string, object>();
                body["device_ids"] = new[] { id };
                body["play"] = what == "play";
                var tr = Api("PUT", "/me/player", Http.Json.Serialize(body));
                if (tr.Key >= 300) Log.Write("Spotify: moving playback here failed: " + tr.Key);
                if (what != "play")
                {
                    Thread.Sleep(700);
                    Do(what, uri, value);
                }
                return;
            }

            // Spotify never showed up as a device. If we started it, press play like a keyboard's play key:
            // the Spotify app then carries on with the last music.
            if (!wasRunning && SpotifyRunning())
            {
                Log.Write("Spotify: not listed as a device after starting, pressing play instead");
                Keys.Press("mediaplaypause");
            }
            else LastError = "Spotify didn't answer. Open the Spotify app once and try again.";
        }

        static bool SpotifyRunning()
        {
            var ps = Process.GetProcessesByName("Spotify");
            bool any = ps.Length > 0;
            foreach (var p in ps) p.Dispose();
            return any;
        }

        /// <summary>Starts the Spotify app without showing its window (the usual installer, or the Microsoft Store version).</summary>
        static bool LaunchHidden()
        {
            string exe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Spotify\Spotify.exe");
            try
            {
                if (File.Exists(exe))
                {
                    Process.Start(new ProcessStartInfo(exe, "--minimized") { UseShellExecute = true, WindowStyle = ProcessWindowStyle.Minimized });
                    return true;
                }
                // Microsoft Store version: start it through its link; the window is minimised as soon as it appears.
                Process.Start(new ProcessStartInfo("spotify:") { UseShellExecute = true, WindowStyle = ProcessWindowStyle.Minimized });
                return true;
            }
            catch (Exception ex)
            {
                Log.Write("Spotify: couldn't start the app: " + ex.Message);
                return false;
            }
        }

        static void MinimizeWindow()
        {
            try
            {
                foreach (var p in Process.GetProcessesByName("Spotify"))
                {
                    try { if (p.MainWindowHandle != IntPtr.Zero) ShowWindow(p.MainWindowHandle, SW_MINIMIZE); }
                    catch { }
                    finally { p.Dispose(); }
                }
            }
            catch { }
        }

        /// <summary>This PC's Spotify device id, or null if Spotify doesn't list it (yet).</summary>
        static string FindPcDevice()
        {
            var r = Api("GET", "/me/player/devices", null);
            if (r.Key != 200) return null;
            var d = Http.Parse(r.Value);
            if (d == null || !d.ContainsKey("devices")) return null;
            string first = null;
            foreach (var x in (IEnumerable)d["devices"])
            {
                var dev = x as Dictionary<string, object>;
                if (dev == null) continue;
                if (dev.ContainsKey("is_restricted") && dev["is_restricted"] is bool && (bool)dev["is_restricted"]) continue;
                string type = Http.Str(dev, "type") ?? "";
                if (!type.Equals("Computer", StringComparison.OrdinalIgnoreCase)) continue;
                string id = Http.Str(dev, "id");
                if (string.IsNullOrEmpty(id)) continue;
                string name = Http.Str(dev, "name") ?? "";
                if (name.Equals(Environment.MachineName, StringComparison.OrdinalIgnoreCase)) return id;
                if (first == null) first = id;
            }
            return first;
        }
    }
}
