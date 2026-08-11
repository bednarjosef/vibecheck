// vibecheck — hold a key, see Claude's status. Let go, it melts away.
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { uIOhook } = require('uiohook-napi');
const gnomeShortcut = require('./gnome-shortcut');
const kdeShortcut = require('./kde-shortcut');
const { ensureDesktopIntegration } = require('./desktop-integration');
const usage = require('./usage');
const keys = require('./keys');

// ── config ──────────────────────────────────────────────────────────
const POLL_MS = 60_000;           // background refresh interval
const TAP_MS = 350;               // key held shorter than this = tap (toggle); longer = hold
const RELEASE_MS = 1_000;         // slow pokes (process spawns): silence = key released
const EDGE_FRAC = 0.1;            // panel sits this fraction in from its screen edge

// Fast pokes: the GNOME binding just touches this file (~10ms), so the app
// sees key auto-repeat at its true ~30ms cadence and can use tight windows.
const POKE_FILE = path.join(process.env.XDG_RUNTIME_DIR || '/tmp', 'vibecheck-poke');
let rapidMs = 140; // > repeat interval = same key event train; recalibrated from gsettings
// ────────────────────────────────────────────────────────────────────

// Which components the pill cares about (substring match, case-insensitive).
// Claude API is included because Claude Code runs on it — an API incident is
// a Claude Code incident. Empty list = mirror the whole status page.
const WATCH = ['Claude Code', 'Claude API'];

const STATUS_URL = 'https://status.claude.com/api/v2/status.json';
const COMPONENTS_URL = 'https://status.claude.com/api/v2/components.json';
const INCIDENTS_URL = 'https://status.claude.com/api/v2/incidents/unresolved.json';

// A request with no deadline is the worst way to lose the status page: the
// promise never settles, so the poll never fails, so the pill never learns
// it can't see Claude and keeps showing the last good news indefinitely.
const FETCH_MS = 10_000;

// ── settings (persisted in <userData>/config.json) ──────────────────
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

const SOUND_THEMES = ['bells', 'pluck', 'wood', 'piano'];
const POSITIONS = ['top', 'bottom'];

const settings = {
  shortcut: keys.DEFAULT, // { code, keysym, label } — any key, recorded live
  autoReveal: true,      // peek on its own when the status changes
  sound: false,          // chime on change
  soundTheme: 'bells',   // which voice the chimes use
  autostart: false,      // launch at login
  displayId: null,       // null = primary display
  position: 'top',       // which edge the pill drops in from: top | bottom
  weekReset: null,       // a real weekly reset moment, learned from Claude Code
  statuslinePrev: null,  // the status line we displaced: the shim defers to
                         // its command, and disabling puts the object back
  limitsSetup: false,    // auto-setup ran (or the user chose) — don't re-decide for them
};
let holdKey = settings.shortcut.code;
let firstRun = false; // no config on disk: nobody has ever seen this app

function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const sc = keys.fromConfig(c.shortcut !== undefined ? c.shortcut : c.key);
    if (sc) settings.shortcut = sc;
    for (const k of ['autoReveal', 'sound', 'autostart', 'limitsSetup']) {
      if (typeof c[k] === 'boolean') settings[k] = c[k];
    }
    if (typeof c.displayId === 'number') settings.displayId = c.displayId;
    if (Number.isFinite(c.weekReset)) settings.weekReset = c.weekReset;
    if (SOUND_THEMES.includes(c.soundTheme)) settings.soundTheme = c.soundTheme;
    if (POSITIONS.includes(c.position)) settings.position = c.position;
    if (c.statuslinePrev && typeof c.statuslinePrev === 'object') settings.statuslinePrev = c.statuslinePrev;
  } catch (err) {
    // no config yet, or unreadable — stay on the defaults. A file that isn't
    // there is a first launch: worth saying hello about, and worth writing
    // one for right away, because the shim reads the shortcut's name out of
    // that file and until it exists has nothing to tell people to press.
    if (err.code === 'ENOENT') firstRun = true;
  }
  holdKey = settings.shortcut.code;
  if (firstRun) saveConfig();
}

function sendChime(kind) {
  if (win && !win.isDestroyed()) win.webContents.send('chime', kind, settings.soundTheme);
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('could not save config:', err);
  }
}

// the desktop's own shortcut system: covers native Wayland apps where the
// X11 key hook can't see keystrokes. GNOME via gsettings, KDE via kglobalaccel.
// Always on — there's no version of this app that's better off without it.
function shortcutProvider() {
  if (gnomeShortcut.isGnome()) {
    return {
      mod: gnomeShortcut,
      // touching the poke file costs ~10ms per key event, which is what
      // lets tap/hold detection stay snappy (vs ~0.5s app spawns)
      command: `bash -c 'touch "\${XDG_RUNTIME_DIR:-/tmp}/vibecheck-poke"'`,
    };
  }
  if (kdeShortcut.isKde()) {
    return {
      mod: kdeShortcut,
      // .desktop Exec fields hate quoting, so bake the resolved path in
      command: `touch ${POKE_FILE}`,
    };
  }
  return null;
}

