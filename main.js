// vibecheck — hold a key, see Claude's status. Let go, it melts away.
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { uIOhook, UiohookKey } = require('uiohook-napi');
const gnomeShortcut = require('./gnome-shortcut');
const kdeShortcut = require('./kde-shortcut');
const { ensureDesktopIntegration } = require('./desktop-integration');
const usage = require('./usage');

// ── config ──────────────────────────────────────────────────────────
const DEFAULT_KEY = 'F8';         // change via tray → Shortcut key, or config.json
const POLL_MS = 60_000;           // background refresh interval
const TAP_MS = 350;               // key held shorter than this = tap (toggle); longer = hold
const RELEASE_MS = 1_000;         // slow pokes (process spawns): silence = key released
const TOP_FRAC = 0.1;             // panel sits this fraction down from the top of the screen

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

// ── settings (persisted in <userData>/config.json) ──────────────────
const KEY_CHOICES = ['F6', 'F7', 'F8', 'F9', 'F10', 'F12', 'ScrollLock', 'Pause'];
const GNOME_KEYSYM = { ScrollLock: 'Scroll_Lock' }; // where X names differ
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

const GLOW_STYLES = ['bottom', 'border', 'off'];
const SOUND_THEMES = ['bells', 'pluck', 'wood', 'piano'];

const settings = {
  key: DEFAULT_KEY,
  autoReveal: true,      // peek on its own when the status changes
  sound: false,          // chime on change
  soundTheme: 'bells',   // which voice the chimes use
  autostart: false,      // launch at login
  displayId: null,       // null = primary display
  glow: 'bottom',        // ambient light: bottom | border | off
  usage: true,           // show Claude Code usage (from its local transcripts)
  weeklyReset: null,     // { day: 0-6 Sun-Sat, hour: 0-23 } or null = rolling 7 days
  statuslineChain: null, // original statusline command the shim defers to
  statuslinePrev: null,  // original statusLine settings object, restored on disable
};
let holdKey = UiohookKey[DEFAULT_KEY];

function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (typeof c.key === 'string' && UiohookKey[c.key] !== undefined) settings.key = c.key;
    for (const k of ['autoReveal', 'sound', 'autostart']) {
      if (typeof c[k] === 'boolean') settings[k] = c[k];
    }
    if (typeof c.displayId === 'number') settings.displayId = c.displayId;
    if (GLOW_STYLES.includes(c.glow)) settings.glow = c.glow;
    if (SOUND_THEMES.includes(c.soundTheme)) settings.soundTheme = c.soundTheme;
    if (typeof c.usage === 'boolean') settings.usage = c.usage;
    if (
      c.weeklyReset &&
      Number.isInteger(c.weeklyReset.day) && c.weeklyReset.day >= 0 && c.weeklyReset.day <= 6 &&
      Number.isInteger(c.weeklyReset.hour) && c.weeklyReset.hour >= 0 && c.weeklyReset.hour <= 23
    ) {
      settings.weeklyReset = { day: c.weeklyReset.day, hour: c.weeklyReset.hour };
    }
    if (typeof c.statuslineChain === 'string') settings.statuslineChain = c.statuslineChain;
    if (c.statuslinePrev && typeof c.statuslinePrev === 'object') settings.statuslinePrev = c.statuslinePrev;
  } catch (_) {} // no config yet, or unreadable — stay on the defaults
  holdKey = UiohookKey[settings.key];
}

function sendChime(kind) {
  if (win && !win.isDestroyed()) win.webContents.send('chime', kind, settings.soundTheme);
}

