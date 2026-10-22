# Status tiles

A status tile shows a live value on your deck: CPU use, a temperature, free disk space, whether a server is up, or anything a script can print.

```
┌─────────────────┐
│ GPU             │  ← Title
│ 61°C            │  ← value
│ RTX 3080        │  ← subtitle
│ ▬▬▬▬▬▬▬──────── │  ← bar (or an up/down dot)
└─────────────────┘
```

**To add one,** drag **Status tile** from the action bar onto a key. Then pick a **Data source**.

## Data sources

| Source | Where the value comes from | Good for |
|---|---|---|
| **This PC** | Built in: this computer's **CPU** or **RAM** use | A quick system monitor, no setup |
| **Command** | A PowerShell or cmd command Deckwell runs every few seconds | Anything on this PC: disk space, GPU temp, a file's contents |
| **SSH** | A command Deckwell runs on one of your hosts every few seconds | Servers: containers, disks, load, services |
| **Push** | Your own script sends values to Deckwell whenever it wants | Long-running scripts, slow checks, things that change rarely |

**Refresh** sets how often Command and SSH tiles update. SSH tiles default to 10 seconds, because each update signs in to the server again.

**Show** picks how the tile looks:

- **Value + bar:** the value, with a bar along the bottom
- **Value:** just the value
- **Up / down:** the value with a green or red dot

**On tap** (optional) opens a link when you tap the tile, like your server's dashboard.

## The output format

For **Command**, **SSH** and **Push**, Deckwell reads **the last line** of what your command prints. Everything before it is ignored, so your script can print other things first.

That line looks like this. Only the value is required:

```
value|subtitle|bar|up
```

| Part | Example | Notes |
|---|---|---|
| value | `72%`, `61°C`, `3/4`, `online` | The big text. Keep it short (up to 24 characters). |
| subtitle | `4 cores`, `C: 120 GB free` | The small text under it |
| bar | `0.72`, `72`, `72%` | How full the bar is. 0 to 1, or 0 to 100. |
| up | `up`, `down`, `ok`, `fail`, `true`, `false` | The dot color, for **Up / down** tiles |

**Shortcuts:**

- If the **value ends in %** and you don't give a bar, the bar follows the value. `72%` alone gives a 72% bar.
- If you don't give **up**, it's **up** when the command exited with 0 and **down** otherwise. So for an up/down tile, a command that succeeds or fails is often enough.

**Examples:**

| Your command prints | The tile shows |
|---|---|
| `45%` | 45%, bar at 45% |
| `72%\|4 cores\|0.72` | 72%, "4 cores", bar at 72% |
| `61°C\|RTX 3080\|23` | 61°C, "RTX 3080", bar at 23% |
| `3/4\|containers up\|0.75\|down` | 3/4, "containers up", bar at 75%, red dot |
| `online` (exit code 0) | online, green dot |

**JSON works too.** If the last line starts with `{`, Deckwell reads it as JSON:

```json
{"value": "72%", "sub": "4 cores", "bar": 0.72, "up": true}
```

## Command tiles

**Runs in** PowerShell or cmd. Commands time out after **15 seconds**.

**One-liners** go straight in the Command box:

```powershell
# Free space on C:, with the bar showing how full it is
$d = Get-PSDrive C; '{0:0}%|C: {1:0} GB free' -f (100*$d.Used/($d.Used+$d.Free)), ($d.Free/1GB)
```

**Longer scripts:** save them as a `.ps1` file and call it from the Command box:

```powershell
& "C:\Scripts\status-gpu.ps1"
```

Ready-made scripts: [`status-disk.ps1`](examples/powershell/status-disk.ps1), [`status-gpu.ps1`](examples/powershell/status-gpu.ps1).

## SSH tiles

Pick a **Host**, type a **Command**, and set **Auth** to your key file (the same as SSH keys; see [Homelab over SSH](scripting/homelab-ssh.md)). Commands time out after **10 seconds**.

```sh
# Disk use on the server's root drive: "62%|120G free on /"
df -Ph / | awk 'NR==2 {print $5 "|" $4 " free on /"}'
```

