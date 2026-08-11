// When installed via npm (unpackaged), register vibecheck as a real desktop
// app on first run: a launcher entry on Linux, an .app bundle on macOS, a
// Start Menu shortcut on Windows. Packaged installers do this themselves.
//
// "First run" also means the first run of each version. What gets written out
// here includes a copy of the icon, so a release that changes the icon has to
// be able to say so — otherwise an upgrade in place leaves the old one in the
// launcher forever, because neither path below moves when npm swaps the
// package contents underneath them.
const { app } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MARKER = () => path.join(app.getPath('userData'), 'integration.json');

function upToDate() {
  try {
    const m = JSON.parse(fs.readFileSync(MARKER(), 'utf8'));
    return (
      m.execPath === process.execPath &&
      m.appPath === app.getAppPath() &&
      m.version === app.getVersion()
    );
  } catch (_) {
    return false;
  }
}

function remember() {
  try {
    fs.mkdirSync(path.dirname(MARKER()), { recursive: true });
    fs.writeFileSync(
      MARKER(),
      JSON.stringify(
        { execPath: process.execPath, appPath: app.getAppPath(), version: app.getVersion() },
        null,
        2
      )
    );
  } catch (_) {}
}

function linux() {
  const iconDir = path.join(os.homedir(), '.local', 'share', 'icons');
  const appsDir = path.join(os.homedir(), '.local', 'share', 'applications');
  fs.mkdirSync(iconDir, { recursive: true });
  fs.mkdirSync(appsDir, { recursive: true });
  const icon = path.join(iconDir, 'vibecheck.png');
  fs.copyFileSync(path.join(app.getAppPath(), 'build', 'icon.png'), icon);
  fs.writeFileSync(
    path.join(appsDir, 'vibecheck.desktop'),
    `[Desktop Entry]\nType=Application\nName=vibecheck\n` +
      `Comment=Tap a key — your Claude usage and status\n` +
      `Exec="${process.execPath}" "${app.getAppPath()}" --no-sandbox\n` +
      `Icon=${icon}\nTerminal=false\nCategories=Utility;\nStartupNotify=false\n`
  );
}

function mac() {
  const contents = path.join(os.homedir(), 'Applications', 'vibecheck.app', 'Contents');
  fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(contents, 'Resources'), { recursive: true });
  const launcher = path.join(contents, 'MacOS', 'vibecheck');
  fs.writeFileSync(
    launcher,
    `#!/bin/bash\nexec "${process.execPath}" "${app.getAppPath()}" "$@"\n`
  );
  fs.chmodSync(launcher, 0o755);
  fs.copyFileSync(
    path.join(app.getAppPath(), 'build', 'icon.icns'),
    path.join(contents, 'Resources', 'icon.icns')
  );
  fs.writeFileSync(
    path.join(contents, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>vibecheck</string>
  <key>CFBundleIdentifier</key><string>com.bednarjosef.vibecheck</string>
  <key>CFBundleExecutable</key><string>vibecheck</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
</dict></plist>\n`
  );
}

function win() {
  const ico = path.join(app.getAppPath(), 'build', 'icon.ico');
  const script =
    `$ws = New-Object -ComObject WScript.Shell; ` +
    `$s = $ws.CreateShortcut([System.IO.Path]::Combine($env:APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'vibecheck.lnk')); ` +
    `$s.TargetPath = '${process.execPath}'; ` +
    `$s.Arguments = '"${app.getAppPath()}"'; ` +
    `$s.IconLocation = '${ico}'; ` +
    `$s.Description = "Tap a key - your Claude usage and status"; ` +
    `$s.Save()`;
  execFile('powershell', ['-NoProfile', '-Command', script], () => {});
}

function ensureDesktopIntegration() {
  if (app.isPackaged || upToDate()) return;
  try {
    if (process.platform === 'linux') linux();
    else if (process.platform === 'darwin') mac();
    else if (process.platform === 'win32') win();
    remember();
  } catch (err) {
    console.error('desktop integration failed:', err);
  }
}

module.exports = { ensureDesktopIntegration };
