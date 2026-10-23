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
  'react-native-tracking-transparency': ['NSUserTrackingUsageDescription'],
  'expo-tracking-transparency': ['NSUserTrackingUsageDescription'],
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
  // too short to say what the app does with the data and why ("Camera access")
  const short = Object.entries(texts).filter(([, t]) => t.trim() && t.trim().length < 25 && !PLACEHOLDER.test(t) && !EXPO_DEFAULT.test(t));
  for (const [key, text] of short) warn(`${plistPath}: ${key} is short ("${text.trim()}")`, 'say what the app does with it and why, for each use; App Review rejects vague texts (5.1.1)');
  if (!problems.length && !vague.length && !short.length && !Object.values(texts).some(t => PLACEHOLDER.test(t))) ok(`${plistPath}: permission texts`, `${Object.keys(texts).length} present`);
  const arbitrary = expo ? (expoPlist.NSAppTransportSecurity || {}).NSAllowsArbitraryLoads === true
    : /<key>NSAllowsArbitraryLoads<\/key>\s*<true\s*\/>/.test(readNow(plistPath) || '');
  if (arbitrary) {
    warn(`${plistPath}: NSAllowsArbitraryLoads is true (any HTTP allowed)`, 'App Review may ask why; allow only the domains that need it (NSExceptionDomains)');
  }
}

