# Deckwell

Turn an old tablet or phone into a Stream Deck style control pad for your PC.

Deckwell has two parts:

- **Desktop app** (Windows today, Mac and Linux planned). You build your deck here and it runs the actions.
- **Deck app** (Android today, iPad/iOS planned). It shows the buttons and sends your taps to the desktop.

They talk over your local Wi-Fi, with a USB fallback for Android.

## Features

- Pages and folders, with a grid size you can set per page
- App keys: launch, focus, or toggle (press again to minimize)
- Hotkeys, media keys, and a live Now Playing tile with album art
- 1 to 6 volume sliders per page, on the left or right: master, per-app, and microphone
- SSH command keys for homelab servers, plus PowerShell and Python scripts and URLs
- Live status tiles: this PC's CPU and RAM, any command, any server over SSH, or values your own scripts push
- Custom icons, or icons pulled from the app automatically
- Everything is edited on the desktop; the deck just shows it
- Paired and signed: only your deck can press your keys

## Downloads

Get the latest build from the [Releases](../../releases) page.

| File | What it is |
|---|---|
| `Deckwell-windows-x64.zip` | Desktop app for Windows 10/11 (no .NET install needed) |
| `Deckwell-android.apk` | Deck app for Android 8.0 and newer |
| `Deckwell-android-legacy.apk` | Deck app for old devices, Android 4.4 to 7.x (for example Kindle Fire HDX) |

## Setup

1. **Desktop:** unzip `Deckwell-windows-x64.zip` and run `Deckwell.exe`. Keep the `adb` folder next to it.
   Windows Firewall will ask once. Allow it on **Private** networks, since that is how it finds your deck on Wi-Fi.
   Deckwell needs the Microsoft Edge WebView2 Runtime, which comes with Windows 11 and most Windows 10 installs.
2. **Deck:** install the APK that matches your device. Allow installs from unknown sources if asked.
   ```
   adb install -r Deckwell-android.apk
   ```
3. Open Deckwell on the deck. It shows up in the desktop's device card within a few seconds.
4. **Pair them (first time only).** The deck shows a 6-digit code. In the device card on the desktop, name the deck and type the code, then tap **Pair** on the deck. After that they reconnect by themselves.

New to Deckwell? A short intro opens the first time you run it, and the **[guides](docs/README.md)** cover everything else.

## Guides

- [Getting started](docs/getting-started.md)
- [How Deckwell works](docs/how-it-works.md)
- [Keys](docs/keys.md), [Pages, folders and sliders](docs/pages-and-sliders.md), [Status tiles](docs/status-tiles.md)
- Scripting: [basics](docs/scripting/README.md), [Windows PowerShell](docs/scripting/windows-powershell.md), [Homelab over SSH](docs/scripting/homelab-ssh.md), [OBS](docs/scripting/obs.md)
- [Pairing and security](docs/pairing-and-security.md), [Troubleshooting](docs/troubleshooting.md)

### How it connects

- **Wi-Fi first.** The deck broadcasts on UDP 8766 and the desktop connects to it on TCP 8765.
- **USB fallback (Android).** Plug in with USB debugging on. The desktop runs `adb forward` for you.
- If your router blocks discovery, click the device card and type the deck's IP. The deck shows its IP on its "Can't reach desktop" screen.

### SSH keys

SSH keys use your private key file (default `~/.ssh/id_ed25519`, no passphrase).
The matching public key must be in `~/.ssh/authorized_keys` on each host.

### Where your data lives

- Config: `%APPDATA%\Deckwell\config.json` (icons in `%APPDATA%\Deckwell\icons`)
- Log: `%APPDATA%\Deckwell\deckwell.log`

## Building from source

**Desktop** (Windows, .NET 8 SDK):
```
cd desktop
dotnet publish -c Release
```
Or open `desktop/Deckwell.csproj` in Visual Studio.

**Android** (JDK 17+, Android SDK 35), or open the `android` folder in Android Studio:
```
cd android
gradlew assembleCurrentDebug     # Android 8.0+
gradlew assembleLegacyDebug      # Android 4.4 to 7.x
```

## Repo layout

```
desktop/   Windows app (WinForms + WebView2 host, HTML/JS editor in desktop/ui)
android/   Deck app, one codebase with two build flavors: current and legacy
shared/    Glyph set, a sample layout, and the pairing test vector
docs/      User guides, example scripts (docs/examples), and PROTOCOL.md for porting to new platforms
tests/     Desktop tests (run with `dotnet test tests/desktop`)
```

## Roadmap

- [x] Windows desktop
- [x] Android deck (legacy and current)
- [ ] Mac and Linux desktop
- [ ] iPad / iOS deck (build with Xcode)
- [ ] Google Play listing

## Security notice

Please read this before you use Deckwell.

- **SSH and script keys run with no confirmation.** One tap on the deck runs the command. Only add commands you would be fine running by accident.
- **Your desktop only listens to a deck you paired.** Pairing uses a key exchange plus a 6-digit code you confirm on both devices, and every message after that is signed. A stranger on your Wi-Fi can't press your keys or change your deck. Details are in [docs/PROTOCOL.md](docs/PROTOCOL.md).
- **Messages are signed, not encrypted.** Someone on the same network could still read your layout (key labels and page names). They can't change it.
- **Anyone holding your unlocked deck can press its keys.** Treat it like your keyboard.
- **Your SSH private key is read from disk** by the desktop app. Use a key made just for Deckwell if you can.
- This is a small open-source project. It has not had a professional security audit.

The software is provided as is, with no warranty. See [LICENSE](LICENSE).

## License

MIT © 2026 Oscar Developments LLC
