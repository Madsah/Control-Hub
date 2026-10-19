// Control Hub — the Overview's cards (1.11): a grid of rounded cards, the status card, the panel drawing,
// now playing, the last flight and quick actions. Plus the accent colour picker and app logos.
// C# 5 / .NET Framework 4.x.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Windows.Forms;

namespace ControlHub
{
    static class DashFonts
    {
        static Font big, huge, iconBig, iconMid;
        public static Font Big { get { return big ?? (big = new Font(T.HeadFamily, 13.5f)); } }
        public static Font Huge { get { return huge ?? (huge = new Font(T.HeadFamily, 20f)); } }
        public static Font IconBig { get { return iconBig ?? (iconBig = new Font(T.IconFamily, 20f)); } }
        public static Font IconMid { get { return iconMid ?? (iconMid = new Font(T.IconFamily, 14f)); } }
    }

    /// <summary>A rounded card with a small caption. Buttons go in its bar at the bottom (Add).</summary>
    class Card : Panel
    {
        public string Caption;
        public int Span;          // width in twelfths of the row
        public int BaseHeight;    // the height it wants (a row is as high as its highest card)
        public Color Glow = Color.Empty;
        public readonly FlowLayoutPanel Bar;

        public Card(string caption, int span, int height)
        {
            Bar = new FlowLayoutPanel { FlowDirection = FlowDirection.LeftToRight, WrapContents = false, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, BackColor = Color.Transparent, Margin = new Padding(0), Padding = new Padding(0) };
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            Caption = caption;
            Span = span;
            BaseHeight = T.Px(height);
            BackColor = T.Surf;
            Controls.Add(Bar);
            Height = BaseHeight;
        }

        public T2 Add<T2>(T2 c) where T2 : Control
        {
            Bar.Controls.Add(c);
            PerformLayout();
            return c;
        }

        public int ContentTop { get { return string.IsNullOrEmpty(Caption) ? T.Px(20) : T.Px(46); } }
        public int BarTop { get { return Bar.Controls.Count > 0 && Bar.Visible ? Bar.Top : Height - T.Px(16); } }

        protected override void OnLayout(LayoutEventArgs e)
        {
            base.OnLayout(e);
            if (Bar == null) return;
            var pref = Bar.PreferredSize;
            var want = new Rectangle(T.Px(12), Math.Max(0, Height - pref.Height - T.Px(18)), pref.Width, pref.Height);
            if (Bar.Bounds != want) Bar.Bounds = want;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            T.Smooth(g);
            g.Clear(Parent != null ? Parent.BackColor : T.Win);
            var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
            using (var p = T.Round(r, T.Px(14)))
            {
                if (Glow != Color.Empty)
                    using (var b = new LinearGradientBrush(new RectangleF(-1, 0, Width + 2, Height), T.Mix(T.Surf, Glow, 0.2f), T.Surf, 0f)) g.FillPath(b, p);
                else using (var b = new SolidBrush(T.Surf)) g.FillPath(b, p);
                using (var pen = new Pen(Glow != Color.Empty ? T.Mix(T.Line, Glow, 0.35f) : T.Line)) g.DrawPath(pen, p);
            }
            if (!string.IsNullOrEmpty(Caption))
                T.DrawText(g, Caption.ToUpperInvariant(), T.Lamp, T.Mute, new Rectangle(T.Px(20), T.Px(17), Width - T.Px(40), T.Px(20)), TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
            PaintContent(g);
        }

        protected virtual void PaintContent(Graphics g) { }
    }

