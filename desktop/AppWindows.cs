using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace Deckwell;

/// Finds an app's top-level windows (by process name or by Store app ID) and focuses / minimizes them.
static class AppWindows
{
    delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern int GetApplicationUserModelId(IntPtr hProcess, ref uint len, StringBuilder? id);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);

    const uint GW_OWNER = 4, GA_ROOTOWNER = 3, PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const int GWL_EXSTYLE = -20, WS_EX_TOOLWINDOW = 0x80, DWMWA_CLOAKED = 14;

    /// Real app windows in z-order (topmost first).
    static List<(IntPtr hwnd, uint pid)> TopLevel()
    {
        var list = new List<(IntPtr, uint)>();
        EnumWindows((h, _) =>
        {
            if (!IsWindowVisible(h) || GetWindow(h, GW_OWNER) != IntPtr.Zero || GetWindowTextLength(h) == 0) return true;
            if ((GetWindowLong(h, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return true;
            if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out var cloaked, 4) == 0 && cloaked != 0 && !Native.IsIconic(h)) return true;
            Native.GetWindowThreadProcessId(h, out var pid);
            list.Add((h, pid));
            return true;
        }, IntPtr.Zero);
        return list;
    }

    static string ProcessName(uint pid) { try { using var p = Process.GetProcessById((int)pid); return p.ProcessName; } catch { return ""; } }

    static string Aumid(uint pid)
    {
        var h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (h == IntPtr.Zero) return "";
        try
        {
            uint len = 0;
            GetApplicationUserModelId(h, ref len, null);
            if (len == 0) return "";
            var sb = new StringBuilder((int)len);
            return GetApplicationUserModelId(h, ref len, sb) == 0 ? sb.ToString() : "";
        }
        finally { CloseHandle(h); }
    }

    /// procName: exe name without extension. aumid: Store app ID (from shell:AppsFolder\<aumid>).
    public static List<IntPtr> Find(string? procName, string? aumid)
    {
        var names = new Dictionary<uint, bool>();
        var result = new List<IntPtr>();
        // A Store app's AUMID looks like "Family_hash!App"; match on the package family part too.
        var family = aumid?.Split('!')[0];
        foreach (var (h, pid) in TopLevel())
        {
            if (!names.TryGetValue(pid, out var ok))
            {
                ok = false;
                if (!string.IsNullOrEmpty(procName)) ok = ProcessName(pid).Equals(procName, StringComparison.OrdinalIgnoreCase);
                if (!ok && !string.IsNullOrEmpty(aumid))
                {
                    var a = Aumid(pid);
                    ok = a.Length > 0 && (a.Equals(aumid, StringComparison.OrdinalIgnoreCase) || a.Split('!')[0].Equals(family, StringComparison.OrdinalIgnoreCase));
                }
                names[pid] = ok;
            }
            if (ok) result.Add(h);
        }
        return result;
    }

    public static bool IsInFront(List<IntPtr> wins)
    {
        var fg = Native.GetForegroundWindow();
        if (fg == IntPtr.Zero) return false;
        var root = GetAncestor(fg, GA_ROOTOWNER);
        return wins.Any(w => (w == fg || w == root) && !Native.IsIconic(w));
    }

    public static void Focus(List<IntPtr> wins) { if (wins.Count > 0) Native.ForceForeground(wins[0]); }
    public static void Minimize(List<IntPtr> wins) { foreach (var w in wins) Native.ShowWindow(w, Native.SW_MINIMIZE); }
}
