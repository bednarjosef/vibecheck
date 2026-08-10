#!/usr/bin/env node
// vibecheck statusline shim — Claude Code runs this as its status line.
// It tees rate_limits (the real /usage percentages, which Claude Code hands
// to every statusline script) into <config>/limits.json for the pill, then
// defers to the user's original statusline command.
//
// When there wasn't one, it prints the shortcut instead. Claude Code always
// reserves the status-line row once a status line is configured — printing
// nothing leaves it blank, not gone — so the row may as well say what the
// key is. No credentials, no network.
const fs = require('fs');
const os = require('os');
const path = require('path');

// same directory Electron resolves as userData for productName "vibecheck";
// the installer bakes the real path into argv[2], this is just the fallback
function defaultDir() {
  if (process.platform === 'win32')
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'vibecheck');
  if (process.platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'Application Support', 'vibecheck');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'vibecheck');
}
const dir = process.argv[2] || defaultDir();

let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  let j = {};
  try { j = JSON.parse(input); } catch (_) {}

  const rl = j.rate_limits; // Pro/Max only, appears after the session's first response
  if (rl) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = path.join(dir, 'limits.json.tmp');
      fs.writeFileSync(tmp, JSON.stringify({ ...rl, updated_at: Date.now() }));
      fs.renameSync(tmp, path.join(dir, 'limits.json')); // atomic — the app never reads a half-write
    } catch (_) {}
  }

  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  } catch (_) {}

  // whatever status line we displaced still owns the row — hand it over
  // untouched. (statuslineChain was the same command under an older key.)
  const chain =
    (config.statuslinePrev && config.statuslinePrev.command) || config.statuslineChain;

  if (typeof chain === 'string' && chain) {
    const { spawn } = require('child_process');
    const child = spawn(chain, { shell: true, stdio: ['pipe', 'inherit', 'inherit'] });
    child.stdin.on('error', () => {}); // chained command may exit without reading stdin
    child.stdin.end(input);
    child.on('error', () => process.exit(0));
    child.on('exit', (code) => process.exit(code || 0));
    return;
  }

  const key = config.shortcut && config.shortcut.label;
  if (key) process.stdout.write(`\x1b[2mpress ${key} to vibecheck\x1b[0m\n`);
});
