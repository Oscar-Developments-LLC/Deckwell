using System.Runtime.InteropServices;

namespace Deckwell;

/// Synthesizes keyboard input with SendInput (hotkeys, media keys).
static class Input
{
    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public InputUnion U; }
    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }

    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);

    const uint INPUT_KEYBOARD = 1, KEYEVENTF_EXTENDEDKEY = 0x1, KEYEVENTF_KEYUP = 0x2;
    static readonly HashSet<ushort> Extended = new() { 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B, 0x5C, 0x5D, 0x6F, 0x90, 0x2C,
        0xA3, 0xA5, 0xAD, 0xAE, 0xAF, 0xB0, 0xB1, 0xB2, 0xB3 };

    static INPUT Key(ushort vk, bool up)
    {
        uint flags = up ? KEYEVENTF_KEYUP : 0;
        if (Extended.Contains(vk)) flags |= KEYEVENTF_EXTENDEDKEY;
        return new INPUT { type = INPUT_KEYBOARD, U = new InputUnion { ki = new KEYBDINPUT { wVk = vk, wScan = (ushort)MapVirtualKey(vk, 0), dwFlags = flags } } };
    }

    public static void Down(IEnumerable<ushort> vks) { var a = vks.Select(v => Key(v, false)).ToArray(); if (a.Length > 0) SendInput((uint)a.Length, a, Marshal.SizeOf<INPUT>()); }
    public static void Up(IEnumerable<ushort> vks) { var a = vks.Reverse().Select(v => Key(v, true)).ToArray(); if (a.Length > 0) SendInput((uint)a.Length, a, Marshal.SizeOf<INPUT>()); }

    public static void Tap(IList<ushort> vks)
    {
        var all = vks.Select(v => Key(v, false)).Concat(vks.Reverse().Select(v => Key(v, true))).ToArray();
        if (all.Length > 0) SendInput((uint)all.Length, all, Marshal.SizeOf<INPUT>());
    }

    public static void TapAlt() => Tap(new ushort[] { 0x12 });

    public const ushort VK_MEDIA_NEXT = 0xB0, VK_MEDIA_PREV = 0xB1, VK_MEDIA_STOP = 0xB2, VK_MEDIA_PLAY_PAUSE = 0xB3,
        VK_VOLUME_MUTE = 0xAD, VK_VOLUME_DOWN = 0xAE, VK_VOLUME_UP = 0xAF;
}
