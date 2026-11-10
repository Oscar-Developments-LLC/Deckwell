# Keys

Every key on your deck does one thing when you tap it, and can do more with **extra steps**.

**To add a key,** drag an action from the bar at the bottom of the editor onto an empty key.
**To edit a key,** click it. Its settings open in the panel on the right.
**To move a key,** drag it to another spot. Drop it on a page in the sidebar to move it to that page.

## Key types

### Launch app

Opens a program.

- **Executable:** the program's `.exe` or a shortcut (`.lnk`). Click the folder button to browse. Paths can use `%LOCALAPPDATA%`, `%APPDATA%` and `~`.
- **Arguments:** extra options for the program, if it needs any.
- **If already running:**

| Option | What it does when the app is already open |
|---|---|
| Focus | Brings its window to the front |
| New | Opens another copy |
| Minimize | Minimizes it (opens it if it isn't running) |
| Toggle | Brings it to the front; press again while it's in front to minimize it |

**Tip:** Click **From .exe** next to the icon to use the program's own icon.

### Hotkey

Sends a keyboard shortcut, like `Ctrl+Shift+M`.

- Click the **Shortcut** box and press the keys. Press **Esc** to stop recording.
- **Send as:**
  - **Press:** taps the shortcut once.
  - **Hold while touched:** holds the keys down as long as your finger is on the key. Good for push-to-talk.

The shortcut goes to whichever window is in front on your PC.

### Media key

Controls whatever is playing on your PC: **Play/Pause, Next, Previous, Stop, Volume up, Volume down, Mute**, and **Mic** (mutes your default microphone).

### Open URL

Opens a web page in your default browser. Any link works, including local ones like `http://192.168.1.10:9000`.

### Script

Runs a **PowerShell** (`.ps1`) or **Python** (`.py`) file.

- **Window:**
  - **Hidden:** runs in the background. The last line it prints shows on the deck, and in **Last run** in the editor.
  - **Visible:** opens a console window you can watch. Output isn't captured.
  - **Admin:** runs as administrator. Windows asks for permission each time. Output isn't captured.
- An **exit code of 0** means success: the key flashes a ring. Anything else shows a red badge with the exit code.
- Scripts run from their own folder, so they can open files next to them.

See [Scripting basics](scripting/README.md) and the [PowerShell examples](scripting/windows-powershell.md).

### SSH command

Runs a command on a server or other computer over SSH.

- **Host:** pick a saved host, or click **+** to add one (name, address, user, port). Double-click a host to edit it.
- **Command:** what to run, like `docker restart nginx`.
- **Auth:** the private key file to sign in with. The default is `~/.ssh/id_ed25519`. The key must **not** have a passphrase.
- **Timeout:** how long to wait before giving up.
- **On the key after firing:** flash a **Ring**, show the **Last line** of output, or do **Nothing**.

**It runs on tap with no "are you sure?".** See [Homelab over SSH](scripting/homelab-ssh.md) for setting up keys.

### Status tile

Shows a live value, like CPU use, a temperature, or whether a server is up. Tapping it can open a link. See [Status tiles](status-tiles.md).

### Panel

A bigger tile (2 x 1 up to 4 x 3 keys) that shows all of a command's output, not just one value. Good for a server's temperatures or its top processes. Swipe up and down on it to scroll. See [Status tiles and panels](status-tiles.md#panels).

### Open terminal

Opens a terminal: a **Windows Terminal** profile, **PowerShell**, **PowerShell 7**, **cmd**, **WSL**, or **SSH** to one of your hosts. You can pick a new window or a new tab, a start folder, a command to run when it opens, and whether it runs as admin. See [Windows and terminals](windows-and-terminals.md#open-terminal).

### Send to terminal

Types text into a terminal that's already open: the one you used last, or one whose title has a word you pick. It types exactly what you wrote and doesn't press Enter for you. See [Windows and terminals](windows-and-terminals.md#send-to-terminal).

### Snap window

Moves the active window (or an app's window) to a spot on a monitor: halves, thirds, quarters, maximize, center, or a zone you drew. See [Windows and terminals](windows-and-terminals.md#snap-window).

### Window picker

Opens a menu on the deck. Pick any open window, then a monitor and a spot. See [Windows and terminals](windows-and-terminals.md#window-picker).

### Window layout

Puts a whole set of windows back where you saved them, and opens any app that isn't running. See [Windows and terminals](windows-and-terminals.md#window-layouts).

### Now Playing

Shows the song or video playing on your PC: title, artist, app, progress and album art. It takes two keys side by side. Tap it to play or pause.

### Folder

Opens a page inside this one. The folder page gets a **Back** key, top-left to start. Drag it to any other spot on that page if you like. Double-click a folder key in the editor to open it.

### Go to page

Jumps the deck to any other page.

**Snap window**, **Open terminal** and **Send to terminal** can also be steps in **Also do**, so one press can open an app and then snap it into place.

## Labels and icons

- **Label:** the text on the key. **Label position** puts it at the bottom, the top, or hides it.
- **Icon:**
  - **Glyph:** click the icon box to pick from the built-in icon set.
  - **Upload image:** use your own image (PNG, JPG, GIF, BMP or ICO).
  - **From .exe:** use a program's own icon (Launch app keys).
  - **Use glyph** switches an uploaded image back to a built-in icon.

## Keys that do more than one thing

Most keys have an **Also do** section. Add **steps** and they run top to bottom after the key's own action:

| Step | What it does |
|---|---|
| Open app | Opens or focuses a program |
| Hotkey | Sends a shortcut |
| Media key | Play/pause, next, volume, ... |
| Open URL | Opens a link |
| Run script | Runs a PowerShell or Python file |
| SSH command | Runs a command on a host |
| Wait | Pauses before the next step (up to 30 seconds) |

If a step fails, the rest are skipped and the key shows which step failed.

**Then show page** switches the deck to another page after the press. Click **New page** to make a page just for that key, with a Back key to return.

**Example: a "Streaming" key**

1. Key type: **Launch app**, OBS.
2. Add step **Wait**, 3 seconds (gives OBS time to open).
3. Add step **Run script**, `obs_switch_scene.py`.
4. **Then show page:** a "Streaming" page with your scene and mic keys.

## Handy editor shortcuts

| Keys | What it does |
|---|---|
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Delete | Clears the selected key |
| Esc | Deselects, or stops recording a shortcut |
| Test button | Runs the selected key from the editor, without the deck |