    /// <summary>A card with a bold line and a grey line under it (Updates).</summary>
    class TextCard : Card
    {
        public string Big, Small;
        public TextCard(string caption, int span, int height) : base(caption, span, height) { }
        public void Set(string big, string small)
        {
            if (Big == big && Small == small) return;
            Big = big; Small = small;
            Invalidate();
        }
        protected override void PaintContent(Graphics g)
        {
            int x = T.Px(20), w = Width - T.Px(40), y = ContentTop;
            T.DrawText(g, Big, DashFonts.Big, T.Text, new Rectangle(x, y, w, DashFonts.Big.Height + T.Px(4)), TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
            y += DashFonts.Big.Height + T.Px(6);
            T.DrawText(g, Small, T.Body, T.Mute, new Rectangle(x, y, w, Math.Max(10, BarTop - y - T.Px(4))), TextFormatFlags.Left | TextFormatFlags.WordBreak | TextFormatFlags.EndEllipsis);
        }
    }

    /// <summary>"Everything is running": a big round check (or warning) and a chip for each part.</summary>
    class StatusCard : Card
    {
        public string Title = "Checking…", Sub = "";
        public Color State = T.Mute;
        public readonly List<KeyValuePair<string, Color>> Chips = new List<KeyValuePair<string, Color>>();
        public StatusCard(int span, int height) : base(null, span, height) { }

        public void Set(string title, string sub, Color state, List<KeyValuePair<string, Color>> chips)
        {
            Title = title; Sub = sub; State = state;
            Glow = state;
            Chips.Clear();
            Chips.AddRange(chips);
            Invalidate();
        }

        protected override void PaintContent(Graphics g)
        {
            int d = T.Px(60), cx = T.Px(24), cy = (Height - d) / 2;
            using (var halo = new SolidBrush(Color.FromArgb(40, State))) g.FillEllipse(halo, cx - T.Px(6), cy - T.Px(6), d + T.Px(12), d + T.Px(12));
            using (var b = new SolidBrush(State)) g.FillEllipse(b, cx, cy, d, d);
            string glyph = State == T.Ok ? Glyph.Check : State == T.Mute ? Glyph.Refresh : Glyph.Warning;
            T.DrawText(g, glyph, DashFonts.IconBig, Color.FromArgb(20, 22, 26), new Rectangle(cx, cy, d, d), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);

            int x = cx + d + T.Px(22), w = Width - x - T.Px(18);
            int y = T.Px(26);
            T.DrawText(g, Title, DashFonts.Big, T.Text, new Rectangle(x, y, w, DashFonts.Big.Height + T.Px(4)), TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
            y += DashFonts.Big.Height + T.Px(4);
            T.DrawText(g, Sub, T.Body, T.Sub, new Rectangle(x, y, w, T.Body.Height * 2 + T.Px(4)), TextFormatFlags.Left | TextFormatFlags.WordBreak | TextFormatFlags.EndEllipsis);
            y = Height - T.Px(26) - T.Px(22);
            int chipX = x;
            foreach (var kv in Chips)
            {
                int tw = TextRenderer.MeasureText(kv.Key, T.Small).Width;
                int cw = tw + T.Px(30), ch = T.Px(26);
                if (chipX + cw > Width - T.Px(14)) break;
                using (var p = T.Round(new RectangleF(chipX, y, cw, ch), ch / 2f))
                using (var b = new SolidBrush(T.Raise)) g.FillPath(b, p);
                int dot = T.Px(7);
                using (var b = new SolidBrush(kv.Value)) g.FillEllipse(b, chipX + T.Px(11), y + (ch - dot) / 2f, dot, dot);
                T.DrawText(g, kv.Key, T.Small, T.Sub, new Rectangle(chipX + T.Px(23), y, tw + T.Px(6), ch), TextFormatFlags.Left | TextFormatFlags.VerticalCenter);
                chipX += cw + T.Px(8);
            }
        }
    }

    /// <summary>A small drawing of a panel page: one rounded box per tile, with its name.</summary>
    class PanelCard : Card
    {
        public class Box { public float X, Y, W, H; public string Name; public string Type; }
        public readonly List<Box> Boxes = new List<Box>();
        public float Cols = 15, Rows = 4;
        public string Empty = "Open the panel once and its layout shows here.";

