using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace ControlPanelHelper
{
    [StructLayout(LayoutKind.Sequential)]
    struct NativeSize
    {
        public int cx;
        public int cy;
        public NativeSize(int w, int h) { cx = w; cy = h; }
    }

    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItemImageFactory
    {
        [PreserveSig] int GetImage(NativeSize size, int flags, out IntPtr phbm);
    }

    /// <summary>
    /// Real app icons, the way Explorer shows them. Each icon gets a short id that the widget
    /// uses in http://127.0.0.1:port/api/icon?id=… — only ids handed out here can be loaded.
    /// </summary>
    static class Icons
    {
        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        static extern int SHCreateItemFromParsingName(string path, IntPtr bindCtx, ref Guid riid,
            [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory item);
        [DllImport("gdi32.dll")]
        static extern bool DeleteObject(IntPtr h);

        const int Size = 128;
        const int SIIGBF_BIGGERSIZEOK = 0x1, SIIGBF_ICONONLY = 0x4;

        static readonly Dictionary<string, string> idToSource = new Dictionary<string, string>();
        static readonly Dictionary<string, byte[]> cache = new Dictionary<string, byte[]>();
        static readonly Dictionary<string, DateTime> missAt = new Dictionary<string, DateTime>();
        static readonly LinkedList<string> cacheOrder = new LinkedList<string>();
        const int MaxCached = 300;

        /// <summary>Register a shell parsing name (exe path, .lnk, or shell:AppsFolder\…) and get its id.</summary>
        public static string Register(string source)
        {
            if (string.IsNullOrEmpty(source)) return null;
            string id = Hash(source.ToLowerInvariant());
            lock (idToSource) idToSource[id] = source;
            return id;
        }

        static string Hash(string s)
        {
            using (var sha = SHA1.Create())
            {
                byte[] b = sha.ComputeHash(Encoding.UTF8.GetBytes(s));
                var sb = new StringBuilder();
                for (int i = 0; i < 8; i++) sb.Append(b[i].ToString("x2"));
                return sb.ToString();
            }
        }

        public static byte[] GetPng(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            lock (cache)
            {
                byte[] hit;
                if (cache.TryGetValue(id, out hit)) return hit;
                // A failed icon is tried again after a minute (the app may have been busy starting).
                DateTime when;
                if (missAt.TryGetValue(id, out when) && (DateTime.Now - when).TotalSeconds < 60) return null;
            }
            string source;
            lock (idToSource) if (!idToSource.TryGetValue(id, out source)) return null;

            byte[] png = null;
            // Shell icon APIs want a single-threaded (STA) thread.
            var t = new Thread(delegate ()
            {
                png = Render(source);
                if (png == null) png = Fallback(source);
            });
            t.SetApartmentState(ApartmentState.STA);
            t.IsBackground = true;
            t.Start();
            if (!t.Join(5000)) return null;

            lock (cache)
            {
                if (png == null)
                {
                    missAt[id] = DateTime.Now;
                    return null;
                }
                cache[id] = png;
                cacheOrder.AddLast(id);
                while (cacheOrder.Count > MaxCached)
                {
                    cache.Remove(cacheOrder.First.Value);
                    cacheOrder.RemoveFirst();
                }
            }
            return png;
        }

        static byte[] Render(string source)
        {
            IShellItemImageFactory factory = null;
            IntPtr hbm = IntPtr.Zero;
            try
            {
                Guid iid = typeof(IShellItemImageFactory).GUID;
                if (SHCreateItemFromParsingName(source, IntPtr.Zero, ref iid, out factory) != 0 || factory == null) return null;
                int hr = factory.GetImage(new NativeSize(Size, Size), SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK, out hbm);
                // 0x8000000A = Windows is still getting the icon ready: wait a moment and ask again.
                for (int tries = 0; hr == unchecked((int)0x8000000A) && tries < 6; tries++)
                {
                    Thread.Sleep(150);
                    hr = factory.GetImage(new NativeSize(Size, Size), SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK, out hbm);
                }
                if (hr != 0 || hbm == IntPtr.Zero)
                {
                    Log.Write("Icon " + source + ": shell returned 0x" + hr.ToString("X8"));
                    return null;
                }
                using (var bmp = WithAlpha(hbm))
                using (var trimmed = Trim(bmp))
                using (var ms = new MemoryStream())
                {
                    trimmed.Save(ms, ImageFormat.Png);
                    return ms.ToArray();
                }
            }
            catch (Exception ex)
            {
                Log.Write("Icon " + source + ": " + ex.Message);
                return null;
            }
            finally
            {
                if (hbm != IntPtr.Zero) DeleteObject(hbm);
                if (factory != null) Marshal.ReleaseComObject(factory);
            }
        }

        /// <summary>Simpler way for .exe files: the icon Windows shows in Explorer (smaller, but reliable).</summary>
        static byte[] Fallback(string source)
        {
            try
            {
                if (!File.Exists(source)) return null;
                using (var icon = Icon.ExtractAssociatedIcon(source))
                {
                    if (icon == null) return null;
                    using (var small = icon.ToBitmap())
                    using (var big = new Bitmap(Size, Size, PixelFormat.Format32bppArgb))
                    using (var g = Graphics.FromImage(big))
                    using (var ms = new MemoryStream())
                    {
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        g.DrawImage(small, new Rectangle(0, 0, Size, Size));
                        big.Save(ms, ImageFormat.Png);
                        return ms.ToArray();
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Write("Icon fallback " + source + ": " + ex.Message);
                return null;
            }
        }

        /// <summary>Image.FromHbitmap drops transparency; re-read the pixels as premultiplied ARGB.</summary>
        static Bitmap WithAlpha(IntPtr hbm)
        {
            using (Bitmap raw = Image.FromHbitmap(hbm))
            {
                var rect = new Rectangle(0, 0, raw.Width, raw.Height);
                var result = new Bitmap(raw.Width, raw.Height, PixelFormat.Format32bppArgb);
                if (Image.GetPixelFormatSize(raw.PixelFormat) < 32)
                {
                    using (var g = Graphics.FromImage(result)) g.DrawImage(raw, rect);
                    return result;
                }
                BitmapData data = raw.LockBits(rect, ImageLockMode.ReadOnly, raw.PixelFormat);
                try
                {
                    using (var view = new Bitmap(data.Width, data.Height, data.Stride, PixelFormat.Format32bppPArgb, data.Scan0))
                    using (var g = Graphics.FromImage(result))
                    {
                        g.CompositingMode = CompositingMode.SourceCopy;
                        g.DrawImage(view, rect);
                    }
                }
                finally { raw.UnlockBits(data); }

                // Some icons have no alpha at all (all zero): fall back to the opaque image.
                bool anyAlpha = false;
                for (int y = 0; y < result.Height && !anyAlpha; y += 4)
                    for (int x = 0; x < result.Width && !anyAlpha; x += 4)
                        if (result.GetPixel(x, y).A > 0) anyAlpha = true;
                if (!anyAlpha)
                {
                    result.Dispose();
                    result = new Bitmap(raw);
                }
                return result;
            }
        }

        /// <summary>Crop empty transparent borders so small icons fill the button.</summary>
        static Bitmap Trim(Bitmap src)
        {
            int minX = src.Width, minY = src.Height, maxX = -1, maxY = -1;
            for (int y = 0; y < src.Height; y++)
                for (int x = 0; x < src.Width; x++)
                    if (src.GetPixel(x, y).A > 8)
                    {
                        if (x < minX) minX = x;
                        if (y < minY) minY = y;
                        if (x > maxX) maxX = x;
                        if (y > maxY) maxY = y;
                    }
            if (maxX < 0) return new Bitmap(src);
            int w = maxX - minX + 1, h = maxY - minY + 1;
            int side = Math.Max(w, h);
            if (side >= src.Width - 2) return new Bitmap(src);
            var dst = new Bitmap(Size, Size, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(dst))
            {
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                float scale = (float)Size / side;
                float dw = w * scale, dh = h * scale;
                g.DrawImage(src, new RectangleF((Size - dw) / 2f, (Size - dh) / 2f, dw, dh),
                    new RectangleF(minX, minY, w, h), GraphicsUnit.Pixel);
            }
            return dst;
        }
    }
}
