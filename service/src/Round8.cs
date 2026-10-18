using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace ControlPanelHelper
{
    /// <summary>
    /// Mic test: records a few seconds from your Windows default microphone and plays it back
    /// through your default speakers/headphones, so you hear what others hear. Nothing is kept:
    /// the recording is deleted right after.
    /// </summary>
    static class MicTest
    {
        [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
        static extern int mciSendString(string command, StringBuilder ret, int retLen, IntPtr callback);

        static readonly object Gate = new object();
        static readonly ManualResetEvent stop = new ManualResetEvent(false);
        static string phase = "idle", error;
        static DateTime phaseEnd;
        static int seconds;

        public static Dictionary<string, object> State()
        {
            lock (Gate)
            {
                var d = new Dictionary<string, object>();
                d["phase"] = phase;
                d["secs"] = seconds;
                d["left"] = phase == "idle" ? 0 : Math.Max(0, (phaseEnd - DateTime.UtcNow).TotalSeconds);
                if (error != null) d["error"] = error;
                return d;
            }
        }

        public static bool Start(int secs)
        {
            lock (Gate)
            {
                if (phase != "idle") return false;
                seconds = Math.Max(2, Math.Min(15, secs <= 0 ? 5 : secs));
                phase = "starting";
                error = null;
                phaseEnd = DateTime.UtcNow.AddSeconds(seconds);
            }
            stop.Reset();
            new Thread(Run) { IsBackground = true, Name = "mictest" }.Start();
            return true;
        }

        public static void Cancel() { stop.Set(); }

        static int Mci(string cmd)
        {
            int r = mciSendString(cmd, null, 0, IntPtr.Zero);
            if (r != 0) Log.Write("Mic test: '" + cmd.Split(' ')[0] + "' answered " + r);
            return r;
        }

        static void Run()
        {
            string file = Path.Combine(Path.GetTempPath(), "control-panel-mictest.wav");
            bool open = false;
            try
            {
                mciSendString("close cpmictest", null, 0, IntPtr.Zero);
                if (Mci("open new type waveaudio alias cpmictest") != 0) throw new Exception("Windows couldn't open your microphone");
                open = true;
                // Good quality mono; if the mic doesn't take it, Windows' default format is used.
                Mci("set cpmictest time format ms bitspersample 16 channels 1 samplespersec 44100 bytespersec 88200 alignment 2");
                if (Mci("record cpmictest") != 0) throw new Exception("Windows couldn't record from your microphone");
                lock (Gate) { phase = "recording"; phaseEnd = DateTime.UtcNow.AddSeconds(seconds); }
                bool cancelled = stop.WaitOne(seconds * 1000);
                Mci("stop cpmictest");
                if (cancelled) return;
                if (File.Exists(file)) File.Delete(file);
                if (Mci("save cpmictest \"" + file + "\"") != 0) throw new Exception("Windows couldn't save the recording");
                Mci("close cpmictest");
                open = false;
                lock (Gate) { phase = "playing"; phaseEnd = DateTime.UtcNow.AddSeconds(seconds); }
                using (var player = new System.Media.SoundPlayer(file))
                {
                    player.Load();
                    player.Play();
                    if (stop.WaitOne(seconds * 1000 + 400)) player.Stop();
                }
            }
            catch (Exception ex)
            {
                lock (Gate) error = ex.Message;
                Log.Write("Mic test: " + ex.Message);
            }
            finally
            {
                if (open) mciSendString("close cpmictest", null, 0, IntPtr.Zero);
                try { if (File.Exists(file)) File.Delete(file); } catch { }
                lock (Gate) { phase = "idle"; }
            }
        }
    }
}