function sendGlow() {
  if (win && !win.isDestroyed()) win.webContents.send('glow', settings.glow);
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
function shortcutProvider() {
  if (gnomeShortcut.isGnome()) {
    return {
      desktop: 'GNOME',
      mod: gnomeShortcut,
      binding: () => GNOME_KEYSYM[settings.key] || settings.key,
      // touching the poke file costs ~10ms per key event, which is what
      // lets tap/hold detection stay snappy (vs ~0.5s app spawns)
      command: `bash -c 'touch "\${XDG_RUNTIME_DIR:-/tmp}/vibecheck-poke"'`,
    };
  }
  if (kdeShortcut.isKde()) {
    return {
      desktop: 'KDE',
      mod: kdeShortcut,
      binding: () => settings.key,
      // .desktop Exec fields hate quoting, so bake the resolved path in
      command: `touch ${POKE_FILE}`,
    };
  }
  return null;
}

function installSystemBinding() {
  const p = shortcutProvider();
  if (!p) return Promise.resolve();
  return p.mod.install({ binding: p.binding(), command: p.command });
}

async function setKey(name) {
  if (UiohookKey[name] === undefined) return;
  settings.key = name;
  holdKey = UiohookKey[name];
  saveConfig();
  if (tray) tray.setToolTip(`vibecheck — ${settings.key}: Claude status`);
  try {
    const p = shortcutProvider();
    if (p && (await p.mod.isInstalled())) {
      await installSystemBinding(); // rebind the system shortcut too
    }
  } catch (err) {
    console.error('could not rebind system shortcut:', err);
  }
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

const TRAY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAiElEQVR4nO2W0RGAMAhD0Y1c' +
  'wKEcxKG6gCPpBEBC26N3kl9J8oq9U5FS6e/aIqbzuV/tWTsuKpMatoqjIPuMcmYeAmDLGZ8L' +
  'EC1H/SZAbzmSA9+BWVIBRp3ey1t3AwVQAOkA7FfNk5a37gZExm3BynE30Avh+aFXEIVAfPAd' +
  'YCHQ+fR/wlIpXR+EhjQo/gSTagAAAABJRU5ErkJggg==';

let win = null;
let tray = null;
let settingsWin = null;
let holding = false;
let lastData = null;
let lastFetched = 0;
let visible = false;
let prevIndicator = null;
let autoPeekTimer = null;
let burstTimer = null;
let burstCount = 0;
let holdStartedAt = 0;
let suppressKeyup = false;

// tokens read well at three digits max: 812 → 45k → 1.2M → 38M → 1.2B
function fmtTokens(n) {
  if (n >= 1e9) return (n >= 1e10 ? Math.round(n / 1e9) : parseFloat((n / 1e9).toFixed(1))) + 'B';
  if (n >= 1e6) return (n >= 1e7 ? Math.round(n / 1e6) : parseFloat((n / 1e6).toFixed(1))) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return String(n);
}

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
      settings.statuslineChain = typeof prev.command === 'string' ? prev.command : null;
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
  settings.statuslineChain = null;
  saveConfig();
  return { ok: true };
}

function readLimits() {
  try {
    const raw = JSON.parse(fs.readFileSync(LIMITS_PATH, 'utf8'));
    const now = Date.now();
    if (!raw.updated_at || now - raw.updated_at > LIMITS_STALE_MS) return null;
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

let lastUsageSent = '';

function sendUsage() {
  const local = settings.usage ? usage.summary(settings.weeklyReset) : null;
  const limits = settings.usage ? readLimits() : null;
  const data =
    local || limits ? { ...(local || { session: null, week: null }), limits } : null;
  if (win && !win.isDestroyed()) win.webContents.send('usage', data);
  const key = JSON.stringify(data);
  if (key !== lastUsageSent) {
    lastUsageSent = key;
    if (tray) buildTrayMenu(); // usage lines live in the tray menu too
  }
}

function refreshUsage() {
  if (!settings.usage) {
    sendUsage();
    return;
  }
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
  if (visible) return; // already on screen, the re-render is enough
  show(true);
  autoPeekTimer = setTimeout(() => {
    autoPeekTimer = null;
    if (!holding) hide(true);
  }, ms);
}

function positionWindow() {
  if (!win || win.isDestroyed()) return;
  const target =
    screen.getAllDisplays().find((d) => d.id === settings.displayId) ||
    screen.getPrimaryDisplay();
  const wa = target.workArea;
  const [w] = win.getSize();
  // the page has 30px of glow headroom above the pill — compensate so the
  // pill itself sits at TOP_FRAC
  win.setPosition(
    wa.x + Math.round((wa.width - w) / 2),
    Math.max(wa.y, wa.y + Math.round(wa.height * TOP_FRAC) - 24)
  );
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

async function fetchStatus() {
  try {
    const [statusRes, componentsRes, incidentsRes] = await Promise.all([
      fetch(STATUS_URL).then((r) => r.json()),
      fetch(COMPONENTS_URL).then((r) => r.json()),
      fetch(INCIDENTS_URL).then((r) => r.json()),
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
  if (win && !win.isDestroyed()) win.webContents.send('status', lastData);

  // react to changes (ignore network blips in either direction)
  const prev = prevIndicator;
  prevIndicator = lastData.indicator;
  if (prev && prev !== lastData.indicator && prev !== 'unknown' && lastData.indicator !== 'unknown') {
    const worse = INDICATOR.indexOf(lastData.indicator) > INDICATOR.indexOf(prev);
    if (settings.sound) sendChime(worse ? 'bad' : 'good');
    if (settings.autoReveal) autoPeek(worse ? 8_000 : 5_000);
  }
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
    if (lastData) win.webContents.send('status', lastData);
    sendGlow();
    refreshUsage(); // waits out any in-flight scan — never paints partial numbers
  });
}

function createTray() {
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_PNG, 'base64'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip(`vibecheck — ${settings.key}: Claude status`);
  buildTrayMenu();
}

function buildTrayMenu() {
  const template = [
    { label: 'Show/hide status', click: () => toggle() },
    { label: 'Refresh now', click: () => { fetchStatus(); refreshUsage(); } },
    { label: 'Settings…', click: () => openSettings() },
  ];
  const u = settings.usage ? usage.summary(settings.weeklyReset) : null;
  const lim = settings.usage ? readLimits() : null;
  if (u || lim) {
    const time = (ts) =>
      new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dayTime = (ts) =>
      new Date(ts).toLocaleDateString([], { weekday: 'short' }) + ' ' + time(ts);
    // real % (from the statusline shim) leads; local token counts follow
    const sess = [];
    if (lim && lim.session) sess.push(`${lim.session.pct}%`);
    if (u && u.session) sess.push(`${fmtTokens(u.session.tokens)} tokens`);
    const sessReset =
      (lim && lim.session && lim.session.resetAt) || (u && u.session && u.session.resetAt);
    const wk = [];
    if (lim && lim.week) wk.push(`${lim.week.pct}%`);
    if (u) wk.push(`${fmtTokens(u.week.tokens)} tokens`);
    const wkReset = (lim && lim.week && lim.week.resetAt) || (u && u.week.resetAt);
    template.push(
      { type: 'separator' },
      {
        label: sess.length
          ? `Session · ${sess.join(' · ')}` + (sessReset ? ` · resets ${time(sessReset)}` : '')
          : 'Session · idle',
        enabled: false,
      }
    );
    if (wk.length) {
      template.push({
        label:
          `Week · ${wk.join(' · ')}` +
          (wkReset
            ? ` · resets ${dayTime(wkReset)}`
            : lim && lim.week
              ? ''
              : ' · rolling 7 days'),
        enabled: false,
      });
    }
  }
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
    height: 880,
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
  settingsWin.on('closed', () => (settingsWin = null));
}

ipcMain.handle('settings:get', async () => {
  const p = shortcutProvider();
  return {
  settings,
  keyChoices: KEY_CHOICES,
  platform: process.platform,
  claude: {
    found: fs.existsSync(path.dirname(CLAUDE_SETTINGS)),
    limitsInstalled: limitsInstalled(),
  },
  systemBind: {
    available: !!p,
    desktop: p ? p.desktop : null,
    installed: p ? await p.mod.isInstalled() : false,
  },
  displays: screen.getAllDisplays().map((d) => ({
    id: d.id,
    label:
      `${d.label || 'Display'} — ${d.size.width}×${d.size.height}` +
      (d.id === screen.getPrimaryDisplay().id ? ' (primary)' : ''),
  })),
  };
});

ipcMain.handle('settings:set', async (_e, patch) => {
  if (typeof patch !== 'object' || !patch) return false;
  if ('key' in patch) await setKey(String(patch.key));
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
  if ('glow' in patch && GLOW_STYLES.includes(patch.glow)) {
    settings.glow = patch.glow;
    sendGlow();
  }
  if ('soundTheme' in patch && SOUND_THEMES.includes(patch.soundTheme)) {
    settings.soundTheme = patch.soundTheme;
    sendChime('open'); // instant preview
  }
  if ('usage' in patch) {
    settings.usage = !!patch.usage;
    refreshUsage();
  }
  if ('weeklyReset' in patch) {
    const w = patch.weeklyReset;
    settings.weeklyReset =
      w &&
      Number.isInteger(w.day) && w.day >= 0 && w.day <= 6 &&
      Number.isInteger(w.hour) && w.hour >= 0 && w.hour <= 23
        ? { day: w.day, hour: w.hour }
        : null;
    refreshUsage();
  }
  if ('systemBind' in patch) {
    try {
      const p = shortcutProvider();
      if (p) {
        if (patch.systemBind) await installSystemBinding();
        else await p.mod.uninstall();
      }
    } catch (err) {
      console.error('system shortcut change failed:', err);
    }
  }
  saveConfig();
  return true;
});

ipcMain.handle('limits:set', (_e, on) => {
  const r = on ? limitsInstall() : limitsUninstall();
  sendUsage(); // reflect the change in pill + tray right away
  return { ...r, installed: limitsInstalled() };
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
    console.error(
      'Could not start the global key hook.\n' +
        'On macOS: System Settings → Privacy & Security → Accessibility → allow your terminal/Electron.\n',
      err
    );
  }
}

// Launching a second instance just pokes the running one to peek — this is
// the Wayland-friendly path: bind a system shortcut to the same command.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  loadConfig();
  app.on('second-instance', () => pokeSlow());

  app.whenReady().then(() => {
    if (process.platform === 'darwin' && app.dock) app.dock.hide();
    createWindow();
    createTray();
    startHook();
    startPokeFile();
    calibrateRapidWindow();
    applyAutostart();
    ensureDesktopIntegration();
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(ev, positionWindow);
    }
    fetchStatus();
    setInterval(fetchStatus, POLL_MS);
    refreshUsage();
    setInterval(refreshUsage, POLL_MS);
    watchLimits();
    setTimeout(checkForUpdate, 15_000);
    setInterval(checkForUpdate, 24 * 60 * 60 * 1000);
  });
}

app.on('will-quit', () => {
  try {
    uIOhook.stop();
  } catch (_) {}
});

// keep running with no visible windows (it's an overlay)
app.on('window-all-closed', (e) => e.preventDefault());
