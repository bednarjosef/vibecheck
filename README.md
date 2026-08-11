<div align="center">

<img src="https://raw.githubusercontent.com/bednarjosef/vibecheck/main/docs/icon.png" width="88" alt="" />

# vibecheck

**Tap a key. See how much Claude you have left.**

[![npm](https://img.shields.io/npm/v/vibecheck-app?color=3ecf8e&label=npm)](https://www.npmjs.com/package/vibecheck-app)
[![download](https://img.shields.io/github/v/release/bednarjosef/vibecheck?color=d97757&label=download)](https://github.com/bednarjosef/vibecheck/releases/latest)
[![platforms](https://img.shields.io/badge/macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-8b93a1)](#install)
[![license](https://img.shields.io/badge/license-PolyForm%20NC-d97757)](LICENSE.md)

</div>

![vibecheck demo](https://raw.githubusercontent.com/bednarjosef/vibecheck/main/docs/hero.webp)

Hold **F8** and a pill drops in from the top of the screen. It has two rows,
one for your five-hour session and one for your seven-day week, each with the
percentage you've spent, the tokens behind it, and how long until it resets.
Above them it says whether Claude itself is up. Let go and it melts away.

Tap the key to pin it, hold it to peek. It floats over whatever you're doing,
ignores your clicks, and leaves nothing behind.

You need [Claude Code](https://claude.com/claude-code) on the same machine,
on a Pro or Max plan, because that's where the numbers come from. Without it
you still get Claude's live status, just not your usage.

Nothing about your account leaves your computer. The usage comes from files
already on disk, and vibecheck only ever asks the internet two things: how
Claude is doing, and whether there's a newer vibecheck.

## Install

**Any OS, one command:**

```bash
npm install -g vibecheck-app
vibecheck
```

The same command updates it later, and vibecheck puts a line in its tray menu
when a new version is out.

> It's an Electron app, so npm pulls a private Chromium with it: **~270 MB
> on disk**. vibecheck itself is 400 kB of that.

**Prefer an installer?** They're all on the
[latest release](https://github.com/bednarjosef/vibecheck/releases/latest):

| | |
|---|---|
| **macOS** | `-arm64.dmg` for Apple Silicon · `-x64.dmg` for Intel |
| **Windows** | `-Setup-x64.exe` · `-Setup-arm64.exe` |
| **Linux** | `-x86_64.AppImage` or `_amd64.deb` · `-arm64` of either |

Either way it registers itself as a real app: a launcher entry on Linux, an
app bundle on macOS, a Start Menu shortcut on Windows. It starts in the tray
with no window, so press the key and it's there. Turn on **Start at login**
in Settings and you can forget about it.

## The key

**F8** by default. In Settings, click Shortcut key and press whatever you
want instead: F13–F24 from an external board, a media key, the numpad,
anything your desktop hasn't already claimed. On GNOME and KDE it gets
registered with the desktop itself, so it works inside native Wayland windows
too.

The tray icon's menu holds everything else: both figures, show/hide,
settings, quit. The icon is the spark from the pill, in the colour the pill
would use for the same news. Green means Claude is fine. Amber, orange and
red mean it isn't.

No tray icon at all? GNOME hides them unless an extension puts them back:
`vibecheck --settings` opens the panel directly.

## Where the numbers come from

**The percentages are the real ones.** Claude Code hands every custom
[status line](https://code.claude.com/docs/en/statusline) the account's true
rate-limit figures, the same ones `/usage` prints. vibecheck points
`statusLine` in `~/.claude/settings.json` at a small shim that copies those
figures to a local file, then hands the line straight through to whatever
status line you already had. Being upfront, since it edits a Claude Code
setting by itself:

- only one key is touched, `statusLine`, and the previous value is saved
- a backup of the whole file goes in vibecheck's config directory
- an existing status line keeps working through the pass-through
- `vibecheck --restore-statusline` puts yours back whenever you want
- no credentials are read, and nothing leaves your machine

If you had no status line of your own, the shim prints `press F8 to
vibecheck` in that row. Claude Code reserves the row as soon as any status
line exists, so it may as well say something.

**Without the shim the numbers still work.** They get counted from Claude
Code's local transcripts instead: exact token totals, no account access. That
count only sees this machine, so read it as an estimate of the same thing the
percentages report exactly.

## Platform notes

- **macOS**: the global key hook needs Accessibility permission, under System
  Settings → Privacy & Security → Accessibility. The app hides from the Dock.
- **Windows**: works out of the box.
- **Linux**: needs a compositor for transparency, which GNOME and KDE both
  have. On Wayland the key hook only sees X11/XWayland windows, which is why
  GNOME and KDE get a desktop-level binding registered for them automatically.

## Removing it

Quit from the tray menu, then `npm uninstall -g vibecheck-app`, or use the
usual uninstaller for your platform. If you want your old Claude Code status
line back, run `vibecheck --restore-statusline` first: a vibecheck that's
still installed puts the shim back the next time it starts.

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md). Free for any personal,
educational or nonprofit use: run it, fork it, tinker, share. Commercial use
needs permission from the author.

Set in [JetBrains Mono](https://www.jetbrains.com/lp/mono/), bundled under
the SIL Open Font License 1.1 ([fonts/OFL.txt](fonts/OFL.txt)).

Not affiliated with Anthropic.
