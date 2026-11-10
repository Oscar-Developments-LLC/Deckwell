using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json.Nodes;

namespace Deckwell;

/// Moves windows around: snap spots, monitors, saved layouts, the deck's window picker, and finding terminals.
/// Spot math lives in SnapSpots (unit tested). Windows blocks a normal app from moving or typing into a window that
/// runs as admin, so those cases are reported instead of failing silently.
static class WindowSnap
{
    [DllImport("user32.dll", SetLastError = true)] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Native.RECT r);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr mon, ref MONITORINFOEX mi);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out Native.RECT r, int size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder sb, ref int size);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr h, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int cls, out int info, int len, out int ret);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct MONITORINFOEX { public int cbSize; public Native.RECT rcMonitor, rcWork; public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice; }

    const uint SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, GA_ROOT = 2, MONITOR_DEFAULTTONEAREST = 2, PROCESS_QUERY_LIMITED_INFORMATION = 0x1000, TOKEN_QUERY = 0x8;
    const int SW_MAXIMIZE = 3, DWMWA_EXTENDED_FRAME_BOUNDS = 9, TokenElevation = 20, ERROR_ACCESS_DENIED = 5;

    public const string AdminMessage = "That window runs as admin. Windows only lets Deckwell control it if Deckwell runs as admin too.";

    /* ---------------- monitors ---------------- */

    public sealed record Mon(string Id, string Name, SnapSpots.Box Bounds, SnapSpots.Box Work, bool Main);

    static SnapSpots.Box Box(Rectangle r) => new(r.X, r.Y, r.Width, r.Height);
    static SnapSpots.Box Box(Native.RECT r) => new(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);

    public static List<Mon> Monitors()
    {
        var list = new List<Mon>();
        foreach (var s in Screen.AllScreens.OrderBy(s => s.Bounds.X).ThenBy(s => s.Bounds.Y))
        {
            var digits = new string(s.DeviceName.Where(char.IsAsciiDigit).ToArray());
            var name = "Display " + (digits.Length > 0 ? digits : (list.Count + 1).ToString());
            list.Add(new Mon(s.DeviceName, name, Box(s.Bounds), Box(s.WorkingArea), s.Primary));
        }
        return list;
    }

    /// For the editor: every monitor with its size, so zones can be drawn on it.
    public static object MonitorsForUi() => Monitors().Select(m => new { id = m.Id, name = m.Name, x = m.Bounds.X, y = m.Bounds.Y, w = m.Bounds.W, h = m.Bounds.H, main = m.Main }).ToList();

    /// The monitor a key asks for: "current" (where the window is now), "main", or a monitor id.
    /// An id that isn't plugged in falls back to the main monitor.
    static Mon PickMonitor(string want, IntPtr hwnd)
    {
        var mons = Monitors();
        var main = mons.FirstOrDefault(m => m.Main) ?? mons[0];
        if (want == "main") return main;
        if (want is "" or "current")
        {
            var mi = new MONITORINFOEX { cbSize = Marshal.SizeOf<MONITORINFOEX>() };
            if (GetMonitorInfo(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), ref mi))
                return mons.FirstOrDefault(m => m.Id == mi.szDevice) ?? main;
            return main;
        }
        return mons.FirstOrDefault(m => string.Equals(m.Id, want, StringComparison.OrdinalIgnoreCase)) ?? main;
    }

    static IEnumerable<JsonNode>? ZonesFor(JsonNode? cfg, string monId) => cfg?["zones"]?[monId] as JsonArray is JsonArray a ? a.Where(z => z != null).Select(z => z!) : null;

    /* ---------------- processes ---------------- */

    static string ExePath(uint pid)
    {
        var h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (h == IntPtr.Zero) return "";
        try { var sb = new StringBuilder(1024); int n = sb.Capacity; return QueryFullProcessImageName(h, 0, sb, ref n) ? sb.ToString() : ""; }
        finally { CloseHandle(h); }
    }

    static bool? TokenElevated(IntPtr proc)
    {
        if (!OpenProcessToken(proc, TOKEN_QUERY, out var tok)) return null;
        try { return GetTokenInformation(tok, TokenElevation, out var e, 4, out _) ? e != 0 : null; }
        finally { CloseHandle(tok); }
    }

    static readonly Lazy<bool> SelfAdmin = new(() => TokenElevated(GetCurrentProcess()) == true);

    /// True when the window's app runs as admin and Deckwell doesn't, so Windows will block moving or typing into it.
    public static bool Blocked(IntPtr hwnd)
    {
        if (SelfAdmin.Value) return false;
        Native.GetWindowThreadProcessId(hwnd, out var pid);
        var h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (h == IntPtr.Zero) return Marshal.GetLastWin32Error() == ERROR_ACCESS_DENIED;
        try { return TokenElevated(h) ?? true; } // a token we can't read belongs to an admin app
        finally { CloseHandle(h); }
    }

    static string Title(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, sb.Capacity); return sb.ToString(); }
    static string Class(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, sb.Capacity); return sb.ToString(); }

    static readonly HashSet<string> ShellClasses = new(StringComparer.Ordinal) { "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow" };

    /// Windows a person would call "a window": visible, titled, not the desktop or taskbar, not Deckwell itself. Topmost first.
    static List<(IntPtr hwnd, uint pid)> UserWindows()
    {
        var me = (uint)Environment.ProcessId;
        return AppWindows.TopLevel().Where(w => w.pid != me && !ShellClasses.Contains(Class(w.hwnd))).ToList();
    }

    static string AppName(string exe, uint pid, string title)
    {
        if (exe.EndsWith("ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase)) return title; // Store apps show their name as the title
        try { var d = FileVersionInfo.GetVersionInfo(exe).FileDescription; if (!string.IsNullOrWhiteSpace(d)) return d.Trim(); } catch { }
        if (exe.Length > 0) return Path.GetFileNameWithoutExtension(exe);
        try { using var p = Process.GetProcessById((int)pid); return p.ProcessName; } catch { return "App"; }
    }

    /* ---------------- moving ---------------- */

    /// Moves a window so its visible edges fill the box. Windows 10/11 windows have invisible resize borders,
    /// so the outer rectangle is grown by those to make the visible frame line up with the spot.
    /// Returns null on success, or a short reason.
    public static string? MoveTo(IntPtr hwnd, SnapSpots.Box box, bool maximize)
    {
        if (!IsWindow(hwnd)) return "That window is gone";
        if (Blocked(hwnd)) return AdminMessage;
        if (Native.IsIconic(hwnd) || IsZoomed(hwnd)) Native.ShowWindow(hwnd, Native.SW_RESTORE);
        for (int pass = 0; pass < 2; pass++) // twice: moving to a screen with another scale can resize the frame
        {
            GetWindowRect(hwnd, out var outer);
            if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out var vis, Marshal.SizeOf<Native.RECT>()) != 0) vis = outer;
            int l = vis.Left - outer.Left, t = vis.Top - outer.Top, r = outer.Right - vis.Right, b = outer.Bottom - vis.Bottom;
            if (!SetWindowPos(hwnd, IntPtr.Zero, box.X - l, box.Y - t, box.W + l + r, box.H + t + b, SWP_NOZORDER | SWP_NOACTIVATE))
                return Marshal.GetLastWin32Error() == ERROR_ACCESS_DENIED ? AdminMessage : "Windows wouldn't move that window";
        }
        if (maximize) Native.ShowWindow(hwnd, SW_MAXIMIZE);
        return null;
    }

    /// Puts a window on a spot ("left", "zone:abc", ...) of a monitor ("current", "main" or an id).
    public static KeyResult Snap(IntPtr hwnd, string monWant, string spot, JsonNode? cfg, string label)
    {
        var mon = PickMonitor(monWant, hwnd);
        var zones = ZonesFor(cfg, mon.Id);
        var f = SnapSpots.Find(spot, zones);
        if (f == null) return Fail(label, "That spot doesn't exist on " + mon.Name, "no spot");
        var err = MoveTo(hwnd, SnapSpots.Place(mon.Work, f.Value), spot == "max");
        if (err != null) return Fail(label, err, err == AdminMessage ? "admin" : "error");
        return new KeyResult(true, $"{SnapSpots.Name(spot, zones)} on {mon.Name}");
    }

    static KeyResult Fail(string label, string text, string badge) =>
        new(false, text, Toast: "⚠ " + (label.Length > 0 ? label + " · " : "") + text, Badge: badge);

    /// A Snap window key or step: the active window, or an app's window (opened first if it isn't running).
    public static async Task<KeyResult> RunSnap(JsonNode a, JsonNode? cfg)
    {
        var label = Json.S(a, "label");
        IntPtr hwnd;
        if (Json.S(a, "target", "active") == "app")
        {
            var exe = Paths.Expand(Json.S(a, "exe"));
            if (exe.Length == 0) return Fail(label, "No app picked", "no app");
            hwnd = FindAppWindow(exe);
            if (hwnd == IntPtr.Zero)
            {
                if (!File.Exists(exe)) return Fail(label, "Not found: " + exe, "not found");
                Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(exe) ?? "" });
                for (int i = 0; i < 60 && hwnd == IntPtr.Zero; i++) { await Task.Delay(250); hwnd = FindAppWindow(exe); }
                if (hwnd == IntPtr.Zero) return Fail(label, "The app opened, but no window showed up", "no window");
                await Task.Delay(300); // let it finish sizing itself first
            }
        }
        else
        {
            hwnd = Native.GetForegroundWindow();
            if (hwnd != IntPtr.Zero) hwnd = GetAncestor(hwnd, GA_ROOT);
            if (hwnd == IntPtr.Zero || ShellClasses.Contains(Class(hwnd)) || Native.GetWindowThreadProcessId(hwnd, out var pid) == 0 || pid == Environment.ProcessId)
                return Fail(label, "No window is active", "no window");
        }
        return Snap(hwnd, Json.S(a, "monitor", "current"), Json.S(a, "spot", "left"), cfg, label);
    }

    /// The topmost window of an app, matched by its .exe (or what a shortcut points to).
    static IntPtr FindAppWindow(string exe)
    {
        var name = Path.GetFileNameWithoutExtension(exe);
        var list = AppWindows.Find(name, null);
        if (list.Count > 0) return list[0];
        foreach (var (h, pid) in UserWindows()) if (string.Equals(ExePath(pid), exe, StringComparison.OrdinalIgnoreCase)) return h;
        return IntPtr.Zero;
    }

    /* ---------------- the deck's window picker ---------------- */

    /// What the deck shows: open windows (topmost first) and every monitor with its custom zones. See docs/PROTOCOL.md.
    public static JsonObject PickerMessage(string keyId, JsonNode? cfg)
    {
        bool hideTitles = cfg?["snap"]?["hideTitles"] is JsonValue v && v.TryGetValue<bool>(out var b) && b;
        var wins = new JsonArray();
        foreach (var (h, pid) in UserWindows().Take(40))
        {
            var exe = ExePath(pid); var title = Title(h);
            var app = AppName(exe, pid, title);
            var o = new JsonObject { ["id"] = h.ToInt64().ToString(), ["app"] = app };
            if (!hideTitles && title.Length > 0 && title != app) o["title"] = title;
            if (exe.Length > 0 && !exe.EndsWith("ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase))
                try { var icon = Icons.FromExe(exe); if (icon != null) o["icon"] = icon; } catch { }
            wins.Add(o);
        }
        var mons = new JsonArray();
        foreach (var m in Monitors())
        {
            var zones = new JsonArray();
            foreach (var z in ZonesFor(cfg, m.Id) ?? Enumerable.Empty<JsonNode>())
            {
                var f = SnapSpots.Clamp(new SnapSpots.Frac(Json.D(z, "x"), Json.D(z, "y"), Json.D(z, "w", 1), Json.D(z, "h", 1)));
                zones.Add(new JsonObject { ["id"] = Json.S(z, "id"), ["name"] = Json.S(z, "name", "Zone"), ["x"] = f.X, ["y"] = f.Y, ["w"] = f.W, ["h"] = f.H });
            }
            mons.Add(new JsonObject { ["id"] = m.Id, ["name"] = m.Name, ["x"] = m.Bounds.X, ["y"] = m.Bounds.Y, ["w"] = m.Bounds.W, ["h"] = m.Bounds.H, ["main"] = m.Main, ["zones"] = zones });
        }
        return new JsonObject { ["t"] = "winpick", ["key"] = keyId, ["wins"] = wins, ["mons"] = mons };
    }

    /// The deck picked a window and a spot. Only windows that are still open can be moved.
    public static KeyResult PickerSnap(string win, string mon, string spot, JsonNode? cfg)
    {
        if (!long.TryParse(win, out var raw)) return Fail("", "Unknown window", "error");
        var h = new IntPtr(raw);
        if (!IsWindow(h) || !UserWindows().Any(w => w.hwnd == h)) return Fail("", "That window was closed", "gone");
        Native.GetWindowThreadProcessId(h, out var pid);
        var app = AppName(ExePath(pid), pid, Title(h));
        var r = Snap(h, mon, spot, cfg, app);
        return r.Ok ? r with { Toast = $"✓ {app} · {r.Text}" } : r;
    }

    /* ---------------- saved layouts ---------------- */

    /// Where every open window is right now, for a Window layout key. Minimized windows are skipped.
    public static JsonArray Capture()
    {
        var mons = Monitors();
        var list = new JsonArray();
        foreach (var (h, pid) in UserWindows())
        {
            if (Native.IsIconic(h)) continue;
            var exe = ExePath(pid); if (exe.Length == 0) continue;
            var mi = new MONITORINFOEX { cbSize = Marshal.SizeOf<MONITORINFOEX>() };
            if (!GetMonitorInfo(MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST), ref mi)) continue;
            var mon = mons.FirstOrDefault(m => m.Id == mi.szDevice); if (mon == null) continue;
            if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out var vis, Marshal.SizeOf<Native.RECT>()) != 0) GetWindowRect(h, out vis);
            var f = SnapSpots.ToFrac(mon.Work, Box(vis));
            var title = Title(h);
            list.Add(new JsonObject
            {
                ["exe"] = exe, ["app"] = AppName(exe, pid, title), ["title"] = title, ["monitor"] = mon.Id, ["monName"] = mon.Name,
                ["max"] = IsZoomed(h), ["x"] = Math.Round(f.X, 4), ["y"] = Math.Round(f.Y, 4), ["w"] = Math.Round(f.W, 4), ["h"] = Math.Round(f.H, 4),
            });
        }
        list.Reverse(); // bottom to top, so restoring keeps the same stacking
        return list;
    }

    /// Puts every window in a saved layout back. Apps that aren't running are opened first.
    public static async Task<KeyResult> Restore(JsonNode key)
    {
        var label = Json.S(key, "label", "Layout");
        var entries = Json.Arr(key, "windows").ToList();
        if (entries.Count == 0) return Fail(label, "No windows saved yet. Capture them in the editor.", "empty");
        var used = new HashSet<IntPtr>();
        var found = new IntPtr[entries.Count];

        IntPtr Match(JsonNode e)
        {
            var exe = Json.S(e, "exe"); var title = Json.S(e, "title");
            var cands = UserWindows().Where(w => !used.Contains(w.hwnd) && string.Equals(ExePath(w.pid), exe, StringComparison.OrdinalIgnoreCase)).Select(w => w.hwnd).ToList();
            foreach (var h in cands) if (Title(h) == title) return h;
            return cands.Count > 0 ? cands[0] : IntPtr.Zero;
        }
        for (int i = 0; i < entries.Count; i++) { found[i] = Match(entries[i]); if (found[i] != IntPtr.Zero) used.Add(found[i]); }

        // Open what's missing (each app once), then wait up to 20 s for its windows.
        var launched = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < entries.Count; i++)
        {
            if (found[i] != IntPtr.Zero) continue;
            var exe = Json.S(entries[i], "exe");
            if (exe.EndsWith("ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase) || !File.Exists(exe) || !launched.Add(exe)) continue;
            try { Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(exe) ?? "" }); } catch (Exception ex) { Log.Write("layout open: " + ex.Message); }
        }
        if (launched.Count > 0)
            for (int t = 0; t < 80 && found.Any(f => f == IntPtr.Zero); t++)
            {
                await Task.Delay(250);
                for (int i = 0; i < entries.Count; i++)
                    if (found[i] == IntPtr.Zero && launched.Contains(Json.S(entries[i], "exe"))) { found[i] = Match(entries[i]); if (found[i] != IntPtr.Zero) used.Add(found[i]); }
            }
        if (launched.Count > 0) await Task.Delay(400);

        int moved = 0, admin = 0, missing = 0;
        var mons = Monitors(); var main = mons.FirstOrDefault(m => m.Main) ?? mons[0];
        for (int i = 0; i < entries.Count; i++)
        {
            var e = entries[i]; var h = found[i];
            if (h == IntPtr.Zero) { missing++; continue; }
            var mon = mons.FirstOrDefault(m => m.Id == Json.S(e, "monitor")) ?? main;
            bool max = e["max"] is JsonValue mv && mv.TryGetValue<bool>(out var mb) && mb;
            var f = SnapSpots.Clamp(new SnapSpots.Frac(Json.D(e, "x"), Json.D(e, "y"), Json.D(e, "w", 1), Json.D(e, "h", 1)));
            var err = MoveTo(h, SnapSpots.Place(mon.Work, f), max);
            if (err == null) moved++; else if (err == AdminMessage) admin++; else missing++;
        }
        var text = $"Placed {moved} of {entries.Count} windows" + (admin > 0 ? $" · {admin} need admin" : "") + (missing > 0 ? $" · {missing} not found" : "");
        bool ok = moved > 0 && admin == 0;
        return new KeyResult(ok, text, Toast: (ok ? "✓ " : "⚠ ") + label + " · " + text, Badge: ok ? null : admin > 0 ? "admin" : "missing", Ring: ok);
    }

    /* ---------------- terminals ---------------- */

    static readonly HashSet<string> TermClasses = new(StringComparer.Ordinal) { "CASCADIA_HOSTING_WINDOW_CLASS", "ConsoleWindowClass", "mintty", "VirtualConsoleClass" };
    static readonly HashSet<string> TermExes = new(StringComparer.OrdinalIgnoreCase) { "WindowsTerminal", "alacritty", "wezterm-gui", "Hyper", "Tabby", "mintty", "ConEmu64", "ConEmu" };

    /// Open terminal windows, most recently used first.
    public static List<(IntPtr hwnd, string title)> Terminals() =>
        UserWindows().Where(w => TermClasses.Contains(Class(w.hwnd)) || TermExes.Contains(Path.GetFileNameWithoutExtension(ExePath(w.pid))))
            .Select(w => (w.hwnd, Title(w.hwnd))).ToList();

    /// A Send to terminal key: types its text into a terminal. No Enter is added; a line break in the text is typed as Enter.
    public static async Task<KeyResult> SendToTerminal(JsonNode a)
    {
        var label = Json.S(a, "label");
        var text = Json.S(a, "text");
        if (text.Length == 0) return Fail(label, "No text to send", "no text");
        var terms = Terminals();
        if (Json.S(a, "target", "recent") == "title")
        {
            var want = Json.S(a, "title").Trim();
            if (want.Length == 0) return Fail(label, "No window title set", "no title");
            terms = terms.Where(t => t.title.Contains(want, StringComparison.OrdinalIgnoreCase)).ToList();
            if (terms.Count == 0) return Fail(label, $"No terminal title has \"{want}\"", "no terminal");
        }
        if (terms.Count == 0) return Fail(label, "No terminal is open", "no terminal");
        var h = terms[0].hwnd;
        if (Blocked(h)) return Fail(label, AdminMessage, "admin");
        Native.ForceForeground(h);
        for (int i = 0; i < 10 && GetAncestor(Native.GetForegroundWindow(), GA_ROOT) != h; i++) await Task.Delay(40);
        if (GetAncestor(Native.GetForegroundWindow(), GA_ROOT) != h) return Fail(label, "Couldn't bring the terminal to the front", "focus");
        await Task.Delay(60);
        Input.Type(text);
        return new KeyResult(true, "Sent to " + (terms[0].title.Length > 0 ? terms[0].title : "the terminal"));
    }
}