        public PanelCard(int span, int height) : base("Your panel", span, height) { }

        protected override void PaintContent(Graphics g)
        {
            var area = new Rectangle(T.Px(20), ContentTop, Width - T.Px(40), Math.Max(T.Px(20), BarTop - ContentTop - T.Px(12)));
            // Keep the panel's shape (the XENEON EDGE is very wide).
            float aspect = Cols / Math.Max(1f, Rows) * 0.88f;
            float w = area.Width, h = w / Math.Max(0.5f, aspect);
            if (h > area.Height) { h = area.Height; w = h * aspect; }
            var screen = new RectangleF(area.X, area.Y, w, h);
            using (var p = T.Round(screen, T.Px(10)))
            {
                using (var b = new SolidBrush(Color.FromArgb(14, 14, 16))) g.FillPath(b, p);
                using (var pen = new Pen(T.Line)) g.DrawPath(pen, p);
            }
            if (Boxes.Count == 0)
            {
                T.DrawText(g, Empty, T.Small, T.Mute, Rectangle.Round(screen), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.WordBreak);
                return;
            }
            float pad = T.Px(6), gap = T.Px(4);
            float cw = (screen.Width - pad * 2) / Math.Max(1f, Cols), rh = (screen.Height - pad * 2) / Math.Max(1f, Rows);
            foreach (var bx in Boxes)
            {
                var r = new RectangleF(screen.X + pad + bx.X * cw + gap / 2, screen.Y + pad + bx.Y * rh + gap / 2, bx.W * cw - gap, bx.H * rh - gap);
                if (r.Width < 3 || r.Height < 3) continue;
                Color fill = TileColor(bx.Type);
                using (var p = T.Round(r, Math.Min(T.Px(6), r.Height / 3)))
                {
                    using (var b = new SolidBrush(fill)) g.FillPath(b, p);
                    using (var pen = new Pen(Color.FromArgb(60, 255, 255, 255))) g.DrawPath(pen, p);
                }
                if (r.Width > T.Px(26) && r.Height > T.Px(14))
                    T.DrawText(g, bx.Name, T.Small, Color.FromArgb(200, 255, 255, 255), Rectangle.Round(RectangleF.Inflate(r, -T.Px(4), -T.Px(2))),
                        (r.Height < T.Px(34) ? TextFormatFlags.VerticalCenter : TextFormatFlags.Top) | TextFormatFlags.Left | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine);
            }
        }

        static Color TileColor(string type)
        {
            switch (type)
            {
                case "spotify": case "spvolume": case "spplaylists": case "spnow": return Color.FromArgb(28, 86, 52);
                case "discord": case "dcjoin": return Color.FromArgb(52, 58, 120);
                case "clock": case "worldclock": case "weather": return Color.FromArgb(52, 54, 62);
                case "shortcut": case "folder": return Color.FromArgb(44, 46, 53);
                default: return T.Mix(Color.FromArgb(44, 46, 53), T.Acc, 0.18f);
            }
        }
    }

    /// <summary>Now playing: the cover, the song, a bar, and the card glows in the cover's colour.</summary>
    class MusicCard : Card
    {
        public Image Cover;
        public string Song = "", Artist = "";
        public float Progress;
        public MusicCard(int span, int height) : base("Now playing", span, height) { }

        public void SetCover(Image img)
        {
            if (Cover != null && Cover != img) Cover.Dispose();
            Cover = img;
            Glow = img != null ? Average(img) : Color.Empty;
            Invalidate();
        }

        static Color Average(Image img)
        {
            try
            {
                using (var small = new Bitmap(img, new Size(8, 8)))
                {
                    long r = 0, g = 0, b = 0;
                    for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) { var c = small.GetPixel(x, y); r += c.R; g += c.G; b += c.B; }
                    var avg = Color.FromArgb((int)(r / 64), (int)(g / 64), (int)(b / 64));
                    // a bit brighter and more colourful, so the glow shows
                    return T.Mix(avg, Color.White, 0.15f);
                }
            }
            catch { return Color.Empty; }
        }

