#!/usr/bin/env node
// vibecheck statusline shim — Claude Code runs this as its status line.
// It tees rate_limits (the real /usage percentages, which Claude Code hands
// to every statusline script) into <config>/limits.json for the pill, then
// defers to the user's original statusline command — or prints a minimal
// line of its own when there wasn't one. No credentials, no network.
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

  let chain = null;
  try {
    chain = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).statuslineChain || null;
  } catch (_) {}
  if (chain) {
    const { spawn } = require('child_process');
    const child = spawn(chain, { shell: true, stdio: ['pipe', 'inherit', 'inherit'] });
    child.stdin.end(input);
    child.on('error', () => process.exit(0));
    child.on('exit', (code) => process.exit(code || 0));
    return;
  }

  // no original statusline to hand off to — print a quiet one
  const seg = [];
  if (j.model && j.model.display_name) seg.push(j.model.display_name);
  if (j.workspace && j.workspace.current_dir) seg.push(path.basename(j.workspace.current_dir));
  const pct = (w) =>
    rl && rl[w] && typeof rl[w].used_percentage === 'number'
      ? Math.round(rl[w].used_percentage) + '%'
      : null;
  if (pct('five_hour')) seg.push('5h ' + pct('five_hour'));
  if (pct('seven_day')) seg.push('wk ' + pct('seven_day'));
  process.stdout.write('\x1b[2m' + seg.join(' · ') + '\x1b[0m');
});
