// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const tmpDir = require('./tmp');

const TEMPLATE = path.join(__dirname, '../stacks/react-native/template');
const write = (dir, f, text, mode) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text, { mode }); };
const skip = process.platform === 'win32' && 'fakes adb with a shell script';

// verify.sh android, with stand-ins for adb, the emulator and Maestro. The state file lists the connected devices
// as "serial avd [tablet]" ("-" for a phone); starting an emulator adds one, a tablet if `tablets` names its AVD.
// adb logs what it's asked to do in calls. Without `build` the app has no android/ folder, so the build fails and only
// the device lines matter; with it a stand-in gradlew "builds" an APK. `maestro` is the stand-in's script body.
// `rotates`: the app supports iPad and isn't locked to portrait, as React Native's template is. `args`: verify.sh's.
// Maestro says it's 2.11.0, or FAKE_MAESTRO_VERSION; gradlew logs its arguments in calls.
function verifyAndroid({ connected, avds = '', tablets = '', env = {}, build = false, rotates = false, maestro = '', args = ['android', '--flavor', 'x', '--label', 'run'], files = {} }) {
  const dir = tmpDir('amk-verify-device-');
  fs.cpSync(path.join(TEMPLATE, 'scripts/amk'), path.join(dir, 'app/scripts/amk'), { recursive: true });
  write(dir, 'state', connected.map(d => `${d}\n`).join(''));
  write(dir, 'sdk/platform-tools/adb', `#!/bin/sh
echo "$*" >> "$FAKE_STATE.calls"
case "$1" in
  devices) echo "List of devices attached"; while read s n k; do printf '%s\\tdevice\\n' "$s"; done < "$FAKE_STATE" ;;
  -s) s=$2; shift 2
      if [ "$1 $2" = "shell wm size; wm density" ] || [ "$1 $2 $3" = "shell wm size" ]; then
        awk -v s="$s" '$1 == s { print ($3 == "tablet" ? "Physical size: 2560x1600\\nPhysical density: 320" : "Physical size: 1080x2400\\nPhysical density: 420") }' "$FAKE_STATE"
      fi
      case "$1 $2 $3" in
        "emu avd name") awk -v s="$s" '$1 == s { print $2; print "OK" }' "$FAKE_STATE" ;;
        "shell getprop sys.boot_completed") echo 1 ;;
        "shell getprop ro.product.cpu.abi") echo arm64-v8a ;;
      esac ;;
esac
`, 0o755);
  write(dir, 'sdk/emulator/emulator', `#!/bin/sh
case "$1" in
  -list-avds) for a in ${avds}; do echo "$a"; done ;;
  -avd) n=$(grep -c '^emulator-56' "$FAKE_STATE"); case " ${tablets} " in *" $2 "*) k=tablet ;; *) k= ;; esac
        echo "emulator-$((5600 + 2 * n)) $2 $k" >> "$FAKE_STATE" ;;
esac
`, 0o755);
  write(dir, 'bin/maestro', `#!/bin/sh\n[ "$1" = --version ] && { echo "\${FAKE_MAESTRO_VERSION:-2.11.0}"; exit 0; }\n${maestro}`, 0o755);
  for (const a of tablets.split(' ').filter(Boolean)) write(dir, `avd/${a}.avd/config.ini`, 'hw.lcd.density=320\nhw.lcd.height=2560\nhw.lcd.width=1600\n');
  for (const [f, text] of Object.entries(files)) write(dir, `app/${f}`, text);
  if (rotates) {
    write(dir, 'app/ios/App.xcodeproj/project.pbxproj', 'INFOPLIST_FILE = App/Info.plist;\nTARGETED_DEVICE_FAMILY = "1,2";\n');
    write(dir, 'app/ios/App/Info.plist', '<key>UISupportedInterfaceOrientations</key>\n<array>\n<string>UIInterfaceOrientationPortrait</string>\n</array>\n');
    write(dir, 'app/android/app/src/main/AndroidManifest.xml', '<activity android:name=".MainActivity">\n<action android:name="android.intent.action.MAIN" />\n</activity>\n');
  }
  if (build) {
    write(dir, 'app/android/gradlew', '#!/bin/sh\necho "gradlew $*" >> "$FAKE_STATE.calls"\n', 0o755);
    write(dir, 'app/android/app/build/outputs/apk/x/release/app-x-release.apk', '');
    write(dir, 'app/android/app/build.gradle', 'android { defaultConfig { applicationId "com.example.app" } }\n');
  }
  const r = spawnSync('sh', ['scripts/amk/verify.sh', ...args], {
    cwd: path.join(dir, 'app'), encoding: 'utf8',
    env: { ...process.env, FAKE_STATE: path.join(dir, 'state'), ANDROID_HOME: path.join(dir, 'sdk'), ANDROID_AVD_HOME: path.join(dir, 'avd'), PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`, AMK_ANDROID_DEVICE: '', AMK_ANDROID_AVD: '', ...env },
  });
  const readIf = f => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : '');
  return { out: r.stdout + r.stderr, calls: readIf('state.calls'), maestro: readIf('state.maestro') };
}

const chooseDevice = o => {
  const { out } = verifyAndroid(o);
  return (out.match(/^android: (checking on .*|there's no emulator.*|no emulator found.*(\n {2}.*)?)$/m) || [out])[0];
};

test('verify.sh android: an emulator, never a phone plugged in over USB unless named, since the flows clear the app\'s data', { skip }, () => {
  const phone = 'ZD22 -';
  assert.strictEqual(chooseDevice({ connected: [phone, 'emulator-5556 P35', 'emulator-5554 amk-test'], avds: 'P35 amk-test', env: { AMK_ANDROID_AVD: 'amk-test' } }),
    'android: checking on emulator-5554', 'the named emulator, not the first device');
  assert.strictEqual(chooseDevice({ connected: [phone, 'emulator-5556 P35'], avds: 'P35 amk-test' }), 'android: checking on emulator-5556', 'a running emulator');
  assert.strictEqual(chooseDevice({ connected: [phone], avds: 'P35 amk-test' }), 'android: checking on emulator-5600', 'starts one rather than use the phone');
  assert.strictEqual(chooseDevice({ connected: [phone, 'emulator-5556 P35'], avds: 'P35 amk-test', env: { AMK_ANDROID_AVD: 'amk-test' } }),
    'android: checking on emulator-5600', 'starts the named one, leaving the other emulator alone');
  assert.strictEqual(chooseDevice({ connected: [phone] }),
    "android: no emulator found (create one in Android Studio)\n  or check on the phone ZD22, which clears the app's data on it: AMK_ANDROID_DEVICE=ZD22 sh scripts/amk/verify.sh android",
    'no emulator at all: says how to use the phone, and doesn\'t');
  assert.strictEqual(chooseDevice({ connected: [] }), 'android: no emulator found (create one in Android Studio)');
  assert.match(chooseDevice({ connected: [phone, 'emulator-5556 P35'], avds: 'P35', env: { AMK_ANDROID_DEVICE: 'ZD22' } }), /checking on the phone ZD22; the flows clear the app's data on it/, 'named');
  assert.strictEqual(chooseDevice({ connected: [phone], avds: 'P35', env: { AMK_ANDROID_AVD: 'nope' } }),
    "android: there's no emulator named nope (see: emulator -list-avds)");
});

test('verify.sh android: hides "isn\'t responding" pop-ups on an emulator only, as the setting stays on the device', { skip }, () => {
  const shot = 'touch "$(echo "$@" | sed \'s/.*--test-output-dir \\([^ ]*\\).*/\\1/\')/shot.png"';
  const emulator = verifyAndroid({ connected: ['emulator-5556 P35'], build: true, maestro: shot });
  assert.match(emulator.out, /android: flows 1\/1 passed, 1 screenshots/);
  assert.match(emulator.calls, /-s emulator-5556 shell settings put global hide_error_dialogs 1/);
  const phone = verifyAndroid({ connected: ['ZD22 -'], build: true, maestro: shot, env: { AMK_ANDROID_DEVICE: 'ZD22' } });
  assert.match(phone.out, /android: flows 1\/1 passed, 1 screenshots/);
  assert.match(phone.calls, /-s ZD22 install -r/);
  assert.doesNotMatch(phone.calls, /settings put/);
});

test('verify.sh android: runs a flow once more when the emulator went offline, and only then', { skip }, () => {
  // Maestro writes "device offline" only to its own log (--debug-output); the first run fails that way
  const offlineOnce = `debug=$(echo "$@" | sed 's/.*--debug-output \\([^ ]*\\).*/\\1/'); out=$(echo "$@" | sed 's/.*--test-output-dir \\([^ ]*\\).*/\\1/')
mkdir -p "$debug"
if [ ! -f "$out/../tried" ]; then touch "$out/../tried"; echo "IOException: Command failed (host:transport:emulator-5556): device offline" >> "$debug/maestro.log"; exit 1; fi
touch "$out/shot.png"`;
  const r = verifyAndroid({ connected: ['emulator-5556 P35'], build: true, maestro: offlineOnce });
  assert.match(r.out, /the device went offline during flow smoke; running it once more/);
  assert.match(r.out, /android: flows 1\/1 passed, 1 screenshots/);
  assert.match(r.calls, /^reconnect offline$/m);
  const failing = verifyAndroid({ connected: ['emulator-5556 P35'], build: true, maestro: 'exit 1' });
  assert.doesNotMatch(failing.out, /once more/, 'other failures aren\'t run again');
  assert.match(failing.out, /flow smoke failed, see \.amk\/evidence\/run\/android\/smoke\.log and Maestro's own log \.amk\/evidence\/run\/maestro-logs\/android-smoke\/maestro\.log/);
});

// records the device, and the orientation a flow is turned to or "direct" for a flow run as it is, then saves a screenshot
const record = String.raw`for last; do :; done
out=$(echo "$@" | sed 's/.*--test-output-dir \([^ ]*\).*/\1/'); device=$(echo "$@" | sed 's/.*--device \([^ ]*\).*/\1/')
case $last in
  */screen.yaml) echo "$device $(sed -n 's/^- setOrientation: //p' "$last") $(sed -n "s/^- runFlow: '\(.*\)'$/\1/p" "$last" | sed 's/.*\///')" ;;
  *) echo "$device direct $(basename "$last")" ;;
esac >> "$FAKE_STATE.maestro"
touch "$out/shot.png"`;

test('verify.sh android: an app that turns and runs on tablets is checked on a phone and a tablet, upright and turned', { skip }, () => {
  // a running tablet emulator isn't taken for the phone; a tablet AVD starts for the tablet screens
  const r = verifyAndroid({ connected: ['emulator-5554 Big tablet', 'emulator-5556 P35'], avds: 'Big P35', tablets: 'Big', rotates: true, build: true, maestro: record });
  assert.match(r.out, /android: checking on emulator-5556\nandroid: tablets on emulator-5554\n/);
  for (const screen of ['android', 'android-landscape', 'android-tablet', 'android-tablet-landscape']) {
    assert.match(r.out, new RegExp(`^${screen}: flows 1/1 passed, 1 screenshots in \\.amk/evidence/run/${screen}$`, 'm'));
  }
  // upright flows run as they are, as before tablets and landscape; turned ones inside a flow that turns the device.
  // The tablet is landscape when Maestro calls it upright (its natural orientation, like a Pixel Tablet's): swapped
  assert.strictEqual(r.maestro, 'emulator-5556 direct smoke.yaml\nemulator-5556 LANDSCAPE_LEFT smoke.yaml\nemulator-5554 LANDSCAPE_LEFT smoke.yaml\nemulator-5554 direct smoke.yaml\n');
  assert.match(r.calls, /-s emulator-5554 install -r/);
  assert.match(r.calls, /-s emulator-5554 shell settings put global hide_error_dialogs 1/);

  const started = verifyAndroid({ connected: ['emulator-5556 P35'], avds: 'P35 Tab', tablets: 'Tab', rotates: true, build: true, maestro: record });
  assert.match(started.out, /android: tablets on emulator-5600\n/);
  assert.match(started.out, /^android-tablet-landscape: flows 1\/1 passed/m);

  // no tablet emulator: says so, and checks the phone both ways
  const none = verifyAndroid({ connected: ['emulator-5556 P35'], avds: 'P35', rotates: true, build: true, maestro: record });
  assert.match(none.out, /the app runs on tablets, but there's no tablet emulator, so tablets aren't checked \(create one in Android Studio: Device Manager > Tablet, or set AMK_ANDROID_TABLET_AVD\)/);
  assert.strictEqual(none.maestro, 'emulator-5556 direct smoke.yaml\nemulator-5556 LANDSCAPE_LEFT smoke.yaml\n');
  assert.doesNotMatch(none.out, /android-tablet/);

  // without tablet or landscape support: the phone upright only, as before
  const plain = verifyAndroid({ connected: ['emulator-5554 Big tablet', 'emulator-5556 P35'], avds: 'Big P35', tablets: 'Big', build: true, maestro: record });
  assert.strictEqual(plain.maestro, 'emulator-5556 direct smoke.yaml\n');
  assert.doesNotMatch(plain.out, /tablets/);
});

test('verify.sh android: --screens and AMK_SCREENS narrow the screens, and Maestro before 2.0 checks only what needs no turning', { skip }, () => {
  const devices = { connected: ['emulator-5554 Big tablet', 'emulator-5556 P35'], avds: 'Big P35', tablets: 'Big', rotates: true, build: true, maestro: record };
  const phone = verifyAndroid({ ...devices, args: ['android', '--flavor', 'x', '--label', 'run', '--screens', 'phone'] });
  assert.strictEqual(phone.maestro, 'emulator-5556 direct smoke.yaml\nemulator-5556 LANDSCAPE_LEFT smoke.yaml\n');
  assert.doesNotMatch(phone.out, /tablets on/, 'no tablet chosen');
  // one screen: only its device is chosen and installed
  const one = verifyAndroid({ ...devices, env: { AMK_SCREENS: 'tablet-landscape' } });
  assert.strictEqual(one.maestro, 'emulator-5554 direct smoke.yaml\n');
  assert.doesNotMatch(one.out, /checking on/);
  assert.doesNotMatch(one.calls, /-s emulator-5556 install/);
  // an older Maestro can't turn devices: those screens say so, the rest are checked
  const old = verifyAndroid({ ...devices, env: { FAKE_MAESTRO_VERSION: '1.39.13' } });
  assert.strictEqual(old.maestro, 'emulator-5556 direct smoke.yaml\nemulator-5554 direct smoke.yaml\n');
  assert.match(old.out, /^android-landscape: not checked: turning the device needs Maestro 2\.0 or later \(this is 1\.39\.13\)$/m);
  assert.match(old.out, /^android-tablet: not checked: turning the device needs Maestro 2\.0 or later/m);
});

test('verify.sh build and --no-build: build once, then check each device without building again', { skip }, () => {
  // build: the release build without a device, for this machine's CPU type (iOS builds too, on a Mac)
  const built = verifyAndroid({ connected: [], build: true, args: ['build', '--flavor', 'x', '--label', 'run'] });
  assert.match(built.out, /^android: release build done$/m);
  assert.match(built.calls, new RegExp(`^gradlew assembleXRelease --no-daemon -q -PreactNativeArchitectures=${process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64'}`, 'm'));
  assert.doesNotMatch(built.calls, /install|devices/, 'no device');
  // --no-build: the APK that's there, no Gradle
  const checked = verifyAndroid({ connected: ['emulator-5556 P35'], avds: 'P35', build: true, maestro: record, args: ['android', '--flavor', 'x', '--label', 'run', '--no-build'] });
  assert.doesNotMatch(checked.calls, /gradlew/);
  assert.match(checked.out, /^android: flows 1\/1 passed, 1 screenshots/m);
  const nothing = verifyAndroid({ connected: ['emulator-5556 P35'], avds: 'P35', maestro: record, args: ['android', '--label', 'run', '--no-build'] });
  assert.match(nothing.out, /android: there's no build to check yet: run sh scripts\/amk\/verify\.sh build first/);
});

test('verify.sh plan: every device at the same time where the machine has room, else one command', { skip }, () => {
  const mac = process.platform === 'darwin';
  const plan = (env, rotates = true) => verifyAndroid({ connected: [], rotates, env, args: ['plan', '--spec', 'x1'] }).out;
  const parallel = plan({ AMK_PARALLEL: '1' });
  assert.match(parallel, new RegExp(`^plan: \\d+ GB of memory, \\d+ GB free disk, Maestro 2\\.11\\.0: check the ${mac ? 4 : 2} devices at the same time$`, 'm'));
  assert.match(parallel, /^ {2}1\. sh scripts\/amk\/verify\.sh quick --spec x1\n {2}2\. sh scripts\/amk\/verify\.sh build --spec x1\n {2}3\. at the same time, each in its own subagent \(m-device-checker\)/m);
  const checks = (mac ? ['ios phone', 'ios tablet'] : []).concat(['android phone', 'android tablet'])
    .map(c => `     sh scripts/amk/verify.sh ${c.replace(' ', ' --no-build --screens ')} --spec x1`).join('\n');
  assert.ok(parallel.includes(checks), parallel);
  assert.match(plan({ AMK_PARALLEL: '0' }), /one device at a time \(AMK_PARALLEL=0; AMK_PARALLEL=1 overrides\)\n {2}sh scripts\/amk\/verify\.sh all --spec x1\n/);
  assert.match(plan({ FAKE_MAESTRO_VERSION: '2.2.0' }), /one device at a time \(.*it needs Maestro 2\.6 or later; AMK_PARALLEL=1 overrides\)/);
  // a phone-only app off a Mac: one device, nothing to share out
  if (!mac) assert.match(plan({ AMK_PARALLEL: '1' }, false), /one device at a time \(there's one device to check/);
});

test("verify.sh: Maestro 2.7 and later keep takeScreenshot files in the debug output; they join the screen's evidence, an earlier run's don't", { skip }, () => {
  // like Maestro 2.11 with --debug-output: <debug>/<flow>/takeScreenshot/<name>.png, nothing in --test-output-dir
  const bundled = String.raw`for last; do :; done
debug=$(echo "$@" | sed 's/.*--debug-output \([^ ]*\).*/\1/')
mkdir -p "$debug/flow/takeScreenshot"
touch "$debug/flow/takeScreenshot/launch.png"`;
  const stale = { '.amk/evidence/run/maestro-logs/android-smoke/flow/takeScreenshot/earlier.png': '' };
  const r = verifyAndroid({ connected: ['emulator-5556 P35'], avds: 'P35', build: true, maestro: bundled, files: stale });
  assert.match(r.out, /^android: flows 1\/1 passed, 1 screenshots in \.amk\/evidence\/run\/android$/m, 'launch.png, not earlier.png');
});
