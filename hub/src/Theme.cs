// Control Hub — the look: colours, fonts, icons and the hand-drawn controls.
// Windows 11's own font (Segoe UI Variable) and icon font (Segoe Fluent Icons), with Windows 10 fallbacks.
// C# 5 / .NET Framework 4.x.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Windows.Forms;

namespace ControlHub
{
    static class T
    {
        // Dark grey (1.11): the same family as the panel's black look, a little lighter.
        public static readonly Color Win = Color.FromArgb(26, 27, 31);
        public static readonly Color Nav = Color.FromArgb(20, 21, 24);
        public static readonly Color Surf = Color.FromArgb(35, 36, 41);
        public static readonly Color Raise = Color.FromArgb(46, 48, 54);
        public static readonly Color RaiseHover = Color.FromArgb(57, 59, 67);
        public static readonly Color Line = Color.FromArgb(47, 49, 56);
        public static readonly Color ButtonLine = Color.FromArgb(60, 62, 71);
        public static readonly Color Text = Color.FromArgb(237, 238, 242);
        public static readonly Color Sub = Color.FromArgb(205, 207, 214);
        public static readonly Color Mute = Color.FromArgb(147, 150, 160);
        // The accent follows the panel's accent colour (or your own pick in Settings).
        public static Color Acc = Color.FromArgb(45, 212, 191);
        public static Color AccHover = Color.FromArgb(94, 234, 212);
        public static Color AccInk = Color.FromArgb(4, 32, 27);
        public static readonly Color Blue = Color.FromArgb(59, 130, 246);
        public static readonly Color Ok = Color.FromArgb(74, 222, 128);
        public static readonly Color Warn = Color.FromArgb(245, 185, 66);
        public static readonly Color Bad = Color.FromArgb(248, 113, 113);

        /// <summary>Screen scaling (1.0 at 100 %, 1.5 at 150 %…). All sizes in this app go through Px().</summary>
        public static float Scale = 1f;
        public static int Px(float v) { return (int)Math.Round(v * Scale); }

        public static string TextFamily = "Segoe UI", HeadFamily = "Segoe UI Semibold", IconFamily = "Segoe MDL2 Assets";
        public static Font Body, BodyBold, Small, Head, Title, Lamp, LampSub, Icon, IconSmall, Mono;

        public static void Init()
        {
            using (var g = Graphics.FromHwnd(IntPtr.Zero)) Scale = Math.Max(1f, g.DpiX / 96f);
            var have = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try { using (var fonts = new InstalledFontCollection()) foreach (var f in fonts.Families) have.Add(f.Name); } catch { }
            if (have.Contains("Segoe UI Variable Text")) TextFamily = "Segoe UI Variable Text";
            if (have.Contains("Segoe Fluent Icons")) IconFamily = "Segoe Fluent Icons";
            Body = new Font(TextFamily, 10f);
            BodyBold = new Font(HeadFamily, 10.5f);
            Small = new Font(TextFamily, 9f);
            Head = new Font(HeadFamily, 10.5f);
            Title = new Font(HeadFamily, 19f);
            Lamp = new Font(HeadFamily, 8.5f);
            LampSub = new Font(TextFamily, 8.5f);
            Icon = new Font(IconFamily, 12f);
            IconSmall = new Font(IconFamily, 10f);
            Mono = new Font("Consolas", 9f);
        }

        /// <summary>Sets the accent colour (and its hover and text colours). Returns true if it changed.</summary>
        public static bool SetAccent(Color c)
        {
            if (c.ToArgb() == Acc.ToArgb()) return false;
            Acc = Color.FromArgb(255, c.R, c.G, c.B);
            AccHover = Mix(Acc, Color.White, 0.25f);
            double lum = 0.2126 * c.R + 0.7152 * c.G + 0.0722 * c.B;
            AccInk = lum > 140 ? Mix(Acc, Color.Black, 0.86f) : Color.White;
            return true;
        }

        public static Color Mix(Color a, Color b, float t)
        {
            return Color.FromArgb(255, (int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t));
        }