Ready-made scripts to copy to your server: [`status-containers.sh`](examples/ssh/status-containers.sh), [`status-disk.sh`](examples/ssh/status-disk.sh), [`status-gpu.sh`](examples/ssh/status-gpu.sh), [`status-load.sh`](examples/ssh/status-load.sh).

## Push tiles

With **Push**, Deckwell doesn't run anything. Your own script sends a value whenever it has one. This is best for:

- Scripts that are already running, like a monitoring loop
- Checks that are slow, or that should only run every few minutes
- Values from other programs that can make a web request

**Set it up:**

1. Set the tile's **Data source** to **Push** and give it a **Feed name**, like `gpu-temp`. Several tiles can share a feed.
2. Your script sends the value to `http://127.0.0.1:8770/status/<feed name>`.
3. Every request needs your **token**. It's in `%APPDATA%\Deckwell\push-token.txt`, and the **Copy** button in the tile's settings copies it.

**Safety:** the push endpoint only listens on your own PC, never on your network, and it ignores any request without the token.

### Sending a value

**POST** the value in the same format as above. Send the token in an `Authorization: Bearer` header:

**PowerShell**

```powershell
$token = (Get-Content "$env:APPDATA\Deckwell\push-token.txt" -Raw).Trim()
Invoke-RestMethod -Method Post http://127.0.0.1:8770/status/gpu-temp `
  -Headers @{ Authorization = "Bearer $token" } -Body '61C|RTX 3080|23'
```

Windows PowerShell 5.1 doesn't always send symbols like `°` correctly in a request, so stick to plain text there. Python sends them fine.

**Python**

```python
import os, pathlib, urllib.request

token = (pathlib.Path(os.environ["APPDATA"]) / "Deckwell" / "push-token.txt").read_text().strip()
req = urllib.request.Request(
    "http://127.0.0.1:8770/status/gpu-temp",
    data="61°C|RTX 3080|23".encode("utf-8"),
    headers={"Authorization": f"Bearer {token}"},
    method="POST",
)
urllib.request.urlopen(req, timeout=5)
```

**curl** (built into Windows 10 and 11)

```bat
curl.exe -X POST http://127.0.0.1:8770/status/gpu-temp -H "Authorization: Bearer YOUR_TOKEN" -d "61C|RTX 3080|23"
```

**A plain GET also works**, for tools that can only open a URL. Put the parts in the query string:

```
http://127.0.0.1:8770/status/gpu-temp?token=YOUR_TOKEN&value=61C&sub=RTX%203080&bar=23
```

### What Deckwell answers

| Answer | Meaning |
|---|---|
| `200` `{"ok":true,"feed":"gpu-temp","tiles":1}` | Done. `tiles` is how many tiles use that feed (0 means none yet). |
| `401` | Wrong or missing token |
| `400` | Bad feed name (use letters, numbers, `-`, `_`, `.`), or a body over 8 KB |
| `404` | Wrong path. Use `/status/<feed>`. |

`GET http://127.0.0.1:8770/health` answers without a token, so scripts can check that Deckwell is running.

### Keep a push script running

[`push-website-check.ps1`](examples/powershell/push-website-check.ps1) checks a website every 30 seconds and pushes how fast it answered.

To start a script like that when you sign in to Windows:

1. Press **Win+R**, type `shell:startup`, and press Enter.
2. In that folder, right-click > **New > Shortcut**.
3. For the location, enter:
   ```
   powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\Scripts\push-website-check.ps1"
   ```

## When a tile looks wrong

| The tile shows | Why |
|---|---|
| `—` | No value yet: no source picked, the command printed nothing, or nothing has been pushed |
| `err` with a message | The command couldn't run. The message says why. |
| `timeout` | The command took longer than 15 seconds (10 for SSH) |
| `auth` / `offline` | SSH couldn't sign in, or the host didn't answer |
| A red dot when it should be green | Your command exited with a non-zero code. Add `\|\|up` or `exit 0`. |

Command errors are also written to `%APPDATA%\Deckwell\deckwell.log`.
