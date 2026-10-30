// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const tmpDir = require('./tmp');
const png = require('./png');

const TEMPLATE = path.join(__dirname, '../stacks/react-native/template');
const write = (dir, f, text, mode) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text, { mode }); };
const skip = process.platform === 'win32' && 'fakes adb with a shell script';

// verify.sh android, with stand-ins for adb, the emulator and Maestro. The state file lists the connected devices
// as "serial avd [tablet]" ("-" for a phone); starting an emulator adds one, a tablet if `tablets` names its AVD.
// adb logs what it's asked to do in calls. Without `build` the app has no android/ folder, so the build fails and only
// the device lines matter; with it a stand-in gradlew "builds" an APK. `maestro` is the stand-in's script body.
// `rotates`: the app supports iPad and isn't locked to portrait, as React Native's template is. `args`: verify.sh's.
// Maestro says it's 2.11.0, or FAKE_MAESTRO_VERSION; gradlew logs its arguments in calls.
// `held`: device locks another run holds, as { key: [pid, who, since] }; `ps`: the processes the stand-in ps lists.
function verifyAndroid({ connected, avds = '', tablets = '', env = {}, build = false, rotates = false, maestro = '', args = ['android', '--flavor', 'x', '--label', 'run'], files = {}, held = {}, ps = '', git = false, prepare = null, sleepless = false }) {
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
        "emu kill ") awk -v s="$s" '$1 != s' "$FAKE_STATE" > "$FAKE_STATE.left" && mv "$FAKE_STATE.left" "$FAKE_STATE" ;;
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
  fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
  // {project} in a key: this app's build locks, named from its folder's path as verify.sh sees it
  const project = spawnSync('sh', ['-c', 'printf %s "$(pwd)" | cksum | cut -d " " -f 1'], { cwd: path.join(dir, 'app') }).stdout.toString().trim();
  for (const [key, owner] of Object.entries(held)) write(dir, `locks/${key.replace('{project}', project)}/owner`, `${owner.join('\n')}\n`);
  write(dir, 'bin/ps', `#!/bin/sh\nprintf '%s\\n' "${ps}"\n`, 0o755);
  // waits that matter only on real devices take no time
  if (sleepless) write(dir, 'bin/sleep', '#!/bin/sh\n', 0o755);
  if (rotates) {
    write(dir, 'app/ios/App.xcodeproj/project.pbxproj', 'INFOPLIST_FILE = App/Info.plist;\nTARGETED_DEVICE_FAMILY = "1,2";\n');
    write(dir, 'app/ios/App/Info.plist', '<key>UISupportedInterfaceOrientations</key>\n<array>\n<string>UIInterfaceOrientationPortrait</string>\n</array>\n');
    write(dir, 'app/android/app/src/main/AndroidManifest.xml', '<activity android:name=".MainActivity">\n<action android:name="android.intent.action.MAIN" />\n</activity>\n');
  }
  if (build) {
    write(dir, 'app/android/gradlew', '#!/bin/sh\necho "gradlew $* (sentry upload off: $SENTRY_DISABLE_AUTO_UPLOAD)" >> "$FAKE_STATE.calls"\necho "gradle sdk: $ANDROID_HOME" >> "$FAKE_STATE.calls"\n', 0o755);
    write(dir, 'app/android/app/build/outputs/apk/x/release/app-x-release.apk', '');
    write(dir, 'app/android/app/build.gradle', 'android { defaultConfig { applicationId "com.example.app" } }\n');
  }
  if (git) spawnSync('sh', ['-c', 'git init -q && git add -A'], { cwd: path.join(dir, 'app') });
  if (prepare) prepare(path.join(dir, 'app'));
  const r = spawnSync('sh', ['scripts/amk/verify.sh', ...args], {
    cwd: path.join(dir, 'app'), encoding: 'utf8',
    env: { ...process.env, FAKE_STATE: path.join(dir, 'state'), ANDROID_HOME: path.join(dir, 'sdk'), ANDROID_SDK_ROOT: path.join(dir, 'sdk'), ANDROID_AVD_HOME: path.join(dir, 'avd'), AMK_LOCK_DIR: path.join(dir, 'locks'), PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`, AMK_ANDROID_DEVICE: '', AMK_ANDROID_AVD: '', AMK_DISK_GB: '50', ...env },
  });
  const readIf = f => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : '');
  const locks = fs.existsSync(path.join(dir, 'locks')) ? fs.readdirSync(path.join(dir, 'locks')) : [];
  return { out: r.stdout + r.stderr, calls: readIf('state.calls'), maestro: readIf('state.maestro'), locks, status: r.status, app: path.join(dir, 'app') };
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
if [ ! -f "$out/../tried" ]; then touch "$out/../tried"; echo "IOException: Command failed (host:transport:emulator-5556): device offline" >> "$debug/maestro.log"; echo "Launch app... FAILED"; exit 1; fi
touch "$out/shot.png"`;
  const r = verifyAndroid({ connected: ['emulator-5556 P35'], build: true, maestro: offlineOnce, sleepless: true });
  assert.match(r.out, /the device went offline during flow smoke; running it once more/);
  assert.match(r.out, /android: flows 1\/1 passed, 1 screenshots/);
  assert.match(r.calls, /^reconnect offline$/m);
  // another emulator starting or stopping can drop it for a moment as Maestro starts, which Maestro says in the flow's log
  const missedOnce = `out=$(echo "$@" | sed 's/.*--test-output-dir \\([^ ]*\\).*/\\1/')
if [ ! -f "$out/../tried" ]; then touch "$out/../tried"; echo "Device emulator-5556 was requested, but it is not connected."; exit 1; fi
touch "$out/shot.png"`;
  const missed = verifyAndroid({ connected: ['emulator-5556 P35'], build: true, maestro: missedOnce, sleepless: true });
  assert.match(missed.out, /the device went offline during flow smoke; running it once more when it answers steadily\nandroid: flows 1\/1 passed, 1 screenshots/);
  // Maestro's server on the device died (an emulator under load can drop out for a few minutes): run again, twice at most
  const drops = String.raw`debug=$(echo "$@" | sed 's/.*--debug-output \([^ ]*\).*/\1/'); out=$(echo "$@" | sed 's/.*--test-output-dir \([^ ]*\).*/\1/')
mkdir -p "$debug"; n=$(( $(cat "$out/../tries" 2> /dev/null || echo 0) + 1 )); echo "$n" > "$out/../tries"
if [ "$n" -le "$DROPS" ]; then echo "maestro.android.DeviceServerDiedException: Device server died during 'deviceInfo' on emulator-5556" >> "$debug/maestro.log"; echo "Launch app...Disable airplane mode..."; exit 1; fi
touch "$out/shot.png"`;
  const twice = verifyAndroid({ connected: ['emulator-5556 P35'], build: true, maestro: drops, env: { DROPS: '2' }, sleepless: true });
  assert.strictEqual((twice.out.match(/the device went offline during flow smoke/g) || []).length, 2);
  assert.match(twice.out, /android: flows 1\/1 passed, 1 screenshots/);
  const thrice = verifyAndroid({ connected: ['emulator-5556 P35'], build: true, maestro: drops, env: { DROPS: '3' }, sleepless: true });
  assert.strictEqual((thrice.out.match(/the device went offline during flow smoke/g) || []).length, 2, 'twice at most');
  assert.match(thrice.out, /android: flows 0\/1 passed/);
  // the step it dropped out of has no FAILED line: the reason is the device, not the flow
  assert.match(thrice.out, /^ {4}failed when the device went offline, on each try \(an emulator under load drops out: check again with fewer devices open\)$/m);
  // as Maestro does: its folder named after the file it ran (the copy with view-tree steps), and a step that failed in
  // a subflow: the subflows around it fail too, onFlowComplete runs, then Maestro's message
  const failing = verifyAndroid({ connected: ['emulator-5556 P35'], build: true, maestro: String.raw`debug=$(echo "$@" | sed 's/.*--debug-output \([^ ]*\).*/\1/')
for last; do :; done; f=$debug/$(basename "$last" .yaml)
mkdir -p "$f/screenshots"; touch "$f/screenshots/step-002-launch.png" "$f/screenshots/step-005-assertVisible.png"
touch "$f/screenshots/step-007-assertCondition-amk-view-tree-smoke-launch.png"
echo "  Launch app... COMPLETED"; echo "    Assert that id: x is visible... FAILED"; echo "  Run login.yaml... FAILED"; echo "Run flows/start.yaml... FAILED"
echo "Disable airplane mode... COMPLETED"; echo ""; echo "Assertion is false: id: x is visible"; exit 1` });
  // a failure of its own runs once more, to tell a flaky flow from a failing one, and nothing more
  assert.strictEqual((failing.out.match(/once more/g) || []).length, 1, failing.out);
  assert.match(failing.out, /^ {2}android: flow smoke failed; running it once more, to tell a flaky flow from a failing one$/m);
  assert.deepStrictEqual(fs.readdirSync(path.join(failing.app, '.amk/evidence/run/maestro-logs/android-smoke')).filter(d => d !== 'maestro.log'), ['smoke'], 'the flow\'s own name, not the copy\'s hidden one');
  assert.match(failing.out, /flow smoke failed, see \.amk\/evidence\/run\/android\/smoke\.log and Maestro's own log \.amk\/evidence\/run\/maestro-logs\/android-smoke\/maestro\.log\n {4}failed at "Assert that id: x is visible": Assertion is false: id: x is visible\n {4}the screen when it failed: \.amk\/evidence\/run\/maestro-logs\/android-smoke\/smoke\/screenshots\/step-005-assertVisible\.png\n/);
  // the report: the flow, why it failed, the screen then; and CI's results
  assert.match(failing.out, /^Report: \.amk\/evidence\/run\/report\.md \(each flow's result, why one failed, and its screenshots\)$/m);
  const report = fs.readFileSync(path.join(failing.app, '.amk/evidence/run/report.md'), 'utf8');
  assert.match(report, /^### ✗ smoke\n\nFailed at "Assert that id: x is visible": Assertion is false: id: x is visible\. Log: \[android\/smoke\.log\]\(android\/smoke\.log\) · \[the screen when it failed\]\(maestro-logs\/android-smoke\/smoke\/screenshots\/step-005-assertVisible\.png\)$/m);
  assert.match(fs.readFileSync(path.join(failing.app, '.amk/evidence/run/junit.xml'), 'utf8'), /<testcase classname="android" name="smoke"><failure message="at &quot;Assert that id: x is visible&quot;: Assertion is false: id: x is visible"\/><\/testcase>/);
  // a flow that passed: its screenshots in the report
  assert.match(fs.readFileSync(path.join(twice.app, '.amk/evidence/run/report.md'), 'utf8'), /^### ✓ smoke\n\n<img src="android\/shot\.png" width="180" alt="shot" title="shot">$/m);
});

// records the device, and the orientation a flow is turned to or "direct" for a flow run as it is (the flow's own name, not
// the copy with view-tree steps that Android runs), then saves a screenshot
// the shape the device shows: a phone tall and a tablet wide, unless turned (NOTURN set: the app never turns)
const record = String.raw`for last; do :; done
out=$(echo "$@" | sed 's/.*--test-output-dir \([^ ]*\).*/\1/'); device=$(echo "$@" | sed 's/.*--device \([^ ]*\).*/\1/')
case $last in
  */screen.yaml) o=$(sed -n 's/^- setOrientation: //p' "$last"); line="$device $o $(sed -n "s/^- runFlow: '\(.*\)'$/\1/p" "$last" | sed 's/.*\///')" ;;
  *) o=natural; line="$device direct $(basename "$last")" ;;
esac
echo "$line" | sed 's/ \.amk-android\(-tablet\)\{0,1\}\(-landscape\)\{0,1\}-/ /' >> "$FAKE_STATE.maestro"
echo "$device $(echo "$@" | sed -n 's/.* -e ORIENTATION=\([^ ]*\) .*/\1/p')" >> "$FAKE_STATE.orientation"
if [ "$(awk -v s="$device" '$1 == s { print $3 }' "$FAKE_STATE")" = tablet ]; then w=2560 h=1600; else w=1080 h=2400; fi
[ "$o" != LANDSCAPE_LEFT ] || [ -n "$NOTURN" ] || { t=$w; w=$h; h=$t; }
[ ! -f "$out/../noturn-once" ] || { rm "$out/../noturn-once"; t=$w; w=$h; h=$t; }
node -e 'const b = Buffer.alloc(24); b.writeUInt32BE(+process.argv[2], 16); b.writeUInt32BE(+process.argv[3], 20); require("fs").writeFileSync(process.argv[1], b)' "$out/shot.png" $w $h`;

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
  // and each tells its flows how it turned the device (\${ORIENTATION}), to turn it back after another app's screen
  // turned it (issue #11)
  assert.strictEqual(fs.readFileSync(path.join(path.dirname(r.app), 'state.orientation'), 'utf8'),
    'emulator-5556 PORTRAIT\nemulator-5556 LANDSCAPE_LEFT\nemulator-5554 LANDSCAPE_LEFT\nemulator-5554 PORTRAIT\n');
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
  // with no ANDROID_HOME (an AI tool started from the Dock doesn't load the shell's profile), Gradle gets the SDK verify.sh found
  const noHome = verifyAndroid({ connected: [], build: true, env: { ANDROID_HOME: '' }, args: ['build', '--flavor', 'x', '--label', 'run'] });
  assert.match(noHome.calls, /^gradle sdk: \S+\/sdk$/m, noHome.calls);
  assert.match(built.calls, /^gradlew assembleXRelease .*--init-script \S+\/scripts\/amk\/no-symbol-upload\.gradle \(sentry upload off: true\)$/m, 'a check build sends no symbols to crash reporters');
  // --no-build: the APK that's there, no Gradle
  const checked = verifyAndroid({ connected: ['emulator-5556 P35'], avds: 'P35', build: true, maestro: record, args: ['android', '--flavor', 'x', '--label', 'run', '--no-build'] });
  assert.doesNotMatch(checked.calls, /gradlew/);
  assert.match(checked.out, /^android: flows 1\/1 passed, 1 screenshots/m);
  const nothing = verifyAndroid({ connected: ['emulator-5556 P35'], avds: 'P35', maestro: record, args: ['android', '--label', 'run', '--no-build'] });
  assert.match(nothing.out, /android: there's no build to check yet: run sh scripts\/amk\/verify\.sh build first/);
});

test('verify.sh plan: as many devices at once as memory allows (about 6 GB each, 4 GB kept), in rounds; else one command', { skip }, () => {
  const mac = process.platform === 'darwin';
  // with 50 GB of free disk, whatever this machine has
  const plan = (env, rotates = true) => verifyAndroid({ connected: [], rotates, env: { AMK_DISK_GB: '50', ...env }, args: ['plan', '--spec', 'x1'] }).out;
  const cmd = c => `     sh scripts/amk/verify.sh ${c.replace(' ', ' --no-build --screens ')} --spec x1`;
  // room for every device: one round, the phones first
  const all = plan({ AMK_MEMORY_GB: '32' });
  assert.match(all, new RegExp(`^plan: 32 GB of memory, \\d+ GB free disk, Maestro 2\\.11\\.0: check the ${mac ? 4 : 2} devices at the same time$`, 'm'));
  assert.match(all, /^ {2}1\. sh scripts\/amk\/verify\.sh quick --spec x1\n {2}2\. sh scripts\/amk\/verify\.sh build --spec x1\n {2}3\. at the same time, each in its own subagent \(m-device-checker\)/m);
  assert.ok(all.includes((mac ? ['ios phone', 'android phone', 'ios tablet', 'android tablet'] : ['android phone', 'android tablet']).map(cmd).join('\n')), all);
  // 16 GB holds two: an iPhone and a phone emulator first, then the tablets
  if (mac) {
    const rounds = plan({ AMK_MEMORY_GB: '16' });
    assert.match(rounds, /^plan: 16 GB of memory, .*: 2 devices at a time, in 2 rounds$/m);
    assert.ok(rounds.includes(`  3. round 1 of 2, at the same time, each in its own subagent (m-device-checker), which checks its screenshots and reports:\n${['ios phone', 'android phone'].map(cmd).join('\n')}\n  4. round 2 of 2, once round 1 has reported, the same way:\n${['ios tablet', 'android tablet'].map(cmd).join('\n')}\n`), rounds);
  }
  assert.match(plan({ AMK_MEMORY_GB: '12' }), /one device at a time \(it needs 16 GB of memory; AMK_PARALLEL=1 overrides\)\n {2}sh scripts\/amk\/verify\.sh all --spec x1\n/);
  assert.match(plan({ AMK_MEMORY_GB: '32', AMK_DISK_GB: '12' }), /^plan: 32 GB of memory, 12 GB free disk, Maestro 2\.11\.0: one device at a time \(it needs 20 GB free disk; AMK_PARALLEL=1 overrides\)$/m);
  assert.match(plan({ AMK_MEMORY_GB: '64', AMK_DEVICES: '1' }), /one device at a time \(AMK_DEVICES=1; AMK_PARALLEL=1 overrides\)/);
  assert.match(plan({ AMK_PARALLEL: '0' }), /one device at a time \(AMK_PARALLEL=0; AMK_PARALLEL=1 overrides\)/);
  assert.match(plan({ AMK_MEMORY_GB: '12', AMK_PARALLEL: '1' }), new RegExp(`check the ${mac ? 4 : 2} devices at the same time`));
  assert.match(plan({ AMK_MEMORY_GB: '32', FAKE_MAESTRO_VERSION: '2.2.0' }), /one device at a time \(it needs Maestro 2\.6 or later; AMK_PARALLEL=1 overrides\)/);
  // a phone-only app off a Mac: one device, nothing to share out
  if (!mac) assert.match(plan({ AMK_PARALLEL: '1' }, false), /one device at a time \(there's one device to check/);
});

const threeFlows = { '.maestro/x1-a.yaml': 'appId: x\n---\n- launchApp\n', '.maestro/x1-b.yaml': 'appId: x\n---\n- launchApp\n', '.maestro/x1-c.yaml': 'appId: x\n---\n- launchApp\n' };

test('verify.sh plan: room for more devices than kinds splits each kind\'s flows into parts, each on its own device; never a real device\'s', { skip }, () => {
  const mac = process.platform === 'darwin';
  const plan = env => verifyAndroid({ connected: [], rotates: false, env: { AMK_DISK_GB: '50', ...env }, files: threeFlows, args: ['plan', '--spec', 'x1'] }).out;
  // a phone-only app: a part's device counts 6 GB for a simulator and 8 GB for an emulator, so 28 GB doesn't split an
  // iPhone and a phone emulator (2 × 14 > 24), and 32 GB does; Android alone needs 20 GB for 2 parts
  if (mac) assert.match(plan({ AMK_MEMORY_GB: '28' }), /check the 2 devices at the same time/);
  else {
    assert.match(plan({ AMK_MEMORY_GB: '16' }), /one device at a time \(there's one device to check/);
    assert.match(plan({ AMK_MEMORY_GB: '20' }), /check on 2 devices at the same time, each kind's flows in parts/);
  }
  // AMK_DEVICES says how many outright
  assert.match(plan({ AMK_MEMORY_GB: '16', AMK_DEVICES: mac ? '4' : '2' }), /each kind's flows in parts/);
  const out = plan({ AMK_MEMORY_GB: '32' });
  const kinds = mac ? ['ios', 'android'] : ['android'];
  const per = mac ? 2 : 3;
  assert.match(out, new RegExp(`check on ${kinds.length * per} devices at the same time, each kind's flows in parts`));
  for (const k of kinds) for (let i = 1; i <= per; i++) assert.ok(out.includes(`     sh scripts/amk/verify.sh ${k} --no-build --screens phone --part ${i}/${per} --spec x1\n`), out);
  // a phone plugged in can't be copied for a part: it runs all its flows
  const phone = plan({ AMK_MEMORY_GB: '32', AMK_ANDROID_DEVICE: 'ZX1' });
  assert.ok(phone.includes('     sh scripts/amk/verify.sh android --no-build --screens phone --spec x1\n'), phone);
  assert.doesNotMatch(phone, /verify\.sh android .*--part/);
});

test('verify.sh --part k/n: its share of the flows, in <screen>/part-k/; a later part on a temporary copy of the emulator, deleted afterwards', { skip }, () => {
  // the flows each run records its screen and flow (from Maestro's debug folder) and the device
  const maestro = String.raw`debug=$(echo "$@" | sed 's/.*--debug-output \([^ ]*\).*/\1/'); out=$(echo "$@" | sed 's/.*--test-output-dir \([^ ]*\).*/\1/'); dev=$(echo "$@" | sed 's/.*--device \([^ ]*\).*/\1/')
echo "$(basename "$debug") on $dev" >> "$FAKE_STATE.flows"; touch "$out/$(basename "$debug" | sed 's/.*-//').png"`;
  // the AVD as Android Studio may leave it: renamed, its folder still under the old name
  const avd = app => {
    fs.mkdirSync(path.join(app, '../avd/Pixel_9.avd'), { recursive: true });
    fs.writeFileSync(path.join(app, '../avd/Pixel_9.avd/config.ini'), 'AvdId=P35\navd.ini.displayname=P35\nhw.lcd.density=420\nhw.lcd.height=2424\nhw.lcd.width=1080\nhw.ramSize=4096\n');
    fs.writeFileSync(path.join(app, '../avd/P35.ini'), `path=${path.join(app, '../avd/Pixel_9.avd')}\ntarget=android-35\n`);
  };
  const flowsRan = r => fs.readFileSync(path.join(r.app, '../state.flows'), 'utf8').trim().split('\n');
  const args = part => ['android', '--flavor', 'x', '--label', 'run', '--spec', 'x1', '--part', part];
  // part 1 of 2: flows a and c on the usual emulator; what an earlier run left beside the parts goes, part 2's stays
  const first = verifyAndroid({ connected: ['emulator-5554 P35'], avds: 'P35', build: true, maestro, prepare: avd, args: args('1/2'),
    files: { ...threeFlows, '.amk/evidence/run/android/old.png': '', '.amk/evidence/run/android/part-3/stale.png': '', '.amk/evidence/run/android/part-2/b.png': '' } });
  assert.strictEqual(first.status, 0, first.out);
  assert.deepStrictEqual(flowsRan(first), ['android-x1-a on emulator-5554', 'android-x1-c on emulator-5554']);
  assert.match(first.out, /^android: flows 2\/2 passed, 2 screenshots in \.amk\/evidence\/run\/android\/part-1$/m);
  assert.deepStrictEqual(fs.readdirSync(path.join(first.app, '.amk/evidence/run/android')).sort(), ['part-1', 'part-2']);
  assert.ok(fs.existsSync(path.join(first.app, '.amk/evidence/run/android/part-2/b.png')), 'another part\'s evidence stays');
  assert.doesNotMatch(first.calls, /reboot|emu kill/, 'the usual emulator isn\'t restarted');
  // part 2 of 2: flow b, on a copy of the emulator's settings, deleted afterwards
  const second = verifyAndroid({ connected: ['emulator-5554 P35'], avds: 'P35', build: true, maestro, prepare: avd, args: args('2/2'), files: threeFlows });
  assert.strictEqual(second.status, 0, second.out);
  assert.match(second.out, /^android: part 2\/2 of the flows runs on a temporary copy of emulator P35, deleted afterwards$/m);
  const [ran] = flowsRan(second);
  assert.match(ran, /^android-x1-b on emulator-56\d\d$/, 'not the emulator part 1 uses');
  assert.match(second.calls, /^-s emulator-56\d\d emu kill$/m, 'the new copy starts twice: on its first boot it drops its adb connection');
  assert.match(second.out, /^android: checking on emulator-56\d\d$/m);
  assert.match(second.out, /^android: flows 1\/1 passed, 1 screenshots in \.amk\/evidence\/run\/android\/part-2$/m);
  assert.deepStrictEqual(fs.readdirSync(path.join(second.app, '../avd')).sort(), ['P35.ini', 'Pixel_9.avd'], 'the copy is gone');
  // a part beyond the flows has nothing to run; a phone plugged in isn't copied
  assert.match(verifyAndroid({ connected: ['emulator-5554 P35'], avds: 'P35', build: true, maestro, args: ['android', '--flavor', 'x', '--spec', 'x1', '--part', '4/4'], files: threeFlows }).out, /^verify: part 4\/4 has no flows: there are fewer flows than parts$/m);
  assert.match(verifyAndroid({ connected: ['ZX1 - phone'], build: true, maestro, env: { AMK_ANDROID_DEVICE: 'ZX1' }, args: args('2/2'), files: threeFlows }).out, /part 2\/2 of the flows runs on a copy of the device, which works only for an emulator, not ZX1/);
  assert.match(verifyAndroid({ connected: [], args: ['android', '--part', '3'] }).out, /^verify: --part takes k\/n, such as 2\/3$/m);
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

test('verify.sh android: a device another run is using is skipped for a free one, or waited for; locks are given back', { skip }, () => {
  const other = [String(process.pid), 'OtherApp (x1)', '10:00']; // a run that's still going: this test's own process
  const two = { connected: ['emulator-5556 P35', 'emulator-5558 P36'], avds: 'P35 P36', build: true, maestro: record };
  // not named: the free one
  const free = verifyAndroid({ ...two, held: { 'android-avd-P35': other } });
  assert.match(free.out, /android: emulator P35 is in use by OtherApp \(x1\) since 10:00, so checking on P36\nandroid: checking on emulator-5558\n/);
  assert.strictEqual(free.maestro, 'emulator-5558 direct smoke.yaml\n');
  assert.deepStrictEqual(free.locks, ['android-avd-P35'], 'its own given back, the other run\'s left alone');
  // named, or named by its serial (claimed by its emulator's name): waits, here not at all
  for (const env of [{ AMK_ANDROID_AVD: 'P35' }, { AMK_ANDROID_DEVICE: 'emulator-5556' }]) {
    const named = verifyAndroid({ ...two, held: { 'android-avd-P35': other }, env: { ...env, AMK_DEVICE_WAIT: '0' } });
    assert.match(named.out, /waiting for (emulator P35|emulator-5556): in use by OtherApp \(x1\) since 10:00\n {2}gave up waiting for .* after 0 minutes/);
    assert.doesNotMatch(named.out, /checking on/);
    assert.notStrictEqual(named.status, 0);
  }
  // a run that ended without giving its lock back: taken over
  const ended = spawnSync('sh', ['-c', 'echo $$']).stdout.toString().trim();
  const stale = verifyAndroid({ ...two, held: { 'android-avd-P35': [ended, 'OtherApp (x1)', '09:00'] } });
  assert.match(stale.out, /android: checking on emulator-5556\n/);
  assert.deepStrictEqual(stale.locks, []);
  // a Maestro run outside the kit on a device: in use
  const outside = verifyAndroid({ ...two, ps: 'java -classpath /x/maestro/lib/* maestro.cli.AppKt --device emulator-5556 test flow.yaml' });
  assert.match(outside.out, /emulator P35 is in use by another Maestro run, so checking on P36/);
});

test('verify.sh: before Maestro 2.6 checks on this machine take turns, and one build of a project at a time', { skip }, () => {
  const other = [String(process.pid), 'OtherApp (x1)', '10:00'];
  const old = verifyAndroid({ connected: ['emulator-5556 P35'], avds: 'P35', build: true, maestro: record, held: { maestro: other }, env: { FAKE_MAESTRO_VERSION: '2.2.0', AMK_DEVICE_WAIT: '0' } });
  assert.match(old.out, /waiting for Maestro \(before 2\.6 it runs one check at a time on this machine\): in use by OtherApp \(x1\) since 10:00/);
  assert.strictEqual(old.maestro, '', 'no flow ran');
  // a build of this project under way: a build waits for it, and so does a check of the build that's there
  for (const args of [['build', '--flavor', 'x', '--label', 'run'], ['android', '--flavor', 'x', '--label', 'run', '--no-build']]) {
    const r = verifyAndroid({ connected: ['emulator-5556 P35'], avds: 'P35', build: true, maestro: record, args, held: { 'build-android-{project}': other }, env: { AMK_DEVICE_WAIT: '0' } });
    assert.match(r.out, /waiting for the Android build of this project: in use by OtherApp \(x1\) since 10:00\n {2}gave up waiting/);
    assert.doesNotMatch(r.calls, /gradlew/);
    assert.strictEqual(r.maestro, '');
  }
});

test('verify.sh: a flow Maestro stopped before it started (it printed nothing) runs once more', { skip }, () => {
  const stopsOnce = String.raw`out=$(echo "$@" | sed 's/.*--test-output-dir \([^ ]*\).*/\1/')
if [ ! -f "$out/../tried" ]; then touch "$out/../tried"; exit 1; fi
echo "Launch app... COMPLETED"; touch "$out/shot.png"`;
  const r = verifyAndroid({ connected: ['emulator-5556 P35'], avds: 'P35', build: true, maestro: stopsOnce });
  assert.match(r.out, /android: Maestro stopped before flow smoke started; running it once more\nandroid: flows 1\/1 passed, 1 screenshots/);
});

test('verify.sh --flow: a path in the project or an absolute one runs that flow; a missing file stops the run', { skip }, () => {
  const which = String.raw`for last; do :; done; echo "$last" >> "$FAKE_STATE.maestro"; touch "$(echo "$@" | sed 's/.*--test-output-dir \([^ ]*\).*/\1/')/shot.png"`;
  // the path Maestro gets, so without the copy that adds view-tree steps
  const run = (flow, files = {}) => verifyAndroid({ connected: ['emulator-5556 P35'], build: true, maestro: which, files, env: { AMK_A11Y: '0' }, args: ['android', '--flavor', 'x', '--label', 'run', '--screens', 'phone-portrait', '--flow', flow] });
  const rel = run('.maestro/x1-home.yaml', { '.maestro/x1-home.yaml': 'appId: ${APP_ID}\n---\n- launchApp\n' });
  assert.strictEqual(fs.realpathSync(rel.maestro.trim()), fs.realpathSync(path.join(rel.app, '.maestro/x1-home.yaml')));
  assert.match(rel.out, /^android: flows 1\/1 passed/m);
  // a Windows path's backslashes
  const back = run('.maestro\\x1-home.yaml', { '.maestro/x1-home.yaml': 'appId: ${APP_ID}\n---\n- launchApp\n' });
  assert.strictEqual(fs.realpathSync(back.maestro.trim()), fs.realpathSync(path.join(back.app, '.maestro/x1-home.yaml')));
  const outside = tmpDir('amk-flow-');
  fs.writeFileSync(path.join(outside, 'probe.yaml'), 'appId: ${APP_ID}\n---\n- launchApp\n');
  const abs = run(path.join(outside, 'probe.yaml'));
  assert.strictEqual(abs.maestro, `${path.join(outside, 'probe.yaml')}\n`);
  assert.match(abs.out, /^android: flows 1\/1 passed/m);
  const missing = run('.maestro/nope.yaml');
  assert.match(missing.out, /^verify: no flow file \S+\/\.maestro\/nope\.yaml$/m);
  assert.strictEqual(missing.status, 2);
  assert.strictEqual(missing.maestro, '');
});

test('verify.sh android: after each screenshot the screen\'s view tree, for controls without a label or under 48 dp; AMK_A11Y=0 turns it off', { skip }, () => {
  // Maestro's stand-in: keeps the flow it was given, saves a tree with a small icon without a label, and a screenshot
  const trees = String.raw`for last; do :; done
debug=$(echo "$@" | sed 's/.*--debug-output \([^ ]*\).*/\1/'); out=$(echo "$@" | sed 's/.*--test-output-dir \([^ ]*\).*/\1/')
echo "$last" >> "$FAKE_STATE.maestro"; cp "$last" "$FAKE_STATE.flow"
f=$debug/$(basename "$last" .yaml); mkdir -p "$f/screen-hierarchy"
echo '{"attributes":{"bounds":"[0,0][1080,2400]"},"children":[{"attributes":{"clickable":"true","bounds":"[900,100][963,163]","resource-id":"close"}}]}' > "$f/screen-hierarchy/step-005-assertCondition-amk-view-tree-x1-1-home.json"
touch "$out/x1-1-home.png"`;
  // and a copy another run is using at the same time, which isn't a flow of its own
  const files = { '.maestro/x1-home.yaml': 'appId: ${APP_ID}\n---\n- launchApp\n- takeScreenshot: x1-1-home\n', '.maestro/.amk-android-tablet-x2.yaml': 'appId: x\n' };
  const args = ['android', '--flavor', 'x', '--label', 'run', '--screens', 'phone-portrait'];
  const r = verifyAndroid({ connected: ['emulator-5556 P35'], build: true, maestro: trees, files, args });
  const state = f => fs.readFileSync(path.join(path.dirname(r.app), `state.${f}`), 'utf8');
  // Maestro ran a copy next to the flow, with a view-tree step after the screenshot; the copy is gone afterwards
  assert.match(state('maestro'), /\/\.maestro\/\.amk-android-x1-home\.yaml\n$/);
  assert.match(state('flow'), /- takeScreenshot: x1-1-home\n- extendedWaitUntil:\n {4}visible:\n {6}id: "amk-view-tree-x1-1-home"\n {4}timeout: 1\n {4}optional: true\n/);
  assert.deepStrictEqual(fs.readdirSync(path.join(r.app, '.maestro')).sort(), ['.amk-android-tablet-x2.yaml', 'x1-home.yaml']);
  assert.match(r.out, /android: flows 1\/1 passed/, 'the other run\'s copy isn\'t run');
  assert.match(r.out, /^android: flows 1\/1 passed, 1 screenshots in \.amk\/evidence\/run\/android\n {2}android: 2 accessibility warnings on the flows' screens \(controls without a label, tap areas under 48 dp\): see the report$/m);
  assert.match(fs.readFileSync(path.join(r.app, '.amk/evidence/run/report.md'), 'utf8'), /Accessibility, from the screen's view tree:\n\n- x1-1-home: testID close: no label: a screen reader can't say what it does\n- x1-1-home: testID close: 24×24 dp: under 48×48/);
  assert.strictEqual(r.status, 0, 'warnings only');
  // turned off: the flow as it is
  const off = verifyAndroid({ connected: ['emulator-5556 P35'], build: true, maestro: trees, files, args, env: { AMK_A11Y: '0' } });
  assert.match(fs.readFileSync(path.join(path.dirname(off.app), 'state.maestro'), 'utf8'), /\/\.maestro\/x1-home\.yaml\n$/);
  assert.doesNotMatch(off.out, /accessibility warning/);
});

test('verify.sh: a flow that fails, then passes when run once more, is flaky: reported with its first try, not a failure', { skip }, () => {
  // fails the first time at a step, with a screenshot of that screen; passes the second. Each run saves a view tree with
  // a small icon without a label, as in the accessibility test
  const flakyOnce = String.raw`for last; do :; done
debug=$(echo "$@" | sed 's/.*--debug-output \([^ ]*\).*/\1/'); out=$(echo "$@" | sed 's/.*--test-output-dir \([^ ]*\).*/\1/')
f=$debug/$(basename "$last" .yaml); mkdir -p "$f/screen-hierarchy" "$f/screenshots"
echo '{"attributes":{"bounds":"[0,0][1080,2400]"},"children":[{"attributes":{"clickable":"true","bounds":"[900,100][963,163]","resource-id":"close"}}]}' > "$f/screen-hierarchy/step-005-assertCondition-amk-view-tree-x1-1-home.json"
if [ -z "$PASSES" ] && [ ! -f "$out/../tried" ]; then touch "$out/../tried" "$f/screenshots/step-004-tapOn.png"; echo "  Tap on id: save... FAILED"; echo ""; echo "Element not found: id: save"; exit 1; fi
touch "$out/x1-1-home.png"`;
  const files = { '.maestro/x1-home.yaml': 'appId: ${APP_ID}\n---\n- launchApp\n- takeScreenshot: x1-1-home\n' };
  const args = ['android', '--flavor', 'x', '--label', 'run', '--screens', 'phone-portrait'];
  const r = verifyAndroid({ connected: ['emulator-5556 P35'], build: true, maestro: flakyOnce, files, args });
  assert.strictEqual(r.status, 0, r.out);
  assert.match(r.out, /^ {2}android: flow x1-home failed; running it once more, to tell a flaky flow from a failing one\n {2}android: flow x1-home is flaky: it failed at "Tap on id: save": Element not found: id: save, then passed\. Not a failure, but fix it \(a race, or a wait too short\);\n {4}the first try's logs and screen are in \.amk\/evidence\/run\/maestro-logs\/android-x1-home-first-try\/\nandroid: flows 1\/1 passed \(1 flaky\), 1 screenshots in \.amk\/evidence\/run\/android\n {2}android: 2 accessibility warnings/m, 'the first try\'s accessibility lines replaced, not added to');
  const first = path.join(r.app, '.amk/evidence/run/maestro-logs/android-x1-home-first-try');
  assert.ok(fs.existsSync(path.join(first, 'flow.log')) && fs.existsSync(path.join(first, 'x1-home/screenshots/step-004-tapOn.png')));
  const report = fs.readFileSync(path.join(r.app, '.amk/evidence/run/report.md'), 'utf8');
  assert.match(report, /· 1 of 1 flows passed on 1 screen, 1 flaky, 2 accessibility warnings\n/);
  assert.match(report, /^### ⚠ x1-home \(flaky\)\n\nFlaky: it failed at "Tap on id: save": Element not found: id: save the first time, then passed\. Not a failure, but fix it \(a race, or a wait too short\)\. The first try's log: \[maestro-logs\/android-x1-home-first-try\/flow\.log\]\(maestro-logs\/android-x1-home-first-try\/flow\.log\) · \[the screen when it failed\]\(maestro-logs\/android-x1-home-first-try\/x1-home\/screenshots\/step-004-tapOn\.png\)$/m);
  assert.match(fs.readFileSync(path.join(r.app, '.amk/evidence/run/junit.xml'), 'utf8'), /<testcase classname="android" name="x1-home"><system-out>flaky: it failed at &quot;Tap on id: save&quot;: Element not found: id: save the first time, then passed<\/system-out><\/testcase>/);
  const summary = spawnSync(process.execPath, ['scripts/amk/report.js', '.amk/evidence/run', '--summary'], { cwd: r.app, encoding: 'utf8' }).stdout;
  assert.match(summary, /^- ⚠ android: x1-home is flaky: it failed at "Tap on id: save"/m);
  // the next run passes at once: the earlier first try goes
  const again = verifyAndroid({ connected: ['emulator-5556 P35'], build: true, maestro: flakyOnce, args, env: { PASSES: '1' },
    files: { ...files, '.amk/evidence/run/maestro-logs/android-x1-home-first-try/flow.log': 'an earlier run' } });
  assert.match(again.out, /^android: flows 1\/1 passed, 1 screenshots/m);
  assert.ok(!fs.existsSync(path.join(again.app, '.amk/evidence/run/maestro-logs/android-x1-home-first-try')));
});

test("verify.sh: Maestro failing before a flow's first step (its driver didn't start) runs the flow once more, and isn't flaky", { skip }, () => {
  // as Maestro 2.11 did on a simulator just booted: a stack trace from opening its driver, and no step
  const driverOnce = String.raw`out=$(echo "$@" | sed 's/.*--test-output-dir \([^ ]*\).*/\1/')
if [ ! -f "$out/../tried" ]; then touch "$out/../tried"; echo "java.lang.IllegalStateException: driver did not start"; echo "	at maestro.drivers.IOSDriver.open(IOSDriver.kt:93)"; exit 1; fi
echo "Launch app... COMPLETED"; touch "$out/shot.png"`;
  const r = verifyAndroid({ connected: ['emulator-5556 P35'], build: true, maestro: driverOnce });
  assert.match(r.out, /android: Maestro stopped before flow smoke started; running it once more\nandroid: flows 1\/1 passed, 1 screenshots/);
  assert.doesNotMatch(r.out, /flaky/);
});

test('verify.sh: each check compares its screenshots with the approved ones; verify.sh approve makes them the approved ones', { skip }, () => {
  const src = tmpDir('amk-shot-src-');
  const [green, red] = [[0, 200, 0], [200, 0, 0]].map((c, i) => {
    const f = path.join(src, `${i}.png`);
    fs.writeFileSync(f, png(30, 60, 3, png.solid(30, 60, 3, c)));
    return f;
  });
  // Maestro's stand-in saves the picture SHOT_SRC names as the flow's screenshot
  const copy = String.raw`out=$(echo "$@" | sed 's/.*--test-output-dir \([^ ]*\).*/\1/'); cp "$SHOT_SRC" "$out/shot.png"`;
  const check = (shot, approved) => verifyAndroid({ connected: ['emulator-5556 P35'], build: true, maestro: copy, args: ['android', '--flavor', 'x', '--label', 'run', '--screens', 'phone-portrait'],
    env: { SHOT_SRC: shot, AMK_A11Y: '0' }, prepare: approved && (app => { fs.mkdirSync(path.join(app, '.amk/approved/android'), { recursive: true }); fs.copyFileSync(approved, path.join(app, '.amk/approved/android/shot.png')); }) });
  const first = check(green);
  assert.match(first.out, /^screenshots: none approved yet\. Once these look right: sh scripts\/amk\/verify\.sh approve --label run$/m);
  const approve = spawnSync('sh', ['scripts/amk/verify.sh', 'approve', '--label', 'run'], { cwd: first.app, encoding: 'utf8' });
  assert.match(approve.stdout, /^approved: 1 screenshots of run are the approved ones now/m);
  assert.ok(fs.readFileSync(path.join(first.app, '.amk/approved/android/shot.png')).equals(fs.readFileSync(green)));
  assert.match(check(green, green).out, /^screenshots: 0 changed since the approved ones, 0 new, 1 the same$/m);
  const changed = check(red, green);
  assert.match(changed.out, /^screenshots: 1 changed since the approved ones, 0 new, 0 the same\n {2}changed: \.amk\/evidence\/run\/android\/shot\.png \(100% differs\)/m);
  assert.match(fs.readFileSync(path.join(changed.app, '.amk/evidence/run/report.md'), 'utf8'), /^Screenshots to look at, as they differ from the approved ones: android\/shot\.png \(changed, 100% differs\)$/m);
});

test('verify.sh --spec a,b: the flows of each spec, or of a flow-name prefix, once each; several need --label', { skip }, () => {
  const files = { '.maestro/x1-home.yaml': 'appId: ${APP_ID}\n---\n- launchApp\n', '.maestro/x2-login.yaml': 'appId: ${APP_ID}\n---\n- launchApp\n',
    '.maestro/offline-sync-1.yaml': 'appId: ${APP_ID}\n---\n- launchApp\n', '.maestro/offline-sync-2.yaml': 'appId: ${APP_ID}\n---\n- launchApp\n' };
  const run = (...a) => verifyAndroid({ connected: ['emulator-5556 P35'], build: true, maestro: record, files, args: ['android', '--flavor', 'x', '--screens', 'phone-portrait', ...a] });
  const r = run('--spec', 'x1,offline-sync,x1-home', '--label', 'x1');
  assert.strictEqual(r.maestro, 'emulator-5556 direct offline-sync-1.yaml\nemulator-5556 direct offline-sync-2.yaml\nemulator-5556 direct x1-home.yaml\n');
  assert.match(r.out, /^android: flows 3\/3 passed, \d+ screenshots in \.amk\/evidence\/x1\/android$/m);
  assert.strictEqual(run('--spec', 'x2').maestro, 'emulator-5556 direct x2-login.yaml\n', 'one id as before, its evidence in its own folder');
  const unlabelled = run('--spec', 'x1,x2');
  assert.strictEqual(unlabelled.status, 2);
  assert.match(unlabelled.out, /^verify: --spec x1,x2 runs several specs' flows: name their evidence folder with --label <name>$/m);
  assert.strictEqual(unlabelled.maestro, '');
});

test('verify.sh: a build stops first when the disk has under 5 GB free, outside CI', { skip }, () => {
  const low = verifyAndroid({ connected: ['emulator-5556 P35'], build: true, env: { AMK_DISK_GB: '3', CI: '' } });
  assert.strictEqual(low.status, 1);
  assert.match(low.out, /^verify: only 3 GB of disk is free here, and a release build needs about 5\. Free some/m);
  assert.doesNotMatch(low.calls, /gradlew/, 'nothing built');
  for (const env of [{ AMK_DISK_GB: '3', CI: 'true' }, { AMK_DISK_GB: '5', CI: '' }]) {
    assert.match(verifyAndroid({ connected: ['emulator-5556 P35'], build: true, maestro: record, env }).calls, /gradlew/, JSON.stringify(env));
  }
});

test('verify.sh --tags: only the flows with one of the tags in their header, inline or one a line', { skip }, () => {
  const files = {
    '.maestro/a-home.yaml': 'appId: ${APP_ID}\ntags: [smoke, home]\n---\n- launchApp\n',
    '.maestro/b-settings.yaml': 'appId: ${APP_ID}\n---\n- launchApp\n',
    '.maestro/c-login.yaml': 'appId: ${APP_ID}\ntags:\n  - login\n  - smoke\nenv:\n  - x\n---\n- launchApp\n',
    '.maestro/d-env.yaml': 'appId: ${APP_ID}\ntags:\n  - nightly\nenv:\n  - smoke\n---\n- launchApp\n',
  };
  const run = tags => verifyAndroid({ connected: ['emulator-5556 P35'], build: true, maestro: record, files, args: ['android', '--flavor', 'x', '--label', 'run', '--screens', 'phone-portrait', '--tags', tags] });
  assert.strictEqual(run('smoke').maestro, 'emulator-5556 direct a-home.yaml\nemulator-5556 direct c-login.yaml\n');
  assert.strictEqual(run('home,nightly').maestro, 'emulator-5556 direct a-home.yaml\nemulator-5556 direct d-env.yaml\n');
  const none = run('missing');
  assert.match(none.out, /android: no flow has the tag missing, so this is a check that the app opens/);
  assert.strictEqual(none.maestro, 'emulator-5556 direct smoke.yaml\n');
});

// verify.sh ios on a Mac, with stand-ins for Xcode's tools (xcrun simctl and devicectl, xcodebuild) and for maestro-runner
// (npx). A bare app that runs on iPhone only, upright and turned, signed by the project's team unless `team` says
// otherwise. One simulator, "iPhone 17", and one connected iPhone, "Tester's iPhone" (00008020-AAAA). xcrun and
// xcodebuild log their arguments in calls, maestro-runner in runner; the crash reports on the iPhone are listed in crashes.
// FAKE_UNTRUSTED: the iPhone doesn't open the app; FAKE_REFUSED_ONCE: not the first time; FAKE_FLOW_REFUSED_ONCE: not in
// the first flow; FAKE_CLOSES: the app closes at once; FAKE_CRASH: it crashes in a flow
const skipIos = process.platform !== 'darwin' && 'needs a Mac (PlistBuddy)';
function verifyIos({ env = {}, team = 'ABCDE12345', args = ['ios', '--label', 'run'], crashes = '', files = {}, pods = true }) {
  const dir = tmpDir('amk-verify-ios-');
  fs.cpSync(path.join(TEMPLATE, 'scripts/amk'), path.join(dir, 'app/scripts/amk'), { recursive: true });
  write(dir, 'state.crashes', crashes);
  const sims = { devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [{ udid: 'SIM-1', name: 'iPhone 17', state: 'Shutdown', deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17' }] } };
  const reals = { result: { devices: [{ identifier: 'CORE-1', deviceProperties: { name: "Tester's iPhone" }, hardwareProperties: { reality: 'physical', udid: '00008020-AAAA' } }] } };
  write(dir, 'bin/xcrun', String.raw`#!/bin/sh
echo "xcrun $*" >> "$FAKE_STATE.calls"
to() { while [ $# -gt 0 ]; do [ "$1" != --json-output ] || { echo "$2"; return; }; shift; done; }
case "$1 $2 $3 $4" in
  "simctl list"*) echo '${JSON.stringify(sims)}' ;;
  "simctl create"*) echo SIM-TEMP-1 ;;
  "devicectl list"*) echo '${JSON.stringify(reals).replace(/'/g, "'\\''")}' > "$(to "$@")" ;;
  "devicectl device process launch") if [ -n "$FAKE_UNTRUSTED" ] || { [ -n "$FAKE_REFUSED_ONCE" ] && [ ! -f "$FAKE_STATE.refused" ] && touch "$FAKE_STATE.refused"; }; then
      echo "ERROR: Unable to launch com.example.app because it has an invalid code signature, inadequate entitlements or its profile has not been explicitly trusted by the user."; exit 1
    fi ;;
  "devicectl device info processes") p='{"executable":"file:///private/var/containers/Bundle/Application/U/App.app/App"}'; [ -z "$FAKE_CLOSES" ] || p=""
    echo "{\"result\":{\"runningProcesses\":[$p]}}" > "$(to "$@")" ;;
  "devicectl device info files") node -e 'console.log(JSON.stringify({ result: { files: require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map(f => ({ relativePath: f })) } }))' "$FAKE_STATE.crashes" > "$(to "$@")" ;;
  "devicectl device copy from") echo report > "$(echo "$@" | sed 's/.*--destination \([^ ]*\).*/\1/')" ;;
esac
`, 0o755);
  write(dir, 'bin/xcodebuild', String.raw`#!/bin/sh
echo "xcodebuild $*" >> "$FAKE_STATE.calls"
case "$*" in *"-destination id="*) p=Release-iphoneos ;; *) p=Release-iphonesimulator ;; esac
mkdir -p "ios/DerivedData/Build/Products/$p/App.app"
printf '<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.example.app</string><key>CFBundleExecutable</key><string>App</string></dict></plist>\n' > "ios/DerivedData/Build/Products/$p/App.app/Info.plist"
`, 0o755);
  // maestro-runner: a screenshot the shape the iPhone shows, saved in its report and next to the flow file as it does,
  // and one of a failed step, which isn't evidence
  write(dir, 'bin/npx', String.raw`#!/bin/sh
echo "$* (telemetry off: $MAESTRO_RUNNER_NO_TELEMETRY)" >> "$FAKE_STATE.runner"
if [ -n "$FAKE_FLOW_REFUSED_ONCE" ] && [ ! -f "$FAKE_STATE.flow-refused" ]; then
  touch "$FAKE_STATE.flow-refused"; echo "Failed to launch app: com.example.app (cause: its profile has not been explicitly trusted by the user)"; exit 1
fi
for last; do :; done
out=$(echo "$@" | sed 's/.*--output \([^ ]*\).*/\1/')
o=$(sed -n 's/^ *orientation: //p' "$last" | tail -n 1)
flow=$(sed -n "s/^- runFlow: '\(.*\)'$/\1/p" "$last")
if [ "$o" = landscape ]; then w=2688 h=1242; else w=1242 h=2688; fi
mkdir -p "$out/assets/flow-000"
for f in "cmd-003-shot.png $w $h" "nested-000-after.png 10 10"; do
  node -e 'const b = Buffer.alloc(24); b.writeUInt32BE(+process.argv[2], 16); b.writeUInt32BE(+process.argv[3], 20); require("fs").writeFileSync(process.argv[1], b)' "$out/assets/flow-000/"$f
done
[ -n "$flow" ] || flow=$last
cp "$out/assets/flow-000/cmd-003-shot.png" "$(dirname "$flow")/shot.png"
# a picture something else saves meanwhile
[ -z "$FAKE_OTHER_PNG" ] || touch "$FAKE_OTHER_PNG"
[ -z "$FAKE_CRASH" ] || grep -qx App-2026-10-16-120000.ips "$FAKE_STATE.crashes" || echo App-2026-10-16-120000.ips >> "$FAKE_STATE.crashes"
# FAKE_RUNNER_FAIL: the flow fails, with that error in maestro-runner's report
if [ -n "$FAKE_RUNNER_FAIL" ]; then echo "{\"flows\":[{\"error\":\"$FAKE_RUNNER_FAIL\"}]}" > "$out/report.json"; exit 1; fi
`, 0o755);
  write(dir, 'bin/maestro', '#!/bin/sh\necho 2.11.0\n', 0o755);
  for (const tool of ['ps', 'sleep', 'sips']) write(dir, `bin/${tool}`, '#!/bin/sh\n', 0o755);
  write(dir, 'app/ios/App.xcodeproj/project.pbxproj', `INFOPLIST_FILE = App/Info.plist;\nTARGETED_DEVICE_FAMILY = 1;\n${team ? `DEVELOPMENT_TEAM = ${team};\n` : ''}`);
  write(dir, 'app/ios/App/Info.plist', '<key>UISupportedInterfaceOrientations</key>\n<array>\n<string>UIInterfaceOrientationPortrait</string>\n<string>UIInterfaceOrientationLandscapeLeft</string>\n</array>\n');
  for (const f of ['Podfile', ...(pods ? ['Pods/Manifest.lock', 'build/generated/.keep'] : []), 'App.xcworkspace/contents.xcworkspacedata']) write(dir, `app/ios/${f}`, '');
  write(dir, 'bin/pod', '#!/bin/sh\necho "[!] CocoaPods could not find compatible versions"\nexit 1\n', 0o755);
  for (const [f, text] of Object.entries(files)) write(dir, `app/${f}`, text);
  const r = spawnSync('sh', ['scripts/amk/verify.sh', ...args], {
    cwd: path.join(dir, 'app'), encoding: 'utf8',
    env: { ...process.env, FAKE_STATE: path.join(dir, 'state'), AMK_LOCK_DIR: path.join(dir, 'locks'), PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`, AMK_IOS_DEVICE: '', AMK_IOS_TABLET: '', AMK_IOS_TEAM: '', AMK_DISK_GB: '50', ...env },
  });
  const readIf = f => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : '');
  return { out: r.stdout + r.stderr, calls: readIf('state.calls'), runner: readIf('state.runner'), status: r.status, app: path.join(dir, 'app') };
}

test('verify.sh ios: a connected iPhone, when named: a build signed for it, opened once, then the flows through maestro-runner', { skip: skipIos }, () => {
  const r = verifyIos({ env: { AMK_IOS_DEVICE: "Tester's iPhone" } });
  assert.match(r.out, /^ios: checking on 00008020-AAAA, a real device; the flows clear the app's data on it$/m);
  // signed for development by the project's team, for this device; no simulator build, as no simulator is checked
  assert.match(r.calls, /^xcodebuild .*-destination id=00008020-AAAA .*-allowProvisioningUpdates -allowProvisioningDeviceRegistration DEVELOPMENT_TEAM=ABCDE12345 CODE_SIGN_STYLE=Automatic/m);
  // a check build isn't a release: no dSYMs, looked for where there are none, and Sentry's upload off
  assert.match(r.calls, /^xcodebuild .*-destination id=00008020-AAAA .* DEBUG_INFORMATION_FORMAT=dwarf DWARF_DSYM_FOLDER_PATH=\S+\/ios\/DerivedData\/no-dsyms SENTRY_DISABLE_AUTO_UPLOAD=true$/m);
  assert.doesNotMatch(r.calls, /iphonesimulator|simctl (boot|install)/);
  assert.match(r.calls, /^xcrun devicectl device install app --device 00008020-AAAA .*Release-iphoneos\/App\.app$/m);
  assert.match(r.calls, /^xcrun devicectl device process launch --device 00008020-AAAA --terminate-existing com\.example\.app$/m);
  // upright, then turned with the name maestro-runner's WebDriverAgent driver turns a device with, a turn that doesn't
  // fail when the home screen in front doesn't turn: the screenshots show whether the app did
  const runs = r.runner.trim().split('\n');
  assert.strictEqual(runs.length, 2, r.runner);
  for (const run of runs) assert.match(run, /^-y maestro-runner@\d+\.\d+\.\d+ --platform ios --driver wda --device 00008020-AAAA --team-id ABCDE12345 --wda-bundle-id com\.example\.app\.wda --app-file \S+\/Release-iphoneos\/App\.app test -e APP_ID=com\.example\.app -e ORIENTATION=(PORTRAIT|landscape) --output \S+ --flatten \S+\/screen\.yaml \(telemetry off: 1\)$/);
  assert.deepStrictEqual(runs.map(run => / -e ORIENTATION=(\S+) /.exec(run)[1]), ['PORTRAIT', 'landscape'], 'the names its driver knows');
  // each flow runs inside one that starts with a launchApp that never runs (on Android only) and says to leave
  // permissions alone, so maestro-runner doesn't answer the app's own alerts
  const first = "- runFlow:\n    when:\n      platform: Android\n    commands:\n      - launchApp:\n          permissions:\n            all: unset\n";
  assert.strictEqual(fs.readFileSync(path.join(r.app, '.amk/evidence/run/maestro-logs/ios-smoke/screen.yaml'), 'utf8'),
    `appId: com.example.app\n---\n${first}- runFlow: '${fs.realpathSync(r.app)}/.amk/evidence/run/ios/smoke.yaml'\n`);
  assert.match(fs.readFileSync(path.join(r.app, '.amk/evidence/run/maestro-logs/ios-landscape-smoke/screen.yaml'), 'utf8'),
    new RegExp(`^appId: com\\.example\\.app\\nonFlowComplete:\\n {2}- setOrientation:\\n {6}orientation: PORTRAIT\\n {6}optional: true\\n---\\n${first.replace(/\./g, '\\.')}- setOrientation:\\n {4}orientation: landscape\\n {4}optional: true\\n- runFlow: '\\S+/smoke\\.yaml'\\n$`));
  // the screenshots the flows took, not the one of a step that failed
  for (const screen of ['ios', 'ios-landscape']) assert.match(r.out, new RegExp(`^${screen}: flows 1/1 passed, 1 screenshots in \\.amk/evidence/run/${screen}$`, 'm'));
  assert.strictEqual(r.status, 0, r.out);

  // a spec's flow: the screenshots maestro-runner also saves next to it leave the project; a picture already there stays
  const spec = verifyIos({ env: { AMK_IOS_DEVICE: '00008020-AAAA' }, args: ['ios', '--label', 'run', '--spec', 'x1'], files: { '.maestro/x1-home.yaml': 'appId: ${APP_ID}\n---\n- launchApp\n', '.maestro/media/photo.png': '' } });
  for (const screen of ['ios', 'ios-landscape']) assert.match(spec.out, new RegExp(`^${screen}: flows 1/1 passed, 1 screenshots`, 'm'));
  assert.deepStrictEqual(fs.readdirSync(path.join(spec.app, '.maestro'), { recursive: true }).sort(), ['media', 'media/photo.png', 'x1-home.yaml']);

  // flows that use airplane mode (here in a subflow): after each flow it goes off, also when the flow failed, as an
  // offline iPhone doesn't open the app for the next one. First, before the screen turns back upright; optional, as a
  // flow that passed doesn't fail there. Settings restarts before each flow, to open on its main page, with the switch
  const offline = verifyIos({ env: { AMK_IOS_DEVICE: '00008020-AAAA' }, args: ['ios', '--label', 'run', '--spec', 'x1'], files: { '.maestro/x1-sync.yaml': 'appId: ${APP_ID}\n---\n- launchApp\n- runFlow: subflows/offline.yaml\n', '.maestro/subflows/offline.yaml': 'appId: ${APP_ID}\n---\n- setAirplaneMode: enabled\n' } });
  const wrapper = screen => fs.readFileSync(path.join(offline.app, `.amk/evidence/run/maestro-logs/${screen}-x1-sync/screen.yaml`), 'utf8');
  const off = 'onFlowComplete:\\n {2}- setAirplaneMode:\\n {6}value: disabled\\n {6}optional: true\\n';
  assert.match(wrapper('ios'), new RegExp(`^appId: com\\.example\\.app\\n${off}---\\n`));
  assert.match(wrapper('ios-landscape'), new RegExp(`^appId: com\\.example\\.app\\n${off} {2}- setOrientation:\\n {6}orientation: PORTRAIT\\n {6}optional: true\\n---\\n`));
  assert.strictEqual((offline.calls.match(/^xcrun devicectl device process launch --device 00008020-AAAA --terminate-existing com\.apple\.Preferences$/gm) || []).length, 2, 'once before each flow');
  assert.doesNotMatch(r.calls, /com\.apple\.Preferences/, 'not for flows that never use airplane mode');
  assert.strictEqual(offline.status, 0, offline.out);

  // a flow outside the project: run where it is; the screenshots maestro-runner saves beside it are collected from
  // its folder only, not the ones below, which may hold anything
  const outside = tmpDir('amk-flow-');
  fs.writeFileSync(path.join(outside, 'probe.yaml'), 'appId: ${APP_ID}\n---\n- launchApp\n');
  fs.mkdirSync(path.join(outside, 'below'));
  const abs = verifyIos({ env: { AMK_IOS_DEVICE: '00008020-AAAA', FAKE_OTHER_PNG: path.join(outside, 'below/other.png') }, args: ['ios', '--label', 'run', '--screens', 'phone-portrait', '--flow', path.join(outside, 'probe.yaml')] });
  assert.match(fs.readFileSync(path.join(abs.app, '.amk/evidence/run/maestro-logs/ios-probe/screen.yaml'), 'utf8'), new RegExp(`- runFlow: '${path.join(outside, 'probe.yaml').replace(/[.]/g, '\\.')}'\n$`));
  assert.match(abs.out, /^ios: flows 1\/1 passed, 1 screenshots/m);
  assert.deepStrictEqual(fs.readdirSync(outside, { recursive: true }).sort(), ['below', 'below/other.png', 'probe.yaml'], 'its screenshot left the folder, and the other picture stayed');
  assert.strictEqual(abs.status, 0, abs.out);

  // a crash report the app left during the flows joins the evidence and fails the check; an older one doesn't
  const crashed = verifyIos({ env: { AMK_IOS_DEVICE: '00008020-AAAA', FAKE_CRASH: '1' }, crashes: 'App-2026-10-01-090000.ips\nOther-2026-10-16-120000.ips\n' });
  assert.match(crashed.out, /^ios: the app crashed on 00008020-AAAA during the checks: 1 crash reports in \.amk\/evidence\/run\/crashes$/m);
  assert.deepStrictEqual(fs.readdirSync(path.join(crashed.app, '.amk/evidence/run/crashes')), ['App-2026-10-16-120000.ips']);
  assert.notStrictEqual(crashed.status, 0);

  // a flow that fails on the iPhone: why, from maestro-runner's report, and the screen then
  const broke = verifyIos({ env: { AMK_IOS_DEVICE: '00008020-AAAA', FAKE_RUNNER_FAIL: 'Element not visible: id=save' }, args: ['ios', '--label', 'run', '--screens', 'phone-portrait'] });
  assert.match(broke.out, /flow smoke failed, see [^\n]* maestro-runner's own log [^\n]*\n {4}failed with: Element not visible: id=save\n {4}the screen when it failed: \.amk\/evidence\/run\/maestro-logs\/ios-smoke\/assets\/flow-000\/nested-000-after\.png\n/);
});

test('verify.sh ios: what a real device needs first is said before any flow runs: a team, trusting it, an app that stays open', { skip: skipIos }, () => {
  const noTeam = verifyIos({ team: '', env: { AMK_IOS_DEVICE: '00008020-AAAA' } });
  assert.match(noTeam.out, /^ios: a real device runs only apps signed by an Apple team: set AMK_IOS_TEAM to your team ID \(Xcode > Settings > Accounts lists them\)$/m);
  assert.doesNotMatch(noTeam.calls, /xcodebuild/);
  assert.notStrictEqual(noTeam.status, 0);
  // AMK_IOS_TEAM signs instead of the project's team
  assert.match(verifyIos({ env: { AMK_IOS_DEVICE: '00008020-AAAA', AMK_IOS_TEAM: 'ZYXWV98765' } }).calls, /DEVELOPMENT_TEAM=ZYXWV98765/);
  const untrusted = verifyIos({ env: { AMK_IOS_DEVICE: '00008020-AAAA', FAKE_UNTRUSTED: '1' } });
  // offline (in airplane mode), an iPhone doesn't open an app signed for development either, with the same error
  assert.match(untrusted.out, /^ios: 00008020-AAAA doesn't open apps from this team: on it, trust the team \(Settings > General > VPN & Device Management > Developer App > Trust\), and turn airplane mode off \(offline, it doesn't open apps signed for development\)\. Then run this again$/m);
  assert.strictEqual(untrusted.calls.match(/process launch/g).length, 3, 'asked three times, as a device refuses a new install for a moment now and then');
  assert.strictEqual(untrusted.runner, '');
  assert.notStrictEqual(untrusted.status, 0);
  // refused for a moment: opened the next time, then a flow refused once (after clearState installed the app again) runs once more
  const moment = verifyIos({ env: { AMK_IOS_DEVICE: '00008020-AAAA', FAKE_REFUSED_ONCE: '1', FAKE_FLOW_REFUSED_ONCE: '1' }, args: ['ios', '--label', 'run', '--screens', 'phone-portrait'] });
  assert.doesNotMatch(moment.out, /doesn't open apps from this team/);
  assert.match(moment.out, /^ {2}ios: the device didn't open the app it had just installed again; running flow smoke once more\nios: flows 1\/1 passed, 1 screenshots/m);
  assert.strictEqual(moment.status, 0, moment.out);
  const closes = verifyIos({ env: { AMK_IOS_DEVICE: '00008020-AAAA', FAKE_CLOSES: '1' } });
  assert.match(closes.out, /^ios: the app closed within 10 seconds of opening on 00008020-AAAA$/m);
  assert.strictEqual(closes.runner, '');
  // not a simulator's name or a connected device's; and a simulator's name still means the simulator
  assert.match(verifyIos({ env: { AMK_IOS_DEVICE: 'nope' } }).out, /^ios: no simulator or connected iPhone or iPad has the name or UDID "nope"$/m);
  const sim = verifyIos({ env: { AMK_IOS_DEVICE: 'iPhone 17' }, args: ['ios', '--label', 'run', '--screens', 'portrait'] });
  assert.match(sim.calls, /^xcrun simctl install SIM-1 /m);
  assert.match(sim.calls, /^xcodebuild .*-sdk iphonesimulator .* DEBUG_INFORMATION_FORMAT=dwarf DWARF_DSYM_FOLDER_PATH=\S+\/ios\/DerivedData\/no-dsyms SENTRY_DISABLE_AUTO_UPLOAD=true$/m);
  // pod install failing: said, not a silent stop
  const pods = verifyIos({ env: { AMK_IOS_DEVICE: 'iPhone 17' }, pods: false });
  assert.match(pods.out, /^ios: pod install FAILED, see \.amk\/evidence\/run\/pod-install\.log$/m);
  assert.match(pods.out, /^Evidence: /m, 'verify.sh carries on to its end');
  assert.notStrictEqual(pods.status, 0);
  assert.doesNotMatch(sim.calls, /devicectl device|-destination id=/);
});

test('verify.sh ios --part: a later part on a temporary simulator of the same type and iOS version, deleted afterwards', { skip: skipIos }, () => {
  const r = verifyIos({ env: { AMK_IOS_DEVICE: 'iPhone 17' }, files: threeFlows, args: ['ios', '--label', 'run', '--screens', 'phone-portrait', '--spec', 'x1', '--part', '2/2'] });
  assert.match(r.out, /^ios: part 2\/2 of the flows runs on a temporary iPhone simulator like SIM-1, deleted afterwards$/m);
  assert.match(r.calls, /^xcrun simctl create amk part 2 of 2 \(\d+\) com\.apple\.CoreSimulator\.SimDeviceType\.iPhone-17 com\.apple\.CoreSimulator\.SimRuntime\.iOS-26-5$/m);
  assert.match(r.calls, /^xcrun simctl install SIM-TEMP-1 /m);
  assert.doesNotMatch(r.calls, /simctl (boot|install) SIM-1/, 'the simulator part 1 uses is left to it');
  assert.match(r.calls, /^xcrun simctl delete SIM-TEMP-1$/m);
  // a real iPhone can't be copied for a part
  assert.match(verifyIos({ env: { AMK_IOS_DEVICE: "Tester's iPhone" }, files: threeFlows, args: ['ios', '--label', 'run', '--spec', 'x1', '--part', '2/2'] }).out,
    /^ios: part 2\/2 of the flows runs on a copy of the device, which works only for a simulator, not Tester's iPhone$/m);
});

test('verify.sh ios: a first iOS build (no pods or no build folder yet) needs 8 GB free; later ones 5', { skip: skipIos }, () => {
  const first = verifyIos({ env: { AMK_DISK_GB: '6', CI: '' } });
  assert.strictEqual(first.status, 1);
  assert.match(first.out, /^verify: only 6 GB of disk is free here, and a first iOS build \(pods, Hermes and a simulator\) needs about 8\. Free some/m);
  assert.doesNotMatch(first.calls, /xcodebuild/, 'nothing built');
  const later = verifyIos({ env: { AMK_DISK_GB: '6', CI: '' }, files: { 'ios/DerivedData/.keep': '' } });
  assert.match(later.calls, /xcodebuild/, 'pods and a build folder there: 5 GB is enough');
});

test("verify.sh: a screen whose screenshots aren't in its orientation runs once more, then fails; the device didn't turn", { skip }, () => {
  const devices = { connected: ['emulator-5556 P35'], avds: 'P35', rotates: true, build: true, maestro: record, env: { AMK_SCREENS: 'phone-landscape' } };
  // turned the second time
  const once = verifyAndroid({ ...devices, files: { '.amk/evidence/run/noturn-once': '' } });
  assert.match(once.out, /android-landscape: 1 screenshots show the screen upright, not as this screen needs; running its flows once more\nandroid-landscape: flows 1\/1 passed, 1 screenshots/);
  assert.doesNotMatch(once.out, /isn't checked/);
  assert.strictEqual(once.status, 0);
  // never turns
  const never = verifyAndroid({ ...devices, env: { ...devices.env, NOTURN: '1' } });
  assert.match(never.out, /android-landscape: flows 1\/1 passed, 1 screenshots in .*\n {2}android-landscape: 1 screenshots show the screen upright: the device or the app didn't turn, so this screen isn't checked; treating this as a failure/);
  // a flow that left the app may have come back upright: how to turn it back (issue #11)
  assert.match(never.out, /^ {2}android-landscape: a flow that leaves the app \(a call, the camera, a picker\) comes back upright when the other app's screen turned the device: turn it back after that step with - setOrientation: \$\{ORIENTATION\}$/m);
  assert.doesNotMatch(never.out, /sets its orientation/, 'nothing in its code to point at');
  assert.notStrictEqual(never.status, 0);
  // never turns, and its code locks it upright although its native settings allow turning: says where
  const locked = verifyAndroid({ ...devices, env: { ...devices.env, NOTURN: '1' }, git: true, files: { 'src/screen/splash/index.js': 'Orientation.lockToPortrait();\n', 'README.md': 'lockToPortrait\n' } });
  assert.match(locked.out, /treating this as a failure\n {2}android-landscape: the app sets its orientation in its code \(src\/screen\/splash\/index\.js\), which can keep it upright\. If it's meant to stay upright, take landscape out of its native settings \(UISupportedInterfaceOrientations in Info\.plist, screenOrientation in AndroidManifest\.xml\) and this screen isn't checked any more; otherwise change that code\n/);
  assert.notStrictEqual(locked.status, 0);
});

test('evidence stays small: the newest 5 folders and every prototype\'s, runs without a spec in one, each with its latest run, and the device\'s log only for a failure', { skip }, () => {
  // seven older checks' folders, a day apart
  const old = app => {
    for (let i = 1; i <= 7; i++) {
      const d = path.join(app, `.amk/evidence/old${i}`);
      fs.mkdirSync(d, { recursive: true });
      const t = new Date(Date.now() - i * 86400e3);
      fs.utimesSync(d, t, t);
    }
    const demo = path.join(app, '.amk/evidence/20260101-onboarding-prototype');
    fs.mkdirSync(demo, { recursive: true });
    fs.utimesSync(demo, new Date(Date.now() - 30 * 86400e3), new Date(Date.now() - 30 * 86400e3));
  };
  // a passing flow that leaves the device's log and Maestro's own next to its screenshot
  const logs = String.raw`debug=$(echo "$@" | sed 's/.*--debug-output \([^ ]*\).*/\1/'); out=$(echo "$@" | sed 's/.*--test-output-dir \([^ ]*\).*/\1/')
mkdir -p "$debug/smoke/logs"; echo log > "$debug/smoke/logs/device-logcat.txt"; echo steps > "$debug/smoke/logs/maestro.log"
touch "$out/shot.png"; [ -z "$FAIL" ] || exit 1`;
  const r = verifyAndroid({ connected: ['emulator-5556 P35'], avds: 'P35', build: true, maestro: logs, prepare: old,
    files: { '.amk/evidence/run/android/screenshots/from-an-earlier-run.png': '', '.amk/evidence/run/maestro-logs/android-smoke/smoke-2/logs/device-logcat.txt': 'old' } });
  assert.match(r.out, /^evidence: removed old5, old6, old7 from \.amk\/evidence, keeping the newest 5 and those of specs in progress \(AMK_EVIDENCE_KEEP sets how many; 0 keeps them all\)$/m);
  assert.deepStrictEqual(fs.readdirSync(path.join(r.app, '.amk/evidence')).sort(), ['20260101-onboarding-prototype', 'old1', 'old2', 'old3', 'old4', 'run'],
    'this check\'s, the four newest, and a prototype\'s, however old');
  assert.match(r.out, /^android: flows 1\/1 passed, 1 screenshots in \.amk\/evidence\/run\/android$/m, 'not the earlier run\'s screenshot');
  assert.deepStrictEqual(fs.readdirSync(path.join(r.app, '.amk/evidence/run/maestro-logs/android-smoke')), ['smoke'], 'only the latest run\'s logs');
  assert.deepStrictEqual(fs.readdirSync(path.join(r.app, '.amk/evidence/run/maestro-logs/android-smoke/smoke/logs')), ['maestro.log'], 'a passing flow keeps no device log');
  // a failing flow keeps it; and AMK_EVIDENCE_KEEP=0 keeps every folder
  const failed = verifyAndroid({ connected: ['emulator-5556 P35'], avds: 'P35', build: true, maestro: logs, prepare: old, env: { FAIL: '1', AMK_EVIDENCE_KEEP: '0' } });
  assert.ok(fs.existsSync(path.join(failed.app, '.amk/evidence/run/maestro-logs/android-smoke/smoke/logs/device-logcat.txt')));
  assert.strictEqual(fs.readdirSync(path.join(failed.app, '.amk/evidence')).length, 9);
  assert.doesNotMatch(failed.out, /evidence: removed/);
  // runs without --spec or --label (verify.sh quick, mostly) share one folder, so they don't push out a feature's
  const plain = verifyAndroid({ connected: ['emulator-5556 P35'], avds: 'P35', build: true, maestro: logs, prepare: old, args: ['android', '--flavor', 'x'],
    files: { '.amk/evidence/no-spec/lint.log': 'an earlier quick run' } });
  assert.match(plain.out, /^android: flows 1\/1 passed, 1 screenshots in \.amk\/evidence\/no-spec\/android$/m);
  assert.deepStrictEqual(fs.readdirSync(path.join(plain.app, '.amk/evidence')).sort(), ['20260101-onboarding-prototype', 'no-spec', 'old1', 'old2', 'old3', 'old4']);
  assert.ok(fs.existsSync(path.join(plain.app, '.amk/evidence/no-spec/lint.log')), 'the quick run\'s logs stay');
  // the first run after an update from a kit before 0.7.12, which gave each run without a spec a folder named after its
  // time: eight of those, newer than three specs' evidence (issue #12). The timestamped ones go first, a done spec's
  // competes as before, and a spec in progress keeps its own, however many there are
  const updated = app => {
    const at = (name, days) => {
      const d = path.join(app, `.amk/evidence/${name}`);
      fs.mkdirSync(d, { recursive: true });
      fs.utimesSync(d, new Date(Date.now() - days * 86400e3), new Date(Date.now() - days * 86400e3));
    };
    for (let i = 1; i <= 8; i++) at(`20261020-1${i}0000`, i / 10);
    at('20261001-vehicle-setup', 10);
    at('20261001-vehicle-setup-android', 11);
    at('20261005-sign-in', 12);
    at('20260901-onboarding', 13);
  };
  const specs = {
    'specs/20261001-vehicle-setup/progress.md': '# Progress\nStatus:        in progress — task 2 of 5\n',
    'specs/20261005-sign-in/progress.md': '# Progress\nStatus:        in progress — task 1 of 3\n',
    'specs/20260901-onboarding/progress.md': '# Progress\nStatus:        done\n',
  };
  const after = verifyAndroid({ connected: ['emulator-5556 P35'], avds: 'P35', build: true, maestro: logs, prepare: updated, files: specs });
  assert.match(after.out, /^evidence: removed 20261020-140000, 20261020-150000, 20261020-160000, 20261020-170000, 20261020-180000 from \.amk\/evidence, keeping/m);
  assert.deepStrictEqual(fs.readdirSync(path.join(after.app, '.amk/evidence')).sort(), ['20260901-onboarding', '20261001-vehicle-setup',
    '20261001-vehicle-setup-android', '20261005-sign-in', '20261020-110000', '20261020-120000', '20261020-130000', 'run']);
});