// Keys we can't name in X terms (an unmapped board key) can't be handed to
// the desktop — the in-process hook still has them, so drop the stale
// binding rather than leave the old key wired up.
async function syncSystemBinding() {
  const p = shortcutProvider();
  if (!p) return;
  try {
    if (settings.shortcut.keysym) {
      await p.mod.install({ binding: settings.shortcut.keysym, command: p.command });
    } else if (await p.mod.isInstalled()) {
      await p.mod.uninstall();
    }
  } catch (err) {
    console.error('system shortcut sync failed:', err);
  }
}

async function setShortcut(sc) {
  settings.shortcut = sc;
  holdKey = sc.code;
  saveConfig();
  updateTray();
  await syncSystemBinding();
}

function applyAutostart() {
  if (process.platform === 'linux') {
    const file = path.join(app.getPath('appData'), 'autostart', 'vibecheck.desktop');
    try {
      if (settings.autostart) {
        const exec = app.isPackaged
          ? `"${process.execPath}" --no-sandbox`
          : `"${process.execPath}" "${app.getAppPath()}" --no-sandbox`;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(
          file,
          `[Desktop Entry]\nType=Application\nName=vibecheck\nComment=Claude status overlay\nExec=${exec}\nX-GNOME-Autostart-enabled=true\n`
        );
      } else {
        fs.rmSync(file, { force: true });
      }
    } catch (err) {
      console.error('could not update autostart entry:', err);
    }
  } else {
    app.setLoginItemSettings({ openAtLogin: settings.autostart });
  }
}

// worst watched component decides the headline word
const SEVERITY = {
  operational: 0,
  under_maintenance: 1,
  degraded_performance: 1,
  partial_outage: 2,
  major_outage: 3,
};
const INDICATOR = ['none', 'minor', 'major', 'critical'];

function deriveIndicator(components) {
  const worst = Math.max(...components.map((c) => SEVERITY[c.status] ?? 1));
  return INDICATOR[worst];
}

// ── the tray mark ───────────────────────────────────────────────────
// The pill's spark, cut down to sixteen pixels (assets/make-tray-icons.js),
// painted in the colour the pill would give the same news. The icon is the
// one piece of vibecheck that's always on screen, so it answers the question
// instead of sitting next to it — green means you'd have found nothing worth
// reading inside.
//
// Colour, not a template image, on macOS too: a template would flatten all
// five states into one silhouette, and the state is the whole point.
const trayImages = new Map();

function trayImage(indicator) {
  const state = INDICATOR.includes(indicator) ? indicator : 'unknown';
  if (!trayImages.has(state)) {
    // the @2x file next to it comes along by name — asking for one path
    // gets both, and the panel takes whichever its screen deserves
    trayImages.set(state, nativeImage.createFromPath(path.join(__dirname, 'assets', `tray-${state}.png`)));
  }
  return trayImages.get(state);
}

let win = null;
let winLoaded = false;
let tray = null;
let settingsWin = null;
let holding = false;
let hookFailed = false;
let lastData = null;
let lastUsage = null;
let lastFetched = 0;
let fetching = false;
let visible = false;
let prevIndicator = null;
let autoPeekTimer = null;
let burstTimer = null;
let burstCount = 0;
let holdStartedAt = 0;
let suppressKeyup = false;

// ── real limit % (opt-in Claude Code statusline shim) ───────────────
// Claude Code hands every statusline script the account's true /usage
// percentages (rate_limits.*.used_percentage — documented, Pro/Max).
// "Install" points ~/.claude/settings.json at our shim, which tees those
// numbers into <userData>/limits.json and defers to any original
// statusline. Nothing here touches credentials or the network.
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const SHIM_SRC = path.join(__dirname, 'statusline-shim.js');
const SHIM_DEST = path.join(app.getPath('userData'), 'statusline-shim.js');
const LIMITS_PATH = path.join(app.getPath('userData'), 'limits.json');
const LIMITS_STALE_MS = 14 * 24 * 60 * 60 * 1000; // shim gone quiet — forget its numbers

const isShimCommand = (sl) =>
  !!(sl && typeof sl.command === 'string' && sl.command.includes('statusline-shim'));

function readClaudeSettings() {
  let raw;
  try { raw = fs.readFileSync(CLAUDE_SETTINGS, 'utf8'); } catch (_) { return {}; } // no file yet is fine
  return JSON.parse(raw); // unparseable throws — callers abort rather than clobber
}