        protected override void PaintContent(Graphics g)
        {
            int top = ContentTop, size = Math.Max(T.Px(40), Math.Min(T.Px(92), BarTop - top - T.Px(12)));
            var art = new Rectangle(T.Px(20), top, size, size);
            using (var p = T.Round(art, T.Px(10)))
            {
                if (Cover != null)
                {
                    var st = g.Save();
                    g.SetClip(p);
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.DrawImage(Cover, art);
                    g.Restore(st);
                }
                else
                {
                    using (var b = new SolidBrush(Color.FromArgb(30, 215, 96))) g.FillPath(b, p);
                    T.DrawText(g, Glyph.Music, DashFonts.IconMid, Color.FromArgb(10, 40, 20), art, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
                }
            }
            int x = art.Right + T.Px(16), w = Width - x - T.Px(18);
            int y = top + T.Px(6);
            T.DrawText(g, Song, DashFonts.Big, T.Text, new Rectangle(x, y, w, DashFonts.Big.Height + T.Px(4)), TextFormatFlags.Left | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine);
            y += DashFonts.Big.Height + T.Px(4);
            T.DrawText(g, Artist, T.Body, T.Sub, new Rectangle(x, y, w, T.Body.Height + T.Px(4)), TextFormatFlags.Left | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine);
            y += T.Body.Height + T.Px(14);
            if (Progress > 0)
            {
                var bar = new RectangleF(x, y, w, T.Px(4));
                using (var p = T.Round(bar, bar.Height / 2)) using (var b = new SolidBrush(Color.FromArgb(60, 255, 255, 255))) g.FillPath(b, p);
                var fill = new RectangleF(x, y, Math.Max(T.Px(4), w * Math.Min(1f, Progress)), T.Px(4));
                using (var p = T.Round(fill, fill.Height / 2)) using (var b = new SolidBrush(Color.White)) g.FillPath(b, p);
            }
        }
    }

    /// <summary>The last flight from FlightLine: EKCH ✈ ENGM and a few facts.</summary>
    class FlightCard : Card
    {
        public string From = "", To = "", Empty = "No flights yet. Fly with MSFS and Control Hub running, and they show up here.";
        public readonly List<KeyValuePair<string, string>> Facts = new List<KeyValuePair<string, string>>();
        public FlightCard(int span, int height) : base("FlightLine · last flight", span, height) { }

