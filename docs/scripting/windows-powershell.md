# Windows automation with PowerShell

These scripts run on your PC when you tap a key.

**To use one:**

1. Save the script somewhere permanent, like `C:\Scripts`.
2. Drag **PowerShell** from the action bar onto a key.
3. Set **Script file** to the `.ps1` file and **Window** to **Hidden**.
4. Tap the key. The last line the script prints shows on the deck.

To try a script by hand first, open PowerShell and run:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Scripts\switch-audio-output.ps1"
```

## Switch between headphones and speakers

**File:** [`switch-audio-output.ps1`](../examples/powershell/switch-audio-output.ps1)

One tap swaps Windows' sound output between two devices. The deck shows which one is now playing.

**Setup, once:**

1. Install the free AudioDeviceCmdlets module. Open PowerShell and run:
   ```powershell
   Install-Module AudioDeviceCmdlets -Scope CurrentUser
   ```
   Answer **Y** if it asks about installing from PSGallery.
2. List your devices:
   ```powershell
   Get-AudioDevice -List | Where-Object Type -eq 'Playback' | Select-Object Index, Name
   ```
3. Open the script and change `$First` and `$Second` at the top to part of each device's name, like `'Headphones'` and `'Realtek'`.

## Open your whole workspace

**File:** [`open-workspace.ps1`](../examples/powershell/open-workspace.ps1)

Opens a list of apps in one tap and skips any that are already open. Edit the `$apps` list at the top. Apps that need arguments work too:

```powershell
"$env:LOCALAPPDATA\Discord\Update.exe --processStart Discord.exe"
```

**No-script version:** a **Launch app** key with extra **Open app** steps does the same thing. See [Keys](../keys.md#keys-that-do-more-than-one-thing).

## Toggle dark mode

**File:** [`toggle-dark-mode.ps1`](../examples/powershell/toggle-dark-mode.ps1)

Flips Windows apps and the taskbar between light and dark. Some open apps only switch after you restart them.

## Small one-liners

Save each one as its own `.ps1` file.

**Lock the PC**

```powershell
rundll32.exe user32.dll,LockWorkStation
```

**Put the PC to sleep** (only if hibernation is off; with it on, this hibernates instead)

```powershell
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false) | Out-Null
```

**Turn off the screens**

```powershell
Add-Type -Namespace Win -Name Power -MemberDefinition '[DllImport("user32.dll")] public static extern int SendMessage(int hWnd, int msg, int wParam, int lParam);'
[Win.Power]::SendMessage(0xFFFF, 0x0112, 0xF170, 2) | Out-Null
```

**Empty the Recycle Bin**

```powershell
Clear-RecycleBin -Force -ErrorAction SilentlyContinue
Write-Output 'Recycle Bin emptied'
```

**Restart a stuck program**

```powershell
Stop-Process -Name 'Spotify' -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-Process "$env:APPDATA\Spotify\Spotify.exe"
Write-Output 'Spotify restarted'
```

**Copy text to the clipboard** (handy for snippets you paste a lot)

```powershell
Set-Clipboard -Value 'Thanks for watching! Follow for more.'
Write-Output 'Copied'
```

## Status tiles from PowerShell

These print a line in the [status tile format](../status-tiles.md#the-output-format). Use them on a **Status tile** with **Data source: Command**:

- [`status-disk.ps1`](../examples/powershell/status-disk.ps1): how full drive C: is
- [`status-gpu.ps1`](../examples/powershell/status-gpu.ps1): NVIDIA GPU temperature and load
- [`push-website-check.ps1`](../examples/powershell/push-website-check.ps1): keeps a **Push** tile updated with whether a website is up

## Tips

- **Text with symbols** like `°` or `é`: save the `.ps1` file as **UTF-8 with BOM** (in VS Code, click the encoding in the bottom bar). Windows PowerShell 5.1 misreads plain UTF-8. The examples avoid the problem with `[char]0xB0` for `°`.
- **Needs admin?** Set the key's **Window** to **Admin**. Windows asks for permission every time, and the output isn't shown on the deck.
- **It works by hand but not from Deckwell:** check for `Read-Host` or anything else that waits for input, and use full paths instead of relying on the current folder.