function limitsInstalled() {
  try { return isShimCommand(readClaudeSettings().statusLine); } catch (_) { return false; }
}

function limitsInstall() {
  let claude;
  try { claude = readClaudeSettings(); }
  catch (_) { return { ok: false, error: '~/.claude/settings.json is not valid JSON — fix it first' }; }

  try {
    // copy the shim out of the package: npm updates, dev checkouts and
    // AppImages all move or vanish; <userData> is the one stable home
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.copyFileSync(SHIM_SRC, SHIM_DEST);

    const prev = claude.statusLine;
    if (prev && !isShimCommand(prev)) {
      settings.statuslinePrev = prev; // restored on disable
      saveConfig();
    }

    // one-time safety copy from before we ever touched the file
    const backup = path.join(app.getPath('userData'), 'claude-settings.backup.json');
    if (!fs.existsSync(backup) && fs.existsSync(CLAUDE_SETTINGS)) {
      fs.copyFileSync(CLAUDE_SETTINGS, backup);
    }

    claude.statusLine = { type: 'command', command: `node "${SHIM_DEST}" "${app.getPath('userData')}"` };
    if (prev && prev.padding !== undefined) claude.statusLine.padding = prev.padding;
    fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
    fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(claude, null, 2) + '\n');
  } catch (err) {
    return { ok: false, error: 'install failed: ' + err.message };
  }
  return { ok: true };
}

function limitsUninstall() {
  let claude;
  try { claude = readClaudeSettings(); }
  catch (_) { return { ok: false, error: '~/.claude/settings.json is not valid JSON — fix it first' }; }
  learnWeekReset(); // last chance before the numbers go: keep the real week
  try {
    if (isShimCommand(claude.statusLine)) {
      if (settings.statuslinePrev) claude.statusLine = settings.statuslinePrev;
      else delete claude.statusLine;
      fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(claude, null, 2) + '\n');
    }
    fs.rmSync(LIMITS_PATH, { force: true });
  } catch (err) {
    return { ok: false, error: 'uninstall failed: ' + err.message };
  }
  settings.statuslinePrev = null;
  saveConfig();
  return { ok: true };
}

// default-on: first launch with Claude Code present wires the shim up by
// itself. Runs once — after that (or after any manual toggle) the choice
// is the user's and stays untouched. Failures stay quiet and retry next
// launch. When already installed, just keep the deployed shim current.
function autoSetupLimits() {
  if (!fs.existsSync(path.dirname(CLAUDE_SETTINGS))) return; // no Claude Code here
  if (limitsInstalled()) {
    try { fs.copyFileSync(SHIM_SRC, SHIM_DEST); } catch (_) {}
    if (!settings.limitsSetup) {
      settings.limitsSetup = true;
      saveConfig();
    }
    return;
  }
  if (settings.limitsSetup) return;
  if (limitsInstall().ok) {
    settings.limitsSetup = true;
    saveConfig();
    sendUsage();
  }
}

function readLimitsFile() {
  try {
    return JSON.parse(fs.readFileSync(LIMITS_PATH, 'utf8'));
  } catch (_) { return null; } // absent or malformed — pill falls back to token counts
}

function readLimits(raw = readLimitsFile()) {
  try {
    const now = Date.now();
    if (!raw || !raw.updated_at || now - raw.updated_at > LIMITS_STALE_MS) return null;
    const pick = (w) => {
      if (!w || typeof w.used_percentage !== 'number') return null;
      const resetAt = typeof w.resets_at === 'number' ? w.resets_at * 1000 : null;
      // window reset since Claude Code last reported — 0 until fresh data
      if (resetAt && now >= resetAt) return { pct: 0, resetAt: null };
      return { pct: Math.round(w.used_percentage), resetAt };
    };
    const session = pick(raw.five_hour);
    const week = pick(raw.seven_day);
    return session || week ? { session, week } : null;
  } catch (_) { return null; } // absent or malformed — pill falls back to token counts
}

