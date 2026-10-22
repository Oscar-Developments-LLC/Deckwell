# Scripting basics

Deckwell can run your own code in three ways. Pick the one that fits.

| You want to... | Use | Runs on |
|---|---|---|
| Do something on this PC when you tap a key | **Script key** (PowerShell or Python file) | This PC |
| Do something on a server when you tap a key | **SSH command key** | The server |
| Show a value that keeps updating | **Status tile** (Command, SSH or Push) | This PC or the server |

You can also chain them: any key can run scripts and SSH commands as **extra steps**. See [Keys](../keys.md#keys-that-do-more-than-one-thing).

## The rules every script follows

**1. Exit code 0 means success.**
The key flashes a ring. Any other exit code shows a red badge on the key with the code. In PowerShell, use `exit 1` to say something went wrong. In Python, `sys.exit(1)`.

**2. The last line you print shows on the deck.**
For a **Script** key with **Window: Hidden**, the last line of output appears briefly on the key and in **Last run** in the editor. Make it short and useful: `Now playing on Headphones`, not `Done.`

**3. There's no input.**
Scripts run in the background, so nothing can ask you a question. `Read-Host` or `input()` will wait forever. Put your settings at the top of the file instead.

**4. Scripts run from their own folder.**
A script can open files saved next to it by name.

**5. Time limits.**

| Kind | Gives up after |
|---|---|
| Script key | 10 minutes |
| SSH key | The **Timeout** you set (10 seconds by default) |
| Status tile command | 15 seconds |
| Status tile over SSH | 10 seconds |

**6. One script per action.**
Script keys can't pass arguments to a script. If you want "switch to scene A" and "switch to scene B", make two small copies of the script with different settings at the top.

## PowerShell or Python?

- **PowerShell** comes with Windows and is great at controlling Windows: settings, apps, files, the registry. Deckwell runs `.ps1` files with Windows PowerShell 5.1, with script blocking turned off for that run (`-ExecutionPolicy Bypass`).
- **Python** is better when a library already does the job, like controlling OBS. You need to [install Python](https://www.python.org/downloads/) first. Tick **"Add python.exe to PATH"** in the installer.

## Guides with ready-to-use scripts

- [Windows automation with PowerShell](windows-powershell.md): switch headphones and speakers, open your workspace, toggle dark mode, lock the PC
- [Homelab over SSH](homelab-ssh.md): restart containers, run updates, check disks and GPUs
- [Streaming with OBS](obs.md): scenes, recording, mic mute
- [Status tiles](../status-tiles.md): live values from commands, servers, and push scripts

All the example files are in [`docs/examples`](../examples).
