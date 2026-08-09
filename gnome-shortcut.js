// Manage a GNOME custom keybinding that pokes vibecheck (second-instance peek).
// GNOME grabs the key at the compositor, so this works even in Wayland-native
// apps where the X11 key hook can't see keystrokes; the trade is that the
// compositor swallows the key entirely — press-to-peek, not hold-to-peek.
const { execFile } = require('child_process');

const LIST_SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys';
const LIST_KEY = 'custom-keybindings';
const KB_PATH = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/vibecheck/';
const KB_SCHEMA = `org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:${KB_PATH}`;

function gsettings(...args) {
  return new Promise((resolve, reject) => {
    execFile('gsettings', args, (err, stdout) =>
      err ? reject(err) : resolve(stdout.trim())
    );
  });
}

// gsettings parses values as GVariant when they look quoted, so serialize
// strings explicitly instead of hoping the literal-text fallback kicks in.
function gvariantString(s) {
  return '"' + s.replace(/[\\"]/g, (c) => '\\' + c) + '"';
}

function isGnome() {
  return (
    process.platform === 'linux' &&
    /gnome/i.test(process.env.XDG_CURRENT_DESKTOP || '')
  );
}

async function getList() {
  const raw = await gsettings('get', LIST_SCHEMA, LIST_KEY);
  return [...raw.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

function setList(paths) {
  const value = paths.length
    ? `[${paths.map((p) => `'${p}'`).join(', ')}]`
    : '@as []';
  return gsettings('set', LIST_SCHEMA, LIST_KEY, value);
}

async function isInstalled() {
  try {
    return (await getList()).includes(KB_PATH);
  } catch {
    return false;
  }
}

async function install({ binding, command }) {
  await gsettings('set', KB_SCHEMA, 'name', gvariantString('vibecheck peek'));
  await gsettings('set', KB_SCHEMA, 'command', gvariantString(command));
  await gsettings('set', KB_SCHEMA, 'binding', gvariantString(binding));
  const list = await getList();
  if (!list.includes(KB_PATH)) await setList([...list, KB_PATH]);
}

async function uninstall() {
  await setList((await getList()).filter((p) => p !== KB_PATH));
  // clear the orphaned keys; harmless if dconf is missing
  await new Promise((resolve) =>
    execFile('dconf', ['reset', '-f', KB_PATH], () => resolve())
  );
}

module.exports = { isGnome, isInstalled, install, uninstall };