        protected override void PaintContent(Graphics g)
        {
            int x = T.Px(20), y = ContentTop, w = Width - T.Px(40);
            if (string.IsNullOrEmpty(From) && string.IsNullOrEmpty(To))
            {
                T.DrawText(g, Empty, T.Body, T.Mute, new Rectangle(x, y, w, Math.Max(10, BarTop - y - T.Px(6))), TextFormatFlags.Left | TextFormatFlags.WordBreak);
                return;
            }
            var f = DashFonts.Huge;
            string a = string.IsNullOrEmpty(From) ? "?" : From, b = string.IsNullOrEmpty(To) ? "?" : To;
            int aw = TextRenderer.MeasureText(a, f).Width;
            T.DrawText(g, a, f, T.Text, new Rectangle(x, y - T.Px(4), aw + T.Px(4), f.Height + T.Px(4)), TextFormatFlags.Left);
            T.DrawText(g, Glyph.Airplane, DashFonts.IconMid, T.Acc, new Rectangle(x + aw, y - T.Px(4), T.Px(40), f.Height + T.Px(4)), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
            T.DrawText(g, b, f, T.Text, new Rectangle(x + aw + T.Px(40), y - T.Px(4), w - aw - T.Px(40), f.Height + T.Px(4)), TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
            y += f.Height + T.Px(8);
            int fx = x;
            foreach (var kv in Facts)
            {
                int fw = Math.Max(TextRenderer.MeasureText(kv.Key, T.Small).Width, TextRenderer.MeasureText(kv.Value, T.BodyBold).Width) + T.Px(22);
                if (fx + fw > Width - T.Px(10)) break;
                T.DrawText(g, kv.Key, T.Small, T.Mute, new Rectangle(fx, y, fw, T.Small.Height + T.Px(2)), TextFormatFlags.Left);
                T.DrawText(g, kv.Value, T.BodyBold, T.Text, new Rectangle(fx, y + T.Small.Height + T.Px(2), fw, T.BodyBold.Height + T.Px(4)), TextFormatFlags.Left);
                fx += fw;
            }
        }
    }

    /// <summary>A square button with a big icon and a name (Quick actions).</summary>
    class QuickTile : DrawnControl
    {
        public string IconGlyph;
        public QuickTile(string glyph, string text) { IconGlyph = glyph; Text = text; Cursor = Cursors.Hand; Font = T.Body; }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            T.Smooth(g);
            var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
            using (var p = T.Round(r, T.Px(12)))
            using (var b = new SolidBrush(Down ? T.Raise : Hover ? T.RaiseHover : T.Raise)) g.FillPath(b, p);
            var ir = new RectangleF(T.Px(14), T.Px(14), T.Px(34), T.Px(34));
            using (var p = T.Round(ir, T.Px(9)))
            using (var b = new SolidBrush(Color.FromArgb(40, T.Acc))) g.FillPath(b, p);
            T.DrawText(g, IconGlyph, T.Icon, T.Acc, Rectangle.Round(ir), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
            T.DrawText(g, Text, Font, T.Text, new Rectangle(T.Px(14), T.Px(54), Width - T.Px(20), Height - T.Px(58)), TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.WordBreak | TextFormatFlags.EndEllipsis);
        }
    }

    class QuickCard : Card
    {
        public readonly List<QuickTile> Tiles = new List<QuickTile>();
        public QuickCard(int span, int height) : base("Quick actions", span, height) { }
        public QuickTile AddTile(string glyph, string text, EventHandler click)
        {
            var t = new QuickTile(glyph, text);
            if (click != null) t.Click += click;
            Tiles.Add(t);
            Controls.Add(t);
            PerformLayout();
            return t;
        }
        protected override void OnLayout(LayoutEventArgs e)
        {
            base.OnLayout(e);
            if (Tiles == null || Tiles.Count == 0) return;
            int gap = T.Px(10), x = T.Px(20), y = ContentTop, w = Width - T.Px(40), h = Height - y - T.Px(18);
            float tw = (w - gap * (Tiles.Count - 1)) / (float)Tiles.Count;
            for (int i = 0; i < Tiles.Count; i++) Tiles[i].Bounds = new Rectangle(x + (int)(i * (tw + gap)), y, (int)tw, Math.Max(T.Px(40), h));
        }
    }

    /// <summary>Lays cards out in rows of twelfths. On a narrow window every card gets its own row.</summary>
    class DashGrid : Panel
    {
        public DashGrid()
        {
            BackColor = T.Win;
            SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint, true);
            Height = T.Px(10);
        }
        public T2 Add<T2>(T2 c) where T2 : Card { Controls.Add(c); return c; }

        protected override void OnLayout(LayoutEventArgs e)
        {
            int W = Width;
            if (W < T.Px(100)) { base.OnLayout(e); return; }
            int gap = T.Px(14);
            bool narrow = W < T.Px(780);
            var row = new List<Card>();
            int used = 0, y = 0;
            foreach (Control c0 in Controls)
            {
                var c = c0 as Card;
                if (c == null || !c.Visible) continue;
                int span = narrow ? 12 : Math.Max(1, Math.Min(12, c.Span));
                if (used + span > 12 && row.Count > 0) { y = PlaceRow(row, y, W, gap, narrow); row.Clear(); used = 0; }
                row.Add(c);
                used += span;
            }
            if (row.Count > 0) y = PlaceRow(row, y, W, gap, narrow);
            int h = Math.Max(T.Px(10), y - gap);
            if (Height != h) Height = h;
            base.OnLayout(e);
        }

        static int PlaceRow(List<Card> row, int y, int W, int gap, bool narrow)
        {
            int total = 0, rh = 0;
            foreach (var c in row) { total += narrow ? 12 : c.Span; rh = Math.Max(rh, c.BaseHeight); }
            float unit = (W - gap * (row.Count - 1)) / (float)Math.Max(1, total);
            int x = 0;
            for (int i = 0; i < row.Count; i++)
            {
                int span = narrow ? 12 : row[i].Span;
                int w = i == row.Count - 1 ? W - x : (int)Math.Round(unit * span);
                var want = new Rectangle(x, y, Math.Max(1, w), rh);
                if (row[i].Bounds != want) row[i].Bounds = want;
                x += w + gap;
            }
            return y + rh + gap;
        }
        protected override void OnResize(EventArgs e) { base.OnResize(e); PerformLayout(); }
    }

