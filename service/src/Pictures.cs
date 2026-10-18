using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

namespace ControlPanelHelper
{
    /// <summary>
    /// Your own pictures for buttons, kept in %APPDATA%\ControlPanelHelper\pictures.
    /// Added from the tray menu; the widget can only read files from this folder.
    /// </summary>
    static class Pictures
    {
        public static readonly string Folder = Path.Combine(Settings.Folder, "pictures");
        static readonly string[] Allowed = { ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg" };

        static string TypeOf(string ext)
        {
            switch (ext)
            {
                case ".png": return "image/png";
                case ".jpg": case ".jpeg": return "image/jpeg";
                case ".gif": return "image/gif";
                case ".webp": return "image/webp";
                case ".svg": return "image/svg+xml";
                default: return null;
            }
        }

        public static List<string> List()
        {
            var list = new List<string>();
            try
            {
                if (!Directory.Exists(Folder)) return list;
                foreach (var f in Directory.GetFiles(Folder))
                {
                    var ext = Path.GetExtension(f).ToLowerInvariant();
                    if (Array.IndexOf(Allowed, ext) >= 0) list.Add(Path.GetFileName(f));
                }
                list.Sort(StringComparer.CurrentCultureIgnoreCase);
            }
            catch (Exception ex) { Log.Write("Pictures: " + ex.Message); }
            return list;
        }

        public static byte[] Read(string name, out string type)
        {
            type = null;
            if (string.IsNullOrEmpty(name) || name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || name.Contains("..")) return null;
            type = TypeOf(Path.GetExtension(name).ToLowerInvariant());
            if (type == null) return null;
            string path = Path.Combine(Folder, name);
            try { return File.Exists(path) ? File.ReadAllBytes(path) : null; }
            catch { return null; }
        }

        /// <summary>Copies a picture into the folder. Big photos are shrunk to 256×256 to keep things light.</summary>
        public static string Add(string source)
        {
            Directory.CreateDirectory(Folder);
            string ext = Path.GetExtension(source).ToLowerInvariant();
            if (ext == ".ico" || ext == ".bmp") ext = ".png";
            if (Array.IndexOf(Allowed, ext) < 0) throw new Exception("Use a PNG, JPG, GIF, WEBP, SVG, ICO or BMP picture.");
            string baseName = Path.GetFileNameWithoutExtension(source);
            foreach (char c in Path.GetInvalidFileNameChars()) baseName = baseName.Replace(c, '_');
            if (baseName.Length > 40) baseName = baseName.Substring(0, 40);
            string name = baseName + ext;
            for (int i = 2; File.Exists(Path.Combine(Folder, name)); i++) name = baseName + " " + i + ext;
            string target = Path.Combine(Folder, name);

            if (ext == ".svg" || ext == ".gif" || ext == ".webp")
            {
                if (new FileInfo(source).Length > 5 * 1024 * 1024) throw new Exception("That picture is too big (over 5 MB).");
                File.Copy(source, target);
                return name;
            }
            using (var img = Image.FromFile(source))
            {
                int max = 256;
                double scale = Math.Min(1.0, Math.Min((double)max / img.Width, (double)max / img.Height));
                int w = Math.Max(1, (int)(img.Width * scale)), h = Math.Max(1, (int)(img.Height * scale));
                using (var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb))
                {
                    using (var g = Graphics.FromImage(bmp))
                    {
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        g.DrawImage(img, new Rectangle(0, 0, w, h));
                    }
                    bmp.Save(target, ext == ".jpg" || ext == ".jpeg" ? ImageFormat.Jpeg : ImageFormat.Png);
                }
            }
            return name;
        }
    }
}
