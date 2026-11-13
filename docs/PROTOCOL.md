# Deckwell link protocol (v2)

This is the contract between the **desktop** (Windows today; Mac and Linux later) and the **deck** (Android today; iOS later). Every app must follow it exactly, or pairing and signatures will not match.

## Transport

- The deck runs a TCP server on port **8765**. The desktop connects to it.
- Over Wi-Fi the deck announces itself with a UDP broadcast on port **8766** every 2 s:
  `DECKWELL1 8765 <device name>`
- Over USB (Android) the desktop runs `adb forward tcp:18765 tcp:8765` and connects to `127.0.0.1:18765`.
- Messages are UTF-8 JSON objects, one per line (`\n`). Every message has a `"t"` (type) field.

## Encoding rules

- `b64(x)` is standard Base64 **with** padding and **no** line breaks.
- Strings fed to HMAC/SHA-256 are UTF-8 bytes.
- `HMAC(k, s)` is HMAC-SHA256. `SHA256(x)` is SHA-256.
- `|` is a literal pipe. Nonces and public keys are joined in their **b64 string form**.
- Public keys are P-256 (secp256r1) in X.509 SubjectPublicKeyInfo DER, sent as `b64(spki)`.
- The ECDH shared secret `Z` is the raw 32-byte x-coordinate.
- MACs are compared in constant time.

## Identities and stored secrets

- Each desktop has a random `desktopId` (32 hex chars), made once.
- Each deck has a random `deckId` (32 hex chars), made once.
- After pairing, both sides store the same 32-byte pairing key `K`:
  - The desktop stores `deckId -> K`, so it can pair with several decks.
  - The deck stores one `desktopId -> K`. Pairing with a new desktop replaces it.

## 1. Hello (deck to desktop, right after the TCP connect)

```json
{"t":"hello","proto":2,"id":"<deckId>","name":"Pixel 7","model":"...","ip":"192.168.1.42","w":1920,"h":1200,"nonce":"<b64 16 random bytes = nK>"}
```

A deck without `"proto": 2` is an old build. The desktop shows "update the deck app" and disconnects.

## 2. Auth (both sides already paired)

```
desktop -> {"t":"auth","desk":"<desktopId>","nonce":"<nD>","mac":b64(HMAC(K, "DW2 auth desk|" + nK + "|" + nD))}
deck    -> {"t":"auth-ok","mac":b64(HMAC(K, "DW2 auth deck|" + nK + "|" + nD))}
       or  {"t":"auth-fail","reason":"unknown"|"bad-mac"}
```

`nD` is 16 fresh random bytes from the desktop, in b64. When both MACs check out, both sides derive the session key:

```
S = HMAC(K, "DW2 session|" + nK + "|" + nD)
```

On `auth-fail` the desktop forgets that deck's key and treats the deck as unpaired.

## 3. Pairing (the desktop doesn't know this deck, or the deck doesn't know this desktop)

The deck commits to its values before it sees the desktop's nonce. That way a device sitting in the middle can't keep trying keys until the two 6-digit codes match.

```
P1 desktop -> {"t":"pair-start","desk":"<desktopId>","dname":"<computer name>","pk":"<b64 spki pkD>"}
P2 deck    -> {"t":"pair-commit","c":b64(SHA256(spkiK_bytes || nK2_bytes))}
P3 desktop -> {"t":"pair-nonce","n":"<b64 16 random bytes = nD2>"}
P4 deck    -> {"t":"pair-reveal","pk":"<b64 spki pkK>","n":"<nK2>"}
```

`pkK` and `nK2` are new for this pairing attempt; `nK2` is 16 random bytes. The desktop checks the commitment. Then both sides compute:

```
T    = pkD + "|" + pkK + "|" + nD2 + "|" + nK2          (b64 strings)
Z    = ECDH(own private key, other public key)
K    = HMAC(Z, "DW2 pair|" + T)
code = (first 4 bytes of SHA256("DW2 code|" + T) as big-endian uint32) mod 1000000, zero-padded to 6 digits
```

The deck shows `code` and the desktop's name, with **Pair** and **Cancel** buttons. The user types the code into the desktop and taps **Pair** on the deck. Either can happen first.

