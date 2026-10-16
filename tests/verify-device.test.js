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
// `held`: device locks another run holds, as { key: [pid, who, since] }; `ps`: the processes the stand-in ps lists.
function verifyAndroid({ connected, avds = '', tablets = '', env = {}, build = false, rotates = false, maestro = '', args = ['android', '--flavor', 'x', '--label', 'run'], files = {}, held = {}, ps = '', git = false }) {
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
  fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
  // {project} in a key: this app's build locks, named from its folder's path as verify.sh sees it
  const project = spawnSync('sh', ['-c', 'printf %s "$(pwd)" | cksum | cut -d " " -f 1'], { cwd: path.join(dir, 'app') }).stdout.toString().trim();
  for (const [key, owner] of Object.entries(held)) write(dir, `locks/${key.replace('{project}', project)}/owner`, `${owner.join('\n')}\n`);
  write(dir, 'bin/ps', `#!/bin/sh\nprintf '%s\\n' "${ps}"\n`, 0o755);
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
  if (git) spawnSync('sh', ['-c', 'git init -q && git add -A'], { cwd: path.join(dir, 'app') });
  const r = spawnSync('sh', ['scripts/amk/verify.sh', ...args], {
    cwd: path.join(dir, 'app'), encoding: 'utf8',
    env: { ...process.env, FAKE_STATE: path.join(dir, 'state'), ANDROID_HOME: path.join(dir, 'sdk'), ANDROID_AVD_HOME: path.join(dir, 'avd'), AMK_LOCK_DIR: path.join(dir, 'locks'), PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`, AMK_ANDROID_DEVICE: '', AMK_ANDROID_AVD: '', ...env },
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
  const r = verifyAndroid({ connected: ['emulator-5556 P35'], build: true, maestro: offlineOnce });
  assert.match(r.out, /the device went offline during flow smoke; running it once more/);
  assert.match(r.out, /android: flows 1\/1 passed, 1 screenshots/);
  assert.match(r.calls, /^reconnect offline$/m);
  const failing = verifyAndroid({ connected: ['emulator-5556 P35'], build: true, maestro: 'echo "Assert that id: x is visible... FAILED"; exit 1' });
  assert.doesNotMatch(failing.out, /once more/, 'other failures aren\'t run again');
  assert.match(failing.out, /flow smoke failed, see \.amk\/evidence\/run\/android\/smoke\.log and Maestro's own log \.amk\/evidence\/run\/maestro-logs\/android-smoke\/maestro\.log/);
});

// records the device, and the orientation a flow is turned to or "direct" for a flow run as it is, then saves a screenshot
// the shape the device shows: a phone tall and a tablet wide, unless turned (NOTURN set: the app never turns)
const record = String.raw`for last; do :; done
out=$(echo "$@" | sed 's/.*--test-output-dir \([^ ]*\).*/\1/'); device=$(echo "$@" | sed 's/.*--device \([^ ]*\).*/\1/')
case $last in
  */screen.yaml) o=$(sed -n 's/^- setOrientation: //p' "$last"); echo "$device $o $(sed -n "s/^- runFlow: '\(.*\)'$/\1/p" "$last" | sed 's/.*\///')" ;;
  *) o=natural; echo "$device direct $(basename "$last")" ;;
esac >> "$FAKE_STATE.maestro"
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

// verify.sh ios on a Mac, with stand-ins for Xcode's tools (xcrun simctl and devicectl, xcodebuild) and for maestro-runner
// (npx). A bare app that runs on iPhone only, upright and turned, signed by the project's team unless `team` says
// otherwise. One simulator, "iPhone 17", and one connected iPhone, "Tester's iPhone" (00008020-AAAA). xcrun and
// xcodebuild log their arguments in calls, maestro-runner in runner; the crash reports on the iPhone are listed in crashes.
// FAKE_UNTRUSTED: the iPhone doesn't open the app; FAKE_REFUSED_ONCE: not the first time; FAKE_FLOW_REFUSED_ONCE: not in
// the first flow; FAKE_CLOSES: the app closes at once; FAKE_CRASH: it crashes in a flow
const skipIos = process.platform !== 'darwin' && 'needs a Mac (PlistBuddy)';
function verifyIos({ env = {}, team = 'ABCDE12345', args = ['ios', '--label', 'run'], crashes = '', files = {} }) {
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
[ -z "$FAKE_CRASH" ] || grep -qx App-2026-10-16-120000.ips "$FAKE_STATE.crashes" || echo App-2026-10-16-120000.ips >> "$FAKE_STATE.crashes"
`, 0o755);
  write(dir, 'bin/maestro', '#!/bin/sh\necho 2.11.0\n', 0o755);
  for (const tool of ['ps', 'sleep', 'sips']) write(dir, `bin/${tool}`, '#!/bin/sh\n', 0o755);
  write(dir, 'app/ios/App.xcodeproj/project.pbxproj', `INFOPLIST_FILE = App/Info.plist;\nTARGETED_DEVICE_FAMILY = 1;\n${team ? `DEVELOPMENT_TEAM = ${team};\n` : ''}`);
  write(dir, 'app/ios/App/Info.plist', '<key>UISupportedInterfaceOrientations</key>\n<array>\n<string>UIInterfaceOrientationPortrait</string>\n<string>UIInterfaceOrientationLandscapeLeft</string>\n</array>\n');
  for (const f of ['Podfile', 'Pods/Manifest.lock', 'build/generated/.keep', 'App.xcworkspace/contents.xcworkspacedata']) write(dir, `app/ios/${f}`, '');
  for (const [f, text] of Object.entries(files)) write(dir, `app/${f}`, text);
  const r = spawnSync('sh', ['scripts/amk/verify.sh', ...args], {
    cwd: path.join(dir, 'app'), encoding: 'utf8',
    env: { ...process.env, FAKE_STATE: path.join(dir, 'state'), AMK_LOCK_DIR: path.join(dir, 'locks'), PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`, AMK_IOS_DEVICE: '', AMK_IOS_TABLET: '', AMK_IOS_TEAM: '', ...env },
  });
  const readIf = f => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : '');
  return { out: r.stdout + r.stderr, calls: readIf('state.calls'), runner: readIf('state.runner'), status: r.status, app: path.join(dir, 'app') };
}

