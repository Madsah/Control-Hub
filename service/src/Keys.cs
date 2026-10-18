using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

namespace ControlPanelHelper
{
    /// <summary>
    /// Presses key combinations like "Ctrl+Shift+M" for custom buttons.
    /// Only key names from the list below are accepted.
    /// </summary>
    static class Keys
    {
        [DllImport("user32.dll")]
        static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
        [DllImport("user32.dll")]
        static extern uint MapVirtualKey(uint code, uint mapType);

        const uint EXTENDED = 0x1, KEYUP = 0x2;

        // name -> { virtual-key code, extended flag }
        static readonly Dictionary<string, int[]> Named = new Dictionary<string, int[]>(StringComparer.OrdinalIgnoreCase)
        {
            { "ctrl", new[] { 0x11, 0 } }, { "control", new[] { 0x11, 0 } }, { "shift", new[] { 0x10, 0 } },
            { "alt", new[] { 0x12, 0 } }, { "win", new[] { 0x5B, 1 } }, { "windows", new[] { 0x5B, 1 } },
            { "esc", new[] { 0x1B, 0 } }, { "escape", new[] { 0x1B, 0 } }, { "enter", new[] { 0x0D, 0 } },
            { "tab", new[] { 0x09, 0 } }, { "space", new[] { 0x20, 0 } }, { "backspace", new[] { 0x08, 0 } },
            { "delete", new[] { 0x2E, 1 } }, { "del", new[] { 0x2E, 1 } }, { "insert", new[] { 0x2D, 1 } },
            { "home", new[] { 0x24, 1 } }, { "end", new[] { 0x23, 1 } }, { "pageup", new[] { 0x21, 1 } },
            { "pagedown", new[] { 0x22, 1 } }, { "up", new[] { 0x26, 1 } }, { "down", new[] { 0x28, 1 } },
            { "left", new[] { 0x25, 1 } }, { "right", new[] { 0x27, 1 } }, { "printscreen", new[] { 0x2C, 1 } },
            { "pause", new[] { 0x13, 0 } }, { "capslock", new[] { 0x14, 0 } }, { "numlock", new[] { 0x90, 1 } },
            { "scrolllock", new[] { 0x91, 0 } },
            { "volumemute", new[] { 0xAD, 1 } }, { "volumedown", new[] { 0xAE, 1 } }, { "volumeup", new[] { 0xAF, 1 } },
            { "medianext", new[] { 0xB0, 1 } }, { "mediaprev", new[] { 0xB1, 1 } }, { "mediastop", new[] { 0xB2, 1 } },
            { "mediaplaypause", new[] { 0xB3, 1 } },
            { "-", new[] { 0xBD, 0 } }, { "=", new[] { 0xBB, 0 } }, { ",", new[] { 0xBC, 0 } }, { ".", new[] { 0xBE, 0 } },
            { "/", new[] { 0xBF, 0 } }, { ";", new[] { 0xBA, 0 } }, { "'", new[] { 0xDE, 0 } }, { "[", new[] { 0xDB, 0 } },
            { "]", new[] { 0xDD, 0 } }, { "\\", new[] { 0xDC, 0 } }, { "`", new[] { 0xC0, 0 } },
        };

