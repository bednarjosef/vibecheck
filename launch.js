#!/usr/bin/env node
// Cross-platform launcher. Hardened Linux setups (e.g. Ubuntu 24.04's
// AppArmor defaults) block both sandbox mechanisms Chromium can use, and it
// aborts before main.js even runs — so the opt-out has to happen out here on
// the command line. We only render local files, so this is a safe trade.
//
// By default the app detaches: `vibecheck` returns your prompt immediately
// and survives the terminal closing. Use --foreground (or --fg) to stay
// attached with logs, for debugging.
const { spawn } = require('child_process');
const electron = require('electron'); // path to the binary when required from node

const argv = process.argv.slice(2);
// --restore-statusline has something to say and then exits, so it stays
// attached whether you asked for that or not
const foreground =
  argv.includes('--foreground') || argv.includes('--fg') || argv.includes('--restore-statusline');
const passthrough = argv.filter((a) => a !== '--foreground' && a !== '--fg');

const args = [
  __dirname,
  ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
  ...passthrough,
];

// Terminals that live inside an Electron app can export this, and it tells
// the binary we just resolved to behave as plain node — which runs main.js
// with no `app` object and kills it on the first line. Detached, with stdio
// thrown away, that failure is completely silent.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

if (foreground) {
  spawn(electron, args, { env, stdio: 'inherit' }).on('exit', (code) => process.exit(code ?? 0));
} else {
  spawn(electron, args, { env, detached: true, stdio: 'ignore' }).unref();
}