function watchLimits() {
  let t = null;
  try {
    fs.watch(app.getPath('userData'), (_ev, name) => {
      if (name !== 'limits.json') return;
      clearTimeout(t);
      t = setTimeout(sendUsage, 250); // debounce the tmp+rename pair
    });
  } catch (_) {} // no watcher = the 60s poll still picks changes up
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_MS = 5 * 60 * 60 * 1000;

// Unlike the weekly one, the 5-hour window isn't worth remembering past the
// moment it lapses: it reopens whenever you next send a message, not on a
// fixed cadence. So it's used while Claude Code is reporting it, and the
// transcript replay takes over when it isn't.
function sessionWindow(limits) {
  const at = limits && limits.session && limits.session.resetAt;
  return Number.isFinite(at) ? { since: at - SESSION_MS, resetAt: at } : null;
}

// The account's weekly reset moment isn't in the transcripts — Claude Code
// only tells the shim. Once heard it's kept for good and stepped forward a
// week at a time, so the token counts stay on the real week even after Real
// limit % is switched off (or the shim goes quiet).
function weekWindow() {
  if (!Number.isFinite(settings.weekReset)) return null;
  const now = Date.now();
  let resetAt = settings.weekReset;
  while (resetAt <= now) resetAt += WEEK_MS;
  return { since: resetAt - WEEK_MS, resetAt };
}

// straight from the file, not readLimits(): a reset moment that has already
// passed is still a valid anchor (weekWindow walks it forward), and it's
// worth keeping even once the percentages themselves have gone stale
function learnWeekReset(raw = readLimitsFile()) {
  const secs = raw && raw.seven_day && raw.seven_day.resets_at;
  if (typeof secs !== 'number') return;
  const at = secs * 1000;
  // same moment in the weekly cadence = nothing new to learn
  if (Number.isFinite(settings.weekReset) && (at - settings.weekReset) % WEEK_MS === 0) return;
  settings.weekReset = at;
  saveConfig();
}

// Every 10% of a window, the pill announces itself. Marks are seeded the
// first time a window is seen, so launching the app at 43% says nothing —
// only a crossing does. resetAt identifies the window: when it changes the
// window has rolled, and the new one is seeded silently too.
const marks = { session: null, week: null };

// Same window, told apart by when it ends. Compared loosely on purpose: the
// shim rewrites the moment on every Claude Code reply, and a second of drift
// in that value must not read as "a new window" — that would reseed the mark
// and swallow the crossing silently.
const sameWindow = (a, b) =>
  a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 60_000);

function noteUsageMarks(limits) {
  for (const key of ['session', 'week']) {
    const w = limits && limits[key];
    if (!w || typeof w.pct !== 'number') {
      marks[key] = null;
      continue;
    }
    const seen = marks[key];
    const decile = Math.floor(w.pct / 10);
    marks[key] = { resetAt: w.resetAt, decile };
    // a decile can be crossed by more than one step at a time (a long reply
    // lands as one jump) — that's still one announcement, of where it landed
    if (seen && sameWindow(seen.resetAt, w.resetAt) && decile > seen.decile) announce(key, w.pct);
  }
}

function announce(window, pct) {
  if (!settings.autoReveal) return;
  if (win && !win.isDestroyed()) win.webContents.send('notice', { window, pct });
  autoPeek(6_000);
}

function sendUsage() {
  const raw = readLimitsFile(); // one read feeds both
  learnWeekReset(raw);
  const limits = readLimits(raw);
  const local = usage.summary(weekWindow(), sessionWindow(limits));
  const data =
    local || limits ? { ...(local || { session: null, week: null }), limits } : null;
  lastUsage = data;
  if (win && !win.isDestroyed()) win.webContents.send('usage', data);
  updateTray();
  noteUsageMarks(limits);
}

function refreshUsage() {
  usage.refresh().then(sendUsage);
}

function show(quiet = false) {
  // always refetch on open — the cached state paints instantly and the live
  // response swaps in a beat later (2s guard so toggle-spam doesn't refetch)
  if (Date.now() - lastFetched > 2_000) fetchStatus();
  refreshUsage();
  positionWindow(); // monitors may have changed since last time
  if (win && !win.isDestroyed()) {
    win.webContents.send('reveal');
    if (!quiet && settings.sound) sendChime('open');
  }
  visible = true;
}

function hide(quiet = false) {
  if (autoPeekTimer) {
    clearTimeout(autoPeekTimer);
    autoPeekTimer = null;
  }
  if (win && !win.isDestroyed()) {
    win.webContents.send('conceal');
    if (!quiet && settings.sound) sendChime('close');
  }
  visible = false;
}

// status changed on its own: pop in briefly, then melt away — quiet, the
// status-change chime is the soundtrack for this one
function autoPeek(ms) {
  // Already up because you asked for it: say the new thing, but don't take
  // the card away on a timer you didn't start. Up because of an earlier
  // peek: the new one gets its own full turn rather than inheriting the
  // remains of the old timer, or a milestone can flash past in a blink.
  if (visible && !autoPeekTimer) return;
  if (!visible) show(true);
  clearTimeout(autoPeekTimer);
  autoPeekTimer = setTimeout(() => {
    autoPeekTimer = null;
    if (!holding) hide(true);
  }, ms);
}

