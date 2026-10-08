#!/usr/bin/env node
// Release check for a bare React Native app: what App Store review, Play review or your users would catch.
// Usage: node scripts/ai/release-check.js [--since <git ref>]
//   --since  the previous release to compare with (default: the latest git tag)
// Exits 1 when something would get the release rejected or broken; warnings don't fail it.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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
const xcodeproj = (fs.readdirSync('ios', { withFileTypes: true }).find(e => e.isDirectory() && e.name.endsWith('.xcodeproj')) || {}).name;
const pbxPath = xcodeproj ? `ios/${xcodeproj}/project.pbxproj` : null;
const pbx = pbxPath ? readNow(pbxPath) : null;
const plists = all(/INFOPLIST_FILE = ([^;]+);/g, pbx).map(p => `ios/${p}`).filter(p => fs.existsSync(p));
const gradlePath = ['android/app/build.gradle', 'android/app/build.gradle.kts'].find(f => fs.existsSync(f));
const gradle = stripComments(readNow(gradlePath));
const manifestPath = 'android/app/src/main/AndroidManifest.xml';
const pkg = JSON.parse(readNow('package.json') || '{}');
const deps = { ...pkg.dependencies, ...pkg.devDependencies };

// ---------- 1. versions ----------
const iosVersions = t => all(/MARKETING_VERSION = ([^;]+);/g, t);
const iosBuilds = t => all(/CURRENT_PROJECT_VERSION = ([^;]+);/g, t);
const androidVersions = t => all(/versionName\s*=?\s*"([^"]+)"/g, stripComments(t));
const androidBuilds = t => all(/versionCode\s*=?\s*(\d+)/g, stripComments(t));

function compare(platform, now, before, kind) {
  if (!now.length) { warn(`${platform} ${kind}: couldn't read it`, 'check it by hand before you ship'); return; }
  if (!before) { info(`${platform} ${kind}: ${now.join(', ')}`); return; }
  if (!before.length || now.join() !== before.join()) {
    if (kind === 'build number' && before.length && maxNum(now) < maxNum(before)) {
      fail(`${platform} build number went down (${before.join(', ')} → ${now.join(', ')})`, 'stores reject a build number lower than the last upload');
    } else ok(`${platform} ${kind}`, `${before.join(', ') || '?'} → ${now.join(', ')}`);
  } else if (kind === 'build number') {
    warn(`${platform} build number unchanged since ${since} (${now.join(', ')})`, 'bump it, unless your CI sets it (for example Codemagic); stores reject a repeated build number');
  } else {
    warn(`${platform} version unchanged since ${since} (${now.join(', ')})`, 'fine for a re-upload of the same version; otherwise bump it');
  }
}

if (!since) info('No previous release found (no git tag)', 'tag each release, e.g. v1.4.0, or pass --since <ref>, so the next check can compare');
if (pbx) {
  compare('iOS', iosVersions(pbx), since && iosVersions(readAt(since, pbxPath)), 'version');
  compare('iOS', iosBuilds(pbx), since && iosBuilds(readAt(since, pbxPath)), 'build number');
}
if (gradle) {
  compare('Android', androidVersions(gradle), since && androidVersions(readAt(since, gradlePath)), 'version');
  compare('Android', androidBuilds(gradle), since && androidBuilds(readAt(since, gradlePath)), 'build number');
}
if (pbx && gradle) {
  const a = iosVersions(pbx), b = androidVersions(gradle);
  if (a.length && b.length && !a.some(v => b.includes(v))) {
    warn(`iOS shows version ${a.join(', ')}, Android shows ${b.join(', ')}`, 'users and support see different numbers; align them unless that\'s intended');
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
};
const PLACEHOLDER = /^\s*$|\b(todo|tbd|lorem|placeholder|description here|your text)\b/i;
const usageTexts = f => Object.fromEntries([...(readNow(f) || '').matchAll(/<key>(\w+UsageDescription)<\/key>\s*<string>([^<]*)<\/string>/g)].map(m => [m[1], m[2]]));
const textsByPlist = Object.fromEntries(plists.map(f => [f, usageTexts(f)]));
const needed = Object.entries(NEEDS).filter(([lib]) => deps[lib]).flatMap(([lib, keys]) => keys.map(key => ({ lib, key })));
for (const plistPath of plists) {
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
  if (!problems.length && !Object.values(texts).some(t => PLACEHOLDER.test(t))) ok(`${plistPath}: permission texts`, `${Object.keys(texts).length} present`);
  const plist = readNow(plistPath);
  if (/<key>NSAllowsArbitraryLoads<\/key>\s*<true\s*\/>/.test(plist)) {
    warn(`${plistPath}: NSAllowsArbitraryLoads is true (any HTTP allowed)`, 'App Review may ask why; allow only the domains that need it (NSExceptionDomains)');
  }
}

// ---------- 4. Android permissions ----------
const SENSITIVE = /\.(ACCESS_(FINE|COARSE|BACKGROUND)_LOCATION|CAMERA|RECORD_AUDIO|READ_CONTACTS|WRITE_CONTACTS|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|READ_MEDIA_\w+|BLUETOOTH_SCAN|BLUETOOTH_CONNECT|POST_NOTIFICATIONS|READ_PHONE_STATE|BODY_SENSORS|READ_CALENDAR|WRITE_CALENDAR|ACCESS_MEDIA_LOCATION)$/;
const perms = t => all(/<uses-permission[^>]*android:name="([^"]+)"/g, t);
const permsNow = perms(readNow(manifestPath));
if (since && readAt(since, manifestPath) !== null) {
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
if (/signingConfig\s*=?\s*signingConfigs\.debug/.test(releaseBlock)) {
  warn('Android release build is signed with the debug key', 'fine only if your release pipeline (for example Codemagic) re-signs it; Play rejects debug-signed uploads');
}
if (/android:usesCleartextTraffic="true"/.test(readNow(manifestPath) || '')) {
  warn('Android allows cleartext (HTTP) traffic', 'allow only the domains that need it (network security config)');
}
const debuggers = (git('grep', '-n', '-E', '^[[:space:]]*debugger;?[[:space:]]*$', '--', '*.js', '*.jsx', '*.ts', '*.tsx') || '').split('\n').filter(Boolean);
if (debuggers.length) fail(`"debugger" statements left in code: ${debuggers.slice(0, 3).join(', ')}${debuggers.length > 3 ? ' …' : ''}`, 'remove them');
else ok('No "debugger" statements');

// ---------- 6. store notes ----------
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