```
deck    -> {"t":"pair-approve"}                               (user tapped Pair)
desktop -> {"t":"pair-done","mac":b64(HMAC(K, "DW2 done desk"))}   (only after the typed code matched AND pair-approve arrived)
deck    -> {"t":"pair-ok","mac":b64(HMAC(K, "DW2 done deck"))}     (deck stores desktopId -> K)
```

The desktop checks `pair-ok`, stores `deckId -> K`, and then runs **Auth** (step 2) on the same connection, using the `nK` from hello.

Either side can send `{"t":"pair-cancel","reason":"..."}` at any time. The deck rejects a second `pair-start` while one is already running (`reason: "busy"`). After 3 wrong codes the desktop cancels.

## 4. Signed messages (after auth)

Every message after auth, in both directions, is wrapped:

```json
{"t":"s","n":<sequence number>,"p":"<the inner message as a JSON string>","h":"<b64 mac>"}
```

```
h = HMAC(S, dir + "|" + n + "|" + p)      dir = "d2k" (desktop to deck) or "k2d" (deck to desktop)
```

- `n` starts at 1 and goes up by 1 for each message a side sends, separately per direction.
- The receiver drops the connection if `h` is wrong or `n` is not larger than the last `n` it accepted.
- Before auth succeeds the deck ignores everything except `auth` and `pair-*`. The desktop does not send the layout and does not run keys.

Messages are signed, **not encrypted**. Someone on the network can read the layout (labels, page names) but can't change it or press keys.

## Inner messages (sent inside `"t":"s"`)

- **Desktop to deck:** `ping`, `layout`, `icon`, `np`, `sliders`, `status`, `panel`, `winpick`, `fb`
- **Deck to desktop:** `pong`, `down`, `up`, `set`, `sbtn`, `need`, `snap`

`panel`, `winpick` and `snap` were added in 1.1. A deck or desktop that doesn't know a message type ignores it.

**Sliders.** While a slider is dragged, the deck sends `{"t":"set","id":"<slider id>","value":0-100}` at most every 30 ms. A move that lands inside that gap is sent when the gap ends, so the newest position always arrives, even if the finger stops without lifting. The final position is sent again on release. The desktop applies only the newest value per slider (older ones still waiting are dropped) and ignores its own volume readings for that slider for 700 ms, so the slider doesn't jump back.

### Layout pages

Each page in `layout.pages` has `cols` (1-8), `rows` (1-6), `keys`, and:

- `strip`: 0 to 6 slider slots. `null` is an empty slot that still takes up room. An empty array means the page has no sliders.
- `side`: `"left"` or `"right"`, where the slider strip sits. Missing means `"right"`.

The strip is `n * 92 + (n - 1) * 50` design units wide, with a 60-unit gap to the keys, in a 1920 x 1200 design space. The desktop editor and every deck app use the same numbers so the preview matches the deck.

Each key has `row`, `col`, `span` (width in keys, 1 to 4) and `vspan` (height in keys, 1 to 3; missing means 1). `kind` is `key`, `status`, `np` (Now Playing, span 2) or `panel`. A deck clamps a key that runs past the page edge.

### Orientation and portrait (1.1)

Folder pages (pages with a `parent`) also have `backRow` and `backCol`: where the Back key sits (missing means 0, 0; outside the grid means 0, 0). A key covering that spot is hidden.

`layout` has `orient`: `"landscape"`, `"portrait"` or `"auto"` (turn with the device, respecting its rotation lock). Missing means `"landscape"`.

In portrait the design space is **1200 x 1920**. Each page also has:

- `porder`: `"reading"` or `"mirror"` (missing means reading)
- `pside`: `"top"` or `"bottom"`, where the sliders go in portrait (missing means bottom)