// An overlay nobody has seen yet is indistinguishable from one that never
// started: the tray icon is hidden by default on GNOME, the pill waits to be
// summoned, and the key is only a default until something says what it is.
// So the first launch introduces itself — once, then never again. It waits
// for the first status so the card arrives with something on it, and that
// wait is bounded by FETCH_MS whether or not the network answers.
function greet() {
  if (!firstRun || !winLoaded || !lastData) return;
  firstRun = false;
  if (win && !win.isDestroyed()) {
    win.webContents.send('notice', { text: `Press ${keys.name(settings.shortcut)} to vibecheck` });
  }
  autoPeek(6_000);
}

function positionWindow() {
  if (!win || win.isDestroyed()) return;
  const target =
    screen.getAllDisplays().find((d) => d.id === settings.displayId) ||
    screen.getPrimaryDisplay();
  const wa = target.workArea;
  const [w, h] = win.getSize();
  // the page keeps 30px of glow headroom on the pill's outer side —
  // compensate so the pill itself sits EDGE_FRAC in from its edge
  const inset = Math.round(wa.height * EDGE_FRAC) - 24;
  const y =
    settings.position === 'bottom'
      ? Math.min(wa.y + wa.height - h, wa.y + wa.height - h - inset)
      : Math.max(wa.y, wa.y + inset);
  win.setPosition(wa.x + Math.round((wa.width - w) / 2), y);
}

function sendPosition() {
  if (win && !win.isDestroyed()) win.webContents.send('position', settings.position);
}

function toggle() {
  visible ? hide() : show();
}

// ── fast pokes (file touches from the GNOME binding) ────────────────
// One touch per key event, auto-repeat included, ~10ms latency. Isolated
// poke = tap (toggle). A poke train at repeat cadence = held key: show for
// the duration, hide within ~rapidMs of release.
let lastPokeAt = 0;
let holdActive = false;
let releaseTimer = null;
let pendingHideTimer = null;

function pokeFast() {
  if (holding) return; // the in-process key hook already owns this press
  // a poke while recording means the desktop grabbed the key before either
  // channel could see it — which only the current shortcut does
  if (capture) {
    noteCapture(settings.shortcut);
    return;
  }
  const now = Date.now();
  const gap = now - lastPokeAt;
  lastPokeAt = now;
  if (gap < 20) return; // duplicate fs event for a single touch

  if (holdActive) {
    armRelease();
    return;
  }

  if (gap <= rapidMs && pendingHideTimer) {
    // the repeat train materialized — this is a held key, not a second tap
    clearTimeout(pendingHideTimer);
    pendingHideTimer = null;
    holdActive = true;
    armRelease();
    return;
  }

  if (!visible) {
    show();
    return;
  }

  // visible + isolated poke: a second tap — hide, unless a train follows
  if (pendingHideTimer) clearTimeout(pendingHideTimer);
  pendingHideTimer = setTimeout(() => {
    pendingHideTimer = null;
    hide();
  }, rapidMs);
}

function armRelease() {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    holdActive = false;
    hide();
  }, rapidMs);
}

function startPokeFile() {
  try {
    fs.closeSync(fs.openSync(POKE_FILE, 'a'));
    const watcher = fs.watch(POKE_FILE, (ev) => {
      if (ev === 'rename') {
        // file was replaced; re-arm on the new inode
        try { watcher.close(); } catch (_) {}
        setTimeout(startPokeFile, 200);
        return;
      }
      pokeFast();
    });
  } catch (err) {
    console.error('poke file watch failed:', err);
  }
}

// ── slow pokes (second-instance spawns, other desktops) ─────────────
// Same idea, but each poke costs an app spawn (~0.5s of jitter), so the
// windows have to be generous. A lone poke = tap; a burst = held key.
function pokeSlow() {
  if (holding) return;
  if (capture) {
    noteCapture(settings.shortcut);
    return;
  }
  if (burstTimer) {
    clearTimeout(burstTimer);
    burstCount++;
    armBurstEnd();
    return;
  }
  if (visible) {
    hide();
    return;
  }
  burstCount = 1;
  show();
  armBurstEnd();
}

function armBurstEnd() {
  burstTimer = setTimeout(() => {
    burstTimer = null;
    if (burstCount >= 2) hide(); // it was a hold — melt away on release
    burstCount = 0;
  }, RELEASE_MS);
}

const getJSON = (url) =>
  fetch(url, { signal: AbortSignal.timeout(FETCH_MS) }).then((r) => r.json());

