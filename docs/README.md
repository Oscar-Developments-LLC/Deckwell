# Deckwell guides

Start with **Getting started**. Then read the guide for whatever you want to build.

## The basics

| Guide | What's in it |
|---|---|
| [Getting started](getting-started.md) | Install the desktop app and the deck app, pair them, and make your first key |
| [How Deckwell works](how-it-works.md) | What runs where, how the two apps find each other, and where your files are |
| [Keys](keys.md) | Every key type, icons and labels, and keys that do several things in one press |
| [Pages, folders and sliders](pages-and-sliders.md) | Laying out your deck, moving between pages, and volume sliders |
| [Status tiles](status-tiles.md) | Live values on your deck: this PC, commands, servers, and scripts that push updates |
| [Pairing and security](pairing-and-security.md) | What pairing protects, and what to be careful with |
| [Troubleshooting](troubleshooting.md) | Fixes for the most common problems |

## Scripting

| Guide | What's in it |
|---|---|
| [Scripting basics](scripting/README.md) | Script keys vs. SSH keys vs. status tiles, and the rules every script follows |
| [Windows automation with PowerShell](scripting/windows-powershell.md) | Switch your audio output, open a set of apps, toggle dark mode, and more |
| [Homelab over SSH](scripting/homelab-ssh.md) | Set up SSH keys, then restart containers, check disks and GPUs, run updates |
| [Streaming with OBS](scripting/obs.md) | Switch scenes, start and stop recording, mute your mic |

Every example script is in [`examples/`](examples/), ready to copy.

## For developers

[PROTOCOL.md](PROTOCOL.md) explains exactly how the desktop and deck talk to each other. Read it before building Deckwell for a new platform.
