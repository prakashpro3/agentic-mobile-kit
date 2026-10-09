#!/usr/bin/env node
// Release check for a bare React Native app: what App Store review, Play review or your users would catch.
// Usage: node scripts/amk/release-check.js [--since <git ref>]
//   --since  the previous release to compare with (default: the latest git tag)
// Exits 1 when something would get the release rejected or broken; warnings don't fail it.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const args = process.argv.slice(2);
const argSince = args.includes('--since') ? args[args.indexOf('--since') + 1] : null;

const results = [];
const ok = (label, detail) => results.push({ level: 'ok', label, detail });
const info = (label, detail) => results.push({ level: 'info', label, detail });
const warn = (label, fix) => results.push({ level: 'warn', label, fix });
const fail = (label, fix) => results.push({ level: 'fail', label, fix });

const git = (...a) => { try { return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const readNow = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const readAt = (ref, f) => (ref ? git('show', `${ref}:${f}`) : null);
const stripComments = t => (t || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const uniq = a => [...new Set(a)];
const all = (re, text) => uniq([...(text || '').matchAll(re)].map(m => m[1].replace(/^"|"$/g, '').trim()));
const maxNum = a => Math.max(...a.map(Number).filter(n => !Number.isNaN(n)));

// a clean checkout of a release tag is that release being built (e.g. in CI): compare with the tag before it
const atTag = git('tag', '--points-at', 'HEAD') && git('status', '--porcelain') === '';
const since = argSince || git('describe', '--tags', '--abbrev=0', ...(atTag ? ['HEAD^'] : []));

// ---------- files ----------
const pkg = JSON.parse(readNow('package.json') || '{}');
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
// Expo apps without native folders in git: ios/ and android/ are generated (and may be stale), so the checks read
// the app config instead, as `expo prebuild` applies it, with every config plugin
const expo = deps.expo && !git('ls-files', 'ios', 'android') ? expoConfig() : null;
function expoConfig() {
  let cli;
  try {
    const dir = path.dirname(require.resolve('expo/package.json', { paths: [process.cwd()] }));
    cli = path.join(dir, require(path.join(dir, 'package.json')).bin.expo);
  } catch {
    fail('Expo isn\'t installed, so the app config can\'t be read', 'install dependencies first: sh scripts/amk/install-deps.sh');
    return null;
  }
  const r = spawnSync(process.execPath, [cli, 'config', '--type', 'introspect', '--json'], { encoding: 'utf8', maxBuffer: 2 ** 28 });
  try { return JSON.parse(r.stdout); } catch {
    fail('Couldn\'t read the Expo app config', (r.stderr || '').trim().split('\n').pop() || 'run: npx expo config');
    return null;
  }
}
const expoResults = ((expo || {})._internal || {}).modResults || {};
const xcodeproj = !expo && fs.existsSync('ios') ? (fs.readdirSync('ios', { withFileTypes: true }).find(e => e.isDirectory() && e.name.endsWith('.xcodeproj')) || {}).name : null;
const pbxPath = xcodeproj ? `ios/${xcodeproj}/project.pbxproj` : null;
const pbx = pbxPath ? readNow(pbxPath) : null;
const plists = all(/INFOPLIST_FILE = ([^;]+);/g, pbx).map(p => `ios/${p}`).filter(p => fs.existsSync(p));
const gradlePath = expo ? null : ['android/app/build.gradle', 'android/app/build.gradle.kts'].find(f => fs.existsSync(f));
const gradle = stripComments(readNow(gradlePath));
const manifestPath = expo ? null : 'android/app/src/main/AndroidManifest.xml';
// this kit's codemagic.yaml sets build numbers and the Android upload key on the build machine
const codemagic = readNow('codemagic.yaml') || '';
// build numbers set at build time (by CI or fastlane, as this kit's codemagic.yaml does) never change in the repo
const workflows = fs.existsSync('.github/workflows') ? fs.readdirSync('.github/workflows').map(f => `.github/workflows/${f}`) : [];
const buildFiles = ['codemagic.yaml', 'bitrise.yml', '.gitlab-ci.yml', '.circleci/config.yml', 'azure-pipelines.yml', ...workflows,
  ...['fastlane', 'ios/fastlane', 'android/fastlane'].map(d => `${d}/Fastfile`)];
const setsBuild = {
  iOS: /agvtool new-version|increment_build_number|set-xcode-build-number|Set :CFBundleVersion/,
  Android: /versionCode[^\n]*\$|increment_version_code|android_set_version_code|change-android-versioncode/,
};
const ciBuildNumber = Object.fromEntries(Object.entries(setsBuild).map(([p, re]) => [p, buildFiles.find(f => re.test(readNow(f) || ''))]));
// EAS sets them itself with autoIncrement, or keeps them on its servers (appVersionSource: remote)
const eas = (() => { try { return JSON.parse(readNow('eas.json') || '{}'); } catch { return {}; } })();
if ((eas.cli || {}).appVersionSource === 'remote' || Object.values(eas.build || {}).some(b => b && b.autoIncrement)) {
  for (const p of ['iOS', 'Android']) ciBuildNumber[p] = ciBuildNumber[p] || 'eas.json';
}

// ---------- 1. versions ----------
const iosVersions = t => all(/MARKETING_VERSION = ([^;]+);/g, t);
const iosBuilds = t => all(/CURRENT_PROJECT_VERSION = ([^;]+);/g, t);
const androidVersions = t => all(/versionName\s*=?\s*"([^"]+)"/g, stripComments(t));
const androidBuilds = t => all(/versionCode\s*=?\s*(\d+)/g, stripComments(t));

function compare(platform, now, before, kind, versionChanged) {
  if (kind === 'build number' && ciBuildNumber[platform]) { info(`${platform} build number: set at build time (${ciBuildNumber[platform]})`); return; }
  if (!now.length) { warn(`${platform} ${kind}: couldn't read it`, 'check it by hand before you ship'); return; }
  if (!before) { info(`${platform} ${kind}: ${now.join(', ')}`); return; }
  if (!before.length || now.join() !== before.join()) {
    if (kind === 'build number' && before.length && maxNum(now) < maxNum(before)) {
      fail(`${platform} build number went down (${before.join(', ')} → ${now.join(', ')})`, 'stores reject a build number lower than the last upload');
    } else ok(`${platform} ${kind}`, `${before.join(', ') || '?'} → ${now.join(', ')}`);
  } else if (kind === 'build number' && platform === 'iOS' && versionChanged) {
    // the App Store needs a new build number only within a version, so 1 again for a new version is fine
    ok(`${platform} build number (${now.join(', ')} again, for a new version)`);
  } else if (kind === 'build number') {
    warn(`${platform} build number unchanged since ${since} (${now.join(', ')})`, 'bump it, unless CI or fastlane sets it at build time; stores reject a repeated build number');
  } else {
    warn(`${platform} version unchanged since ${since} (${now.join(', ')})`, 'fine for a re-upload of the same version; otherwise bump it');
  }
}

if (!since) info('No previous release found (no git tag)', 'tag each release, e.g. v1.4.0, or pass --since <ref>, so the next check can compare');
if (pbx) {
  const [now, before] = [iosVersions(pbx), since && iosVersions(readAt(since, pbxPath))];
  compare('iOS', now, before, 'version');
  compare('iOS', iosBuilds(pbx), since && iosBuilds(readAt(since, pbxPath)), 'build number', before && now.join() !== before.join());
}
if (gradle) {
  compare('Android', androidVersions(gradle), since && androidVersions(readAt(since, gradlePath)), 'version');
  compare('Android', androidBuilds(gradle), since && androidBuilds(readAt(since, gradlePath)), 'build number');
}
if (expo) {
  // the release before, from app.json at its tag (an app.config.* can't be evaluated at an old commit)
  let old = null;
  try { const j = JSON.parse(readAt(since, 'app.json')); old = j.expo || j; } catch {}
  const now = [expo.version].filter(Boolean);
  const before = since && (old ? [old.version].filter(Boolean) : null);
  compare('App', now, before, 'version');
  const builds = c => c && { iOS: [String((c.ios || {}).buildNumber || 1)], Android: [String((c.android || {}).versionCode || 1)] };
  compare('iOS', builds(expo).iOS, since && old && builds(old).iOS, 'build number', before && now.join() !== before.join());
  compare('Android', builds(expo).Android, since && old && builds(old).Android, 'build number');
}
if (pbx && gradle) {
  const a = iosVersions(pbx), b = androidVersions(gradle);
  if (a.length && b.length && !a.some(v => b.includes(v))) {
    info(`iOS shows version ${a.join(', ')}, Android shows ${b.join(', ')}`, 'users and support see different numbers; fine if your team numbers the platforms separately');
  }
}

// ---------- 2. iOS privacy manifest ----------
if (pbx) {
  const manifests = fs.readdirSync('ios', { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(`ios/${e.name}/PrivacyInfo.xcprivacy`)).map(e => `ios/${e.name}/PrivacyInfo.xcprivacy`);
  if (!manifests.length) fail('No PrivacyInfo.xcprivacy in the iOS app', 'Apple requires a privacy manifest; React Native\'s template ships one in ios/<App>/');
  else if (!/PrivacyInfo\.xcprivacy/.test(pbx)) fail(`${manifests[0]} isn't in the Xcode project`, 'add it to the app target in Xcode so it ships in the build');
  else ok('iOS privacy manifest', manifests.join(', '));
}

// ---------- 3. iOS permission texts ----------
// libraries that make iOS ask for a permission, and the Info.plist text each one needs
const NEEDS = {
  'react-native-vision-camera': ['NSCameraUsageDescription'],
  'react-native-image-picker': ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription'],
  'react-native-image-crop-picker': ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription'],
  '@react-native-camera-roll/camera-roll': ['NSPhotoLibraryUsageDescription'],
  'react-native-geolocation-service': ['NSLocationWhenInUseUsageDescription'],
  '@react-native-community/geolocation': ['NSLocationWhenInUseUsageDescription'],
  'react-native-location': ['NSLocationWhenInUseUsageDescription'],
  'react-native-contacts': ['NSContactsUsageDescription'],
  'react-native-ble-plx': ['NSBluetoothAlwaysUsageDescription'],
  'react-native-ble-manager': ['NSBluetoothAlwaysUsageDescription'],
  'react-native-kontaktio': ['NSBluetoothAlwaysUsageDescription', 'NSLocationWhenInUseUsageDescription'],
  'react-native-nfc-manager': ['NFCReaderUsageDescription'],
  'react-native-biometrics': ['NSFaceIDUsageDescription'],
  'react-native-touch-id': ['NSFaceIDUsageDescription'],
  'react-native-audio-recorder-player': ['NSMicrophoneUsageDescription'],
  '@react-native-voice/voice': ['NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription'],
  'expo-camera': ['NSCameraUsageDescription'],
  'expo-image-picker': ['NSPhotoLibraryUsageDescription'],
  'expo-media-library': ['NSPhotoLibraryUsageDescription'],
  'expo-location': ['NSLocationWhenInUseUsageDescription'],
  'expo-contacts': ['NSContactsUsageDescription'],
  'expo-local-authentication': ['NSFaceIDUsageDescription'],
};
// the texts Expo's config plugins write when app.json gives none: too vague for App Review
const EXPO_DEFAULT = /^Allow \$\(PRODUCT_NAME\) to /;
const PLACEHOLDER = /^\s*$|\b(todo|tbd|lorem|placeholder|description here|your text)\b/i;
const usageTexts = f => Object.fromEntries([...(readNow(f) || '').matchAll(/<key>(\w+UsageDescription)<\/key>\s*<string>([^<]*)<\/string>/g)].map(m => [m[1], m[2]]));
const expoPlist = (expoResults.ios || {}).infoPlist || {};
const textsByPlist = expo
  ? { 'app config (ios.infoPlist)': Object.fromEntries(Object.entries(expoPlist).filter(([k, v]) => /UsageDescription$/.test(k) && typeof v === 'string')) }
  : Object.fromEntries(plists.map(f => [f, usageTexts(f)]));
const needed = Object.entries(NEEDS).filter(([lib]) => deps[lib]).flatMap(([lib, keys]) => keys.map(key => ({ lib, key })));
for (const plistPath of Object.keys(textsByPlist)) {
  const texts = textsByPlist[plistPath];
  const problems = [];
  for (const { lib, key } of needed) {
    if (key in texts) continue;
    // with several app targets (e.g. a kiosk app), one may legitimately not use a library
    const elsewhere = plists.filter(p => p !== plistPath && key in textsByPlist[p]);
    if (elsewhere.length) warn(`${plistPath}: no ${key}, which ${elsewhere[0]} has (${lib})`, `if this app uses ${lib}, add it; otherwise ignore`);
    else problems.push(`${key} (${lib})`);
  }
  if (problems.length) fail(`${plistPath}: missing permission texts: ${uniq(problems).join(', ')}`, 'add each key with a sentence that says why the app needs it; without it iOS crashes on the permission request and review rejects the app (guideline 5.1.1)');
  const neededKeys = needed.map(n => n.key);
  for (const [key, text] of Object.entries(texts).filter(([, t]) => PLACEHOLDER.test(t))) {
    if (neededKeys.includes(key)) fail(`${plistPath}: ${key} is ${text.trim() ? `a placeholder ("${text.trim()}")` : 'empty'}`, 'write a real reason users can understand');
    else warn(`${plistPath}: ${key} is ${text.trim() ? 'a placeholder' : 'empty'}`, 'remove the key if the app doesn\'t use this permission; otherwise write a real reason');
  }
  const vague = Object.entries(texts).filter(([, t]) => EXPO_DEFAULT.test(t)).map(([k]) => k);
  if (vague.length) warn(`${plistPath}: Expo's default text for ${vague.join(', ')}`, 'App Review asks why the app needs each permission: set the text in the library\'s plugin options or ios.infoPlist in app.json');
  if (!problems.length && !vague.length && !Object.values(texts).some(t => PLACEHOLDER.test(t))) ok(`${plistPath}: permission texts`, `${Object.keys(texts).length} present`);
  const arbitrary = expo ? (expoPlist.NSAppTransportSecurity || {}).NSAllowsArbitraryLoads === true
    : /<key>NSAllowsArbitraryLoads<\/key>\s*<true\s*\/>/.test(readNow(plistPath) || '');
  if (arbitrary) {
    warn(`${plistPath}: NSAllowsArbitraryLoads is true (any HTTP allowed)`, 'App Review may ask why; allow only the domains that need it (NSExceptionDomains)');
  }
}

// ---------- 4. Android permissions ----------
const SENSITIVE = /\.(ACCESS_(FINE|COARSE|BACKGROUND)_LOCATION|CAMERA|RECORD_AUDIO|READ_CONTACTS|WRITE_CONTACTS|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|READ_MEDIA_\w+|BLUETOOTH_SCAN|BLUETOOTH_CONNECT|POST_NOTIFICATIONS|READ_PHONE_STATE|BODY_SENSORS|READ_CALENDAR|WRITE_CALENDAR|ACCESS_MEDIA_LOCATION)$/;
const perms = t => all(/<uses-permission[^>]*android:name="([^"]+)"/g, t);
// Expo: the manifest prebuild would write, as JSON
const expoManifest = ((expoResults.android || {}).manifest || {}).manifest;
const permsNow = expo ? uniq(((expoManifest || {})['uses-permission'] || []).map(p => p.$['android:name'])) : perms(readNow(manifestPath));
if (manifestPath && since && readAt(since, manifestPath) !== null) {
  const before = perms(readAt(since, manifestPath));
  const added = permsNow.filter(p => !before.includes(p));
  const removed = before.filter(p => !permsNow.includes(p));
  if (added.some(p => SENSITIVE.test(p))) {
    warn(`New Android permissions since ${since}: ${added.join(', ')}`, 'update the Play Console data safety form, and explain the permission in the app before asking');
  } else if (added.length) info(`New Android permissions since ${since}: ${added.join(', ')}`);
  else ok('No new Android permissions', removed.length ? `removed: ${removed.join(', ')}` : '');
} else if (permsNow.some(p => SENSITIVE.test(p))) {
  info('Android permissions that the Play data safety form must cover', permsNow.filter(p => SENSITIVE.test(p)).map(p => p.split('.').pop()).join(', '));
}

// ---------- 5. debug leftovers ----------
// the body of `name { … }` inside text, found by matching braces (Gradle blocks nest)
function block(text, name) {
  const m = new RegExp(`(^|\\W)${name}\\s*\\{`).exec(text || '');
  if (!m) return '';
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(m.index + m[0].length, i);
  }
  return '';
}
const releaseBlock = block(block(gradle, 'buildTypes'), 'release');
if (/debuggable\s*=?\s*true/.test(releaseBlock)) fail('Android release build is debuggable', 'remove "debuggable true" from buildTypes.release; Play rejects debuggable apps');
if (/android\.injected\.signing/.test(codemagic)) ok('Android release signing', 'Codemagic signs with the upload key');
else if (/signingConfig\s*=?\s*signingConfigs\.debug/.test(releaseBlock)) {
  // the kit's release-build.sh (and Codemagic) sign with the upload key, and Play rejects debug-signed uploads anyway
  info('build.gradle signs release builds with the debug key', 'build store releases with sh scripts/amk/release-build.sh android, which signs with your upload key');
}
const cleartext = expo ? ((((expoManifest || {}).application || [])[0] || {}).$ || {})['android:usesCleartextTraffic'] === 'true'
  : /android:usesCleartextTraffic="true"/.test(readNow(manifestPath) || '');
if (cleartext) {
  warn('Android allows cleartext (HTTP) traffic', 'allow only the domains that need it (network security config)');
}
const debuggers = (git('grep', '-n', '-E', '^[[:space:]]*debugger;?[[:space:]]*$', '--', '*.js', '*.jsx', '*.ts', '*.tsx') || '').split('\n').filter(Boolean);
if (debuggers.length) fail(`"debugger" statements left in code: ${debuggers.slice(0, 3).join(', ')}${debuggers.length > 3 ? ' …' : ''}`, 'remove them');
else ok('No "debugger" statements');

// ---------- 6. signing keys in git ----------
// the standard debug.keystore (password "android") is public and fine; real keys and passwords aren't
const tracked = (git('ls-files') || '').split('\n').filter(Boolean);
const gradleCode = stripComments(readNow(gradlePath));
const storeFiles = [
  ...all(/storeFile\s*=?\s*file\(\s*["']([^"']+)["']\s*\)/g, gradleCode).map(f => path.posix.join('android/app', f)),
  ...all(/storeFile\s*=?\s*rootProject\.file\(\s*["']([^"']+)["']\s*\)/g, gradleCode).map(f => path.posix.join('android', f)),
];
// credentials.json: EAS's local credentials, with the keystore passwords
const keys = tracked.filter(f => (/\.(jks|keystore|p12|p8|mobileprovision)$/.test(f) || storeFiles.includes(f) || f === 'credentials.json') && path.basename(f) !== 'debug.keystore');
// React Native's docs suggest android/gradle.properties for these passwords, and that file is usually committed
const propsPasswords = tracked.includes('android/gradle.properties')
  ? (readNow('android/gradle.properties') || '').split('\n').filter(l => /^[^#]*password[^=]*=\s*\S/i.test(l)).length : 0;
const passwords = [...gradleCode.matchAll(/(?:store|key)Password\s*=?\s*["']([^"']*)["']/g)].filter(m => m[1] !== 'android').length + propsPasswords;
if (keys.length || passwords) {
  const what = [keys.length && `signing keys are in git: ${keys.join(', ')}`, passwords && `${passwords} signing password(s) are written in ${propsPasswords ? 'android/gradle.properties or ' : ''}${gradlePath}`].filter(Boolean).join('; ');
  warn(what.charAt(0).toUpperCase() + what.slice(1), 'anyone who can read the repo can sign builds as you: keep keys in a password manager, read passwords from the environment or ~/.gradle/gradle.properties, and reset the upload key in Play Console if Play App Signing is on');
}

// ---------- 7. store notes ----------
const LIMITS = { 'play-store': 500, 'app-store': 4000 };
const noteFiles = fs.existsSync('release-notes') ? (git('ls-files', '--others', '--cached', '--exclude-standard', 'release-notes') || '').split('\n').filter(Boolean) : [];
for (const f of noteFiles) {
  const kind = Object.keys(LIMITS).find(k => path.basename(f).startsWith(k));
  if (!kind) continue;
  const len = [...readNow(f).trim()].length;
  if (len > LIMITS[kind]) fail(`${f} is ${len} characters (limit ${LIMITS[kind]})`, 'shorten it; the store rejects longer release notes');
  else ok(`${f}`, `${len}/${LIMITS[kind]} characters`);
}
if (!noteFiles.length) info('No store release notes yet', 'run the m-release skill to write them from the changelog');

// ---------- report ----------
const icon = { ok: '✓', info: '·', warn: '!', fail: '✗' };
console.log(`Release check${since ? ` (compared with ${since})` : ''}`);
for (const r of results) {
  console.log(`  ${icon[r.level]} ${r.label}${r.detail ? ` (${r.detail})` : ''}`);
  if (r.fix) console.log(`      → ${r.fix}`);
}
const failures = results.filter(r => r.level === 'fail').length;
const warnings = results.filter(r => r.level === 'warn').length;
console.log(`\n${failures} problem(s), ${warnings} warning(s).`);
process.exitCode = failures ? 1 : 0;
