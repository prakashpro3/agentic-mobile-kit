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
// as "serial avd" ("-" for a phone); starting an emulator adds one. adb logs what it's asked to do in calls. Without
// `build` the app has no android/ folder, so the build fails and only the device line matters; with it a stand-in
// gradlew "builds" an APK. `maestro` is the stand-in's script body.
function verifyAndroid({ connected, avds = '', env = {}, build = false, maestro = '' }) {
  const dir = tmpDir('amk-verify-device-');
  fs.cpSync(path.join(TEMPLATE, 'scripts/amk'), path.join(dir, 'app/scripts/amk'), { recursive: true });
  write(dir, 'state', connected.map(d => `${d}\n`).join(''));
  write(dir, 'sdk/platform-tools/adb', `#!/bin/sh
echo "$*" >> "$FAKE_STATE.calls"
case "$1" in
  devices) echo "List of devices attached"; while read s n; do printf '%s\\tdevice\\n' "$s"; done < "$FAKE_STATE" ;;
  -s) s=$2; shift 2
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
  -avd) echo "emulator-5600 $2" >> "$FAKE_STATE" ;;
esac
`, 0o755);
  write(dir, 'bin/maestro', `#!/bin/sh\n${maestro}`, 0o755);
  if (build) {
    write(dir, 'app/android/gradlew', '#!/bin/sh\n', 0o755);
    write(dir, 'app/android/app/build/outputs/apk/x/release/app-x-release.apk', '');
    write(dir, 'app/android/app/build.gradle', 'android { defaultConfig { applicationId "com.example.app" } }\n');
  }
  const r = spawnSync('sh', ['scripts/amk/verify.sh', 'android', '--flavor', 'x', '--label', 'run'], {
    cwd: path.join(dir, 'app'), encoding: 'utf8',
    env: { ...process.env, FAKE_STATE: path.join(dir, 'state'), ANDROID_HOME: path.join(dir, 'sdk'), PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`, AMK_ANDROID_DEVICE: '', AMK_ANDROID_AVD: '', ...env },
  });
  const calls = fs.existsSync(path.join(dir, 'state.calls')) ? fs.readFileSync(path.join(dir, 'state.calls'), 'utf8') : '';
  return { out: r.stdout + r.stderr, calls };
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
