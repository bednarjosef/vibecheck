# vibecheck

Tap **F8** → Claude's live status pops in over whatever you're doing, like
a little notification; tap again → it melts away. Hold F8 instead → it
shows only while held.

Data comes straight from [status.claude.com](https://status.claude.com)'s public
Statuspage API. Polled every 60s in the background so the reveal paints
instantly — and every reveal also refetches live on the spot, swapping in the
fresh answer a beat later.

## Run

```bash
npm install
npm start
```

The overlay is click-through and lives in your tray. Quit from the tray icon.

## Without the key

- **Tray → "Bind F8 in GNOME"** (GNOME only) — one click writes a GNOME
  custom shortcut so F8 works from anywhere, including native Wayland
  windows. Untick to remove it again. The shortcut just touches a file
  the app watches (~10ms per key event); GNOME auto-repeats it while the
  key is held, and the app reads that train to tell taps (toggle) from
  holds (show while held, gone within ~150ms of release).
- **Tray → Show/hide status**
- **Run the app again** — a second launch just pokes the running instance
  and exits. On other desktops, bind any system shortcut to
  `node <path-to-repo>/launch.js`.

## What it watches

By default only **Claude Code** and **Claude API** (Claude Code runs on the
API, so an API incident is a Claude Code incident). The headline word is the
worst status among watched components — an unrelated claude.ai hiccup won't
bother you. Edit `WATCH` at the top of `main.js` to change it; empty list
mirrors the whole status page.

## Change the key

Tray → **Shortcut key** — pick one and it persists (and the GNOME binding,
if installed, is rebound automatically). The choice lives in
`~/.config/vibecheck/config.json`; any `UiohookKey` name works there too,
e.g. `{ "key": "F13" }`.

## Platform notes

- **macOS** — the global key hook needs Accessibility permission:
  System Settings → Privacy & Security → Accessibility → allow your
  terminal (or the Electron app). The app hides from the Dock.
- **Windows** — works out of the box.
- **Linux** — needs a compositor for window transparency (fine on GNOME/KDE).
  On hardened distros (e.g. Ubuntu 24.04+) the Chromium sandbox can't start;
  `launch.js` opts out on Linux automatically, so `npm start` just works.
  On **Wayland** the key hook runs through XWayland, so F8 is only seen while
  an X11/XWayland app has focus — use the GNOME binding above for a shortcut
  that works everywhere.

## How it works

- `uiohook-napi` listens for global keydown/keyup (Electron's own
  `globalShortcut` can't detect key *release*, which "hold to peek" needs)
- a transparent, frameless, always-on-top, click-through window renders the panel
- CSS handles the notification-style fade/slide in and out
- `GET /api/v2/status.json` + `/api/v2/components.json` from status.claude.com

Not affiliated with Anthropic.
