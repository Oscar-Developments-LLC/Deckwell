# How Deckwell works

Deckwell is two apps working together.

```
   Your PC                                        Your tablet or phone
 ┌──────────────────────────────┐               ┌───────────────────────┐
 │ Deckwell desktop             │   Wi-Fi or    │ Deckwell deck app     │
 │  • editor (where you build)  │◄─────────────►│  • shows your keys    │
 │  • engine (does the work)    │      USB      │  • sends your taps    │
 └──────────────────────────────┘               └───────────────────────┘
```

## Who does what

**The desktop app does all the work.**

- You build and edit everything in its editor.
- When you tap a key, the desktop runs the action: opening an app, sending a shortcut, running a script, or connecting to a server.
- It owns your settings, icons and scripts.

**The deck is just a screen with buttons.**

- It shows the layout the desktop sends it.
- It tells the desktop which key you tapped and where you dragged a slider.
- It never runs commands itself and doesn't store your settings (only a copy of the layout, so it can show it right away when it starts).

This is why you only ever edit on the desktop, and why the deck can be an old, slow device.

## How they find each other

| Step | What happens |
|---|---|
| 1 | Every 2 seconds, the deck announces itself on your Wi-Fi (a broadcast on UDP port **8766**). |
| 2 | The desktop hears it and connects to the deck on TCP port **8765**. |
| 3 | They check each other's pairing key. If they aren't paired yet, the deck shows a code. |
| 4 | The desktop sends the layout. From then on, every message both ways is signed. |

**Over USB** (Android only), the desktop uses `adb forward` to reach the deck through the cable. This works even with no Wi-Fi at all.

**Link mode** is in the device card (click it):

- **Auto** tries Wi-Fi first and falls back to USB. If you're on USB and the deck shows up on Wi-Fi, it moves to Wi-Fi.
- **Wi-Fi only** or **USB only** forces one.
- **Deck IP** lets you type the deck's address if your router blocks the broadcast. The deck shows its IP on its "Can't reach desktop" screen.

## Where your files are

Everything lives in `%APPDATA%\Deckwell` (paste that into File Explorer's address bar).

| File | What it is |
|---|---|
| `config.json` | Your pages, keys, sliders and hosts |
| `icons\` | Icons you uploaded or pulled from apps |
| `pairing.json` | This PC's ID and the keys for decks you've paired. **Keep it private.** |
| `push-token.txt` | The secret your scripts use to push status values. **Keep it private.** |
| `deckwell.log` | What Deckwell has been doing. Useful when something goes wrong. |

To back up your setup, copy `config.json` and the `icons` folder.

## Ports Deckwell uses

| Port | Where | What for |
|---|---|---|
| 8765 (TCP) | On the deck | The desktop connects here |
| 8766 (UDP) | On your network | The deck's "I'm here" broadcast |
| 18765 (TCP) | Your PC only | The USB link through `adb forward` |
| 8770 (TCP) | Your PC only | Status tile push endpoint, for your own scripts |

8770 and 18765 only accept connections from your own PC, not from your network.
