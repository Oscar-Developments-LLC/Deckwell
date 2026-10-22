# Getting started

This takes about 10 minutes. You need:

- A Windows 10 or 11 PC
- A tablet or phone to use as the deck: Android 4.4 or newer (including Kindle Fire tablets)
- Both on the same Wi-Fi, or a USB cable for Android

## 1. Install the desktop app

1. Download `Deckwell-windows-x64.zip` from the [Releases](https://github.com/Oscar-Developments-LLC/Deckwell/releases) page and unzip it anywhere, like `C:\Deckwell`.
2. Keep the `adb` folder next to `Deckwell.exe`. Deckwell uses it to talk to Android decks over USB.
3. Double-click `Deckwell.exe`.
   - If Windows says **"Windows protected your PC"**, click **More info**, then **Run anyway**. This shows up because the app isn't code-signed yet.
   - If Windows Firewall asks, allow Deckwell on **Private networks**. That's how it finds your deck on Wi-Fi.
4. The first time it opens, a short intro explains the basics. You can open it again anytime with **Help** at the top.

Deckwell needs the Microsoft Edge WebView2 Runtime. Windows 11 and most Windows 10 PCs already have it. If not, Deckwell tells you and links to the download.

## 2. Install the deck app

Pick the right file from the Releases page:

| Your device | Install this |
|---|---|
| Android 8.0 or newer (most phones and tablets from 2017 on) | `Deckwell-android.apk` |
| Android 4.4 to 7.x, including Kindle Fire tablets | `Deckwell-android-legacy.apk` |

**To install it:**

- **On the device itself:** download the APK in its browser and open it. Android asks you to allow installs from that app. Say yes.
- **Kindle Fire:** go to **Settings > Security** and turn on **Apps from Unknown Sources** first.
- **From your PC over USB** (USB debugging on):
  ```
  adb install -r Deckwell-android.apk
  ```

Open Deckwell on the deck. It shows **"Can't reach desktop"** until the two apps find each other. That's normal.

## 3. Pair them

Within a few seconds, the deck shows a **6-digit code** and the desktop's device card (top left) says **Not paired**.

1. In the device card, type a **name** for the deck, like "Desk tablet".
2. Type the **code** shown on the deck and click **Pair**.
3. On the deck, tap **Pair**.

That's it. From now on, they reconnect by themselves whenever both apps are open. Pairing makes sure that only your deck can press your keys. See [Pairing and security](pairing-and-security.md).

**If they don't find each other,** see [Troubleshooting](troubleshooting.md#the-deck-and-desktop-cant-find-each-other).

## 4. Make your first key

1. At the bottom of the editor there's a bar of **actions**. Drag **Media key** onto an empty key.
2. On the right, pick **Play / Pause**.
3. Tap that key on your deck. Your music should play or pause.

Changes save and appear on the deck right away. There's no Save button.

## Next steps

- Learn every key type in [Keys](keys.md).
- Add more pages, folders and volume sliders: [Pages, folders and sliders](pages-and-sliders.md).
- Show live values like CPU use or server status: [Status tiles](status-tiles.md).
- Automate things with scripts: [Scripting basics](scripting/README.md).
