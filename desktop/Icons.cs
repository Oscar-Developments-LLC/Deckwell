using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Deckwell;

/// Pulls 256 px icons out of .exe files and normalizes uploaded images.
static class Icons
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct SHFILEINFO { public IntPtr hIcon; public int iIcon; public uint dwAttributes; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName; }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SHGetFileInfo(string path, uint attr, ref SHFILEINFO sfi, uint cb, uint flags);
    [DllImport("shell32.dll", EntryPoint = "#727")] static extern int SHGetImageList(int iImageList, ref Guid riid, out IImageList ppv);
    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);

    [ComImport, Guid("46EB5926-582E-4017-9FDF-E8998DAA0950"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IImageList
    {
        [PreserveSig] int Add(IntPtr hbmImage, IntPtr hbmMask, ref int pi);
        [PreserveSig] int ReplaceIcon(int i, IntPtr hicon, ref int pi);
        [PreserveSig] int SetOverlayImage(int iImage, int iOverlay);
        [PreserveSig] int Replace(int i, IntPtr hbmImage, IntPtr hbmMask);
        [PreserveSig] int AddMasked(IntPtr hbmImage, int crMask, ref int pi);
        [PreserveSig] int Draw(IntPtr pimldp);
        [PreserveSig] int Remove(int i);
        [PreserveSig] int GetIcon(int i, int flags, ref IntPtr picon);
    }

    const uint SHGFI_SYSICONINDEX = 0x4000;
    const int SHIL_JUMBO = 4, SHIL_EXTRALARGE = 2, ILD_TRANSPARENT = 1;

    static string Hash(string s) => Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(s)))[..12].ToLowerInvariant();

    public static string? FromExe(string rawPath)
    {
        var path = Paths.Expand(rawPath);
        if (!File.Exists(path)) return null;
        var id = "exe-" + Hash(path.ToLowerInvariant() + File.GetLastWriteTimeUtc(path).Ticks);
        var dest = Path.Combine(Paths.Icons, id + ".png");
        if (File.Exists(dest)) return id;
        using var bmp = Jumbo(path) ?? Fallback(path);
        if (bmp == null) return null;
        using var trimmed = TrimAndFit(bmp, 256);
        trimmed.Save(dest, ImageFormat.Png);
        return id;
    }

    static Bitmap? Jumbo(string path)
    {
        try
        {
            var sfi = new SHFILEINFO();
            SHGetFileInfo(path, 0, ref sfi, (uint)Marshal.SizeOf(sfi), SHGFI_SYSICONINDEX);
            foreach (var list in new[] { SHIL_JUMBO, SHIL_EXTRALARGE })
            {
                var iid = new Guid("46EB5926-582E-4017-9FDF-E8998DAA0950");
                if (SHGetImageList(list, ref iid, out var il) != 0) continue;
                IntPtr h = IntPtr.Zero;
                il.GetIcon(sfi.iIcon, ILD_TRANSPARENT, ref h);
                if (h == IntPtr.Zero) continue;
                try { using var ico = Icon.FromHandle(h); return IconToBitmap(ico); }
                finally { DestroyIcon(h); }
            }
        }
        catch (Exception e) { Log.Write("jumbo icon: " + e.Message); }
        return null;
    }

    static Bitmap? Fallback(string path)
    {
        try { using var ico = Icon.ExtractAssociatedIcon(path); return ico == null ? null : IconToBitmap(ico); } catch { return null; }
    }

    // Icon.ToBitmap loses alpha for some 32-bit icons; draw via DrawIcon onto a transparent canvas instead.
    static Bitmap IconToBitmap(Icon ico)
    {
        var b = new Bitmap(ico.Width, ico.Height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(b)) { g.Clear(Color.Transparent); g.DrawIcon(ico, 0, 0); }
        return b;
    }

    /// Crops transparent padding (jumbo lists pad small icons into 256) and scales into a size x size canvas.
    static Bitmap TrimAndFit(Bitmap src, int size)
    {
        int minX = src.Width, minY = src.Height, maxX = -1, maxY = -1;
        var data = src.LockBits(new Rectangle(0, 0, src.Width, src.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        var px = new int[src.Width * src.Height];
        Marshal.Copy(data.Scan0, px, 0, px.Length);
        src.UnlockBits(data);
        for (int y = 0; y < src.Height; y++)
            for (int x = 0; x < src.Width; x++)
                if (((px[y * src.Width + x] >> 24) & 0xFF) > 8) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
        var crop = maxX < 0 ? new Rectangle(0, 0, src.Width, src.Height) : Rectangle.FromLTRB(minX, minY, maxX + 1, maxY + 1);
        return Fit(src, crop, size, contain: true);
    }

    static Bitmap Fit(Image src, Rectangle crop, int size, bool contain)
    {
        var dst = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(dst);
        g.Clear(Color.Transparent);
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.SmoothingMode = SmoothingMode.HighQuality;
        double s = contain ? Math.Min((double)size / crop.Width, (double)size / crop.Height) : Math.Max((double)size / crop.Width, (double)size / crop.Height);
        int w = (int)Math.Round(crop.Width * s), h = (int)Math.Round(crop.Height * s);
        using var attrs = new ImageAttributes();
        attrs.SetWrapMode(WrapMode.TileFlipXY);
        g.DrawImage(src, new Rectangle((size - w) / 2, (size - h) / 2, w, h), crop.X, crop.Y, crop.Width, crop.Height, GraphicsUnit.Pixel, attrs);
        return dst;
    }

    public static string? FromImageFile(string path)
    {
        try { return FromImageBytes(File.ReadAllBytes(path)); }
        catch (Exception e) { Log.Write("image icon: " + e.Message); return null; }
    }

    public static string? FromImageBytes(byte[] bytes)
    {
        try
        {
            var id = "img-" + Convert.ToHexString(SHA1.HashData(bytes))[..12].ToLowerInvariant();
            var dest = Path.Combine(Paths.Icons, id + ".png");
            if (!File.Exists(dest))
            {
                using var ms = new MemoryStream(bytes);
                using var img = Image.FromStream(ms);
                using var fit = Fit(img, new Rectangle(0, 0, img.Width, img.Height), 256, contain: true);
                fit.Save(dest, ImageFormat.Png);
            }
            return id;
        }
        catch (Exception e) { Log.Write("image icon: " + e.Message); return null; }
    }

    /// Album art: square-cropped 256 px PNG. Returns the id.
    public static string? FromArtBytes(byte[] bytes)
    {
        try
        {
            var id = "np-" + Convert.ToHexString(SHA1.HashData(bytes))[..12].ToLowerInvariant();
            var dest = Path.Combine(Paths.Icons, id + ".png");
            if (!File.Exists(dest))
            {
                using var ms = new MemoryStream(bytes);
                using var img = Image.FromStream(ms);
                int side = Math.Min(img.Width, img.Height);
                using var fit = Fit(img, new Rectangle((img.Width - side) / 2, (img.Height - side) / 2, side, side), 256, contain: false);
                fit.Save(dest, ImageFormat.Png);
                PruneArt();
            }
            return id;
        }
        catch (Exception e) { Log.Write("art: " + e.Message); return null; }
    }

    static void PruneArt()
    {
        try
        {
            foreach (var f in new DirectoryInfo(Paths.Icons).GetFiles("np-*.png").OrderByDescending(f => f.LastWriteTimeUtc).Skip(30)) f.Delete();
        }
        catch { }
    }

    public static byte[]? Read(string id)
    {
        if (id.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || id.Contains("..")) return null;
        var p = Path.Combine(Paths.Icons, id + ".png");
        return File.Exists(p) ? File.ReadAllBytes(p) : null;
    }
}