// ---------- 4. Android permissions ----------
const SENSITIVE = /\.(ACCESS_(FINE|COARSE|BACKGROUND)_LOCATION|CAMERA|RECORD_AUDIO|READ_CONTACTS|WRITE_CONTACTS|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|READ_MEDIA_\w+|BLUETOOTH_SCAN|BLUETOOTH_CONNECT|POST_NOTIFICATIONS|READ_PHONE_STATE|BODY_SENSORS|READ_CALENDAR|WRITE_CALENDAR|ACCESS_MEDIA_LOCATION)$/;
// what the manifest asks for: not the ones it removes (tools:node="remove", for a permission a library adds)
const perms = t => uniq([...(t || '').matchAll(/<uses-permission\b[^>]*>/g)].map(m => m[0]).filter(p => !/tools:node="remove"/.test(p))
  .map(p => (/android:name="([^"]+)"/.exec(p) || [])[1]).filter(Boolean));
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

// ---------- 8. store review rules ----------
// what App Store review and Google Play policy reject that the project shows. Most need a person to judge (an
// exception, an approved Play declaration), so they warn
const found = names => names.filter(n => deps[n]);
const sourceFiles = (git('ls-files', '--', '*.js', '*.jsx', '*.ts', '*.tsx') || '').split('\n')
  .filter(f => f && !/(^|\/)(node_modules|scripts\/amk|__tests__|__mocks__|e2e|ios|android)\//.test(f) && !/\.(test|spec)\.\w+$/.test(f));
const source = sourceFiles.map(f => readNow(f) || '').join('\n');
// a sign-up in code (a call, a screen, an API path), not the words in a comment or in text ("No account, no sign-up")
const SIGN_UP = /\b(signUp|signup|createAccount|createUserWithEmailAndPassword|registerUser|registerAccount)\s*\(|\b(name|screen)\s*[:=]\s*\{?\s*['"](SignUp|Signup|Register|Registration|CreateAccount)['"]|navigate\(\s*['"](SignUp|Signup|Register|Registration|CreateAccount)['"]|['"`][^'"`\s]*\/(sign-?up|register|registration|create-?account)\b/i;
const rnVersion = (() => { try { return require(path.resolve('node_modules/react-native/package.json')).version; } catch { return (deps['react-native'] || '').replace(/^[^\d]*/, ''); } })();
const [rnMajor, rnMinor] = rnVersion.split('.').map(Number);
const rnBelow = minor => rnMajor === 0 && rnMinor < minor;
let storeFindings = 0;
const storeWarn = (label, fix) => { storeFindings++; warn(label, fix); };

// Apple
if (SIGN_UP.test(stripComments(source))
  && !/delete[ _-]?(my[ _-]?)?account|account[ _-]?deletion|deleteUser|close[ _-]?account|remove[ _-]?account/i.test(source)) {
  storeWarn('The app has a sign-up, but no account deletion was found in its code', 'people who can create an account must be able to start deleting it in the app (Apple 5.1.1(v)); Google Play also needs a web link to it in the Data safety form');
}
const social = [...found(['@react-native-google-signin/google-signin', 'react-native-fbsdk-next']),
  ...(/expo-auth-session\/providers\/(google|facebook)/.test(source) ? ['expo-auth-session'] : [])];
const entitlements = fs.existsSync('ios') ? fs.readdirSync('ios', { withFileTypes: true }).filter(e => e.isDirectory())
  .flatMap(e => fs.readdirSync(`ios/${e.name}`).filter(f => f.endsWith('.entitlements')).map(f => readNow(`ios/${e.name}/${f}`) || '')) : [];
const appleSignIn = found(['expo-apple-authentication', '@invertase/react-native-apple-authentication']).length
  || entitlements.some(e => e.includes('com.apple.developer.applesignin')) || ((expo || {}).ios || {}).usesAppleSignIn;
if (social.length && !appleSignIn) {
  storeWarn(`A social login (${social.join(', ')}) without Sign in with Apple`, 'App Review needs an equivalent private login next to it, usually Sign in with Apple (4.8); fine if the app signs in only with the company\'s own accounts');
}
const trackers = found(['react-native-fbsdk-next', 'react-native-appsflyer', 'react-native-adjust', 'react-native-google-mobile-ads']);
const allTexts = Object.values(textsByPlist).flatMap(Object.keys);
if (trackers.length && !found(['react-native-tracking-transparency', 'expo-tracking-transparency']).length && !allTexts.includes('NSUserTrackingUsageDescription')) {
  storeWarn(`${trackers.join(', ')} can track people across apps, and the app has no App Tracking Transparency prompt`, 'ask with the ATT prompt first (react-native-tracking-transparency or expo-tracking-transparency) and set NSUserTrackingUsageDescription (5.1.2)');
}
const privacy = expo ? [['app config (ios.privacyManifests)', (expo.ios || {}).privacyManifests || {}]]
  : (fs.existsSync('ios') ? fs.readdirSync('ios', { withFileTypes: true }) : []).filter(e => e.isDirectory() && fs.existsSync(`ios/${e.name}/PrivacyInfo.xcprivacy`))
    .map(e => [`ios/${e.name}/PrivacyInfo.xcprivacy`, readNow(`ios/${e.name}/PrivacyInfo.xcprivacy`) || '']);
const collectors = found(['@react-native-firebase/analytics', '@react-native-firebase/crashlytics', '@sentry/react-native', '@amplitude/analytics-react-native',
  '@segment/analytics-react-native', 'posthog-react-native', 'mixpanel-react-native', '@microsoft/react-native-clarity', '@datadog/mobile-react-native',
  '@bugsnag/react-native', '@intercom/intercom-react-native', 'react-native-appsflyer', 'react-native-fbsdk-next']);
for (const [where, m] of privacy) {
  const xml = typeof m === 'string';
  const tracking = xml ? /<key>NSPrivacyTracking<\/key>\s*<true\s*\/>/.test(m) : m.NSPrivacyTracking === true;
  const domains = xml ? /<key>NSPrivacyTrackingDomains<\/key>\s*<array>\s*<string>/.test(m) : (m.NSPrivacyTrackingDomains || []).length > 0;
  const collected = xml ? /<key>NSPrivacyCollectedDataTypes<\/key>\s*<array>\s*<dict>/.test(m) : (m.NSPrivacyCollectedDataTypes || []).length > 0;
  if (tracking && !domains) fail(`${where}: NSPrivacyTracking is true but lists no NSPrivacyTrackingDomains`, 'list the domains the app tracks with; Apple needs them when tracking is on');
  if (!collected && collectors.length) storeWarn(`${where} lists no collected data, and ${collectors.join(', ')} collect some`, 'make sure App Store Connect\'s privacy details (and this manifest, where the SDK\'s own doesn\'t) list it: names, emails, usage data, crash data, recordings');
}
const plistFlags = expo ? [['app config (ios.infoPlist)', expoPlist]] : plists.map(p => [p, readNow(p) || '']);
for (const [where, p] of plistFlags) {
  const on = key => (typeof p === 'string' ? new RegExp(`<key>${key}</key>\\s*<true\\s*/>`).test(p) : p[key] === true);
  if (on('UIDesignRequiresCompatibility')) storeWarn(`${where}: UIDesignRequiresCompatibility opts out of iOS 26's design`, 'builds with the iOS 27 SDK ignore it: make the app work with the current design');
  if (on('UIRequiresFullScreen')) storeWarn(`${where}: UIRequiresFullScreen is deprecated (iPadOS 26)`, 'iPad windows resize anyway: make every screen adapt to the window');
}
const nativeCaps = [...(git('grep', '-l', '-E', 'override +var +preferredContentSizeCategory|\\(UIContentSizeCategory\\) *preferredContentSizeCategory', '--', 'ios/*.swift', 'ios/*.m', 'ios/*.mm') || '').split('\n'),
  ...(git('grep', '-l', '-E', 'fontScale *= *[^= ]', '--', 'android/*.kt', 'android/*.java') || '').split('\n')].filter(f => f && !f.includes('/Pods/'));
if (nativeCaps.length) storeWarn(`Native code caps the user's text size: ${nativeCaps.join(', ')}`, 'people who pick a large text size get a smaller one; let text scale, and make layouts wrap');
if (rnVersion && rnBelow(88)) info(`React Native ${rnVersion}: apps built with Xcode 27 (the iOS 27 SDK) don't launch below 0.88`, 'App Store uploads move to each new Xcode from a date Apple announces: upgrade React Native before then');
const payments = found(['@stripe/stripe-react-native', 'react-native-razorpay', 'react-native-paypal', 'react-native-braintree-dropin-ui']);
if (payments.length && !found(['react-native-iap', 'react-native-purchases', 'expo-iap', 'expo-in-app-purchases']).length) {
  info(`${payments.join(', ')} without in-app purchase`, 'fine for physical goods and services; digital content and subscriptions need in-app purchase (3.1.1)');
}

// Google: every permission the release build gets: the app's manifests and its libraries' (Gradle merges them), less
// what the app removes. A release build's merged manifest already is that, when it's newer than what it was built from
function walk(dir, keep, depth = 0) {
  if (depth > 6 || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(`${dir}/${e.name}`, keep, depth + 1) : keep(`${dir}/${e.name}`) ? [`${dir}/${e.name}`] : []));
}
const tags = (t, name) => [...(t || '').matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map(m => m[0]);
const attr = (tag, a) => (new RegExp(`${a}="([^"]+)"`).exec(tag) || [])[1];
const mtime = f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
const ownManifests = expo ? [] : (fs.existsSync('android/app/src') ? fs.readdirSync('android/app/src') : [])
  .map(d => `android/app/src/${d}/AndroidManifest.xml`).filter(f => fs.existsSync(f));
const intermediates = 'android/app/build/intermediates';
const built = expo || !fs.existsSync(intermediates) ? [] : fs.readdirSync(intermediates).filter(d => /^merged_manifests?$/.test(d))
  .flatMap(d => walk(`${intermediates}/${d}`, f => /release/i.test(f) && f.endsWith('AndroidManifest.xml')));
const sourcesTime = Math.max(...[...ownManifests, 'package.json', gradlePath].filter(Boolean).map(mtime));
const merged = built.filter(f => mtime(f) >= sourcesTime);
const appManifests = merged.length ? merged : ownManifests;
const libManifests = merged.length ? [] : Object.keys(deps).map(d => [d, readNow(`node_modules/${d}/android/src/main/AndroidManifest.xml`)]).filter(([, t]) => t);
const removed = new Set([...ownManifests.flatMap(f => tags(readNow(f), 'uses-permission').filter(p => /tools:node="remove"/.test(p)).map(p => attr(p, 'android:name'))),
  ...(expo ? ((expoManifest || {})['uses-permission'] || []).filter(p => p.$['tools:node'] === 'remove').map(p => p.$['android:name']) : []),
  ...(((expo || {}).android || {}).blockedPermissions || [])]);
const granted = new Map();
const grant = (name, from) => { if (name && !removed.has(name)) granted.set(name, [...new Set([...(granted.get(name) || []), from])]); };
if (expo) for (const p of (expoManifest || {})['uses-permission'] || []) { if (p.$['tools:node'] !== 'remove') grant(p.$['android:name'], 'the app config'); }
for (const f of appManifests) for (const p of tags(readNow(f), 'uses-permission').filter(x => !/tools:node="remove"/.test(x))) grant(attr(p, 'android:name'), merged.length ? 'the merged release manifest' : f);
for (const [lib, t] of libManifests) for (const p of tags(t, 'uses-permission')) grant(attr(p, 'android:name'), lib);
const permName = n => n.replace(/^android\.permission\./, '');
const RESTRICTED = {
  READ_MEDIA_IMAGES: 'only for apps built around broad access to photos; others use the Android photo picker, which needs no permission',
  READ_MEDIA_VIDEO: 'only for apps built around broad access to videos; others use the Android photo picker, which needs no permission',
  QUERY_ALL_PACKAGES: 'list the apps it needs to see in <queries> instead',
  MANAGE_EXTERNAL_STORAGE: 'picking files or media isn\'t an allowed use: use the system pickers',
  READ_SMS: 'only for the default SMS app: one-time codes use the SMS Retriever API', RECEIVE_SMS: 'only for the default SMS app: one-time codes use the SMS Retriever API',
  SEND_SMS: 'only for the default SMS app', RECEIVE_MMS: 'only for the default SMS app', RECEIVE_WAP_PUSH: 'only for the default SMS app', WRITE_SMS: 'only for the default SMS app',
  READ_CALL_LOG: 'only for the default phone app', WRITE_CALL_LOG: 'only for the default phone app', PROCESS_OUTGOING_CALLS: 'only for the default phone app',
  USE_EXACT_ALARM: 'only for alarm, timer and calendar apps: others use SCHEDULE_EXACT_ALARM, and check canScheduleExactAlarms',
  ACCESS_BACKGROUND_LOCATION: 'needs a Play Console declaration for one feature, a short video, and a prominent disclosure in the app before asking',
  REQUEST_INSTALL_PACKAGES: 'needs a Play Console declaration', USE_FULL_SCREEN_INTENT: 'only for calls and alarms',
};
const remove = expo ? 'list it in android.blockedPermissions' : 'remove it (tools:node="remove" for one a library adds)';
for (const [name, from] of granted) {
  const why = RESTRICTED[permName(name)];
  if (why) storeWarn(`Google Play restricts ${permName(name)} (from ${from.join(', ')})`, `${why}; keep it only with an approved Play Console declaration, otherwise ${remove}`);
}
// foreground services: each declares its type, and each FOREGROUND_SERVICE_<TYPE> permission has a service of that type
// the app's own services (a merged manifest also has every library's, which declare their own types)
const services = [...ownManifests.flatMap(f => tags(readNow(f), 'service').map(s => [s, f])),
  ...(expo ? ((((expoManifest || {}).application || [])[0] || {}).service || []).map(s => [`<service ${Object.entries(s.$ || {}).map(([k, v]) => `${k}="${v}"`).join(' ')}>`, 'the app config']) : [])];
const typeName = v => v.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
const allServices = [...services, ...merged.flatMap(f => tags(readNow(f), 'service').map(s => [s, f])), ...libManifests.flatMap(([lib, t]) => tags(t, 'service').map(s => [s, lib]))];
const types = new Set(allServices.flatMap(([s]) => (attr(s, 'android:foregroundServiceType') || '').split('|').filter(Boolean).map(typeName)));
if ([...granted.keys()].some(n => permName(n).startsWith('FOREGROUND_SERVICE'))) {
  // once per service, wherever it's declared (the main manifest and a flavor's, say)
  const untyped = new Map();
  for (const [s, from] of services.filter(([s]) => !attr(s, 'android:foregroundServiceType'))) {
    const name = attr(s, 'android:name') || 'a service';
    untyped.set(name, [...(untyped.get(name) || []), from]);
  }
  for (const [name, from] of untyped) {
    storeWarn(`${name} has no android:foregroundServiceType (${from.join(', ')})`, 'if it runs in the foreground, declare its type and the matching FOREGROUND_SERVICE_<TYPE> permission: from Android 14, starting it without one crashes');
  }
  for (const n of [...granted.keys()].map(permName).filter(n => /^FOREGROUND_SERVICE_./.test(n))) {
    if (!types.has(n.replace('FOREGROUND_SERVICE_', ''))) storeWarn(`${n} is declared, but no service has that type`, 'give the service that does this work the matching android:foregroundServiceType, or remove the permission');
  }
  if (types.size) info(`Foreground service types to declare in Play Console: ${[...types].join(', ')}`);
}
if (rnVersion && rnBelow(77)) {
  const due = Date.now() >= Date.parse('2027-02-01');
  (due ? fail : warn)(`React Native ${rnVersion} has no 16 KB page size support (from 0.77)`, 'from 1 February 2027 Google Play takes updates to apps targeting Android 15 or later only with it: upgrade React Native');
  if (!due) storeFindings++;
}
const notifiers = found(['@react-native-firebase/messaging', '@notifee/react-native', 'react-native-push-notification', 'expo-notifications', 'react-native-onesignal', 'react-native-notifications']);
if (notifiers.length && !/requestPermission|requestPermissionsAsync|requestNotifications|POST_NOTIFICATIONS|requestUserPermission/.test(source)) {
  storeWarn(`${notifiers.join(', ')}, but the code never asks for permission to notify`, 'Android 13 and later show notifications only once the user allows them: ask after an action they serve');
}
if (!storeFindings) ok('Store review rules', 'nothing found');

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
