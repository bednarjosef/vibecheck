# vibecheck

[![npm](https://img.shields.io/npm/v/vibecheck-app?color=3ecf8e&label=npm)](https://www.npmjs.com/package/vibecheck-app)
[![license](https://img.shields.io/badge/license-PolyForm%20NC-d97757)](LICENSE.md)

**Tap a key. See how much Claude you have left.** Your session and weekly
limits, the real percentages, and how long until each one resets — plus
whether Claude itself is up. Let go and it melts away.

![vibecheck demo](https://raw.githubusercontent.com/bednarjosef/vibecheck/main/docs/hero.webp)

Tap the key to pin it, hold it to peek. It floats over whatever you're
doing, ignores your clicks, and leaves nothing behind.

## Install

**Any OS, one command** — you have npm, you use Claude Code:

```bash
npm install -g vibecheck-app
vibecheck
```

> It's an Electron app, so npm pulls a private Chromium with it: **~270 MB
> on disk**. vibecheck itself is 400 kB of that.

**Or grab an installer** from [Releases](https://github.com/bednarjosef/vibecheck/releases):

| | |
|---|---|
| **macOS** | `-arm64.dmg` for Apple Silicon · `-x64.dmg` for Intel |
| **Windows** | `-Setup-x64.exe` · `-Setup-arm64.exe` |
| **Linux** | `-x86_64.AppImage` or `_amd64.deb` · `-arm64` of either |

Either way it registers itself as a real app — launcher entry on Linux, an
app bundle on macOS, a Start Menu shortcut on Windows. Flip on **Start at
login** in Settings and you can forget about it.

## The key

**F8** by default. Settings → Shortcut key records whatever you press
next — F13–F24 from an external board, a media key, the numpad, anything
your desktop hasn't already claimed. On GNOME and KDE it's registered with
the desktop itself, so it works inside native Wayland windows too.

No tray icon? GNOME hides them unless an extension puts them back:
`vibecheck --settings` opens the panel directly.

## Where the numbers come from

**The percentages are the real ones.** Claude Code hands every custom
[status line](https://code.claude.com/docs/en/statusline) the account's true
rate-limit figures — the same ones `/usage` prints. On first launch
vibecheck points `statusLine` in `~/.claude/settings.json` at a small shim
that copies them to a local file and then hands the line straight through to
whatever status line you already had. Being upfront, since it edits a Claude
Code setting by itself:

- one key is touched — `statusLine` — and the previous value is saved
- a backup of the whole file goes in vibecheck's config directory
- an existing status line keeps working through the pass-through
- **Real limit %** in Settings switches it off and puts everything back
- no credentials are read, and nothing leaves your machine

If you had no status line of your own, the shim prints `press F8 to
vibecheck` in that row — Claude Code reserves it as soon as any status line
exists, so it may as well say something.

**Turn it off and the numbers keep working**, counted from Claude Code's
local transcripts instead: exact token totals, no account access. They only
see this machine, and they're an estimate of the same thing the percentages
report exactly.

## Platform notes

- **macOS** — the global key hook needs Accessibility permission: System
  Settings → Privacy & Security → Accessibility. The app hides from the Dock.
- **Windows** — works out of the box.
- **Linux** — needs a compositor for transparency (fine on GNOME/KDE). On
  Wayland the key hook only sees X11/XWayland windows, which is why GNOME
  and KDE get a desktop-level binding registered for them automatically.

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md) — free for any personal,
educational or nonprofit use: run it, fork it, tinker, share. Commercial use
needs permission from the author.

Set in [JetBrains Mono](https://www.jetbrains.com/lp/mono/), bundled under
the SIL Open Font License 1.1 ([fonts/OFL.txt](fonts/OFL.txt)).

Not affiliated with Anthropic.