        public static bool TryHex(string s, out Color c)
        {
            c = Color.Empty;
            if (string.IsNullOrEmpty(s) || s.Length != 7 || s[0] != '#') return false;
            int v;
            if (!int.TryParse(s.Substring(1), System.Globalization.NumberStyles.HexNumber, null, out v)) return false;
            c = Color.FromArgb(255, (v >> 16) & 255, (v >> 8) & 255, v & 255);
            return true;
        }

        public static GraphicsPath Round(RectangleF r, float radius)
        {
            float d = Math.Max(1f, radius * 2);
            var p = new GraphicsPath();
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        public static void Smooth(Graphics g)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        }

        public static void DrawText(Graphics g, string s, Font f, Color c, Rectangle r, TextFormatFlags flags)
        {
            TextRenderer.DrawText(g, s ?? "", f, r, c, flags | TextFormatFlags.NoPrefix);
        }
    }

    /// <summary>Icons from Windows' own icon font (the same in Windows 10 and 11).</summary>
    static class Glyph
    {
        public const string Home = "", Tiles = "", Link = "", Monitor = "", Sync = "", Help = "",
            History = "", Folder = "", Add = "", Settings = "", Save = "", Music = "", Chat = "",
            Video = "", Game = "", People = "", Airplane = "", Mic = "", Download = "", Copy = "",
            Open = "", Shield = "", Warning = "", Check = "", Power = "", Play = "", Document = "",
            Picture = "", Calendar = "", Globe = "", Undo = "", Lock = "", Refresh = "",
            Prev = "", Next = "", Pause = "", Left = "", Right = "", Palette = "", Window = "", Info = "";
    }

