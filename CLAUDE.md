# vibecheck — working rules

An Electron tray app: hold a key, see Claude's status and how much of your
Claude Code limits you've spent. `main.js` is the main process, `index.html`
is the pill and `settings.html` the settings window, and `usage.js` derives
token counts from Claude Code's local transcripts.

## npm publishing — manual only

**Never publish this package to npm automatically, and never add CI or
workflow automation that publishes to npm.** Not on tags, not on releases,
not on version bumps.

- Publishing happens only when the maintainer explicitly asks for it.
  Suggesting a release is welcome; waiting for a yes is required.
- GitHub Releases via tag push (the electron-builder workflow) are fine and
  stay automated. That's releases only — **not** npm.
- Package is `vibecheck-app`, binary `vibecheck`. Bare `vibecheck` is squatted
  on npm, which blocks the punctuation variants too; the name is kept
  provider-neutral on purpose.

## What ships

`files` in package.json (npm) and `build.files` (electron-builder) are both
whitelists — a file reaches users only if it is named there. Adding a source
file to the app means adding it to both. This document is in neither, and
shouldn't be.

## The app is a singleton

One config directory, one single-instance lock, one tray icon, one desktop key
binding. A second launch doesn't start a second app; it toggles the running one
and exits. So:

- Kill the running instance before driving the app with Playwright.
- Give every test instance its own `--user-data-dir`. That isolates
  `config.json`, `limits.json` *and* the single-instance lock, so copies can
  coexist — and it's the only way to keep a fixture stable, for the reason
  below.

## Testing this app

Four things that have each cost a wrong conclusion:

- **`limits.json` has a live writer.** When Claude Code is running on the same
  machine, its status line rewrites the real `limits.json` continuously and
  will overwrite whatever a test puts there, mid-run. Isolate with
  `--user-data-dir`.
- **Don't assert on live token totals.** `usage.js` reads
  `~/.claude/projects/**`, which every running Claude Code session appends to.
  Inject a `limits.json` and assert on that.
- **Don't toggle "Real limit %" in a test.** It rewrites
  `~/.claude/settings.json`, which is machine-wide, and will clobber the
  user's real status line.
- **Record events, don't sample state.** An auto-peek lasts a few seconds, so
  checking whether the pill is visible some time later proves nothing either
  way. Listen for `reveal` and keep timestamps.

## Worktrees

`node_modules` is gitignored and runs to a few hundred MB with native modules,
so a fresh worktree has none. For a short-lived branch that doesn't touch
dependencies, symlink it; otherwise `npm ci`.

```bash
git worktree add ../vibecheck-foo -b foo
ln -s ../vibecheck/node_modules ../vibecheck-foo/node_modules
```

Run each worktree's copy with its own `--user-data-dir` so they don't fight
over the lock. The poke file and the desktop key binding stay global whatever
you do, so only one *interactive* copy at a time.
