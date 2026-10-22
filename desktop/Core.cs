using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Deckwell;

static class Paths
{
    public static readonly string Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Deckwell");
    public static readonly string Icons = Path.Combine(Root, "icons");
    public static readonly string Config = Path.Combine(Root, "config.json");
    public static readonly string Pairing = Path.Combine(Root, "pairing.json");
    public static readonly string PushToken = Path.Combine(Root, "push-token.txt");
    public static readonly string Log = Path.Combine(Root, "deckwell.log");
    public static readonly string WebData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Deckwell", "WebView2");

    public static void Ensure()
    {
        MoveFromLegacyName();
        Directory.CreateDirectory(Root); Directory.CreateDirectory(Icons); Directory.CreateDirectory(WebData);
    }

    /// Early builds were called LabDeck and kept data in %APPDATA%\LabDeck. Copy it over once so an
    /// existing setup survives the rename. The old folder is left in place as a backup.
    static void MoveFromLegacyName()
    {
        try
        {
            var old = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "LabDeck");
            if (Directory.Exists(Root) || !File.Exists(Path.Combine(old, "config.json"))) return;
            CopyDir(old, Root);
        }
        catch { }
    }

    static void CopyDir(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var f in Directory.GetFiles(from)) File.Copy(f, Path.Combine(to, Path.GetFileName(f)), false);
        foreach (var d in Directory.GetDirectories(from)) CopyDir(d, Path.Combine(to, Path.GetFileName(d)));
    }

    public static string Expand(string? p)
    {
        if (string.IsNullOrWhiteSpace(p)) return "";
        p = Environment.ExpandEnvironmentVariables(p.Trim().Trim('"'));
        if (p.StartsWith("~")) p = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) + p[1..];
        return p.Replace('/', Path.DirectorySeparatorChar);
    }
}

static class Log
{
    static readonly object Gate = new();
    public static void Write(string msg)
    {
        try
        {
            lock (Gate)
            {
                var fi = new FileInfo(Paths.Log);
                if (fi.Exists && fi.Length > 2_000_000) fi.Delete();
                File.AppendAllText(Paths.Log, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {msg}{Environment.NewLine}");
            }
        }
        catch { }
    }
}

static class Json
{
    public static readonly JsonSerializerOptions Opts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = false };
    public static string S(JsonNode? n, string key, string def = "") { try { var v = n?[key]; return v == null ? def : v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : v.ToJsonString(); } catch { return def; } }
    public static double D(JsonNode? n, string key, double def = 0)
    {
        try
        {
            if (n?[key] is not JsonValue v) return def;
            if (v.TryGetValue<double>(out var d)) return d;
            if (v.TryGetValue<int>(out var i)) return i;
            if (v.TryGetValue<long>(out var l)) return l;
            if (v.TryGetValue<float>(out var f)) return f;
            if (v.TryGetValue<string>(out var s) && double.TryParse(s, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var ps)) return ps;
            return double.TryParse(v.ToJsonString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var pj) ? pj : def;
        }
        catch { return def; }
    }
    public static IEnumerable<JsonNode> Arr(JsonNode? n, string key) => (n?[key] as JsonArray)?.Where(x => x != null).Select(x => x!) ?? Enumerable.Empty<JsonNode>();
}

static class Native
{
    public const int WM_NCLBUTTONDOWN = 0xA1, WM_NCHITTEST = 0x84, WM_NCCALCSIZE = 0x83, WM_SIZE = 0x05, WM_GETMINMAXINFO = 0x24;
    public const int HTCAPTION = 2, HTLEFT = 10, HTRIGHT = 11, HTTOP = 12, HTTOPLEFT = 13, HTTOPRIGHT = 14, HTBOTTOM = 15, HTBOTTOMLEFT = 16, HTBOTTOMRIGHT = 17, HTCLIENT = 1;
    public const int SW_RESTORE = 9, SW_MINIMIZE = 6, SW_SHOW = 5;

    [DllImport("user32.dll")] public static extern bool ReleaseCapture();
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);
    [DllImport("dwmapi.dll")] public static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS m);

    [StructLayout(LayoutKind.Sequential)] public struct MARGINS { public int Left, Right, Top, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct NCCALCSIZE_PARAMS { public RECT r0, r1, r2; public IntPtr lppos; }

    /// Bring another app's window to the front even when Deckwell isn't the foreground app.
    public static void ForceForeground(IntPtr hwnd)
    {
        if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
        var fg = GetForegroundWindow();
        uint fgThread = GetWindowThreadProcessId(fg, out _);
        uint me = GetCurrentThreadId();
        if (fgThread != me) AttachThreadInput(me, fgThread, true);
        Input.TapAlt();
        BringWindowToTop(hwnd);
        SetForegroundWindow(hwnd);
        if (fgThread != me) AttachThreadInput(me, fgThread, false);
    }
}