async function fetchStatus() {
  // a poll and a summon can land together, and a slow answer shouldn't let
  // the interval stack requests behind it — one in flight is enough, and
  // whoever asked second gets the same result a moment later
  if (fetching) return;
  fetching = true;
  try {
    const [statusRes, componentsRes, incidentsRes] = await Promise.all([
      getJSON(STATUS_URL),
      getJSON(COMPONENTS_URL),
      getJSON(INCIDENTS_URL),
    ]);
    const all = componentsRes.components
      .filter((c) => !c.group)
      .sort((a, b) => a.position - b.position);
    const watched = WATCH.length
      ? all.filter((c) =>
          WATCH.some((w) => c.name.toLowerCase().includes(w.toLowerCase()))
        )
      : [];
    // if the watchlist matches nothing (component renamed upstream?), fall
    // back to the whole page rather than silently showing green
    const components = (watched.length ? watched : all)
      .slice(0, 8)
      .map((c) => ({ name: c.name, status: c.status }));
    // prefer the human-written incident title over raw component states —
    // scoped to the watchlist when one is set
    const incident =
      (incidentsRes.incidents || []).find(
        (i) =>
          !WATCH.length ||
          (i.components || []).some((ic) =>
            WATCH.some((w) => ic.name.toLowerCase().includes(w.toLowerCase()))
          )
      ) || null;
    lastData = {
      indicator: watched.length
        ? deriveIndicator(components)
        : statusRes.status.indicator, // none | minor | major | critical
      description: statusRes.status.description,
      components,
      incident: incident ? { name: incident.name, status: incident.status } : null,
      fetchedAt: Date.now(),
      error: false,
    };
    lastFetched = Date.now();
  } catch (err) {
    lastData = {
      indicator: 'unknown',
      description: 'Could not reach status.claude.com',
      components: [],
      incident: null,
      fetchedAt: Date.now(),
      error: true,
    };
    lastFetched = Date.now();
  }
  fetching = false;
  if (win && !win.isDestroyed()) win.webContents.send('status', lastData);
  updateTray();
  greet(); // the card has something to say now

  // react to changes — a change in Claude's health, and separately losing
  // sight of it, which is a different kind of news and reads on its own path
  const prev = prevIndicator;
  prevIndicator = lastData.indicator;
  if (prev && prev !== lastData.indicator && prev !== 'unknown' && lastData.indicator !== 'unknown') {
    const worse = INDICATOR.indexOf(lastData.indicator) > INDICATOR.indexOf(prev);
    if (settings.sound) sendChime(worse ? 'bad' : 'good');
    if (settings.autoReveal) autoPeek(worse ? 8_000 : 5_000);
  }
  noteReachability(lastData.indicator === 'unknown');
}

// Losing status.claude.com is worth saying — but not on the first missed
// poll, or the pill would let itself in over a wifi hiccup. Two in a row is
// an outage rather than a blip. The recovery is announced too: a card that
// says it can't see Claude and then never takes it back is worse than one
// that never spoke up.
const OFFLINE_POLLS = 2;
let misses = 0;
let toldOffline = false;

function noteReachability(offline) {
  misses = offline ? misses + 1 : 0;
  if (offline === toldOffline) return;
  if (offline && misses < OFFLINE_POLLS) return;
  toldOffline = offline;
  if (settings.sound) sendChime(offline ? 'bad' : 'good');
  if (settings.autoReveal) autoPeek(offline ? 6_000 : 5_000);
}

function createWindow() {
  win = new BrowserWindow({
    width: 560,
    height: 240,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true); // click-through: it's a ghost
  positionWindow();
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', () => {
    winLoaded = true;
    if (lastData) win.webContents.send('status', lastData);
    sendPosition();
    refreshUsage(); // waits out any in-flight scan — never paints partial numbers
    greet(); // there's a page to say it on now
  });
}

function createTray() {
  tray = new Tray(trayImage(trayIndicator));
  buildTrayMenu();
  updateTray();
}

// ── what the tray says ──────────────────────────────────────────────
// The icon has the health, in its colour. The two figures go on both of the
// surfaces underneath it — the tooltip, and a header line in the menu —
// because the app-indicator shells GNOME needs for a tray at all drop
// tooltips on the floor, and that's precisely where the icon is hardest to
// do without.
let trayLine = '';
let trayIndicator = 'unknown'; // grey until the first status lands

function updateTray() {
  if (!tray) return;
  const indicator = (lastData && lastData.indicator) || 'unknown';
  if (indicator !== trayIndicator) {
    trayIndicator = indicator;
    tray.setImage(trayImage(indicator));
  }
  const line = usage.summaryLine(lastUsage);
  const lines = [`vibecheck — tap ${keys.name(settings.shortcut)}`];
  if (line) lines.push(line);
  if (lastData) {
    // Windows truncates a tooltip at 127 characters, and an incident title
    // can run long enough to eat the lines above it
    const health = (lastData.incident && lastData.incident.name) || lastData.description;
    lines.push(health.length > 60 ? health.slice(0, 59) + '…' : health);
  }
  // Everywhere else a desktop-level binding stands in for a dead hook. On
  // macOS it's the only way in, so a hook that never started means the key
  // does nothing at all, and this is the last place left to say so.
  if (hookFailed && process.platform === 'darwin') {
    lines.push('key needs Accessibility permission');
  }
  tray.setToolTip(lines.join('\n'));
  if (line !== trayLine) {
    trayLine = line; // rebuilding the menu on every poll would flicker the icon
    buildTrayMenu();
  }
}

