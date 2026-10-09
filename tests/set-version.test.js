// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const tmpDir = require('./tmp');

const SCRIPT = path.join(__dirname, '../stacks/react-native/template/scripts/ai/set-version.sh');
const PBX = 'ios/Demo.xcodeproj/project.pbxproj';
const GRADLE = 'android/app/build.gradle';

// an app whose targets and flavors carry the given version names
function app(iosVersions, androidVersions) {
  const dir = tmpDir('amk-version-');
  fs.mkdirSync(path.join(dir, 'ios/Demo.xcodeproj'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'android/app'), { recursive: true });
  const configs = iosVersions.map((v, i) => `  C${i} = { MARKETING_VERSION = ${v}; CURRENT_PROJECT_VERSION = 3; };`);
  fs.writeFileSync(path.join(dir, PBX), `// !$*UTF8*$!\n{\n${configs.join('\n')}\n}\n`);
  const flavors = androidVersions.map((v, i) => `    f${i} { versionCode 3\n      versionName "${v}" }`);
  fs.writeFileSync(path.join(dir, GRADLE), `android {\n  productFlavors {\n${flavors.join('\n')}\n  }\n}\n`);
  return dir;
}
const run = (dir, v) => spawnSync('sh', [SCRIPT, v], { cwd: dir, encoding: 'utf8' });
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');

test('sets the version name on both platforms and leaves build numbers alone', () => {
  const dir = app(['1.0', '1.0'], ['1.0']);
  const r = run(dir, '1.4.0');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(read(dir, PBX).match(/MARKETING_VERSION = 1\.4\.0;/g).length, 2);
  assert.match(read(dir, PBX), /CURRENT_PROJECT_VERSION = 3;/);
  assert.match(read(dir, GRADLE), /versionName "1\.4\.0"/);
  assert.match(read(dir, GRADLE), /versionCode 3/);
});

test('a project with several apps is left for a person to decide', () => {
  const dir = app(['7.1', '6.1'], ['1.1.3']);
  const r = run(dir, '7.2');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /several app versions/);
  assert.match(read(dir, PBX), /MARKETING_VERSION = 7\.1;/);
});

test('rejects something that is not a version', () => {
  const r = run(app(['1.0'], ['1.0']), 'v1.4');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /usage/);
});

test('Expo apps without native folders: sets expo.version in app.json, keeping its layout', () => {
  const dir = tmpDir('amk-version-');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { expo: '~57.0.27', 'react-native': '0.86.3' } }));
  const appJson = '{\n    "expo": {\n        "name": "Demo",\n        "version": "1.0.0",\n        "ios": { "buildNumber": "7" }\n    }\n}\n';
  fs.writeFileSync(path.join(dir, 'app.json'), appJson);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const r = run(dir, '1.4.0');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Version 1\.4\.0 set in app\.json/);
  const json = JSON.parse(read(dir, 'app.json'));
  assert.strictEqual(json.expo.version, '1.4.0');
  assert.strictEqual(json.expo.ios.buildNumber, '7', 'build numbers are left alone');
  assert.match(read(dir, 'app.json'), /^ {4}"expo"/m, 'keeps the 4-space indent');

  fs.writeFileSync(path.join(dir, 'app.config.ts'), 'export default ({ config }) => ({ ...config, version: process.env.APP_VERSION });\n');
  const computed = run(dir, '1.5.0');
  assert.strictEqual(computed.status, 1);
  assert.match(computed.stderr, /computes its config in app\.config\.ts: set the version there by hand/);
});