A `cols x rows` page shows as `rows x cols`. Keys (including a folder's Back key at 0,0) are placed one at a time, in landscape reading order (by row, then column):

1. Start spot, as an index into the portrait grid read left to right, top to bottom (`pc` = portrait columns = `rows`):
   - reading: `row * cols + col`
   - mirror: `col * pc + row` (row and column swap)
2. Size: `w = min(span, pc)`, `h = min(vspan, portrait rows)`.
3. From the start spot, go forward in reading order (wrapping to the top) to the first spot where a `w x h` key fits on free cells.
4. If it fits nowhere, try smaller sizes: height from `h` down to 1, and for each height, width from `w` down to 1. If even 1 x 1 doesn't fit, the key is left out.

`shared/portrait-vector.json` has test cases (made from the editor's `desktop/ui/portrait.js`). Every deck must match it.

Portrait geometry: pad 37, top 132, bottom reserve 178, gap 28, keys as wide as fits and no taller than they are wide. Sliders are rows of height 92 with a 50 gap, stacked across the full width (`n * 92 + (n - 1) * 50` tall, with a 60 gap to the keys). The top strip starts at y = 132; the bottom strip ends at y = 1920 - 178. Each slider row has a 150-wide label column, then the track, then (if it has one) the 92 x 92 button with a 40 gap before it. Screens without a page (pairing, offline) keep the landscape design, scaled to the width and centered.

### Status

```json
{"t":"status","id":"<key id>","value":"72%","sub":"4 cores","bar":0.72,"up":true}
```

`value`, `sub` and `bar` are left out when there's nothing to show. They are never sent as `null`. `bar` is 0 to 1.

### Panel (1.1)

```json
{"t":"panel","id":"<key id>","text":"line 1\nline 2","up":true}
```

`text` is the whole output, already cleaned by the desktop: up to 60 lines of up to 120 characters, no color codes, tabs as spaces. The deck shows it in a fixed-width font and lets you scroll it. `up` is false when the command failed.

Text size: as large as fits, between 21 and 64 design units. With `n` lines, the longest `L` characters long, the text area `w` wide and `h` tall (the panel minus 26 on each side, 84 at the top and 18 at the bottom), size = `min(w / (L * advance), h / (n * 30/21))`, where `advance` is the font's character width per unit of size (0.6 for JetBrains Mono). Line height is 30/21 of the size.

### Window picker (1.1)

When a Window picker key is pressed, the desktop sends:

```json
{"t":"winpick","key":"<key id>",
 "wins":[{"id":"<window id>","app":"Google Chrome","title":"Inbox","icon":"exe-1a2b3c4d5e6f"}],
 "mons":[{"id":"\\\\.\\DISPLAY1","name":"Display 1","x":0,"y":0,"w":2560,"h":1440,"main":true,
          "zones":[{"id":"z1","name":"Code","x":0,"y":0,"w":0.7,"h":1}]}]}
```

- `wins` is topmost first. `title` is left out when the user hides titles. `icon` is an icon id the deck fetches with `need`.
- `mons` uses the desktop's own pixel coordinates (they can be negative). Zone `x`, `y`, `w`, `h` are fractions of the monitor's work area.

After the user picks a window, a monitor and a spot (the deck asks for the spot in two screens: a size, then the spot inside it), the deck sends:

```json
{"t":"snap","key":"<key id>","win":"<window id>","mon":"<monitor id>","spot":"left"}
```

and the desktop answers with an `fb` for that key (a toast with the result). Spot ids and the part of the screen (x, y, w, h as fractions of the work area):

| id | spot | id | spot |
|---|---|---|---|
| `max` | 0, 0, 1, 1 (maximized) | `two-l` | 0, 0, 2/3, 1 |
| `left` | 0, 0, 0.5, 1 | `two-r` | 1/3, 0, 2/3, 1 |
| `right` | 0.5, 0, 0.5, 1 | `tl` | 0, 0, 0.5, 0.5 |
| `top` | 0, 0, 1, 0.5 | `tr` | 0.5, 0, 0.5, 0.5 |
| `bottom` | 0, 0.5, 1, 0.5 | `bl` | 0, 0.5, 0.5, 0.5 |
| `third-l` | 0, 0, 1/3, 1 | `br` | 0.5, 0.5, 0.5, 0.5 |
| `third-c` | 1/3, 0, 1/3, 1 | `center` | 0.15, 0.1, 0.7, 0.8 |
| `third-r` | 2/3, 0, 1/3, 1 | `zone:<id>` | that zone |

The window list (app names and titles) is signed like everything else, not encrypted.

### Device names

The deck sends its hardware model in `hello` (`name` and `model`) only as a hint. The name shown to the user is the one they type while pairing, stored on the desktop with that deck's key.

## Test vector

`shared/pairing-vector.json` has fixed keys and nonces with the expected `code`, `K`, auth MACs, `S` and one envelope MAC. Every implementation should pass it.