function buildTrayMenu() {
  const template = [];
  if (trayLine) template.push({ label: trayLine, enabled: false }, { type: 'separator' });
  template.push(
    { label: 'Show/hide status', click: () => toggle() },
    { label: 'Settings…', click: () => openSettings() }
  );
  if (updateAvailable) {
    template.push({ type: 'separator' });
    template.push({
      label: `Update available — v${updateAvailable}`,
      click: () => shell.openExternal('https://github.com/bednarjosef/vibecheck/releases'),
    });
  }
  template.push({ type: 'separator' }, { label: 'Quit', click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

// npm can't auto-update a global package, but we can at least notice
let updateAvailable = null;

async function checkForUpdate() {
  try {
    const res = await fetch('https://registry.npmjs.org/vibecheck-app/latest');
    const { version } = await res.json();
    const newer = (a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
      }
      return false;
    };
    if (version && newer(version, app.getVersion()) && version !== updateAvailable) {
      updateAvailable = version;
      buildTrayMenu();
    }
  } catch (_) {} // offline or unpublished — never bother the user
}

// ── settings window ─────────────────────────────────────────────────
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 430,
    height: 560, // the page measures itself and corrects this on load
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
    },
  });
  settingsWin.loadFile('settings.html');
  settingsWin.on('closed', () => {
    settingsWin = null;
    endCapture('cancel'); // closing mid-recording gives the key back
  });
}

ipcMain.handle('settings:get', async () => ({
  settings: { ...settings, shortcut: { ...settings.shortcut, label: keys.name(settings.shortcut) } },
  platform: process.platform,
  claude: {
    found: fs.existsSync(path.dirname(CLAUDE_SETTINGS)),
    limitsInstalled: limitsInstalled(),
  },
  displays: screen.getAllDisplays().map((d) => ({
    id: d.id,
    label:
      `${d.label || 'Display'} — ${d.size.width}×${d.size.height}` +
      (d.id === screen.getPrimaryDisplay().id ? ' (primary)' : ''),
  })),
}));

ipcMain.handle('settings:set', async (_e, patch) => {
  if (typeof patch !== 'object' || !patch) return false;
  if ('autoReveal' in patch) settings.autoReveal = !!patch.autoReveal;
  if ('sound' in patch) settings.sound = !!patch.sound;
  if ('autostart' in patch) {
    settings.autostart = !!patch.autostart;
    applyAutostart();
  }
  if ('displayId' in patch) {
    settings.displayId = typeof patch.displayId === 'number' ? patch.displayId : null;
    positionWindow();
  }
  if ('soundTheme' in patch && SOUND_THEMES.includes(patch.soundTheme)) {
    settings.soundTheme = patch.soundTheme;
    sendChime('open'); // instant preview
  }
  if ('position' in patch && POSITIONS.includes(patch.position)) {
    settings.position = patch.position;
    sendPosition();
    positionWindow();
    show(true); // preview it where it now lives
  }
  saveConfig();
  return true;
});

// ── recording a shortcut ────────────────────────────────────────────
// Two channels see a keypress and either can be the only one: the global
// hook knows the keycode the pill will match on, the settings window sees
// the key even where the hook is blind, and on a desktop that already grabs
// the current key neither fires — a poke arrives instead. Whichever speaks
// first wins the race, then we wait a beat for the other to fill in the rest.
let capture = null;

const CAPTURE_MS = 10_000;

function beginCapture() {
  endCapture('cancel'); // a second click just restarts the recording
  return new Promise((resolve) => {
    capture = { resolve, hit: null, timer: null };
    capture.timer = setTimeout(() => endCapture('timeout'), CAPTURE_MS);
  });
}

function noteCapture(hit) {
  if (!capture || !hit) return;
  const prev = capture.hit;
  // a second, different keycode is a second key press — the first one wins
  if (prev && prev.code && hit.code && prev.code !== hit.code) return;
  capture.hit = keys.merge(prev, hit);
  clearTimeout(capture.timer);
  // with a keycode in hand there's little left to wait for; without one,
  // give the slower channel room to supply it
  capture.timer = setTimeout(() => endCapture('done'), capture.hit.code ? 140 : 400);
}

function endCapture(reason) {
  if (!capture) return;
  const { resolve, timer, hit } = capture;
  clearTimeout(timer);
  capture = null;
  resolve({ hit, reason });
}

