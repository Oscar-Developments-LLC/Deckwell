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

- **Desktop to deck:** `ping`, `layout`, `icon`, `np`, `sliders`, `status`, `fb`
- **Deck to desktop:** `pong`, `down`, `up`, `set`, `sbtn`, `need`

### Layout pages

Each page in `layout.pages` has `cols` (1-8), `rows` (1-6), `keys`, and:

- `strip`: 0 to 6 slider slots. `null` is an empty slot that still takes up room. An empty array means the page has no sliders.
- `side`: `"left"` or `"right"`, where the slider strip sits. Missing means `"right"`.

The strip is `n * 92 + (n - 1) * 50` design units wide, with a 60-unit gap to the keys, in a 1920 x 1200 design space. The desktop editor and every deck app use the same numbers so the preview matches the deck.

### Status

```json
{"t":"status","id":"<key id>","value":"72%","sub":"4 cores","bar":0.72,"up":true}
```

`value`, `sub` and `bar` are left out when there's nothing to show. They are never sent as `null`. `bar` is 0 to 1.

### Device names

The deck sends its hardware model in `hello` (`name` and `model`) only as a hint. The name shown to the user is the one they type while pairing, stored on the desktop with that deck's key.

## Test vector

`shared/pairing-vector.json` has fixed keys and nonces with the expected `code`, `K`, auth MACs, `S` and one envelope MAC. Every implementation should pass it.