test('verify.sh ios: a connected iPhone, when named: a build signed for it, opened once, then the flows through maestro-runner', { skip: skipIos }, () => {
  const r = verifyIos({ env: { AMK_IOS_DEVICE: "Tester's iPhone" } });
  assert.match(r.out, /^ios: checking on 00008020-AAAA, a real device; the flows clear the app's data on it$/m);
  // signed for development by the project's team, for this device; no simulator build, as no simulator is checked
  assert.match(r.calls, /^xcodebuild .*-destination id=00008020-AAAA .*-allowProvisioningUpdates -allowProvisioningDeviceRegistration DEVELOPMENT_TEAM=ABCDE12345 CODE_SIGN_STYLE=Automatic/m);
  assert.doesNotMatch(r.calls, /iphonesimulator|simctl (boot|install)/);
  assert.match(r.calls, /^xcrun devicectl device install app --device 00008020-AAAA .*Release-iphoneos\/App\.app$/m);
  assert.match(r.calls, /^xcrun devicectl device process launch --device 00008020-AAAA --terminate-existing com\.example\.app$/m);
  // upright, then turned with the name maestro-runner's WebDriverAgent driver turns a device with, a turn that doesn't
  // fail when the home screen in front doesn't turn: the screenshots show whether the app did
  const runs = r.runner.trim().split('\n');
  assert.strictEqual(runs.length, 2, r.runner);
  for (const run of runs) assert.match(run, /^-y maestro-runner@\d+\.\d+\.\d+ --platform ios --driver wda --device 00008020-AAAA --team-id ABCDE12345 --wda-bundle-id com\.example\.app\.wda --app-file \S+\/Release-iphoneos\/App\.app test -e APP_ID=com\.example\.app --output \S+ --flatten \S+\/screen\.yaml \(telemetry off: 1\)$/);
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

  // a crash report the app left during the flows joins the evidence and fails the check; an older one doesn't
  const crashed = verifyIos({ env: { AMK_IOS_DEVICE: '00008020-AAAA', FAKE_CRASH: '1' }, crashes: 'App-2026-10-01-090000.ips\nOther-2026-10-16-120000.ips\n' });
  assert.match(crashed.out, /^ios: the app crashed on 00008020-AAAA during the checks: 1 crash reports in \.amk\/evidence\/run\/crashes$/m);
  assert.deepStrictEqual(fs.readdirSync(path.join(crashed.app, '.amk/evidence/run/crashes')), ['App-2026-10-16-120000.ips']);
  assert.notStrictEqual(crashed.status, 0);
});

test('verify.sh ios: what a real device needs first is said before any flow runs: a team, trusting it, an app that stays open', { skip: skipIos }, () => {
  const noTeam = verifyIos({ team: '', env: { AMK_IOS_DEVICE: '00008020-AAAA' } });
  assert.match(noTeam.out, /^ios: a real device runs only apps signed by an Apple team: set AMK_IOS_TEAM to your team ID \(Xcode > Settings > Accounts lists them\)$/m);
  assert.doesNotMatch(noTeam.calls, /xcodebuild/);
  assert.notStrictEqual(noTeam.status, 0);
  // AMK_IOS_TEAM signs instead of the project's team
  assert.match(verifyIos({ env: { AMK_IOS_DEVICE: '00008020-AAAA', AMK_IOS_TEAM: 'ZYXWV98765' } }).calls, /DEVELOPMENT_TEAM=ZYXWV98765/);
  const untrusted = verifyIos({ env: { AMK_IOS_DEVICE: '00008020-AAAA', FAKE_UNTRUSTED: '1' } });
  assert.match(untrusted.out, /^ios: 00008020-AAAA doesn't open apps from this team yet: on it, Settings > General > VPN & Device Management > Developer App > Trust, then run this again$/m);
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
  assert.doesNotMatch(sim.calls, /devicectl device|-destination id=/);
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
  assert.doesNotMatch(never.out, /sets its orientation/, 'nothing in its code to point at');
  assert.notStrictEqual(never.status, 0);
  // never turns, and its code locks it upright although its native settings allow turning: says where
  const locked = verifyAndroid({ ...devices, env: { ...devices.env, NOTURN: '1' }, git: true, files: { 'src/screen/splash/index.js': 'Orientation.lockToPortrait();\n', 'README.md': 'lockToPortrait\n' } });
  assert.match(locked.out, /treating this as a failure\n {2}android-landscape: the app sets its orientation in its code \(src\/screen\/splash\/index\.js\), which can keep it upright\. If it's meant to stay upright, take landscape out of its native settings \(UISupportedInterfaceOrientations in Info\.plist, screenOrientation in AndroidManifest\.xml\) and this screen isn't checked any more; otherwise change that code\n/);
  assert.notStrictEqual(locked.status, 0);
});
