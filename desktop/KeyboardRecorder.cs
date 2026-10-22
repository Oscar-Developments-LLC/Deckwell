using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Deckwell;

/// Low-level keyboard hook used only while the editor records a shortcut.
/// It swallows keys so combos like Win+Shift+S get recorded instead of firing.
sealed class KeyboardRecorder : IDisposable
{
    delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc fn, IntPtr hMod, uint threadId);
    [DllImport("user32.dll", SetLastError = true)] static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string? name);
    [StructLayout(LayoutKind.Sequential)] struct KBDLLHOOKSTRUCT { public uint vkCode, scanCode, flags, time; public IntPtr extra; }

    const int WH_KEYBOARD_LL = 13, WM_KEYDOWN = 0x100, WM_KEYUP = 0x101, WM_SYSKEYDOWN = 0x104, WM_SYSKEYUP = 0x105;
    readonly LowLevelKeyboardProc _proc;
    IntPtr _hook;
    readonly Action<string, int, bool> _onKey;
    readonly HashSet<int> _down = new();
    System.Windows.Forms.Timer? _safety;

    public KeyboardRecorder(Action<string, int, bool> onKey) { _onKey = onKey; _proc = Hook; }

    public void Start()
    {
        Stop();
        _down.Clear();
        using var mod = Process.GetCurrentProcess().MainModule!;
        _hook = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(mod.ModuleName), 0);
        _safety = new System.Windows.Forms.Timer { Interval = 30000 };
        _safety.Tick += (_, _) => Stop();
        _safety.Start();
    }

    public void Stop()
    {
        if (_hook != IntPtr.Zero) { UnhookWindowsHookEx(_hook); _hook = IntPtr.Zero; }
        _safety?.Stop(); _safety?.Dispose(); _safety = null;
    }

    IntPtr Hook(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && _hook != IntPtr.Zero)
        {
            var k = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
            int msg = (int)wParam;
            bool down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
            bool up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
            int vk = (int)k.vkCode;
            if (down && _down.Contains(vk)) return (IntPtr)1; // ignore auto-repeat
            if (down) _down.Add(vk); else if (up) _down.Remove(vk);
            if (down || up) _onKey(Name(vk), Normalize(vk), down);
            return (IntPtr)1;
        }
        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    static int Normalize(int vk) => vk switch { 0xA0 or 0xA1 => 0x10, 0xA2 or 0xA3 => 0x11, 0xA4 or 0xA5 => 0x12, 0x5C => 0x5B, _ => vk };

    public static string Name(int vk)
    {
        vk = Normalize(vk);
        if (vk >= 0x41 && vk <= 0x5A) return ((char)vk).ToString();
        if (vk >= 0x30 && vk <= 0x39) return ((char)vk).ToString();
        if (vk >= 0x70 && vk <= 0x87) return "F" + (vk - 0x6F);
        if (vk >= 0x60 && vk <= 0x69) return "Num " + (vk - 0x60);
        return vk switch
        {
            0x10 => "Shift", 0x11 => "Ctrl", 0x12 => "Alt", 0x5B => "Win", 0x20 => "Space", 0x0D => "Enter", 0x09 => "Tab", 0x08 => "Bksp",
            0x2E => "Del", 0x2D => "Ins", 0x24 => "Home", 0x23 => "End", 0x21 => "PgUp", 0x22 => "PgDn", 0x25 => "←", 0x26 => "↑", 0x27 => "→", 0x28 => "↓",
            0x1B => "Esc", 0x2C => "PrtSc", 0x13 => "Pause", 0x14 => "Caps", 0x5D => "Menu", 0xBD => "-", 0xBB => "=", 0xDB => "[", 0xDD => "]", 0xDC => "\\",
            0xBA => ";", 0xDE => "'", 0xBC => ",", 0xBE => ".", 0xBF => "/", 0xC0 => "`", 0x6B => "Num +", 0x6D => "Num -", 0x6A => "Num *", 0x6F => "Num /", 0x6E => "Num .",
            0xB3 => "Play", 0xB0 => "Next", 0xB1 => "Prev", 0xB2 => "Stop", 0xAD => "Mute", 0xAE => "Vol -", 0xAF => "Vol +",
            _ => "0x" + vk.ToString("X2"),
        };
    }

    public void Dispose() => Stop();
}
