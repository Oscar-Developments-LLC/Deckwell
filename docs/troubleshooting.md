# Troubleshooting

**First stop:** click the **device card** (top left of the editor). The **Status** box shows what Deckwell sees: the Wi-Fi broadcast, the USB state, and the last connection error.

**Second stop:** the log at `%APPDATA%\Deckwell\deckwell.log`.

## The deck and desktop can't find each other

**On Wi-Fi:**

1. **Same network?** The PC and deck must be on the same Wi-Fi network. A guest network usually blocks devices from seeing each other.
2. **Windows Firewall.** Deckwell needs to be allowed on **Private** networks. If you clicked Cancel when Windows asked:
   - Open **Windows Security > Firewall & network protection > Allow an app through firewall**.
   - Click **Change settings** and find Deckwell. Tick **Private**.
3. **Is your network set to Public?** Windows blocks more on Public networks. Open **Settings > Network & internet > Wi-Fi > (your network)** and choose **Private network**.
4. **Router blocks broadcasts** ("client isolation" or "AP isolation"): type the deck's IP into **Deck IP** in the device card. The deck shows its IP at the bottom of its "Can't reach desktop" screen.

**On USB (Android):**

1. Turn on **USB debugging** on the device:
   - Open **Settings > About**, then tap **Build number** 7 times. Kindle Fire: tap **Serial number** instead.
   - Then go to **Developer options** and turn on **USB debugging**. Kindle Fire: **Enable ADB**.
2. Plug in and tap **Allow** on the "Allow USB debugging?" popup. The device card says `unauthorized` until you do.
3. Kindle Fire on Windows may need Amazon's **Kindle Fire ADB driver**.
4. Keep the `adb` folder next to `Deckwell.exe`.

## Using the Android Studio emulator as a deck

The emulator runs behind its own private network, so the desktop can't find it over Wi-Fi.

1. Set **Connection** in the device card to **USB only**. Deckwell reaches the emulator through adb.
2. **Rename the `adb` folder** next to `Deckwell.exe` (to `adb-off`, for example). Deckwell then uses Android Studio's own adb. Two different adb versions running at once keep restarting each other.

## Pairing problems

| What you see | What to do |
|---|---|
| "That code doesn't match the deck" | Check the code on the deck and type it again. After 3 wrong tries, click **Pair this deck** to start over. |
| "Give the deck a name first" | Type a name above the code. |
| The desktop says "Code matches" but nothing happens | Tap **Pair** on the deck. Both sides have to agree. |
| "The deck is pairing with another computer" | Another PC started pairing first. Cancel it on the deck, then click **Pair this deck**. |
| "Update deck app" | The app on the deck is too old to pair. Install the latest APK. |
| A deck that used to work says "Not paired" | The deck was reset, reinstalled, or paired with another PC. Pair it again. |

## A key doesn't work

**Launch app**

- "Not found": the path is wrong. Click the folder button and pick the `.exe` again.
- It focuses the wrong window, or opens a second copy: check **If already running**.

**Hotkey:** the shortcut goes to whatever window is in front. Some games and apps running as administrator ignore shortcuts from normal apps. Run Deckwell as administrator if you need those.

**Script**

- Look at **Last run** in the key's settings. It shows the exit code and the last line printed.
- A **Python** script needs Python installed and on your PATH. Deckwell looks for `py.exe`, then `python.exe`, and skips the Microsoft Store shortcut.
- Scripts that need administrator rights: set **Window** to **Admin**.
- Test it by hand first: `powershell -ExecutionPolicy Bypass -File "C:\path\script.ps1"`.

**SSH:** see [Homelab over SSH](scripting/homelab-ssh.md#when-it-doesnt-work).

## Sliders

- **A slider is greyed out:** it controls an app that isn't playing sound right now. It wakes up when the app makes a sound.
- **The app isn't in the list:** the list only shows apps making sound right now. Start some audio in the app, then pick it.

## Status tiles

See [Status tiles](status-tiles.md#when-a-tile-looks-wrong).

**"Port 8770 is busy"** in a push tile's settings means another program is using that port, so push tiles won't work until it's free. Command, SSH and This PC tiles still work.

## Start fresh

Close Deckwell, then in `%APPDATA%\Deckwell`:

- Delete **`pairing.json`** to forget all paired decks.
- Rename **`config.json`** to start with an empty layout. Keep the old file as a backup.

Deckwell keeps automatic backups next to `config.json` if it ever finds the file damaged.
