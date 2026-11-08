const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
if (process.platform !== 'darwin') throw Error('macOS required');
const root = path.resolve(__dirname, '..');
const dmg = path.join(root, 'dist', fs.readdirSync(path.join(root, 'dist')).find(name => name.endsWith('.dmg')));
const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'noliz-dmg-'));
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
run('hdiutil', ['verify', dmg]);
let attached = false;
try {
  run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg]); attached = true;
  const bundle = path.join(mount, 'Noliz.app');
  const exe = path.join(bundle, 'Contents/MacOS/Noliz');
  const architectures = run('lipo', ['-archs', exe]);
  if (!architectures.includes('x86_64') || !architectures.includes('arm64')) throw Error('Missing universal architecture: ' + architectures);
  if (fs.readlinkSync(path.join(mount, 'Applications')) !== '/Applications') throw Error('Missing Applications shortcut');
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle]);
  const minimumSystem = run('/usr/libexec/PlistBuddy', ['-c', 'Print :LSMinimumSystemVersion', path.join(bundle, 'Contents/Info.plist')]);
  execFileSync(process.execPath, [path.join(__dirname, 'mac-smoke.mjs'), exe], { cwd: root, stdio: 'inherit', timeout: 150000, env: { ...process.env, NOLIZ_QA_SCREENSHOT: '1' } });
  const result = { dmg: path.basename(dmg), architectures, minimumSystem, imageVerification: 'passed', applicationSignature: 'ad-hoc; no Apple Developer ID or notarization', mountedAppSmokeTest: 'passed', runnerArchitecture: process.arch };
  fs.writeFileSync(path.join(root, 'qa/macos-verification.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  if (attached) run('hdiutil', ['detach', mount]);
  fs.rmdirSync(mount);
}
