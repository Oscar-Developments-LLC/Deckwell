# Windows and terminals

Deckwell 1.1 adds keys that move windows around and keys that work with terminals.

| Key | What it does |
|---|---|
| [Snap window](#snap-window) | Moves a window to a spot on a monitor |
| [Window picker](#window-picker) | Opens a menu on the deck: pick a window, then where it goes |
| [Window layout](#window-layouts) | Puts a saved set of windows back where they were |
| [Open terminal](#open-terminal) | Opens Windows Terminal, PowerShell, cmd, WSL or SSH |
| [Send to terminal](#send-to-terminal) | Types text into a terminal that's already open |

All of them are in the action bar under **Windows** and **Terminal**.

## Snap window

Moves a window to a **spot** on a **monitor**.

**Window:**

- **Active window:** whatever window you're using on the PC when you tap the key.
- **An app:** that app's window. If the app isn't running, Deckwell opens it first and waits for its window.

**Monitor:**

- **Where the window is now:** stays on the same monitor.
- **Main monitor:** your main display.
- **A specific monitor** (Display 1, Display 2, ...). If that monitor is unplugged, like a laptop off its dock, the main monitor is used instead.

**Spots:**

| Spot | Part of the screen |
|---|---|
| Maximize | The whole screen (the window is maximized) |
| Left half, Right half, Top half, Bottom half | Half the screen |
| Left third, Middle third, Right third | A third of the width |
| Left two-thirds, Right two-thirds | Two thirds of the width |
| Top left, Top right, Bottom left, Bottom right | A quarter |
| Center | 70% wide and 80% tall, in the middle |
| Your zones | Any zone you drew for that monitor (see below) |

Spots use the screen minus the taskbar, and the window's visible edges line up with the spot.

**Snap window can also be a step** in **Also do**. For example: an Open app key that opens your editor, then a Snap window step that puts it on the left two-thirds.

### Custom zones

A zone is a part of a monitor that you draw yourself, like "the left 70% for code".

1. Select a Snap window or Window picker key.
2. Click **Edit zones**.
3. Pick the monitor at the top, if you have more than one.
4. **Drag** on the picture of the screen to draw a zone.
5. Type a name for it. Click a zone later to rename or remove it.

Zones belong to a monitor. A Snap window key shows them once you pick **Main monitor** or a specific monitor. The deck's window picker shows each monitor's zones.

## Window picker

A key that opens a menu **on the deck**:

1. Tap the key. The deck lists your open windows, with each app's icon.
2. Tap a window.
3. **Which display?** Tap the monitor you want. The monitors are drawn as they're arranged in Windows. With only one monitor, this screen is skipped.
4. **What size?** Tap **Maximize**, **Half**, **Third**, **Two-thirds**, **Corner** or **Center**. If that monitor has zones, **Your zones** shows up too.
5. **Which one?** Tap the exact spot, like **Right half** or **Top left**. Maximize and Center don't need this screen, so the window moves right away.

The window moves, and the deck goes back to your page. The top right of the menu shows what you've picked so far.

Tap **Back** (bottom left) to go back one screen, or **Cancel** (bottom right) to close the menu.

**Show window titles:** by default the list shows each app's name and its window title. Titles can show private things, like an email subject, and the deck link is signed but not encrypted. To show only app names, pick **App name only** in the key's settings.

## Window layouts

A **Window layout** key remembers where a set of windows goes and puts them all back with one press.

1. Arrange your windows the way you like them.
2. Add a **Window layout** key and click **Capture my windows now**.
3. The key's settings list each saved window. Remove any you don't want with **x**.

Pressing the key:

- Moves each window back to its spot and monitor, and maximizes the ones that were maximized.
- Opens any app that isn't running, then waits up to 20 seconds for its window.
- Skips windows it can't find and tells you on the deck ("Placed 4 of 5 windows · 1 not found").

Notes:

- Minimized windows are skipped when you capture.
- Windows are matched by their app. If an app has several windows, the one with the same title wins.
- Store apps (like Calculator) are moved if they're open, but not opened for you.
- Positions are saved as a share of the screen, so a layout still fits after you change resolution.

## Open terminal

**Program:**

| Program | What opens |
|---|---|
| Windows Terminal | A Windows Terminal profile (pick one, or use the default) |
| PowerShell | Windows PowerShell 5.1 |
| PowerShell 7 | `pwsh` (install PowerShell 7 first) |
| cmd | Command Prompt |
| WSL | Your default WSL Linux |
| SSH | An SSH session to one of your hosts, using the key file you pick |

**Settings:**

- **Open in:** a **New window**, or a **New tab** in the Windows Terminal window you used last.
- **Windows Terminal profile:** the profile's look (and its shell, for the Windows Terminal program). The list comes from your Windows Terminal settings.
- **Start folder:** where it starts (not for SSH).
- **Command when it opens:** runs once it opens, and the terminal stays open afterwards. Not for the plain Windows Terminal program; pick PowerShell, cmd, WSL or SSH to run a command.
- **Run as:** **Normal** or **Admin**. Admin shows the Windows admin prompt on the PC.

Without Windows Terminal installed, the shell opens in its own classic console window, and **New tab** isn't available.

## Send to terminal

Types text into a terminal that's already open, as if you typed it on the keyboard.

- **Text to send:** typed exactly as written. **It doesn't press Enter for you.** If your text has a line break, that line break is typed as Enter.
- **Send to:**
  - **Last used terminal:** the terminal window you used most recently.
  - **Window title has...:** the first terminal whose title has your word, like `Ubuntu` or the name of a server.
- If no terminal is open (or none matches), nothing is typed and the deck shows "No terminal is open".

Deckwell brings the terminal to the front first, then types.

Terminals it knows: Windows Terminal, classic consoles (PowerShell, cmd, WSL), Git Bash (mintty), ConEmu, Alacritty, WezTerm, Hyper and Tabby.

## Admin windows

Windows doesn't let a normal app move, or type into, a window that runs **as admin**. When that happens, the deck shows "That window runs as admin" instead of failing silently.

To control admin windows, run Deckwell as admin too (right-click it and pick **Run as administrator**).
