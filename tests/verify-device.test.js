// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const tmpDir = require('./tmp');

const TEMPLATE = path.join(__dirname, '../stacks/react-native/template');
const write = (dir, f, text, mode) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text, { mode }); };

// verify.sh android up to its device choice, with stand-ins for adb, the emulator and Maestro. The state file lists
// the connected devices as "serial avd" ("-" for a phone); starting an emulator adds one. The build then fails, as
// the app has no android/ folder, so only the device line matters.
function chooseDevice({ connected, avds = '', env = {} }) {
  const dir = tmpDir('amk-verify-device-');
  fs.cpSync(path.join(TEMPLATE, 'scripts/amk'), path.join(dir, 'app/scripts/amk'), { recursive: true });
  write(dir, 'state', connected.map(d => `${d}\n`).join(''));
  write(dir, 'sdk/platform-tools/adb', `#!/bin/sh
case "$1" in
  devices) echo "List of devices attached"; while read s n; do printf '%s\\tdevice\\n' "$s"; done < "$FAKE_STATE" ;;
  -s) s=$2; shift 2
      case "$1 $2" in
        "emu avd") awk -v s="$s" '$1 == s { print $2; print "OK" }' "$FAKE_STATE" ;;
        "shell getprop") echo arm64-v8a ;;
      esac ;;
esac
`, 0o755);
  write(dir, 'sdk/emulator/emulator', `#!/bin/sh
case "$1" in
  -list-avds) for a in ${avds}; do echo "$a"; done ;;
  -avd) echo "emulator-5600 $2" >> "$FAKE_STATE" ;;
esac
`, 0o755);
  write(dir, 'bin/maestro', '#!/bin/sh\n', 0o755);
  const r = spawnSync('sh', ['scripts/amk/verify.sh', 'android', '--flavor', 'x'], {
    cwd: path.join(dir, 'app'), encoding: 'utf8',
    env: { ...process.env, FAKE_STATE: path.join(dir, 'state'), ANDROID_HOME: path.join(dir, 'sdk'), PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`, AMK_ANDROID_DEVICE: '', AMK_ANDROID_AVD: '', ...env },
  });
  return (r.stdout.match(/^android: (checking on .*|there's no emulator.*)$/m) || [r.stdout + r.stderr])[0];
}

test('verify.sh android: an emulator before a phone plugged in over USB, since the flows clear the app\'s data', { skip: process.platform === 'win32' && 'fakes adb with a shell script' }, () => {
  const phone = 'ZD22 -';
  assert.strictEqual(chooseDevice({ connected: [phone, 'emulator-5556 P35', 'emulator-5554 amk-test'], avds: 'P35 amk-test', env: { AMK_ANDROID_AVD: 'amk-test' } }),
    'android: checking on emulator-5554', 'the named emulator, not the first device');
  assert.strictEqual(chooseDevice({ connected: [phone, 'emulator-5556 P35'], avds: 'P35 amk-test' }), 'android: checking on emulator-5556', 'a running emulator');
  assert.strictEqual(chooseDevice({ connected: [phone], avds: 'P35 amk-test' }), 'android: checking on emulator-5600', 'starts one rather than use the phone');
  assert.strictEqual(chooseDevice({ connected: [phone, 'emulator-5556 P35'], avds: 'P35 amk-test', env: { AMK_ANDROID_AVD: 'amk-test' } }),
    'android: checking on emulator-5600', 'starts the named one, leaving the other emulator alone');
  assert.match(chooseDevice({ connected: [phone] }), /checking on the phone ZD22; the flows clear the app's data on it/, 'no emulator at all');
  assert.match(chooseDevice({ connected: [phone, 'emulator-5556 P35'], avds: 'P35', env: { AMK_ANDROID_DEVICE: 'ZD22' } }), /checking on the phone ZD22/, 'named');
  assert.strictEqual(chooseDevice({ connected: [phone], avds: 'P35', env: { AMK_ANDROID_AVD: 'nope' } }),
    "android: there's no emulator named nope (see: emulator -list-avds)");
});