    /// <summary>Round colour dots to pick the accent colour; the first one means "like the panel".</summary>
    class AccentPicker : DrawnControl
    {
        public static readonly string[] Choices = { "panel", "#2DD4BF", "#22C55E", "#3B82F6", "#8B5CF6", "#EC4899", "#F97316", "#EF4444", "#EAB308" };
        public string Value = "panel";
        public event EventHandler Changed;
        public AccentPicker() { Height = T.Px(40); Width = T.Px(40 * Choices.Length + 10); Cursor = Cursors.Hand; }

        int At(int x) { int i = x / T.Px(40); return i >= 0 && i < Choices.Length ? i : -1; }

        protected override void OnMouseClick(MouseEventArgs e)
        {
            int i = At(e.X);
            if (i < 0) return;
            Value = Choices[i];
            Invalidate();
            if (Changed != null) Changed(this, EventArgs.Empty);
            base.OnMouseClick(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            T.Smooth(g);
            for (int i = 0; i < Choices.Length; i++)
            {
                var r = new RectangleF(i * T.Px(40) + T.Px(6), T.Px(6), T.Px(28), T.Px(28));
                bool sel = string.Equals(Value, Choices[i], StringComparison.OrdinalIgnoreCase);
                Color c;
                if (i == 0)
                {
                    using (var b = new LinearGradientBrush(r, Color.FromArgb(45, 212, 191), Color.FromArgb(139, 92, 246), 45f)) g.FillEllipse(b, r);
                    T.DrawText(g, "P", T.BodyBold, Color.White, Rectangle.Round(r), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
                }
                else if (T.TryHex(Choices[i], out c)) using (var b = new SolidBrush(c)) g.FillEllipse(b, r);
                if (sel) using (var pen = new Pen(T.Text, T.Px(2))) g.DrawEllipse(pen, RectangleF.Inflate(r, T.Px(4), T.Px(4)));
            }
        }
    }

    /// <summary>Downloads small pictures (album covers, app icons) for the window. Never throws.</summary>
    static class Pics
    {
        public static Image Load(string url, int timeoutMs)
        {
            try
            {
                try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; } catch { }
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = timeoutMs;
                req.ReadWriteTimeout = timeoutMs;
                req.UserAgent = "ControlHub/" + HubApp.Version;
                if (url.StartsWith("http://127.0.0.1")) req.Proxy = null;
                using (var res = req.GetResponse())
                using (var s = res.GetResponseStream())
                using (var ms = new MemoryStream())
                {
                    s.CopyTo(ms);
                    ms.Position = 0;
                    using (var img = Image.FromStream(ms)) return new Bitmap(img);   // a copy that doesn't need the stream
                }
            }
            catch { return null; }
        }
    }
}
