# vibecheck

Tap **F8** → Claude's live status pops in over whatever you're doing, like
a little notification; tap again → it melts away. Hold F8 instead → it
shows only while held.

![vibecheck demo](https://raw.githubusercontent.com/bednarjosef/vibecheck/main/docs/hero.gif)

Data comes straight from [status.claude.com](https://status.claude.com)'s
public Statuspage API. Polled every 60s in the background so the reveal
paints instantly — every reveal also refetches live on the spot, and during
an incident the pill shows Anthropic's actual incident title, not just a
component flag. When the status changes on its own, the pill auto-reveals
for a few seconds (and again on recovery), with an optional soft chime.

## Install

One command, any OS (you have npm — you use Claude Code):

```bash
npm install -g vibecheck-app
vibecheck
```

On first launch it registers itself as a real app — launcher entry on
Linux, an app bundle in ~/Applications on macOS, a Start Menu shortcut on
Windows — so from then on you can start it like anything else (and flip on
**Start at login** in Settings to never think about it again).

Prefer a classic installer? [Releases](https://github.com/bednarjosef/vibecheck/releases)
has AppImage/deb for Linux, dmg for macOS, and a Windows setup. Or run from
source:

```bash
git clone https://github.com/bednarjosef/vibecheck && cd vibecheck
npm install
npm start
```

The overlay is click-through and lives in your tray. Quit from the tray icon.

> Hardened Linux distros (e.g. Ubuntu 24.04+) block Chromium's sandbox;
> `npm start` handles that automatically, but a packaged binary needs
> `--no-sandbox` on the command line.

## Settings

Tray → **Settings…** opens a small panel:

- **Shortcut key** — pick from F6–F12, ScrollLock, Pause (any `UiohookKey`
  name also works by hand in `~/.config/vibecheck/config.json`)
- **System-wide key (GNOME & KDE)** — one click registers the key with your
  desktop (gsettings on GNOME, kglobalaccel on KDE Plasma 5/6) so it works
  from anywhere, including native Wayland windows
- **Auto-reveal on change** — the pill peeks on its own when the status
  flips, and again when it recovers
- **Sound on change** — a soft two-note chime, down for bad news, up for
  recovery (off by default)
- **Start at login**
- **Ambient light** — a living glow in the status color: *Underglow* (a
  lamp wandering the bottom edge, casting light downward), *Border
  shimmer* (light drifting along the pill's hairline border), or *Off*
- **Display** — which monitor the pill appears on (default: primary)

## Without the key

- **Tray → Show/hide status**
- **Run the app again** — a second launch just pokes the running instance
  and exits. On desktops other than GNOME/KDE, bind any system shortcut to
  `node <path-to-repo>/launch.js`.

The system binding itself just touches a file the app watches (~10ms per key
event); GNOME auto-repeats it while the key is held, and the app reads that
train to tell taps (toggle) from holds (show while held, gone within ~150ms
of release).

## What it watches

By default only **Claude Code** and **Claude API** (Claude Code runs on the
API, so an API incident is a Claude Code incident). The headline word is the
worst status among watched components — an unrelated claude.ai hiccup won't
bother you — and unresolved incidents are matched against the same watchlist.
Edit `WATCH` at the top of `main.js` to change it; empty list mirrors the
whole status page.

## Platform notes

- **macOS** — the global key hook needs Accessibility permission:
  System Settings → Privacy & Security → Accessibility → allow your
  terminal (or the app). The app hides from the Dock.
- **Windows** — works out of the box.
- **Linux** — needs a compositor for window transparency (fine on GNOME/KDE).
  On **Wayland** the key hook runs through XWayland, so the plain key is only
  seen while an X11/XWayland app has focus — use the system binding from
  Settings (GNOME and KDE) for a shortcut that works everywhere.

## How it works

- `uiohook-napi` listens for global keydown/keyup (Electron's own
  `globalShortcut` can't detect key *release*, which "hold to peek" needs)
- a transparent, frameless, always-on-top, click-through window renders the
  pill; a second small window hosts Settings
- CSS handles the notification-style fade/slide in and out
- `status.json` + `components.json` + `incidents/unresolved.json` from
  status.claude.com's Statuspage API

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md) — the source is open and free
for any personal, educational, or nonprofit use: run it, fork it, tinker,
share. Commercial use needs permission from the author.

Not affiliated with Anthropic.
