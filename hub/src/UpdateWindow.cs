// Control Hub — the update window.
//
// Started by Control Hub's Update button as a copy of Control Hub in the temp folder ("Control Hub Updater.exe --update"),
// so it keeps running while the installer closes and replaces Control Hub itself.
// It downloads the new version, runs that version's "Install Control Hub.bat /update /quiet" hidden, and turns what the
// installer writes into steps and a progress bar. Everything the installer wrote is under "Show details".
// C# 5 / .NET Framework 4.x.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace ControlHub
{
    class UpdateWindow : Form
    {
        // The steps shown, and how much of the bar each one is.
        static readonly string[] StepNames = { "Downloading the new version", "Building Control Hub", "Installing", "The panel", "Finishing" };
        static readonly float[] StepWeight = { 0.15f, 0.45f, 0.15f, 0.15f, 0.10f };

        enum State { Working, Done, Failed }

        readonly string version;
        State state = State.Working;
        int step;                       // the step that's running now
        float target, shown;            // progress 0..1: where it should be, and where the bar is drawn (eases towards it)
        string status = "Getting ready…";
        string failTitle, failText;
        int pulse;
        readonly StringBuilder log = new StringBuilder();
        readonly object logGate = new object();

        readonly System.Windows.Forms.Timer anim;
        readonly FlatButton detailsBtn, copyBtn, closeBtn;
        readonly TextBox details;
        readonly Icon logo;
        bool detailsOpen;
        DateTime doneAt = DateTime.MinValue;   // when it finished: it closes by itself 5 seconds later
        int shownLeft = -1;

        readonly int W = T.Px(560), H = T.Px(372), DetailsH = T.Px(200);

        public UpdateWindow(string version)
        {
            this.version = version;
            AutoScaleMode = AutoScaleMode.None;   // sizes are already scaled (T.Px)
            Text = "Updating Control Hub";
            Icon = HubApp.AppIcon(32);
            logo = HubApp.AppIcon(48);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = T.Win;
            ForeColor = T.Text;
            ClientSize = new Size(W, H);
            TopMost = true;   // stays in view while Control Hub closes behind it
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);

            detailsBtn = new FlatButton("Show details", false);
            copyBtn = new FlatButton("Copy details", false) { IconGlyph = Glyph.Copy, Visible = false };
            closeBtn = new FlatButton("Close", true) { Visible = false };
            foreach (var b in new[] { detailsBtn, copyBtn, closeBtn }) { b.Margin = Padding.Empty; Controls.Add(b); }
            detailsBtn.Click += delegate { ToggleDetails(); };
            copyBtn.Click += delegate { CopyDetails(); };
            closeBtn.Click += delegate { Close(); };

            details = new TextBox
            {
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                WordWrap = true,
                BorderStyle = BorderStyle.None,
                BackColor = T.Nav,
                ForeColor = T.Sub,
                Font = T.Mono,
                Visible = false
            };
            Controls.Add(details);
            PlaceButtons();

            anim = new System.Windows.Forms.Timer { Interval = 33 };
            anim.Tick += delegate { Tick(); };
            Shown += delegate
            {
                DarkTitle.Apply(this);
                anim.Start();
                var t = new Thread(Work) { IsBackground = true };
                t.Start();
            };
        }

        // ------------------------------------------------------------------ the work (background thread)

        void Work()
        {
            HubApp.Step("Update window: updating to " + version);
            SetStep(0, "Downloading the new version…");
            string error;
            string folder = Updater.Download(delegate (string msg) { SetStatus(msg); }, out error);
            if (folder == null)
            {
                Fail("The update couldn't be downloaded", (error ?? "Unknown error") + "\n\nNothing was changed. Check that the PC is online and try again from Control Hub → Updates.");
                return;
            }
            Log("Downloaded to " + folder);
            SetStep(1, "Building Control Hub Service…");

            int code;
            try
            {
                string bat = Path.Combine(folder, "Install Control Hub.bat");
                var psi = new ProcessStartInfo("cmd.exe", "/c \"\"" + bat + "\" /update /quiet 2>&1\"")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    WorkingDirectory = folder,
                    StandardOutputEncoding = OemEncoding()
                };
                using (var p = Process.Start(psi))
                {
                    string line;
                    while ((line = p.StandardOutput.ReadLine()) != null) OnLine(line);
                    p.WaitForExit();
                    code = p.ExitCode;
                }
            }
            catch (Exception ex)
            {
                Fail("The installer couldn't start", ex.Message + "\n\nNothing was changed.");
                return;
            }

            if (code == 0)
            {
                HubApp.Step("Update window: done (" + version + ")");
                Ui(delegate
                {
                    state = State.Done;
                    step = StepNames.Length;
                    target = 1f;
                    status = "Control Hub is opening.";
                    doneAt = DateTime.UtcNow;
                    closeBtn.Text = "Close";
                    closeBtn.Visible = true;
                    TopMost = false;
                    PlaceButtons();
                    Invalidate();
                });
                return;
            }
            string all = LogText();
            if (all.Contains("The build failed"))
            {
                string cs = FirstMatch(all, "error CS");
                Fail("Building the new version failed", "Nothing was changed: your current version keeps working." + (cs != null ? "\n\n" + cs : "") + "\n\nPress Copy details and send it to Claude.");
            }
            else if (all.Contains("Couldn't copy the new files"))
                Fail("The new files couldn't be put in place", "Something still had Control Hub's files open. Restart the PC and try the update again.\n\nPress Copy details and send it to Claude.");
            else
                Fail("The update stopped", "The installer ended with code " + code + ".\n\nPress Copy details and send it to Claude.");
        }

        static Encoding OemEncoding()
        {
            try { return Encoding.GetEncoding(CultureInfo.CurrentCulture.TextInfo.OEMCodePage); }
            catch { return Encoding.Default; }
        }

        // What the installer writes: "[1/6] Building Control Hub Service..." moves the steps on.
        void OnLine(string line)
        {
            Log(line);
            string t = line.Trim();
            if (t.Length < 6 || t[0] != '[' || t[2] != '/') return;
            int n;
            if (!int.TryParse(t.Substring(1, 1), out n)) return;
            string text = t.Substring(t.IndexOf(']') + 1).Trim();
            int s = n <= 2 ? 1 : n <= 4 ? 2 : n == 5 ? 3 : 4;
            float within = n == 2 ? 0.5f : n == 4 ? 0.6f : 0f;
            SetStep(s, text, within);
        }

        void SetStep(int s, string text) { SetStep(s, text, 0f); }

        void SetStep(int s, string text, float within)
        {
            Ui(delegate
            {
                if (state != State.Working) return;
                step = s;
                float before = 0;
                for (int i = 0; i < s && i < StepWeight.Length; i++) before += StepWeight[i];
                target = Math.Max(target, before + (s < StepWeight.Length ? StepWeight[s] * within : 0));
                status = Friendly(text);
                Invalidate();
            });
        }

        static string Friendly(string s)
        {
            if (s.StartsWith("Installing to", StringComparison.OrdinalIgnoreCase)) return "Putting the new version in place…";
            if (s.StartsWith("Start menu", StringComparison.OrdinalIgnoreCase)) return "Starting Control Hub Service…";
            if (s.StartsWith("The panel", StringComparison.OrdinalIgnoreCase)) return "Updating the panel…";
            if (s.StartsWith("Projects", StringComparison.OrdinalIgnoreCase)) return "Finishing…";
            return s.Replace("...", "…");
        }

        void SetStatus(string s) { Ui(delegate { if (state == State.Working) { status = s; Invalidate(); } }); }

        void Fail(string title, string text)
        {
            HubApp.Step("Update window: " + title + " - " + text.Replace("\n", " "));
            Ui(delegate
            {
                state = State.Failed;
                failTitle = title;
                failText = text;
                status = title;
                TopMost = false;
                copyBtn.Visible = true;
                closeBtn.Visible = true;
                PlaceButtons();
                Invalidate();
            });
        }

        void Log(string line)
        {
            lock (logGate) log.AppendLine(line);
            Ui(delegate { if (detailsOpen) ShowLog(); });
        }

        string LogText() { lock (logGate) return log.ToString(); }

        static string FirstMatch(string all, string what)
        {
            foreach (var l in all.Split('\n')) if (l.Contains(what)) return l.Trim();
            return null;
        }

        void Ui(MethodInvoker a)
        {
            try { if (IsHandleCreated && !IsDisposed) BeginInvoke(a); } catch { }
        }

        // ------------------------------------------------------------------ buttons and details

        void ToggleDetails()
        {
            detailsOpen = !detailsOpen;
            detailsBtn.Text = detailsOpen ? "Hide details" : "Show details";
            details.Visible = detailsOpen;
            ClientSize = new Size(W, H + (detailsOpen ? DetailsH : 0));
            if (detailsOpen) ShowLog();
            PlaceButtons();
            Invalidate();
        }

        void ShowLog()
        {
            details.Text = LogText();
            details.SelectionStart = details.TextLength;
            details.ScrollToCaret();
        }

        void CopyDetails()
        {
            try
            {
                Clipboard.SetText("Control Hub update to " + version + "\r\n" + (failTitle ?? "") + "\r\n\r\n" + LogText());
                copyBtn.Text = "Copied";
            }
            catch { }
        }

        void PlaceButtons()
        {
            int pad = T.Px(24), y = H - pad - T.Px(32);
            int x = W - pad;
            if (closeBtn.Visible) { x -= closeBtn.Width; closeBtn.Location = new Point(x, y); x -= T.Px(8); }
            if (copyBtn.Visible) { x -= copyBtn.Width; copyBtn.Location = new Point(x, y); }
            detailsBtn.Location = new Point(pad, y);
            details.SetBounds(pad, H, W - pad * 2, DetailsH - pad);
        }

        // ------------------------------------------------------------------ drawing

        void Tick()
        {
            pulse = (pulse + 1) % 60;
            // A slow creep inside the running step, so a long build doesn't look frozen.
            if (state == State.Working)
            {
                float end = 0;
                for (int i = 0; i <= step && i < StepWeight.Length; i++) end += StepWeight[i];
                if (target < end - 0.02f) target += 0.0004f;
            }
            float d = target - shown;
            if (Math.Abs(d) > 0.001f) shown += d * 0.12f; else shown = target;
            if (state == State.Done && doneAt != DateTime.MinValue && !detailsOpen)
            {
                int left = 5 - (int)(DateTime.UtcNow - doneAt).TotalSeconds;
                if (left <= 0) { doneAt = DateTime.MinValue; Close(); return; }
                if (left != shownLeft)
                {
                    shownLeft = left;
                    closeBtn.Text = "Close (" + left + ")";
                    PlaceButtons();
                }
            }
            Invalidate(new Rectangle(0, T.Px(96), W, T.Px(230)));
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            T.Smooth(g);
            g.Clear(T.Win);
            int pad = T.Px(24);

            // Header: logo, title, version.
            if (logo != null) g.DrawIcon(logo, new Rectangle(pad, pad, T.Px(40), T.Px(40)));
            string title = state == State.Done ? "Control Hub is updated" : state == State.Failed ? "The update didn't finish" : "Updating Control Hub";
            T.DrawText(g, title, T.Title, T.Text, new Rectangle(pad + T.Px(54), pad - T.Px(4), W - pad * 2, T.Px(34)), TextFormatFlags.Left | TextFormatFlags.VerticalCenter);
            T.DrawText(g, (state == State.Done ? "Now on version " : "To version ") + version, T.Body, T.Mute, new Rectangle(pad + T.Px(55), pad + T.Px(28), W - pad * 2, T.Px(20)), TextFormatFlags.Left);

            // Progress bar.
            Color barColor = state == State.Failed ? T.Bad : state == State.Done ? T.Ok : T.Acc;
            var bar = new RectangleF(pad, T.Px(96), W - pad * 2, T.Px(8));
            using (var p = T.Round(bar, bar.Height / 2)) using (var b = new SolidBrush(T.Raise)) g.FillPath(b, p);
            float fw = Math.Max(bar.Height, bar.Width * Math.Min(1f, shown));
            using (var p = T.Round(new RectangleF(bar.X, bar.Y, fw, bar.Height), bar.Height / 2)) using (var b = new SolidBrush(barColor)) g.FillPath(b, p);

            int y = T.Px(122);
            if (state == State.Failed)
            {
                // What went wrong, in plain words.
                var box = new Rectangle(pad, y, W - pad * 2, T.Px(176));
                using (var p = T.Round(box, T.Px(8)))
                {
                    using (var b = new SolidBrush(Color.FromArgb(40, T.Bad))) g.FillPath(b, p);
                    using (var pen = new Pen(Color.FromArgb(90, T.Bad))) g.DrawPath(pen, p);
                }
                T.DrawText(g, Glyph.Warning, T.Icon, T.Bad, new Rectangle(box.X + T.Px(14), box.Y + T.Px(14), T.Px(24), T.Px(24)), TextFormatFlags.Left);
                T.DrawText(g, failTitle, T.BodyBold, T.Text, new Rectangle(box.X + T.Px(46), box.Y + T.Px(14), box.Width - T.Px(60), T.Px(24)), TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
                T.DrawText(g, failText, T.Body, T.Sub, new Rectangle(box.X + T.Px(46), box.Y + T.Px(42), box.Width - T.Px(60), box.Height - T.Px(50)), TextFormatFlags.Left | TextFormatFlags.WordBreak);
                return;
            }

            // The steps.
            for (int i = 0; i < StepNames.Length; i++)
            {
                bool done = state == State.Done || i < step, now = state == State.Working && i == step;
                var dot = new Rectangle(pad + T.Px(2), y + T.Px(4), T.Px(18), T.Px(18));
                if (done)
                {
                    using (var b = new SolidBrush(T.Ok)) g.FillEllipse(b, dot);
                    T.DrawText(g, Glyph.Check, T.IconSmall, T.AccInk, dot, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
                }
                else if (now)
                {
                    int a = 90 + (int)(90 * Math.Abs(Math.Sin(pulse / 60.0 * Math.PI)));
                    using (var b = new SolidBrush(Color.FromArgb(a, T.Acc))) g.FillEllipse(b, dot);
                    var inner = Rectangle.Inflate(dot, -T.Px(5), -T.Px(5));
                    using (var b = new SolidBrush(T.Acc)) g.FillEllipse(b, inner);
                }
                else using (var pen = new Pen(T.Line, T.Px(2))) g.DrawEllipse(pen, Rectangle.Inflate(dot, -1, -1));
                T.DrawText(g, StepNames[i], now ? T.BodyBold : T.Body, done ? T.Sub : now ? T.Text : T.Mute,
                    new Rectangle(pad + T.Px(32), y, W - pad * 2 - T.Px(32), T.Px(26)), TextFormatFlags.Left | TextFormatFlags.VerticalCenter);
                y += T.Px(30);
            }

            // What's happening right now.
            T.DrawText(g, status, T.Small, state == State.Done ? T.Ok : T.Mute, new Rectangle(pad, y + T.Px(6), W - pad * 2, T.Px(20)), TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            // Closing in the middle would leave the installer running hidden: say so and let it finish.
            if (state == State.Working && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                status = "Please wait, the update finishes by itself in a moment.";
                Invalidate();
                return;
            }
            anim.Stop();
            base.OnFormClosing(e);
        }
    }
}
