// Manage a KDE Plasma global shortcut that pokes vibecheck. Plasma's
// kglobalaccel binds keys to launcher entries: a hidden .desktop file plus a
// [services] entry in kglobalshortcutsrc. Works on Plasma 5 and 6, X11 and
// Wayland — the compositor grabs the key, so native Wayland apps are covered.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DESKTOP_ID = 'vibecheck-poke.desktop';
const DESKTOP_PATH = path.join(os.homedir(), '.local', 'share', 'applications', DESKTOP_ID);
const SHORTCUTS_RC = path.join(os.homedir(), '.config', 'kglobalshortcutsrc');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(stdout.trim())));
  });
}

// Plasma 6 ships *6 tool names, Plasma 5 ships *5 — try in order
async function runFirst(cmds) {
  let lastErr;
  for (const [cmd, args] of cmds) {
    try {
      return await run(cmd, args);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function isKde() {
  const desktop =
    process.env.ORIGINAL_XDG_CURRENT_DESKTOP ||
    process.env.XDG_CURRENT_DESKTOP ||
    '';
  return process.platform === 'linux' && /kde|plasma/i.test(desktop);
}

function isInstalled() {
  try {
    return (
      fs.existsSync(DESKTOP_PATH) &&
      fs.readFileSync(SHORTCUTS_RC, 'utf8').includes(DESKTOP_ID)
    );
  } catch (_) {
    return false;
  }
}

// kglobalaccel only rereads its config on startup; poke it over systemd,
// falling back to kquitapp (DBus activation restarts it on next use)
async function reloadDaemon() {
  try {
    await run('systemctl', ['--user', 'restart', 'plasma-kglobalaccel.service']);
  } catch (_) {
    try {
      await runFirst([
        ['kquitapp6', ['kglobalaccel']],
        ['kquitapp5', ['kglobalaccel']],
      ]);
    } catch (_) {} // best effort — worst case the binding applies next login
  }
}

async function install({ binding, command }) {
  fs.mkdirSync(path.dirname(DESKTOP_PATH), { recursive: true });
  fs.writeFileSync(
    DESKTOP_PATH,
    `[Desktop Entry]\nType=Application\nName=vibecheck peek\nExec=${command}\nNoDisplay=true\nStartupNotify=false\n`
  );
  const kwargs = [
    '--file', 'kglobalshortcutsrc',
    '--group', 'services',
    '--group', DESKTOP_ID,
    '--key', '_launch', binding,
  ];
  await runFirst([
    ['kwriteconfig6', kwargs],
    ['kwriteconfig5', kwargs],
  ]);
  await reloadDaemon();
}

async function uninstall() {
  fs.rmSync(DESKTOP_PATH, { force: true });
  const kwargs = [
    '--file', 'kglobalshortcutsrc',
    '--group', 'services',
    '--group', DESKTOP_ID,
    '--key', '_launch', '--delete',
  ];
  try {
    await runFirst([
      ['kwriteconfig6', kwargs],
      ['kwriteconfig5', kwargs],
    ]);
  } catch (_) {}
  await reloadDaemon();
}

module.exports = { isKde, isInstalled, install, uninstall };