    /// <summary>Base for the hand-drawn controls: double-buffered, hover tracking, transparent to its parent.</summary>
    class DrawnControl : Control
    {
        protected bool Hover, Down;
        public DrawnControl()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint |
                     ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
        }
        protected override void OnMouseEnter(EventArgs e) { Hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { Hover = false; Down = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { if (e.Button == MouseButtons.Left) { Down = true; Invalidate(); } base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { Down = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }
        protected override void OnTextChanged(EventArgs e) { Invalidate(); base.OnTextChanged(e); }
    }

    /// <summary>A flat button: grey, or the teal accent for the main action. Sizes itself to its text.</summary>
    class FlatButton : DrawnControl
    {
        public bool Accent;
        string iconGlyph;
        public string IconGlyph { get { return iconGlyph; } set { iconGlyph = value; FitWidth(); Invalidate(); } }
        public FlatButton(string text, bool accent)
        {
            Text = text;
            Accent = accent;
            Cursor = Cursors.Hand;
            Font = T.Body;
            Height = T.Px(32);
            Margin = new Padding(T.Px(8), 0, 0, 0);
            FitWidth();
        }
        public void FitWidth()
        {
            if (string.IsNullOrEmpty(Text) && IconGlyph != null) { Width = Height + T.Px(8); return; }   // a round icon button
            int w = TextRenderer.MeasureText(Text ?? "", Font).Width + T.Px(34) + (IconGlyph != null ? T.Px(22) : 0);
            Width = Math.Max(T.Px(72), w);
        }
        protected override void OnTextChanged(EventArgs e) { FitWidth(); base.OnTextChanged(e); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            T.Smooth(g);
            Color back = Accent ? (Hover ? T.AccHover : T.Acc) : (Hover ? T.RaiseHover : T.Raise);
            if (Down) back = ControlPaint.Dark(back, 0.05f);
            if (!Enabled) back = Color.FromArgb(120, back);
            var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
            using (var p = T.Round(r, r.Height / 2f))
            {
                using (var b = new SolidBrush(back)) g.FillPath(b, p);
                if (!Accent) using (var pen = new Pen(T.ButtonLine)) g.DrawPath(pen, p);
            }
            Color ink = !Enabled ? T.Mute : Accent ? T.AccInk : T.Text;
            var tr = new Rectangle(0, 0, Width, Height);
            if (IconGlyph != null && string.IsNullOrEmpty(Text))
                T.DrawText(g, IconGlyph, T.IconSmall, ink, tr, TextFormatFlags.VerticalCenter | TextFormatFlags.HorizontalCenter);
            else if (IconGlyph != null)
            {
                T.DrawText(g, IconGlyph, T.IconSmall, ink, new Rectangle(T.Px(14), 0, T.Px(18), Height), TextFormatFlags.VerticalCenter | TextFormatFlags.Left);
                tr = new Rectangle(T.Px(35), 0, Width - T.Px(44), Height);
                T.DrawText(g, Text, Accent ? T.BodyBold : Font, ink, tr, TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
            }
            else T.DrawText(g, Text, Accent ? T.BodyBold : Font, ink, tr, TextFormatFlags.VerticalCenter | TextFormatFlags.HorizontalCenter | TextFormatFlags.EndEllipsis);
        }
    }

    /// <summary>A small coloured dot with text: Running, Connected, Not set up…</summary>
    class Pill : DrawnControl
    {
        Color color = T.Mute;
        public Pill() { Font = T.Small; Height = T.Px(26); Margin = new Padding(T.Px(8), 0, 0, 0); }
        public void Set(string text, Color c)
        {
            if (Text == text && color == c) return;
            color = c;
            Text = text;
            Width = TextRenderer.MeasureText(text ?? "", Font).Width + T.Px(34);
            Visible = !string.IsNullOrEmpty(text);
            Invalidate();
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            T.Smooth(g);
            using (var p = T.Round(new RectangleF(0, 0, Width - 1, Height - 1), (Height - 1) / 2f))
            using (var b = new SolidBrush(Color.FromArgb(24, color))) g.FillPath(b, p);
            int d = T.Px(7);
            using (var b = new SolidBrush(color)) g.FillEllipse(b, T.Px(11), (Height - d) / 2f, d, d);
            T.DrawText(g, Text, Font, color, new Rectangle(T.Px(23), 0, Width - T.Px(25), Height), TextFormatFlags.VerticalCenter | TextFormatFlags.Left);
        }
    }

    /// <summary>An on/off switch.</summary>
    class Toggle : DrawnControl
    {
        bool on;
        public event EventHandler Changed;
        public Toggle() { Size = new Size(T.Px(44), T.Px(22)); Cursor = Cursors.Hand; Margin = new Padding(T.Px(8), 0, 0, 0); }
        public bool On { get { return on; } set { if (on != value) { on = value; Invalidate(); } } }
        protected override void OnClick(EventArgs e)
        {
            on = !on;
            Invalidate();
            if (Changed != null) Changed(this, EventArgs.Empty);
            base.OnClick(e);
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            T.Smooth(g);
            var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
            using (var p = T.Round(r, r.Height / 2f))
            {
                using (var b = new SolidBrush(on ? T.Acc : T.Raise)) g.FillPath(b, p);
                if (!on) using (var pen = new Pen(T.ButtonLine)) g.DrawPath(pen, p);
            }
            float k = Height - T.Px(8);
            float x = on ? Width - k - T.Px(4) : T.Px(4);
            using (var b = new SolidBrush(on ? T.AccInk : T.Mute)) g.FillEllipse(b, x, T.Px(4), k, k);
        }
    }

    /// <summary>One annunciator light: a name and a short state, lit green, amber or red (like a cockpit's).</summary>
    class Lamp : DrawnControl
    {
        public string LampName, Value;
        public Color State = Color.Empty;   // Empty = not lit
        public Lamp(string name) { LampName = name; Height = T.Px(52); }
        public void Set(string value, Color state)
        {
            if (Value == value && State == state) return;
            Value = value;
            State = state;
            Invalidate();
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            T.Smooth(g);
            var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
            bool lit = State != Color.Empty;
            Color ink = lit ? Color.FromArgb(255, Math.Min(255, State.R + 40), Math.Min(255, State.G + 30), Math.Min(255, State.B + 40)) : Color.FromArgb(92, 95, 104);
            using (var p = T.Round(r, T.Px(4)))
            {
                if (lit)
                {
                    using (var b = new LinearGradientBrush(new RectangleF(0, 0, Width, Height + 1), Color.FromArgb(46, State), Color.FromArgb(22, State), 90f)) g.FillPath(b, p);
                    using (var pen = new Pen(Color.FromArgb(90, State))) g.DrawPath(pen, p);
                }
                else
                {
                    using (var b = new SolidBrush(Color.FromArgb(30, 31, 36))) g.FillPath(b, p);
                    using (var pen = new Pen(Color.FromArgb(42, 44, 50))) g.DrawPath(pen, p);
                }
            }
            int half = Height / 2;
            T.DrawText(g, (LampName ?? "").ToUpperInvariant(), T.Lamp, ink, new Rectangle(0, T.Px(6), Width, half - T.Px(4)), TextFormatFlags.HorizontalCenter | TextFormatFlags.Bottom);
            T.DrawText(g, Value, T.LampSub, lit ? Color.FromArgb(220, ink) : Color.FromArgb(92, 95, 104), new Rectangle(T.Px(4), half, Width - T.Px(8), half - T.Px(6)), TextFormatFlags.HorizontalCenter | TextFormatFlags.Top | TextFormatFlags.EndEllipsis);
        }
    }

    /// <summary>A row of annunciator lights, side by side.</summary>
    class LampStrip : Control
    {
        public readonly List<Lamp> Lamps = new List<Lamp>();
        public LampStrip()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            Height = T.Px(52 + 14);
            BackColor = T.Win;
        }
        public Lamp Add(string name)
        {
            var l = new Lamp(name);
            Lamps.Add(l);
            Controls.Add(l);
            return l;
        }
        protected override void OnLayout(LayoutEventArgs e)
        {
            base.OnLayout(e);
            if (Lamps.Count == 0 || Width < T.Px(100) || Height < T.Px(20)) return;   // not sized yet
            int pad = T.Px(7), gap = T.Px(6);
            float w = (Width - 2 * pad - gap * (Lamps.Count - 1)) / (float)Lamps.Count;
            for (int i = 0; i < Lamps.Count; i++)
                Lamps[i].Bounds = new Rectangle(pad + (int)(i * (w + gap)), pad, (int)w, Height - 2 * pad);
        }
        protected override void OnResize(EventArgs e) { base.OnResize(e); PerformLayout(); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            T.Smooth(g);
            g.Clear(T.Win);
            using (var p = T.Round(new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f), T.Px(8)))
            {
                using (var b = new SolidBrush(Color.FromArgb(22, 23, 26))) g.FillPath(b, p);
                using (var pen = new Pen(T.Line)) g.DrawPath(pen, p);
            }
        }
    }

    /// <summary>
    /// One row (like Windows Settings): an icon, a title and a line under it on the left; status and buttons on the right.
    /// Optional extra content below the text (Body) makes the row taller.
    /// </summary>
    class Row : Panel
    {
        public string IconGlyph, Title, Subtitle;
        public Color IconColor = T.Sub;
        public Color IconBack = Color.Empty;   // a brand colour behind the icon (Empty = grey)
        Image iconImage;
        /// <summary>A real logo instead of the font icon (e.g. the Spotify app's own icon).</summary>
        public Image IconImage { get { return iconImage; } set { iconImage = value; Invalidate(); } }
        public bool Highlight;           // the teal "update ready" look
        public readonly FlowLayoutPanel Side;
        public Control Body;             // e.g. a list or a text box under the title
        int baseHeight;

        public Row(string glyph, string title, string subtitle)
        {
            // The button area must exist before the size is set: setting the size lays the row out right away.
            Side = new FlowLayoutPanel
            {
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                BackColor = Color.Transparent,
                Margin = new Padding(0),
                Padding = new Padding(0)
            };
            IconGlyph = glyph;
            Title = title;
            Subtitle = subtitle;
            baseHeight = T.Px(66);
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            BackColor = T.Surf;
            Controls.Add(Side);
            Height = baseHeight;
        }

        public T2 Add<T2>(T2 c) where T2 : Control
        {
            c.Anchor = AnchorStyles.None;
            Side.Controls.Add(c);
            PerformLayout();
            return c;
        }

        public void SetText(string title, string subtitle)
        {
            if (Title == title && Subtitle == subtitle) return;
            Title = title;
            Subtitle = subtitle;
            Invalidate();
        }

        public void SetBody(Control c, int height)
        {
            if (Body != null) Controls.Remove(Body);
            Body = c;
            if (c != null) { Controls.Add(c); Height = baseHeight + height + T.Px(12); }
            else Height = baseHeight;
            PerformLayout();
        }

        int TextLeft { get { return IconGlyph != null ? T.Px(16 + 36 + 14) : T.Px(18); } }

        protected override void OnLayout(LayoutEventArgs e)
        {
            base.OnLayout(e);
            if (Side == null) return;
            var pref = Side.PreferredSize;
            var want = new Rectangle(Math.Max(0, Width - pref.Width - T.Px(16)), Math.Max(0, (baseHeight - pref.Height) / 2), pref.Width, pref.Height);
            if (Side.Bounds != want) Side.Bounds = want;
            if (Body != null) Body.Bounds = new Rectangle(TextLeft, baseHeight, Math.Max(1, Width - TextLeft - T.Px(18)), Math.Max(1, Height - baseHeight - T.Px(12)));
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            T.Smooth(g);
            g.Clear(Parent != null ? Parent.BackColor : T.Win);
            var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
            using (var p = T.Round(r, T.Px(10)))
            {
                if (Highlight)
                    using (var b = new LinearGradientBrush(new RectangleF(0, 0, Width, Height), Color.FromArgb(32, T.Acc), Color.FromArgb(14, T.Blue), 0f)) g.FillPath(b, p);
                else using (var b = new SolidBrush(T.Surf)) g.FillPath(b, p);
                using (var pen = new Pen(Highlight ? Color.FromArgb(90, T.Acc) : T.Line)) g.DrawPath(pen, p);
            }
            if (IconGlyph != null)
            {
                var ir = new RectangleF(T.Px(16), (baseHeight - T.Px(36)) / 2f, T.Px(36), T.Px(36));
                if (iconImage != null)
                {
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    var im = RectangleF.Inflate(ir, -T.Px(2), -T.Px(2));
                    g.DrawImage(iconImage, im);
                }
                else
                {
                    using (var p = T.Round(ir, T.Px(9)))
                    using (var b = new SolidBrush(IconBack != Color.Empty ? IconBack : T.Raise)) g.FillPath(b, p);
                    T.DrawText(g, IconGlyph, T.Icon, IconBack != Color.Empty ? Color.White : IconColor, Rectangle.Round(ir), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
                }
            }
            int right = Side != null && Side.Visible && Side.Controls.Count > 0 ? Side.Left - T.Px(12) : Width - T.Px(16);
            int x = TextLeft, w = Math.Max(10, right - x);
            bool two = !string.IsNullOrEmpty(Subtitle);
            int titleH = T.Body.Height + T.Px(2);
            int top = two ? (baseHeight - titleH - T.Small.Height - T.Px(2)) / 2 : (baseHeight - titleH) / 2;
            T.DrawText(g, Title, T.Head, T.Text, new Rectangle(x, top, w, titleH), TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
            if (two) T.DrawText(g, Subtitle, T.Small, T.Mute, new Rectangle(x, top + titleH, w, T.Small.Height + T.Px(4)), TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
        }
    }

    /// <summary>The left menu entry: icon, name, the teal bar when selected, and an optional number badge.</summary>
    class NavItem : DrawnControl
    {
        public string IconGlyph;
        public bool Selected;
        public int Badge;
        public NavItem(string glyph, string text)
        {
            IconGlyph = glyph;
            Text = text;
            Height = T.Px(40);
            Cursor = Cursors.Hand;
            Font = T.Body;
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            T.Smooth(g);
            g.Clear(T.Nav);
            if (Selected || Hover)
                using (var p = T.Round(new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f), T.Px(8)))
                using (var b = new SolidBrush(Selected ? T.Raise : Color.FromArgb(31, 32, 37))) g.FillPath(b, p);
            if (Selected)
                using (var p = T.Round(new RectangleF(0, T.Px(11), T.Px(3), Height - T.Px(22)), 1f))
                using (var b = new SolidBrush(T.Acc)) g.FillPath(b, p);
            Color ink = Selected ? T.Text : Color.FromArgb(190, 193, 202);
            T.DrawText(g, IconGlyph, T.Icon, Selected ? T.Acc : ink, new Rectangle(T.Px(12), 0, T.Px(24), Height), TextFormatFlags.VerticalCenter | TextFormatFlags.HorizontalCenter);
            T.DrawText(g, Text, Font, ink, new Rectangle(T.Px(46), 0, Width - T.Px(80), Height), TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
            if (Badge > 0)
            {
                string s = Badge.ToString();
                int bw = Math.Max(T.Px(20), TextRenderer.MeasureText(s, T.Small).Width + T.Px(8)), bh = T.Px(18);
                var br = new RectangleF(Width - bw - T.Px(12), (Height - bh) / 2f, bw, bh);
                using (var p = T.Round(br, bh / 2f))
                using (var b = new SolidBrush(T.Acc)) g.FillPath(b, p);
                T.DrawText(g, s, T.Small, T.AccInk, Rectangle.Round(br), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
            }
        }
    }

    /// <summary>
    /// A scrolling page that stacks its parts top to bottom at full width (headings, rows, strips…).
    /// </summary>
    class Stack : Panel
    {
        public int Gap = 4;
        public Stack()
        {
            AutoScroll = true;
            BackColor = T.Win;
            Padding = new Padding(T.Px(30), T.Px(22), T.Px(30), T.Px(22));
            SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint, true);
        }
        protected override void OnLayout(LayoutEventArgs e)
        {
            int y = Padding.Top + AutoScrollPosition.Y;
            int w = ClientSize.Width - Padding.Horizontal;
            if (w < T.Px(40)) { base.OnLayout(e); return; }   // not sized yet
            foreach (Control c in Controls)
            {
                if (!c.Visible) continue;
                y += c.Margin.Top;
                if (c is Label && ((Label)c).AutoSize)
                {
                    c.MaximumSize = new Size(w, 0);
                    c.Location = new Point(Padding.Left, y);
                }
                else c.Bounds = new Rectangle(Padding.Left, y, w, c.Height);
                y += c.Height + c.Margin.Bottom + T.Px(Gap);
            }
            AutoScrollMinSize = new Size(0, y - AutoScrollPosition.Y + Padding.Bottom);
            base.OnLayout(e);
        }
        protected override void OnResize(EventArgs e) { base.OnResize(e); PerformLayout(); Invalidate(true); }

        public Label Heading(string text, string sub)
        {
            var h = new Label { Text = text, Font = T.Title, ForeColor = T.Text, AutoSize = true, BackColor = Color.Transparent, Margin = new Padding(0, 0, 0, 0) };
            Controls.Add(h);
            if (!string.IsNullOrEmpty(sub))
            {
                var s = new Label { Text = sub, Font = T.Body, ForeColor = T.Mute, AutoSize = true, BackColor = Color.Transparent, Margin = new Padding(0, 0, 0, T.Px(10)) };
                Controls.Add(s);
            }
            return h;
        }

        public Label Section(string text)
        {
            var l = new Label { Text = text, Font = T.Head, ForeColor = T.Sub, AutoSize = true, BackColor = Color.Transparent, Margin = new Padding(0, T.Px(14), 0, T.Px(4)) };
            Controls.Add(l);
            return l;
        }

        public Label Note(string text)
        {
            var l = new Label { Text = text, Font = T.Small, ForeColor = T.Mute, AutoSize = true, BackColor = Color.Transparent, Margin = new Padding(T.Px(2), T.Px(2), 0, T.Px(4)) };
            Controls.Add(l);
            return l;
        }

        public T2 Put<T2>(T2 c) where T2 : Control
        {
            Controls.Add(c);
            return c;
        }
    }
}
