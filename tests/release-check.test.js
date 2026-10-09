// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const tmpDir = require('./tmp');

const SCRIPT = path.join(__dirname, '../stacks/react-native/template/scripts/ai/release-check.js');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const write = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
const commit = (dir, msg) => { git(dir, 'add', '-A'); git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', msg); };

const pbx = (version, build) => `/* Begin XCBuildConfiguration section */
  INFOPLIST_FILE = Demo/Info.plist;
  MARKETING_VERSION = ${version};
  CURRENT_PROJECT_VERSION = ${build};
  /* PrivacyInfo.xcprivacy in Resources */
`;
const plist = (keys = { NSLocationWhenInUseUsageDescription: 'Shows nearby sites on the map.' }, arbitrary = false) => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
${Object.entries(keys).map(([k, v]) => `  <key>${k}</key>\n  <string>${v}</string>`).join('\n')}
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsArbitraryLoads</key><${arbitrary}/></dict>
</dict></plist>
`;
const gradle = (code, name, release = 'minifyEnabled false') => `android {
  defaultConfig {
    versionCode ${code}
    versionName "${name}"
  }
  signingConfigs { release { storeFile file('upload.keystore') } }
  buildTypes {
    debug { signingConfig signingConfigs.debug }
    release { ${release} }
  }
}
`;
const manifest = (perms = ['INTERNET']) => `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
${perms.map(p => `  <uses-permission android:name="android.permission.${p}" />`).join('\n')}
</manifest>
`;

// a released app (tagged v1.0.0), then an optional change on top
function app(change = {}) {
  const dir = tmpDir('amk-release-');
  const files = {
    'package.json': JSON.stringify({ name: 'demo', dependencies: { 'react-native': '0.87.1' } }),
    'ios/Demo.xcodeproj/project.pbxproj': pbx('1.0', 1),
    'ios/Demo/Info.plist': plist(),
    'ios/Demo/PrivacyInfo.xcprivacy': '<plist/>',
    'android/app/build.gradle': gradle(1, '1.0'),
    'android/app/src/main/AndroidManifest.xml': manifest(),
    'src/index.js': 'export default 1;\n',
  };
  for (const [f, t] of Object.entries(files)) write(dir, f, t);
  git(dir, 'init', '-q');
  commit(dir, 'release 1.0');
  git(dir, 'tag', 'v1.0.0');
  for (const [f, t] of Object.entries(change)) write(dir, f, t);
  return dir;
}
const check = dir => {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
  return { out: r.stdout, code: r.status };
};
const bumped = { 'ios/Demo.xcodeproj/project.pbxproj': pbx('1.1', 2), 'android/app/build.gradle': gradle(2, '1.1') };

test('no version bump since the last tag: warnings, not a failure', () => {
  const { out, code } = check(app({ 'src/index.js': 'export default 2;\n' }));
  assert.match(out, /compared with v1\.0\.0/);
  assert.match(out, /! iOS build number unchanged/);
  assert.match(out, /! Android build number unchanged/);
  assert.strictEqual(code, 0);
});

test('a proper bump on both platforms passes', () => {
  const { out, code } = check(app(bumped));
  assert.match(out, /✓ iOS build number \(1 → 2\)/);
  assert.match(out, /✓ Android version \(1\.0 → 1\.1\)/);
  assert.match(out, /0 problem\(s\)/);
  assert.strictEqual(code, 0);
});

test('a build number that goes down fails', () => {
  const dir = app();
  write(dir, 'android/app/build.gradle', gradle(5, '1.0'));
  commit(dir, 'bump');
  git(dir, 'tag', 'v1.0.1');
  write(dir, 'android/app/build.gradle', gradle(3, '1.1'));
  const { out, code } = check(dir);
  assert.match(out, /✗ Android build number went down \(5 → 3\)/);
  assert.strictEqual(code, 1);
});

test('missing or placeholder permission texts fail when a library needs them, and only warn otherwise', () => {
  const missing = check(app({ ...bumped, 'package.json': JSON.stringify({ dependencies: { 'react-native-vision-camera': '5.2.2' } }) }));
  assert.match(missing.out, /✗ ios\/Demo\/Info\.plist: missing permission texts: NSCameraUsageDescription \(react-native-vision-camera\)/);
  assert.strictEqual(missing.code, 1);

  const geo = JSON.stringify({ dependencies: { 'react-native-geolocation-service': '5.3.1' } });
  const placeholder = check(app({ ...bumped, 'package.json': geo, 'ios/Demo/Info.plist': plist({ NSLocationWhenInUseUsageDescription: 'TODO' }) }));
  assert.match(placeholder.out, /✗ ios\/Demo\/Info\.plist: NSLocationWhenInUseUsageDescription is a placeholder \("TODO"\)/);
  assert.strictEqual(placeholder.code, 1);

  // React Native's template ships an empty location text; with no library asking for location it only warns
  const unused = check(app({ ...bumped, 'ios/Demo/Info.plist': plist({ NSLocationWhenInUseUsageDescription: '' }) }));
  assert.match(unused.out, /! ios\/Demo\/Info\.plist: NSLocationWhenInUseUsageDescription is empty/);
  assert.strictEqual(unused.code, 0);
});

test('with several app targets, a text that only one of them has is a warning', () => {
  const { out, code } = check(app({
    ...bumped,
    'package.json': JSON.stringify({ dependencies: { 'react-native-nfc-manager': '3.17.2' } }),
    'ios/Demo.xcodeproj/project.pbxproj': pbx('1.1', 2) + '  INFOPLIST_FILE = Demo/Info-kiosk.plist;\n',
    'ios/Demo/Info.plist': plist({ NFCReaderUsageDescription: 'Reads visitor badges.' }),
    'ios/Demo/Info-kiosk.plist': plist({}),
  }));
  assert.match(out, /! ios\/Demo\/Info-kiosk\.plist: no NFCReaderUsageDescription, which ios\/Demo\/Info\.plist has/);
  assert.strictEqual(code, 0);
});

test('new sensitive Android permissions since the last release are flagged', () => {
  const { out } = check(app({ ...bumped, 'android/app/src/main/AndroidManifest.xml': manifest(['INTERNET', 'CAMERA']) }));
  assert.match(out, /! New Android permissions since v1\.0\.0: android\.permission\.CAMERA/);
});

test('debuggable release fails; debug-key signing is noted; arbitrary loads warn; signingConfigs.release is ignored', () => {
  const debuggable = check(app({ ...bumped, 'android/app/build.gradle': gradle(2, '1.1', 'debuggable true') }));
  assert.match(debuggable.out, /✗ Android release build is debuggable/);
  assert.strictEqual(debuggable.code, 1);

  const debugKey = check(app({ ...bumped, 'android/app/build.gradle': gradle(2, '1.1', 'signingConfig signingConfigs.debug') }));
  assert.match(debugKey.out, /· build\.gradle signs release builds with the debug key/);

  const clean = check(app(bumped));
  assert.doesNotMatch(clean.out, /debuggable|debug key|NSAllowsArbitraryLoads/);

  const ats = check(app({ ...bumped, 'ios/Demo/Info.plist': plist(undefined, true) }));
  assert.match(ats.out, /! .*NSAllowsArbitraryLoads is true/);
});

test('store notes over the limit fail; within the limit pass', () => {
  const long = check(app({ ...bumped, 'release-notes/1.1/play-store.txt': 'a'.repeat(501) }));
  assert.match(long.out, /✗ release-notes\/1\.1\/play-store\.txt is 501 characters \(limit 500\)/);
  const fine = check(app({ ...bumped, 'release-notes/1.1/play-store.txt': 'a'.repeat(500), 'release-notes/1.1/app-store.txt': 'b'.repeat(4000) }));
  assert.match(fine.out, /✓ release-notes\/1\.1\/play-store\.txt \(500\/500/);
  assert.strictEqual(fine.code, 0);
});

test('a leftover debugger statement fails', () => {
  const dir = app(bumped);
  write(dir, 'src/screen.js', 'function f() {\n  debugger;\n}\n');
  commit(dir, 'wip');
  const { out, code } = check(dir);
  assert.match(out, /✗ "debugger" statements left in code: src\/screen\.js:2/);
  assert.strictEqual(code, 1);
});

test('a clean checkout of a release tag (a CI release build) is compared with the tag before it', () => {
  const dir = app(bumped);
  commit(dir, 'release 1.1');
  git(dir, 'tag', 'v1.1.0');
  const { out } = check(dir);
  assert.match(out, /compared with v1\.0\.0/);
  assert.match(out, /✓ iOS build number \(1 → 2\)/);
});

test('build numbers and the upload key that Codemagic sets are not reported as problems', () => {
  const yaml = fs.readFileSync(path.join(__dirname, '../stacks/react-native/template/codemagic.yaml'), 'utf8');
  const { out } = check(app({ 'codemagic.yaml': yaml, 'src/index.js': 'export default 2;\n', 'android/app/build.gradle': gradle(1, '1.0', 'signingConfig signingConfigs.debug') }));
  assert.match(out, /· iOS build number: set at build time \(codemagic\.yaml\)/);
  assert.match(out, /· Android build number: set at build time \(codemagic\.yaml\)/);
  assert.match(out, /✓ Android release signing \(Codemagic signs with the upload key\)/);
  assert.doesNotMatch(out, /build number unchanged|debug key/);
});

test('build numbers that fastlane sets at build time are not reported as unchanged', () => {
  const fastfile = `lane :beta do
  increment_build_number(build_number: latest_testflight_build_number + 1)
  build_app(scheme: "Demo")
end
`;
  const androidFastfile = 'lane :beta do\n  increment_version_code(gradle_file_path: "app/build.gradle")\nend\n';
  const { out } = check(app({ 'ios/fastlane/Fastfile': fastfile, 'android/fastlane/Fastfile': androidFastfile, 'src/index.js': 'export default 2;\n' }));
  assert.match(out, /· iOS build number: set at build time \(ios\/fastlane\/Fastfile\)/);
  assert.match(out, /· Android build number: set at build time \(android\/fastlane\/Fastfile\)/);
  assert.doesNotMatch(out, /build number unchanged/);
});

test('iOS may reuse its build number for a new version; Android may not', () => {
  const { out } = check(app({ 'ios/Demo.xcodeproj/project.pbxproj': pbx('1.1', 1), 'android/app/build.gradle': gradle(1, '1.1') }));
  assert.match(out, /✓ iOS build number \(1 again, for a new version\)/);
  assert.match(out, /! Android build number unchanged/);
});

test('signing keys and passwords in git warn; the standard debug keystore does not', () => {
  const signed = `android {
  defaultConfig { versionCode 2
    versionName "1.1" }
  signingConfigs {
    debug { storeFile file('debug.keystore'); storePassword 'android'; keyPassword 'android' }
    release { storeFile file('jks/upload'); storePassword "s3cret" }
  }
  buildTypes { release { signingConfig signingConfigs.release } }
}
`;
  const dir = app({ ...bumped, 'android/app/build.gradle': signed, 'android/app/jks/upload': 'binary', 'android/app/debug.keystore': 'binary', 'android/gradle.properties': 'MYAPP_UPLOAD_KEY_PASSWORD=abc\n# a comment about password=x\n' });
  git(dir, 'add', '-A');
  const { out } = check(dir);
  assert.match(out, /! Signing keys are in git: android\/app\/jks\/upload; 2 signing password\(s\) are written in android\/gradle\.properties or android\/app\/build\.gradle/);
  assert.doesNotMatch(out, /debug\.keystore/);
  assert.doesNotMatch(out, /s3cret|abc/, 'never prints the passwords');
  assert.doesNotMatch(check(app(bumped)).out, /Signing keys|signing password/, 'a clean app has no warning');
});

// ---------- Expo apps without native folders ----------
// a released Expo app (tagged v1.0.0) whose Expo CLI is a stand-in that prints app.json resolved with `results`,
// the way `expo config --type introspect` does after the config plugins ran
function expoApp(appJson, results, change = {}) {
  const dir = tmpDir('amk-release-');
  const cli = `const app = JSON.parse(require('fs').readFileSync('app.json', 'utf8')).expo;
console.log(JSON.stringify({ ...app, _internal: { modResults: ${JSON.stringify(results)} } }));
`;
  const files = {
    'package.json': JSON.stringify({ name: 'demo', dependencies: { expo: '~57.0.27', 'expo-camera': '~57.0.3', 'react-native': '0.86.3' } }),
    'app.json': JSON.stringify({ expo: appJson }, null, 2),
    'node_modules/expo/package.json': JSON.stringify({ name: 'expo', bin: { expo: 'bin/cli' } }),
    'node_modules/expo/bin/cli': cli,
    '.gitignore': 'node_modules/\n/ios\n/android\n',
    'src/index.js': 'export default 1;\n',
  };
  for (const [f, t] of Object.entries(files)) write(dir, f, t);
  git(dir, 'init', '-q');
  commit(dir, 'release 1.0');
  git(dir, 'tag', 'v1.0.0');
  for (const [f, t] of Object.entries(change)) write(dir, f, t);
  return dir;
}
const perm = name => ({ $: { 'android:name': `android.permission.${name}` } });
const camera = text => ({ ios: { infoPlist: { NSCameraUsageDescription: text } }, android: { manifest: { manifest: { 'uses-permission': [perm('INTERNET'), perm('CAMERA')], application: [{ $: {} }] } } } });

test('Expo: versions and build numbers come from the app config, compared with app.json at the last tag', () => {
  const v1 = { name: 'Demo', version: '1.0.0', ios: { buildNumber: '3' }, android: { versionCode: 3 } };
  const dir = expoApp(v1, camera('Scans receipts so you can file expenses.'), {
    'app.json': JSON.stringify({ expo: { ...v1, version: '1.1.0', android: { versionCode: 4 } } }),
    // stale generated folders must not be read
    'ios/Old.xcodeproj/project.pbxproj': pbx('0.1', 1),
    'android/app/build.gradle': gradle(1, '0.1'),
  });
  const { out, code } = check(dir);
  assert.match(out, /✓ App version \(1\.0\.0 → 1\.1\.0\)/);
  assert.match(out, /✓ iOS build number \(3 again, for a new version\)/);
  assert.match(out, /✓ Android build number \(3 → 4\)/);
  assert.match(out, /✓ app config \(ios\.infoPlist\): permission texts/);
  assert.match(out, /Android permissions that the Play data safety form must cover \(CAMERA\)/);
  assert.doesNotMatch(out, /0\.1|Old\.xcodeproj/, 'the generated folders are ignored');
  assert.strictEqual(code, 0, out);
});

test('Expo: a missing or default permission text, EAS build numbers and EAS credentials in git', () => {
  const app = { name: 'Demo', version: '1.0.0' };
  const missing = check(expoApp(app, { ios: { infoPlist: {} }, android: { manifest: { manifest: {} } } }, { 'src/index.js': 'export default 2;\n' }));
  assert.match(missing.out, /✗ app config \(ios\.infoPlist\): missing permission texts: NSCameraUsageDescription \(expo-camera\)/);
  assert.strictEqual(missing.code, 1);

  const dir = expoApp(app, camera('Allow $(PRODUCT_NAME) to access your camera'), {
    'eas.json': JSON.stringify({ cli: { appVersionSource: 'remote' }, build: { production: { autoIncrement: true } } }),
    'credentials.json': '{"android":{"keystore":{"keystorePassword":"x"}}}',
  });
  git(dir, 'add', '-A');
  const { out } = check(dir);
  assert.match(out, /! app config \(ios\.infoPlist\): Expo's default text for NSCameraUsageDescription/);
  assert.match(out, /· iOS build number: set at build time \(eas\.json\)/);
  assert.match(out, /· Android build number: set at build time \(eas\.json\)/);
  assert.match(out, /! Signing keys are in git: credentials\.json/);
  assert.doesNotMatch(out, /keystorePassword|"x"/);
});