ipcMain.handle('key:capture', async () => {
  const { hit, reason } = await beginCapture();
  const current = { label: keys.name(settings.shortcut), note: null };
  if (!hit) {
    // nothing arrived on either channel: something upstream ate the key
    return reason === 'timeout'
      ? { ...current, note: 'no key came through — your desktop may own it already' }
      : current;
  }
  if (!hit.code) {
    return { ...current, note: `“${keys.name(hit)}” never reaches vibecheck — try another key` };
  }
  if (hit.code === settings.shortcut.code) return current;
  await setShortcut(hit);
  return {
    label: keys.name(hit),
    note:
      hit.keysym || !shortcutProvider()
        ? null
        : 'set — but your desktop can’t bind this one for other apps',
  };
});

ipcMain.on('key:capture:dom', (_e, dom) => {
  if (!capture || !dom) return;
  noteCapture(keys.fromDom(String(dom.code || ''), String(dom.key || '')));
});

ipcMain.on('key:capture:cancel', () => endCapture('cancel'));

ipcMain.handle('limits:set', (_e, on) => {
  const r = on ? limitsInstall() : limitsUninstall();
  settings.limitsSetup = true; // an explicit choice — auto-setup stands down
  saveConfig();
  sendUsage(); // reflect the change in the pill right away
  return { ...r, installed: limitsInstalled() };
});

// the page knows its own height; the panel's 30px glow margin is ours
ipcMain.on('settings:fit', (_e, height) => {
  if (!settingsWin || settingsWin.isDestroyed()) return;
  const h = Math.round(Number(height) || 0);
  if (h > 0) settingsWin.setContentSize(430, Math.min(900, h + 60));
});

ipcMain.on('settings:close', () => {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
});

// widen the rapid window for people who slowed their key repeat down
function calibrateRapidWindow() {
  if (process.platform !== 'linux') return;
  execFile(
    'gsettings',
    ['get', 'org.gnome.desktop.peripherals.keyboard', 'repeat-interval'],
    (err, out) => {
      const m = String(out || '').match(/(\d+)\s*$/);
      if (!err && m) rapidMs = Math.max(140, Number(m[1]) * 2 + 50);
    }
  );
}

function startHook() {
  uIOhook.on('keydown', (e) => {
    if (capture) {
      noteCapture(keys.fromCode(e.keycode));
      return; // recording a new shortcut — nothing peeks meanwhile
    }
    if (e.keycode !== holdKey || holding) return; // ignore OS key-repeat
    holding = true;
    if (visible) {
      hide(); // pressing while open always closes
      suppressKeyup = true;
      return;
    }
    holdStartedAt = Date.now();
    show();
  });
  uIOhook.on('keyup', (e) => {
    if (e.keycode !== holdKey) return;
    holding = false;
    if (suppressKeyup) {
      suppressKeyup = false;
      return;
    }
    if (Date.now() - holdStartedAt >= TAP_MS) hide(); // hold: close on release
    // tap: stays open until the next tap
  });
  try {
    uIOhook.start();
  } catch (err) {
    hookFailed = true;
    updateTray();
    console.error(
      'Could not start the global key hook.\n' +
        'On macOS: System Settings → Privacy & Security → Accessibility → allow your terminal/Electron.\n',
      err
    );
  }
}

// GNOME hides tray icons unless an extension puts them back, so settings
// need a door that doesn't go through the tray: `vibecheck --settings`
const wantsSettings = (argv) => argv.includes('--settings');

// Launching a second instance just pokes the running one to peek — this is
// the Wayland-friendly path: bind a system shortcut to the same command.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  loadConfig();
  app.on('second-instance', (_e, argv) =>
    wantsSettings(argv) ? openSettings() : pokeSlow()
  );

  app.whenReady().then(() => {
    if (process.platform === 'darwin' && app.dock) app.dock.hide();
    createWindow();
    createTray();
    startHook();
    startPokeFile();
    calibrateRapidWindow();
    applyAutostart();
    ensureDesktopIntegration();
    syncSystemBinding(); // the desktop-level binding is part of the deal
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(ev, positionWindow);
    }
    fetchStatus();
    setInterval(fetchStatus, POLL_MS);
    autoSetupLimits();
    refreshUsage();
    setInterval(refreshUsage, POLL_MS);
    watchLimits();
    setTimeout(checkForUpdate, 15_000);
    setInterval(checkForUpdate, 24 * 60 * 60 * 1000);
    if (wantsSettings(process.argv)) openSettings();
  });
}

app.on('will-quit', () => {
  try {
    uIOhook.stop();
  } catch (_) {}
});

// keep running with no visible windows (it's an overlay)
app.on('window-all-closed', (e) => e.preventDefault());
