// Cross-platform launcher. Hardened Linux setups (e.g. Ubuntu 24.04's
// AppArmor defaults) block both sandbox mechanisms Chromium can use, and it
// aborts before main.js even runs — so the opt-out has to happen out here on
// the command line. We only render local files, so this is a safe trade.
const { spawn } = require('child_process');
const electron = require('electron'); // path to the binary when required from node

const args = [
  __dirname,
  ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
  ...process.argv.slice(2),
];

spawn(electron, args, { stdio: 'inherit' }).on('exit', (code) => process.exit(code ?? 0));
