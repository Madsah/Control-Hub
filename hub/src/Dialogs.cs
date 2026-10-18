// Control Hub — dark dialogs (questions, messages, passwords) in the app's own look, and the dark title bar.
// C# 5 / .NET Framework 4.x.
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace ControlHub
{
    static class DarkTitle
    {
        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        /// <summary>Dark title bar (Windows 10 20H1+ / 11) in the app's navy (Windows 11). Ignored where not supported.</summary>
        public static void Apply(Form f)
        {
            try
            {
                int on = 1;
                if (DwmSetWindowAttribute(f.Handle, 20, ref on, 4) != 0) DwmSetWindowAttribute(f.Handle, 19, ref on, 4);
                int caption = T.Nav.R | (T.Nav.G << 8) | (T.Nav.B << 16);   // COLORREF is 0x00BBGGRR
                DwmSetWindowAttribute(f.Handle, 35, ref caption, 4);
                int text = T.Mute.R | (T.Mute.G << 8) | (T.Mute.B << 16);
                DwmSetWindowAttribute(f.Handle, 36, ref text, 4);
            }
            catch { }
        }
    }

    /// <summary>A small dark window with a title, a text, an optional input and buttons.</summary>
    class DarkDialog : Form
    {
        public TextBox Input, Input2;
        public string Choice;

        public DarkDialog(string title, string text, string[] buttons, string primary, bool password, bool confirm)
        {
            AutoScaleMode = AutoScaleMode.None;   // sizes are already scaled (T.Px)
            Text = title;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterParent;
            MinimizeBox = false; MaximizeBox = false; ShowInTaskbar = false;
            BackColor = T.Win;
            ForeColor = T.Text;
            Font = T.Body;
            Icon = HubApp.AppIcon(32);
            int w = T.Px(460), pad = T.Px(22), y = pad;

            var head = new Label { Text = title, Font = T.Head, ForeColor = T.Text, AutoSize = true, MaximumSize = new Size(w - 2 * pad, 0), Location = new Point(pad, y) };
            Controls.Add(head);
            y += head.PreferredHeight + T.Px(8);
            var body = new Label { Text = text, Font = T.Body, ForeColor = T.Sub, AutoSize = true, MaximumSize = new Size(w - 2 * pad, 0), Location = new Point(pad, y) };
            Controls.Add(body);
            y += body.GetPreferredSize(new Size(w - 2 * pad, 0)).Height + T.Px(14);

            if (password)
            {
                Input = Box(pad, ref y, w - 2 * pad, "Password");
                if (confirm) Input2 = Box(pad, ref y, w - 2 * pad, "The same password again");
                y += T.Px(4);
            }

            int x = w - pad;
            for (int i = buttons.Length - 1; i >= 0; i--)
            {
                string label = buttons[i];
                var b = new FlatButton(label, label == primary);
                b.Location = new Point(x - b.Width, y);
                b.Click += delegate { Choice = label; DialogResult = DialogResult.OK; Close(); };
                Controls.Add(b);
                x -= b.Width + T.Px(8);
            }
            ClientSize = new Size(w, y + T.Px(32) + pad);
            HandleCreated += delegate { DarkTitle.Apply(this); };
            Shown += delegate { if (Input != null) Input.Focus(); };
            KeyPreview = true;
            KeyDown += delegate (object s, KeyEventArgs e)
            {
                if (e.KeyCode == Keys.Escape) { Choice = null; DialogResult = DialogResult.Cancel; Close(); }
                else if (e.KeyCode == Keys.Enter && primary != null) { Choice = primary; DialogResult = DialogResult.OK; Close(); e.SuppressKeyPress = true; }
            };
        }

        /// <summary>A password box with its label above it; moves y below both.</summary>
        TextBox Box(int x, ref int y, int w, string hint)
        {
            var hintLbl = new Label { Text = hint, Font = T.Small, ForeColor = T.Mute, AutoSize = true, Location = new Point(x, y) };
            Controls.Add(hintLbl);
            var t = new TextBox
            {
                UseSystemPasswordChar = true,
                Location = new Point(x, y + hintLbl.PreferredHeight + T.Px(4)),
                Width = w,
                BackColor = T.Raise,
                ForeColor = T.Text,
                BorderStyle = BorderStyle.FixedSingle,
                Font = T.Body
            };
            Controls.Add(t);
            y = t.Bottom + T.Px(10);
            return t;
        }

    }

    static class Dlg
    {
        /// <summary>Asks a question. Returns the chosen button's text, or null when closed.</summary>
        public static string Ask(IWin32Window owner, string title, string text, params string[] buttons)
        {
            using (var d = new DarkDialog(title, text, buttons, buttons.Length > 0 ? buttons[buttons.Length - 1] : null, false, false))
            {
                d.ShowDialog(owner);
                return d.Choice;
            }
        }

        public static bool Confirm(IWin32Window owner, string title, string text, string ok)
        {
            return Ask(owner, title, text, "Cancel", ok) == ok;
        }

        public static void Info(IWin32Window owner, string title, string text)
        {
            Ask(owner, title, text, "OK");
        }

        /// <summary>Asks for a password (twice when making one). Returns it, null when cancelled, or "" for the extra button (skip).</summary>
        public static string Password(IWin32Window owner, string title, string text, bool confirm, string skip, string ok)
        {
            while (true)
            {
                var buttons = skip != null ? new[] { "Cancel", skip, ok } : new[] { "Cancel", ok };
                using (var d = new DarkDialog(title, text, buttons, ok, true, confirm))
                {
                    d.ShowDialog(owner);
                    if (d.Choice == null || d.Choice == "Cancel") return null;
                    if (skip != null && d.Choice == skip) return "";
                    string a = d.Input.Text;
                    if (a.Length < 4) { Info(owner, title, "Use at least 4 characters."); continue; }
                    if (confirm && d.Input2.Text != a) { Info(owner, title, "The two passwords aren't the same. Try again."); continue; }
                    return a;
                }
            }
        }
    }
}
