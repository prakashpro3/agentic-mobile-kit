// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const tmpDir = require('./tmp');

const SCRIPT = path.join(__dirname, '../stacks/react-native/template/scripts/amk/prebuild.sh');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const write = (dir, f, text, mode) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text, { mode }); };
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');

// an Expo app with stand-ins for the Expo CLI (prebuild edits the files the real one does, and logs each run)
// and for the fingerprint (a hash of app.json)
function expoApp() {
  const dir = tmpDir('amk-prebuild-');
  write(dir, 'package.json', `${JSON.stringify({ dependencies: { expo: '~57.0.27' }, scripts: { ios: 'expo start --ios' } }, null, 2)}\n`);
  write(dir, 'app.json', `${JSON.stringify({ expo: { name: 'Demo' } }, null, 2)}\n`);
  write(dir, '.gitignore', 'node_modules/\n/ios\n/android\nruns.log\n');
  write(dir, 'node_modules/expo/bin/fingerprint', `const h = require('crypto').createHash('sha1').update(require('fs').readFileSync('app.json')).digest('hex');
console.log(JSON.stringify({ hash: h, sources: [] }));
`);
  write(dir, 'node_modules/.bin/expo', `#!/bin/sh
echo "$*" >> runs.log
mkdir -p ios && echo generated > ios/Podfile
node -e 'const fs = require("fs"); const p = JSON.parse(fs.readFileSync("package.json")); p.scripts.ios = "expo run:ios"; fs.writeFileSync("package.json", JSON.stringify(p));'
echo "✔ Finished prebuild"
`, 0o755);
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'app');
  return dir;
}
const prebuild = dir => spawnSync('sh', [SCRIPT, 'ios'], { cwd: dir, encoding: 'utf8' });
const runs = dir => (fs.existsSync(path.join(dir, 'runs.log')) ? read(dir, 'runs.log').trim().split('\n').length : 0);

test('prebuild.sh: generates once, puts back the files prebuild edits, and runs again only when the app config changes', { skip: process.platform === 'win32' && 'fakes the expo command with a shell script' }, () => {
  const dir = expoApp();
  const first = prebuild(dir);
  assert.strictEqual(first.status, 0, first.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'ios/Podfile')));
  assert.strictEqual(git(dir, 'status', '--porcelain'), '', 'package.json is put back');
  assert.match(read(dir, 'runs.log'), /prebuild --platform ios --no-install/);

  assert.match(prebuild(dir).stdout, /ios\/ already matches the app config/);
  assert.strictEqual(runs(dir), 1, 'nothing changed: no second prebuild');

  // the team's own uncommitted change to app.json: prebuild runs, and the change stays
  write(dir, 'app.json', `${JSON.stringify({ expo: { name: 'Demo', ios: { infoPlist: { NSCameraUsageDescription: 'Scans receipts.' } } } }, null, 2)}\n`);
  const changed = prebuild(dir);
  assert.strictEqual(changed.status, 0, changed.stderr);
  assert.strictEqual(runs(dir), 2);
  assert.match(read(dir, 'app.json'), /Scans receipts/);
  assert.match(git(dir, 'status', '--porcelain'), /M app\.json/);
  assert.doesNotMatch(git(dir, 'status', '--porcelain'), /package\.json/);
});

test('prebuild.sh does nothing for apps that keep ios/ in git, or that aren\'t Expo apps', { skip: process.platform === 'win32' && 'fakes the expo command with a shell script' }, () => {
  const dir = expoApp();
  write(dir, 'ios/Podfile', 'committed\n');
  git(dir, 'add', '-f', 'ios/Podfile');
  assert.strictEqual(prebuild(dir).status, 0);
  assert.strictEqual(runs(dir), 0);

  const bare = expoApp();
  write(bare, 'package.json', '{"dependencies":{"react-native":"0.87.1"}}\n');
  assert.strictEqual(prebuild(bare).status, 0);
  assert.strictEqual(runs(bare), 0);
});
