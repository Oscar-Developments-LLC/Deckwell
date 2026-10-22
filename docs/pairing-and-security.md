# Pairing and security

Deckwell can open apps, run scripts and run commands on your servers, so it matters who can press its keys. This page explains what's protected and what's up to you.

## What pairing does

The first time a deck connects, you **pair** it:

1. The deck shows a 6-digit code.
2. You name the deck and type the code on the desktop.
3. You tap **Pair** on the deck.

Behind the scenes, the two apps agree on a secret key that only they know. After that:

- **Your desktop only listens to decks you paired.** Another device on your Wi-Fi can't pretend to be your deck.
- **Every message is signed.** Nobody on your network can change your layout or press your keys, even if they can see the traffic.
- **Old messages can't be replayed.** Each message is numbered, and a repeated or out-of-order one ends the connection.
- **The code check stops a middleman.** Typing the code on one device and tapping Pair on the other proves you're pairing the two devices in front of you, and not something in between.

Pair once and they reconnect by themselves. You only pair again if you reset the deck app, reinstall it, or click **Forget deck**.

## Managing paired decks

Click the **device card** (top left) while a deck is connected:

- **Deck name:** rename it anytime.
- **Forget deck:** removes its key. It has to pair again to connect.

A deck remembers one computer at a time. Pairing it with a different PC replaces the old one.

## What's still up to you

- **Messages are signed, not encrypted.** Someone on the same network could read your key labels and page names. They can't change them or press anything. Avoid putting secrets in key labels.
- **SSH and script keys run with no confirmation.** One tap runs the command. Only put commands on your deck that you'd be fine running by accident.
- **Anyone holding your unlocked deck can press its keys.** Treat it like your keyboard. Use the tablet's own screen lock if others can get to it.
- **Your SSH private key is read from disk** by the desktop app. Make a key just for Deckwell, and on your servers, limit what it can do (see [Homelab over SSH](scripting/homelab-ssh.md#use-a-limited-key)).
- **Keep these files private:** `%APPDATA%\Deckwell\pairing.json` and `push-token.txt`. Anyone who copies them could pose as your deck or push fake status values.
- **Use Deckwell on networks you trust.** At home is fine. On public or school Wi-Fi, USB is safer.

## The push endpoint

Status tiles can receive values from your own scripts at `http://127.0.0.1:8770`. It:

- Only accepts connections from your own PC, never from your network
- Rejects any request without your token from `push-token.txt`
- Can only change what a status tile displays. It can't press keys or change your layout.

## Reporting a problem

This is a small open-source project. It hasn't had a professional security audit. If you find a security issue, please report it privately through GitHub's **Security** tab on the repository instead of opening a public issue.

For the exact technical details, see [PROTOCOL.md](PROTOCOL.md).
