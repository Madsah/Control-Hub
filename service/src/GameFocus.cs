// Control Hub Service: keeps the game in front when you touch the panel.
//
// A touch on the XENEON EDGE can make Windows move the focus from the game to the panel's window for a moment.
// The game then lets go of the mouse, and the mouse pointer shows up on the main screen.
// When the front window changes from a game straight to a window on the panel's screen, this gives the focus
// back to the game and puts the mouse back where it was in the game.
// Only a window change is watched (no polling), plus a light 4-per-second mouse check while a game is in front.
// C# 5 / .NET Framework 4.x.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace ControlPanelHelper
{
    static class GameFocus
    {
        delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);

        [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
        [StructLayout(LayoutKind.Sequential)]
        struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }

        [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventProc proc, uint pid, uint tid, uint flags);
        [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
        [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
        [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT p, uint flags);
        [DllImport("user32.dll", EntryPoint = "GetMonitorInfoW")] static extern bool GetMonitorInfo(IntPtr mon, ref MONITORINFO mi);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
        [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
        [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
        [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int max);

        const uint EVENT_SYSTEM_FOREGROUND = 0x0003, OUTOFCONTEXT_SKIPOWN = 0x0002, GA_ROOT = 2, MONITOR_DEFAULTTONEAREST = 2;

        // Games that often run in a window rather than full screen still count.
        static readonly string[] GameExes = { "flightsimulator", "flightsimulator2024", "cs2", "msfs2024" };

        static WinEventProc proc;          // kept, so it isn't collected while Windows still calls it
        static IntPtr game = IntPtr.Zero;   // the game that's in front (or was, right before the panel took the focus)
        static POINT gameCursor;
        static bool haveCursor;
        static DateTime lastGive = DateTime.MinValue;
        static int givesInRow;
        static Timer cursorTimer, giveTimer;
        static IntPtr pending = IntPtr.Zero;      // the game to give the focus back to, in a moment
        static DateTime pausedUntil = DateTime.MinValue;
        static readonly object Gate = new object();

        // Panel buttons that open something: that program should come to the front, so the game is let go.
        static readonly string[] Opens = { "launch", "openUrl", "quick", "winFocus", "appOut", "steamRun", "fileOpen", "downloadsFolder",
            "screensFolder", "openSettings", "notifOpen", "openScreen", "gameReopen", "power", "cleanup" };
        const int GiveAfterMs = 450;  // a tap's button press arrives within this time

        public static bool On { get { return !Settings.Current.GameFocusOff; } }

        public static void Set(bool on)
        {
            Settings.Current.GameFocusOff = !on;
            Settings.Save();
            if (!on) Forget();
        }

        /// <summary>Call on the UI thread (the window hook needs its message loop).</summary>
        public static void Start()
        {
            proc = OnForeground;
            cursorTimer = new Timer(delegate { TrackCursor(); }, null, Timeout.Infinite, Timeout.Infinite);
            giveTimer = new Timer(delegate { GiveNow(); }, null, Timeout.Infinite, Timeout.Infinite);
            SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, proc, 0, 0, OUTOFCONTEXT_SKIPOWN);
        }

        static void Forget()
        {
            lock (Gate)
            {
                game = IntPtr.Zero;
                pending = IntPtr.Zero;
                haveCursor = false;
            }
            try { cursorTimer.Change(Timeout.Infinite, Timeout.Infinite); } catch { }
            try { giveTimer.Change(Timeout.Infinite, Timeout.Infinite); } catch { }
        }

        /// <summary>Called for every panel button press. One that opens a program lets go of the game.</summary>
        public static void Acting(string action)
        {
            if (action == null || Array.IndexOf(Opens, action) < 0 || giveTimer == null) return;
            pausedUntil = DateTime.UtcNow.AddSeconds(4);
            Forget();
        }

        static void OnForeground(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
        {
            try
            {
                if (!On || hwnd == IntPtr.Zero) return;
                IntPtr w = GetAncestor(hwnd, GA_ROOT);
                if (w == IntPtr.Zero) w = hwnd;

                if (IsGame(w))
                {
                    if (w != game) haveCursor = false;
                    game = w;
                    cursorTimer.Change(250, 250);
                    return;
                }

                IntPtr g = game;
                if (g == IntPtr.Zero) return;
                if (!IsWindow(g) || IsIconic(g) || !IsWindowVisible(g)) { Forget(); return; }
                // Anything other than the panel (Alt+Tab, a program the panel opened): you meant to leave the game.
                if (!OnPanelScreen(w)) { Forget(); return; }

                if (DateTime.UtcNow < pausedUntil) { Forget(); return; }
                // Never fight over the focus: at most a few times in a row.
                var now = DateTime.UtcNow;
                givesInRow = (now - lastGive).TotalMilliseconds < 1500 ? givesInRow + 1 : 0;
                lastGive = now;
                if (givesInRow > 4) return;

                // Not right away: if the touch was on a button that opens a program, that program should win.
                lock (Gate) pending = g;
                giveTimer.Change(GiveAfterMs, Timeout.Infinite);
            }
            catch (Exception ex) { Log.Write("Game focus: " + ex.Message); }
        }

        static void GiveNow()
        {
            try
            {
                IntPtr g;
                lock (Gate) { g = pending; pending = IntPtr.Zero; }
                if (g == IntPtr.Zero || !On || DateTime.UtcNow < pausedUntil || !IsWindow(g)) return;
                // Only while the panel still has the focus.
                IntPtr front = GetForegroundWindow();
                if (front == g || front == IntPtr.Zero || !OnPanelScreen(front)) return;
                Give(g);
            }
            catch (Exception ex) { Log.Write("Game focus: " + ex.Message); }
        }

        static void Give(IntPtr g)
        {
            uint pid;
            uint front = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
            uint me = GetCurrentThreadId();
            // Windows only lets the program that has the focus hand it on; sharing its input for a moment allows it.
            bool joined = front != 0 && front != me && AttachThreadInput(me, front, true);
            try
            {
                BringWindowToTop(g);
                SetForegroundWindow(g);
            }
            finally
            {
                if (joined) AttachThreadInput(me, front, false);
            }
            // The touch moved the mouse to the panel: put it back where it was in the game.
            POINT p;
            if (haveCursor && GetCursorPos(out p) && OnWideScreen(MonitorFromPoint(p, MONITOR_DEFAULTTONEAREST)))
                SetCursorPos(gameCursor.X, gameCursor.Y);
        }

        // While a game is in front: remember where the mouse is (only when it's on the game's screen).
        static void TrackCursor()
        {
            try
            {
                IntPtr g = game;
                if (g == IntPtr.Zero) return;
                if (GetForegroundWindow() != g) return;
                POINT p;
                if (!GetCursorPos(out p)) return;
                if (OnWideScreen(MonitorFromPoint(p, MONITOR_DEFAULTTONEAREST))) return;
                gameCursor = p;
                haveCursor = true;
            }
            catch { }
        }

        static RECT MonitorRect(IntPtr mon)
        {
            var mi = new MONITORINFO();
            mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
            if (mon == IntPtr.Zero || !GetMonitorInfo(mon, ref mi)) return new RECT();
            return mi.rcMonitor;
        }

        // The XENEON EDGE is a very wide, low screen (2560 × 720). No normal monitor is 2.8 times wider than tall.
        static bool OnWideScreen(IntPtr mon)
        {
            RECT r = MonitorRect(mon);
            int w = r.Right - r.Left, h = r.Bottom - r.Top;
            return h > 0 && w >= h * 2.8;
        }

        static bool OnPanelScreen(IntPtr w)
        {
            return OnWideScreen(MonitorFromWindow(w, MONITOR_DEFAULTTONEAREST));
        }

        static bool IsGame(IntPtr w)
        {
            if (!IsWindowVisible(w) || IsIconic(w)) return false;
            var cls = new StringBuilder(64);
            GetClassName(w, cls, cls.Capacity);
            string c = cls.ToString();
            if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return false;
            IntPtr mon = MonitorFromWindow(w, MONITOR_DEFAULTTONEAREST);
            if (OnWideScreen(mon)) return false;

            string exe = ExeOf(w);
            if (exe == "explorer" || exe == "icue") return false;
            foreach (var g in GameExes) if (exe == g) return true;

            // Full screen or borderless full screen: the window covers its whole screen.
            RECT r, m = MonitorRect(mon);
            if (!GetWindowRect(w, out r)) return false;
            return r.Left <= m.Left && r.Top <= m.Top && r.Right >= m.Right && r.Bottom >= m.Bottom && m.Right > m.Left;
        }

        static string ExeOf(IntPtr w)
        {
            try
            {
                uint pid;
                GetWindowThreadProcessId(w, out pid);
                if (pid == 0) return "";
                using (var p = Process.GetProcessById((int)pid)) return p.ProcessName.ToLowerInvariant();
            }
            catch { return ""; }
        }
    }
}