        static int[] Code(string name)
        {
            int[] c;
            if (Named.TryGetValue(name, out c)) return c;
            if (name.Length == 1)
            {
                char ch = char.ToUpperInvariant(name[0]);
                if ((ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')) return new[] { (int)ch, 0 };
            }
            string lower = name.ToLowerInvariant();
            int n;
            if (lower.StartsWith("f") && int.TryParse(lower.Substring(1), out n) && n >= 1 && n <= 24) return new[] { 0x6F + n, 0 };
            if (lower.StartsWith("num") && int.TryParse(lower.Substring(3), out n) && n >= 0 && n <= 9) return new[] { 0x60 + n, 0 };
            return null;
        }

        /// <summary>"Ctrl+Shift+M" -> list of keys, or null if anything is not understood.</summary>
        public static List<int[]> Parse(string combo)
        {
            if (string.IsNullOrEmpty(combo) || combo.Length > 80) return null;
            var parts = new List<string>();
            foreach (var p in combo.Split('+'))
            {
                var t = p.Trim();
                if (t.Length > 0) parts.Add(t);
            }
            if (combo.TrimEnd().EndsWith("++")) parts.Add("=");
            if (parts.Count == 0 || parts.Count > 5) return null;
            var keys = new List<int[]>();
            foreach (var p in parts)
            {
                var c = Code(p);
                if (c == null) return null;
                keys.Add(c);
            }
            return keys;
        }

        public static bool Press(string combo)
        {
            var keys = Parse(combo);
            if (keys == null) return false;
            foreach (var k in keys)
            {
                keybd_event((byte)k[0], (byte)MapVirtualKey((uint)k[0], 0), k[1] == 1 ? EXTENDED : 0, UIntPtr.Zero);
                Thread.Sleep(15);
            }
            for (int i = keys.Count - 1; i >= 0; i--)
            {
                var k = keys[i];
                keybd_event((byte)k[0], (byte)MapVirtualKey((uint)k[0], 0), (k[1] == 1 ? EXTENDED : 0) | KEYUP, UIntPtr.Zero);
                Thread.Sleep(15);
            }
            return true;
        }

        // ------------------------------------------------------------------ hold a key down (push-to-talk)
        [DllImport("user32.dll")]
        static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
        const uint XDOWN = 0x80, XUP = 0x100;

        static readonly object HoldGate = new object();
        static string held;              // the combo that is down right now
        static List<int[]> heldKeys;
        static DateTime heldBeat;
        static Timer watchdog;

        /// <summary>
        /// Press (down = true) or let go of a key or combo, for push-to-talk. "Mouse4"/"Mouse5" work too.
        /// While held, the widget repeats "down" every second; if that stops (screen off, iCUE closed,
        /// network hiccup) the key is let go after 3 seconds, so it can never get stuck.
        /// </summary>
        public static bool Hold(string combo, bool down)
        {
            lock (HoldGate)
            {
                if (!down) { Release(); return true; }
                if (held != null && string.Equals(held, combo, StringComparison.OrdinalIgnoreCase)) { heldBeat = DateTime.UtcNow; return true; }
                Release();
                string lower = (combo ?? "").Trim().ToLowerInvariant();
                List<int[]> keys;
                if (lower == "mouse4" || lower == "mouse5") keys = new List<int[]> { new[] { lower == "mouse4" ? -1 : -2, 0 } };
                else keys = Parse(combo);
                if (keys == null) return false;
                foreach (var k in keys) Send(k, true);
                held = combo;
                heldKeys = keys;
                heldBeat = DateTime.UtcNow;
                if (watchdog == null) watchdog = new Timer(delegate { lock (HoldGate) { if (held != null && (DateTime.UtcNow - heldBeat).TotalSeconds > 3) { Log.Write("Push-to-talk: no signal from the widget, letting go"); Release(); } } }, null, Timeout.Infinite, Timeout.Infinite);
                watchdog.Change(1000, 1000);
                return true;
            }
        }

        /// <summary>Lets go of a held key (also when the helper closes).</summary>
        public static void ReleaseHeld() { lock (HoldGate) Release(); }

        public static bool Holding { get { return held != null; } }

        // Call with HoldGate held.
        static void Release()
        {
            if (heldKeys != null)
                for (int i = heldKeys.Count - 1; i >= 0; i--) Send(heldKeys[i], false);
            held = null;
            heldKeys = null;
            if (watchdog != null) watchdog.Change(Timeout.Infinite, Timeout.Infinite);
        }

        static void Send(int[] k, bool down)
        {
            if (k[0] < 0)
            {
                mouse_event(down ? XDOWN : XUP, 0, 0, (uint)(k[0] == -1 ? 1 : 2), UIntPtr.Zero);
                return;
            }
            keybd_event((byte)k[0], (byte)MapVirtualKey((uint)k[0], 0), (k[1] == 1 ? EXTENDED : 0) | (down ? 0 : KEYUP), UIntPtr.Zero);
            Thread.Sleep(10);
        }
    }

    /// <summary>Windows power plans (Balanced / High performance / Power saver).</summary>
    static class PowerPlans
    {
        [DllImport("powrprof.dll")]
        static extern uint PowerGetActiveScheme(IntPtr root, out IntPtr guid);
        [DllImport("powrprof.dll")]
        static extern uint PowerSetActiveScheme(IntPtr root, ref Guid guid);
        [DllImport("kernel32.dll")]
        static extern IntPtr LocalFree(IntPtr mem);

        static readonly Guid Balanced = new Guid("381b4222-f694-41f0-9685-ff5bb260df2e");
        static readonly Guid High = new Guid("8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c");
        static readonly Guid Saver = new Guid("a1841308-3541-4fab-bc81-f71556f20b4a");
        static readonly Guid Ultimate = new Guid("e9a42b02-d5df-448d-aa00-03f14749eb61");

        public static string Current()
        {
            try
            {
                IntPtr p;
                if (PowerGetActiveScheme(IntPtr.Zero, out p) != 0) return "unknown";
                var g = (Guid)Marshal.PtrToStructure(p, typeof(Guid));
                LocalFree(p);
                if (g == Balanced) return "balanced";
                if (g == High || g == Ultimate) return "high";
                if (g == Saver) return "saver";
                return "custom";
            }
            catch { return "unknown"; }
        }

        public static bool Set(string plan)
        {
            Guid g;
            switch (plan)
            {
                case "balanced": g = Balanced; break;
                case "high": g = High; break;
                case "saver": g = Saver; break;
                default: return false;
            }
            uint r = PowerSetActiveScheme(IntPtr.Zero, ref g);
            if (r != 0) Log.Write("Power plan " + plan + ": error " + r);
            return r == 0;
        }
    }
}
