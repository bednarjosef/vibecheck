// vibecheck — hold a key, see Claude's status. Let go, it melts away.
const { app, BrowserWindow, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { uIOhook, UiohookKey } = require('uiohook-napi');
const gnomeShortcut = require('./gnome-shortcut');

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

// ── shortcut key (persisted in <userData>/config.json) ──────────────
const KEY_CHOICES = ['F6', 'F7', 'F8', 'F9', 'F10', 'F12', 'ScrollLock', 'Pause'];
const GNOME_KEYSYM = { ScrollLock: 'Scroll_Lock' }; // where X names differ
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

let keyName = DEFAULT_KEY;
let holdKey = UiohookKey[DEFAULT_KEY];

function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (typeof c.key === 'string' && UiohookKey[c.key] !== undefined) {
      keyName = c.key;
      holdKey = UiohookKey[c.key];
    }
  } catch (_) {} // no config yet, or unreadable — stay on the default
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ key: keyName }, null, 2));
  } catch (err) {
    console.error('could not save config:', err);
  }
}

function installGnomeBinding() {
  return gnomeShortcut.install({
    binding: GNOME_KEYSYM[keyName] || keyName,
    // touching the poke file costs ~10ms per key event, which is what lets
    // tap/hold detection stay snappy (vs ~0.5s app spawns)
    command: `bash -c 'touch "\${XDG_RUNTIME_DIR:-/tmp}/vibecheck-poke"'`,
  });
}

async function setKey(name) {
  keyName = name;
  holdKey = UiohookKey[name];
  saveConfig();
  if (tray) tray.setToolTip(`vibecheck — ${keyName}: Claude status`);
  try {
    if (gnomeShortcut.isGnome() && (await gnomeShortcut.isInstalled())) {
      await installGnomeBinding(); // rebind the system shortcut too
    }
  } catch (err) {
    console.error('could not rebind GNOME shortcut:', err);
  }
  buildTrayMenu();
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
let holding = false;
let lastData = null;
let lastFetched = 0;
let visible = false;
let burstTimer = null;
let burstCount = 0;
let holdStartedAt = 0;
let suppressKeyup = false;

function show() {
  // always refetch on open — the cached state paints instantly and the live
  // response swaps in a beat later (2s guard so toggle-spam doesn't refetch)
  if (Date.now() - lastFetched > 2_000) fetchStatus();
  if (win && !win.isDestroyed()) win.webContents.send('reveal');
  visible = true;
}

function hide() {
  if (win && !win.isDestroyed()) win.webContents.send('conceal');
  visible = false;
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
    const [statusRes, componentsRes] = await Promise.all([
      fetch(STATUS_URL).then((r) => r.json()),
      fetch(COMPONENTS_URL).then((r) => r.json()),
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
    lastData = {
      indicator: watched.length
        ? deriveIndicator(components)
        : statusRes.status.indicator, // none | minor | major | critical
      description: statusRes.status.description,
      components,
      fetchedAt: Date.now(),
      error: false,
    };
    lastFetched = Date.now();
  } catch (err) {
    lastData = {
      indicator: 'unknown',
      description: 'Could not reach status.claude.com',
      components: [],
      fetchedAt: Date.now(),
      error: true,
    };
    lastFetched = Date.now();
  }
  if (win && !win.isDestroyed()) win.webContents.send('status', lastData);
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
  const wa = screen.getPrimaryDisplay().workArea;
  const [w] = win.getSize();
  win.setPosition(
    wa.x + Math.round((wa.width - w) / 2),
    wa.y + Math.round(wa.height * TOP_FRAC)
  );
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', () => {
    if (lastData) win.webContents.send('status', lastData);
  });
}

function createTray() {
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_PNG, 'base64'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip(`vibecheck — ${keyName}: Claude status`);
  buildTrayMenu();
}

async function buildTrayMenu() {
  const template = [
    { label: 'Show/hide status', click: () => toggle() },
    { label: 'Refresh now', click: () => fetchStatus() },
    {
      label: 'Shortcut key',
      submenu: KEY_CHOICES.map((k) => ({
        label: k,
        type: 'radio',
        checked: k === keyName,
        click: () => setKey(k).catch((err) => console.error(err)),
      })),
    },
  ];
  if (gnomeShortcut.isGnome()) {
    const installed = await gnomeShortcut.isInstalled();
    template.push({
      label: `Bind ${keyName} in GNOME`,
      type: 'checkbox',
      checked: installed,
      click: async () => {
        try {
          if (installed) await gnomeShortcut.uninstall();
          else await installGnomeBinding();
        } catch (err) {
          console.error('GNOME shortcut change failed:', err);
        }
        buildTrayMenu();
      },
    });
  }
  template.push({ type: 'separator' }, { label: 'Quit', click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

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
    fetchStatus();
    setInterval(fetchStatus, POLL_MS);
  });
}

app.on('will-quit', () => {
  try {
    uIOhook.stop();
  } catch (_) {}
});

// keep running with no visible windows (it's an overlay)
app.on('window-all-closed', (e) => e.preventDefault());
