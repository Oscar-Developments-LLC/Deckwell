# Homelab over SSH

SSH keys run a command on a server, NAS, Raspberry Pi, or any computer that accepts SSH. Use them to restart containers, run updates, or check on things, all from your deck.

## Set up a key (once)

Deckwell signs in with an **SSH key file**, not a password. The key must **not** have a passphrase, because nobody is there to type it.

**1. Make a key just for Deckwell.** Open PowerShell on your PC:

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\deckwell_ed25519" -C deckwell
```

Press **Enter twice** when it asks for a passphrase (leave it empty).

**2. Copy the public key to your server.** Replace `user@server` with yours:

```powershell
Get-Content "$env:USERPROFILE\.ssh\deckwell_ed25519.pub" | ssh user@server "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
```

It asks for your server password one last time.

**3. Test it.** This should sign in with no password:

```powershell
ssh -i "$env:USERPROFILE\.ssh\deckwell_ed25519" user@server "echo it works"
```

**4. Add the host in Deckwell.** Drag **SSH command** onto a key, click **+** next to Host, and fill in a name, the address, the user and the port (usually 22). Set **Auth** to:

```
~/.ssh/deckwell_ed25519
```

## Commands to put on keys

**Docker**

| Key | Command |
|---|---|
| Restart a container | `docker restart nginx` |
| Restart a Compose stack | `cd ~/stacks/media && docker compose restart` |
| Update a Compose stack | `cd ~/stacks/media && docker compose pull && docker compose up -d` |
| Clean up old images | `docker image prune -f` |
| How many are running | `docker ps -q \| wc -l` |

**System**

| Key | Command |
|---|---|
| Uptime | `uptime -p` |
| Disk space | `df -h / \| tail -1` |
| GPU status | `nvidia-smi --query-gpu=temperature.gpu,utilization.gpu --format=csv,noheader` |
| Is a service running | `systemctl is-active nginx` |
| Restart a service | `sudo systemctl restart nginx` (see [sudo](#commands-that-need-sudo)) |
| Updates (Debian/Ubuntu) | `sudo apt-get update && sudo apt-get -y upgrade` |
| Reboot | `sudo systemctl reboot` |

Set **On the key after firing** to **Last line** to see the result on the deck, like the uptime or how many containers are running.

**Wake a PC with Wake-on-LAN** from an always-on server (needs the `wakeonlan` package on the server):

```sh
wakeonlan AA:BB:CC:DD:EE:FF
```

## Commands that need sudo

`sudo` normally asks for a password, and Deckwell can't type it. Allow just the commands your keys need, with no password, by adding a sudoers file **on the server**:

```sh
sudo visudo -f /etc/sudoers.d/deckwell
```

Add one line per command, with the full path (find it with `which systemctl`):

```
youruser ALL=(root) NOPASSWD: /usr/bin/systemctl restart nginx, /usr/bin/systemctl reboot
```

Only list exact commands you want the deck to run. Never allow `ALL`.

## Use a limited key

A key with no passphrase on your PC is only as safe as your PC. To limit what it can do on the server, add options in front of it in `~/.ssh/authorized_keys`:

```
from="192.168.1.0/24",no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... deckwell
```

- `from="..."` only accepts the key from your home network.
- The `no-...` options turn off things Deckwell doesn't need.

## Status tiles over SSH

Copy these to your server and use them on a **Status tile** with **Data source: SSH**. Each prints one line in the [status tile format](../status-tiles.md#the-output-format):

| Script | Shows |
|---|---|
| [`status-containers.sh`](../examples/ssh/status-containers.sh) | Containers running out of total, red if any are stopped |
| [`status-disk.sh`](../examples/ssh/status-disk.sh) | How full a disk is |
| [`status-gpu.sh`](../examples/ssh/status-gpu.sh) | NVIDIA GPU temperature and load |
| [`status-load.sh`](../examples/ssh/status-load.sh) | Load average for the number of cores |

On the server:

```sh
mkdir -p ~/deckwell
# copy the scripts into ~/deckwell, then:
chmod +x ~/deckwell/*.sh
```

Set the tile's **Command** to the script's path, like `~/deckwell/status-containers.sh`. Use a **Refresh** of 10 seconds or more, because each update signs in again.

## When it doesn't work

The key shows a short message, and **Last run** has the details.

| Message | Fix |
|---|---|
| Key file not found | Check **Auth**. `~` means your Windows user folder. |
| Auth failed | The public key isn't in the server's `authorized_keys`, or it's for a different user. Run the test from step 3. |
| That key needs a passphrase | Make a key without one (step 1). |
| Timed out | The command took longer than **Timeout**. Raise it, or run long jobs in the background: `nohup ./backup.sh >/dev/null 2>&1 &` |
| Host unreachable | Wrong address, the server is off, or you're not on the right network or VPN. |
| exit 1 (or another number) | The command ran but failed. Try it in a normal SSH session to see the error. |
