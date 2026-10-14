// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const tmpDir = require('./tmp');
const { screens, list, describe } = require('../stacks/react-native/template/scripts/amk/screens.js');

const write = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
const plist = (phone, ipad) => `<plist><dict>
<key>UISupportedInterfaceOrientations</key>
<array>${phone.map(o => `\n\t\t<string>UIInterfaceOrientation${o}</string>`).join('')}
</array>${ipad ? `\n<key>UISupportedInterfaceOrientations~ipad</key>\n<array>${ipad.map(o => `\n\t\t<string>UIInterfaceOrientation${o}</string>`).join('')}\n</array>` : ''}
</dict></plist>`;
// a bare app as React Native's template makes it, with what each case changes
function bareApp({ family = '"1,2"', phone = ['Portrait'], ipad = ['LandscapeLeft', 'LandscapeRight', 'Portrait', 'PortraitUpsideDown'], lock = '', target = 36 } = {}) {
  const dir = tmpDir('amk-screens-');
  write(dir, 'ios/App.xcodeproj/project.pbxproj', `INFOPLIST_FILE = AppTests/Info.plist;\nINFOPLIST_FILE = App/Info.plist;\nTARGETED_DEVICE_FAMILY = ${family};\n`);
  write(dir, 'ios/App/Info.plist', plist(phone, ipad));
  write(dir, 'android/app/src/main/AndroidManifest.xml', `<manifest><application>
    <activity android:name=".MainActivity"${lock ? ` android:screenOrientation="${lock}"` : ''} android:exported="true">
      <intent-filter><action android:name="android.intent.action.MAIN" /></intent-filter>
    </activity>
  </application></manifest>`);
  write(dir, 'android/build.gradle', `buildscript { ext { compileSdkVersion = 36\n targetSdkVersion = ${target} } }`);
  return dir;
}

test('screens: read from the native projects, as React Native\'s template sets them', () => {
  const s = screens(bareApp());
  assert.deepStrictEqual(list(s, 'ios'), ['phone-portrait', 'tablet-portrait', 'tablet-landscape']);
  assert.deepStrictEqual(list(s, 'android'), ['phone-portrait', 'phone-landscape', 'tablet-portrait', 'tablet-landscape']);
  assert.strictEqual(describe(s), 'phones (portrait only on iPhone, portrait and landscape on Android) and tablets (portrait and landscape)');
});

test('screens: orientation locks, Android 16 on tablets, iPhone-only apps', () => {
  // locked to portrait on Android: tablets still turn when the app targets Android 16, which ignores the lock there
  let s = screens(bareApp({ lock: 'portrait' }));
  assert.deepStrictEqual(list(s, 'android'), ['phone-portrait', 'tablet-portrait', 'tablet-landscape']);
  s = screens(bareApp({ lock: 'sensorPortrait', target: 35 }));
  assert.deepStrictEqual(list(s, 'android'), ['phone-portrait', 'tablet-portrait']);
  assert.strictEqual(describe(s), 'phones (portrait only) and tablets (portrait and landscape on iPad, portrait only on Android)');
  // an iPhone-only app: no tablets on either platform
  s = screens(bareApp({ family: '1' }));
  assert.deepStrictEqual(list(s, 'ios'), ['phone-portrait']);
  assert.deepStrictEqual(list(s, 'android'), ['phone-portrait', 'phone-landscape']);
  assert.strictEqual(describe(s), 'phones only (portrait only on iPhone, portrait and landscape on Android), no iPad app');
  // every orientation everywhere, as init --new sets it up; no key at all means the same on iOS
  s = screens(bareApp({ phone: ['Portrait', 'LandscapeLeft', 'LandscapeRight'], ipad: null }));
  assert.strictEqual(describe(s), 'phones (portrait and landscape) and tablets (portrait and landscape)');
  const dir = bareApp();
  write(dir, 'ios/App/Info.plist', '<plist><dict></dict></plist>');
  assert.deepStrictEqual(list(screens(dir), 'ios'), ['phone-portrait', 'phone-landscape', 'tablet-portrait', 'tablet-landscape']);
});

test('screens: an Expo app without native folders reads app.json; nothing to read means a phone, upright', () => {
  const dir = tmpDir('amk-screens-');
  write(dir, 'app.json', JSON.stringify({ expo: { orientation: 'portrait' } }));
  assert.strictEqual(describe(screens(dir)), 'phones only (portrait only), no iPad app');
  write(dir, 'app.json', JSON.stringify({ expo: { orientation: 'default', ios: { supportsTablet: true } } }));
  assert.strictEqual(describe(screens(dir)), 'phones (portrait and landscape) and tablets (portrait and landscape)');
  // after expo prebuild, the generated project is what counts
  write(dir, 'ios/App.xcodeproj/project.pbxproj', 'INFOPLIST_FILE = App/Info.plist;\nTARGETED_DEVICE_FAMILY = 1;\n');
  write(dir, 'ios/App/Info.plist', plist(['Portrait']));
  assert.deepStrictEqual(list(screens(dir), 'ios'), ['phone-portrait']);
  const empty = tmpDir('amk-screens-');
  assert.deepStrictEqual(list(screens(empty), 'android'), ['phone-portrait']);
});
