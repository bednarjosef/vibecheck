# vibecheck

[![npm](https://img.shields.io/npm/v/vibecheck-app?color=3ecf8e&label=npm)](https://www.npmjs.com/package/vibecheck-app)
[![license](https://img.shields.io/badge/license-PolyForm%20NC-d97757)](LICENSE.md)

Tap **F8** → Claude's live status pops in over whatever you're doing, like
a little notification; tap again → it melts away. Hold F8 instead → it
shows only while held. Rather it were another key? Settings takes any key
you press.

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

> vibecheck itself is ~420 kB, but it's an Electron app, so npm pulls a
> private Chromium with it: about **270 MB on disk** after install. The
> [Releases](https://github.com/bednarjosef/vibecheck/releases) builds are
> the same story in one file (~100 MB compressed).

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

- **Shortcut key** — click it and press the key you want. Any key, on any
  keyboard: F13–F24 and macro keys from external boards, media keys, the
  numpad, a letter, whatever your desktop hasn't already claimed
- **Auto-reveal on change** — the pill peeks on its own when the status
  flips, and again when it recovers
- **Sound on change** — a soft two-note chime, down for bad news, up for
  recovery (off by default)
- **Real limit %** — your actual `/usage` percentages in the pill
  (`SESSION 34% · WEEK 62%`), set up automatically when Claude Code is
  detected; this toggle is the off switch —
  [details below](#usage-in-the-pill)
- **Start at login**
- **Position** — top or bottom edge. The whole thing mirrors: it drops in
  from that side, and the underglow moves to the pill's far edge so the
  light always falls away from the screen edge
- **Display** — which monitor the pill appears on (default: primary)

No tray icon (GNOME hides them without an extension)? `vibecheck --settings`
opens the panel — from a fresh launch or an already-running one.

The key is also registered with your desktop itself — gsettings on GNOME,
kglobalaccel on KDE Plasma 5/6 — so it works from anywhere, native Wayland
windows included. That happens on every launch and every key change; the
only keys left out are ones X has no name for.

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

## Usage in the pill

The pill carries your own Claude Code numbers next to the status. Real limit
% (below) supplies them when it's on; when it isn't, they fall back to token
counts for the current 5-hour session and the last week, read **entirely from
Claude Code's local transcripts** (`~/.claude/projects/**/*.jsonl`), where
every response records its exact token counts: nothing leaves your machine,
no account access, no extra login.

Honest fine print:

- Counts are input + output + freshly cached context. Cache *re-reads* are
  excluded — they're 98%+ of raw volume but nearly free, and would drown
  the signal.
- Session boundaries are reconstructed from timestamps (first message after
  a lapse opens a 5-hour window, anchored to the hour) — the same
  approximation ccusage uses, usually matching `/usage` to the minute.
- Token counts only see Claude Code on this machine — claude.ai chats and
  other devices don't appear. Real limit % (below) doesn't have that
  limitation.
- The weekly window follows your account's real reset moment. Claude Code
  reports it once (through the shim below) and vibecheck keeps it, stepping
  it forward a week at a time — so the token counts stay on the real week
  even with Real limit % switched off. Until it's heard once: rolling 7 days.

### Real limit % (on by default)

Claude Code hands every custom [status line](https://code.claude.com/docs/en/statusline)
script the account's true rate-limit numbers — the same percentages
`/usage` shows. On first launch with Claude Code detected, vibecheck wires
that up by itself: the status line in `~/.claude/settings.json` is pointed
at a tiny shim (copied to vibecheck's own config dir, so it survives app
updates). On every Claude Code reply the shim tees `rate_limits` into a
local file for the pill, then hands the line straight through to whatever
status-line command you already had. The percentages are account-wide
(other devices and claude.ai included), refresh as you work, and come with
real reset times.

If you had no status line, the shim prints `press F8 to vibecheck` (or
whatever your key is) in that row. Claude Code reserves the status-line row
as soon as any status line is configured — printing nothing leaves it blank
rather than gone — so the row says something useful instead.

Being upfront, since this edits a Claude Code setting automatically: the
one key touched is `statusLine`, the previous value is saved and a backup
of the whole file is kept in vibecheck's config dir, an existing status
line keeps working through the pass-through, and the **Real limit %**
toggle in Settings puts everything back exactly as it was — after which
vibecheck never touches it again. No credentials are read and nothing
leaves your machine.

## Platform notes

- **macOS** — the global key hook needs Accessibility permission:
  System Settings → Privacy & Security → Accessibility → allow your
  terminal (or the app). The app hides from the Dock.
- **Windows** — works out of the box.
- **Linux** — needs a compositor for window transparency (fine on GNOME/KDE).
  On **Wayland** the key hook runs through XWayland, so the plain key is only
  seen while an X11/XWayland app has focus — which is why GNOME and KDE get
  the desktop-level binding, registered for you, that works everywhere.

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

The pill is set in [JetBrains Mono](https://www.jetbrains.com/lp/mono/),
bundled with the app under the SIL Open Font License 1.1
([fonts/OFL.txt](fonts/OFL.txt)) so it looks the same on every machine.

Not affiliated with Anthropic.
