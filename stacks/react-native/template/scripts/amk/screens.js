#!/usr/bin/env node
// The screens the app supports: phones and tablets, portrait and landscape, on iOS and Android. Read from the native
// projects (app.json in an Expo app that doesn't have them yet), so agents build for them and verify.sh checks them.
// The app runs on tablets when its iOS app runs on iPad; Android runs every app on tablets, but the kit checks
// Android tablets only for apps made for tablets.
// Usage: node scripts/amk/screens.js               one sentence, as AGENTS.md says it
//        node scripts/amk/screens.js ios|android   the screens to check, one per line: phone-portrait, tablet-landscape, …
'use strict';
const fs = require('fs');
const path = require('path');

const BOTH = ['portrait', 'landscape'];
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

// an Info.plist array's orientations, or null without the key (upside down counts as portrait)
function plistOrientations(plist, key) {
  const m = plist.match(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`));
  if (!m) return null;
  const found = BOTH.filter(o => m[1].includes(`UIInterfaceOrientation${o === 'portrait' ? 'Portrait' : 'Landscape'}`));
  return found.length ? found : null;
}

function ios(cwd) {
  const dir = path.join(cwd, 'ios');
  const proj = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).find(f => f.endsWith('.xcodeproj'));
  if (!proj) return null;
  const pbx = read(path.join(dir, proj, 'project.pbxproj')) || '';
  // the app target's Info.plist, not a test target's
  const plistFile = [...pbx.matchAll(/INFOPLIST_FILE = "?([^";]+)"?;/g)].map(m => m[1].replace(/^\$\(SRCROOT\)\//, ''))
    .find(f => !/Tests?\//.test(f)) || `${proj.replace(/\.xcodeproj$/, '')}/Info.plist`;
  const plist = read(path.join(dir, plistFile)) || '';
  // without the key, iOS lets the app turn both ways
  const phone = plistOrientations(plist, 'UISupportedInterfaceOrientations') || BOTH;
  const ipad = /TARGETED_DEVICE_FAMILY = "?[\d,]*2/.test(pbx);
  return { phone, tablet: ipad ? plistOrientations(plist, 'UISupportedInterfaceOrientations~ipad') || phone : null };
}

const lockOf = value => (/portrait/i.test(value) ? ['portrait'] : /landscape/i.test(value) ? ['landscape'] : BOTH);

function android(cwd) {
  const manifest = read(path.join(cwd, 'android/app/src/main/AndroidManifest.xml'));
  if (manifest === null) return null;
  // the launcher activity's orientation lock, if it has one
  const at = manifest.lastIndexOf('<activity', manifest.indexOf('android.intent.action.MAIN'));
  const tag = at < 0 ? '' : manifest.slice(at, manifest.indexOf('>', at) + 1);
  const phone = lockOf((tag.match(/android:screenOrientation="([^"]+)"/) || [])[1] || '');
  // apps targeting Android 16 (API 36) can't lock the orientation on tablets: the system ignores it there
  const gradle = ['build.gradle', 'app/build.gradle', 'gradle.properties'].map(f => read(path.join(cwd, 'android', f)) || '').join('\n');
  const target = Number((gradle.match(/targetSdk(?:Version)?\s*[=:]?\s*(\d+)/) || [])[1]) || 36;
  return { phone, tablet: target >= 36 ? BOTH : phone };
}

// app.json's expo section: "orientation" (no lock unless it says portrait or landscape) and ios.supportsTablet
function expo(cwd) {
  let config;
  try { config = JSON.parse(read(path.join(cwd, 'app.json'))).expo; } catch { return null; }
  if (!config) return null;
  const phone = lockOf(config.orientation || '');
  return { ios: { phone, tablet: config.ios && config.ios.supportsTablet ? phone : null }, android: { phone, tablet: BOTH } };
}

function screens(cwd) {
  const fromExpo = expo(cwd);
  const i = ios(cwd) || (fromExpo && fromExpo.ios);
  const a = android(cwd) || (fromExpo && fromExpo.android);
  const tablets = Boolean(i && i.tablet);
  return {
    ios: i && { phone: i.phone, tablet: tablets ? i.tablet : null },
    android: a && { phone: a.phone, tablet: tablets ? a.tablet : null },
  };
}

// the screens to check on a platform, phone portrait first
function list(s, platform) {
  const p = s[platform] || { phone: ['portrait'], tablet: null };
  return [...p.phone.map(o => `phone-${o}`), ...(p.tablet || []).map(o => `tablet-${o}`)];
}

function describe(s) {
  const say = o => (o.length === 2 ? 'portrait and landscape' : `${o[0]} only`);
  const part = (kind, apple) => {
    const i = s.ios && s.ios[kind];
    const a = s.android && s.android[kind];
    if (i && a && say(i) !== say(a)) return `${say(i)} on ${apple}, ${say(a)} on Android`;
    return say(i || a || ['portrait']);
  };
  const tablets = (s.ios && s.ios.tablet) || (s.android && s.android.tablet);
  return tablets
    ? `phones (${part('phone', 'iPhone')}) and tablets (${part('tablet', 'iPad')})`
    : `phones only (${part('phone', 'iPhone')}), no iPad app`;
}

if (require.main === module) {
  const s = screens(process.cwd());
  const platform = process.argv[2];
  console.log(platform ? list(s, platform).join('\n') : describe(s));
}

module.exports = { screens, list, describe };
