// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const tmpDir = require('./tmp');

const KIT = path.join(__dirname, '../stacks/react-native/template/scripts/amk');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const write = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
const commit = (dir, msg) => { git(dir, 'add', '-A'); git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', msg); };
const check = dir => {
  const r = spawnSync(process.execPath, ['scripts/amk/rn-check.js'], { cwd: dir, encoding: 'utf8', env: { ...process.env, AMK_BASE: '' } });
  return { out: r.stdout + r.stderr, status: r.status };
};

// an app on main with old mistakes in it, then a branch: files of its own, and the kit's scripts beside them
function app(pkg = { dependencies: { react: '19.2.3', 'react-native': '0.87.1' } }, files = {}) {
  const dir = tmpDir('amk-rn-check-');
  git(dir, 'init', '-q');
  git(dir, 'checkout', '-q', '-b', 'main');
  write(dir, 'package.json', JSON.stringify(pkg));
  write(dir, 'src/old.tsx', "import { InteractionManager, SafeAreaView } from 'react-native';\nconst w = Dimensions.get('window');\n");
  write(dir, 'src/list.tsx', "import {\n  SafeAreaView,\n  View,\n} from 'react-native';\n");
  for (const f of ['rn-check.js', 'baseline.js']) write(dir, `scripts/amk/${f}`, fs.readFileSync(path.join(KIT, f), 'utf8'));
  for (const [f, text] of Object.entries(files)) write(dir, f, text);
  commit(dir, 'app');
  git(dir, 'checkout', '-q', '-b', 'feature');
  return dir;
}

// a GitHub token's shape, made here so the kit's own repository holds none
const TOKEN = `gh${'p'}_${'a1B2'.repeat(9)}`;
// the local date n days ago, as amk-ok comments carry it
const day = n => new Date(Date.now() - n * 864e5 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

test('rn-check: problems and warnings in the lines a branch changes, and nothing in code it left alone', () => {
  const dir = app();
  // a line added to an old file: only it counts. A name added to an old import over several lines doesn't bring up
  // the names already in it
  fs.appendFileSync(path.join(dir, 'src/old.tsx'), 'console.log(w);\n');
  fs.writeFileSync(path.join(dir, 'src/list.tsx'), fs.readFileSync(path.join(dir, 'src/list.tsx'), 'utf8').replace('  View,\n', '  View,\n  ScrollView,\n'));
  write(dir, 'src/screens/login.tsx', `import {
  View,
  SafeAreaView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import codegen from 'react-native/Libraries/Utilities/codegenNativeComponent';
// InteractionManager.runAfterInteractions(go) is only in this comment
export async function save(token: string) {
  await AsyncStorage.setItem('auth_token', token);
  await AsyncStorage.setItem('theme', 'dark');
}
const key = '${TOKEN}';
export function Login({ items }: { items: Item[] }) {
  useEffect(() => {
    const t = setTimeout(() => go(), 1000);
  }, []);
  try { go(); } catch (e) {}
  try { go(); } catch (e) { /* offline: the next sync retries */ }
  const w = Dimensions.get('window'); // amk-ok: read once for the splash, which never turns
  return (
    <SafeAreaView>
      <Pressable onPress={go}>
        <Text>Don't Allow: any change waits</Text>
        {/* InteractionManager, after JSX text with a quote in it, is still only a comment */}
      </Pressable>
      <Pressable onPress={go} accessibilityRole="button" accessibilityLabel="Save" />
      {items.map((it, index) => <Row key={index} />)}
      <StatusBar backgroundColor="red" />
    </SafeAreaView>
  );
}
`);
  const r = check(dir);
  assert.strictEqual(r.status, 1, r.out);
  assert.match(r.out, /^rn-check: 5 problems, 5 warnings in the lines changed since main$/m);
  const at = (line, re) => assert.match(r.out, new RegExp(`^ {2}${re.source.startsWith('!') ? '!' : '✗'} src/screens/login\\.tsx:${line} {2}${re.source.replace(/^!/, '')}`, 'm'));
  at(3, /SafeAreaView from 'react-native' is deprecated/); // in an import over several lines, at the name
  at(6, /'react-native\/Libraries\/Utilities\/codegenNativeComponent' is React Native's private code/);
  at(9, /a token or password saved to AsyncStorage/);
  at(12, /a GitHub token in code/);
  at(28, /StatusBar's backgroundColor was removed in React Native 0\.87/);
  at(15, /!a setTimeout in an effect with nothing clearing it/); // at the timer, not the effect
  at(17, /!an empty catch/);
  at(22, /!<Pressable> without accessibilityLabel and accessibilityRole/);
  at(27, /!a list key from the index/);
  assert.match(r.out, /^ {2}! src\/old\.tsx:3 {2}console\.log left in/m);
  assert.match(r.out, /✗ src\/screens\/login\.tsx:3 [^\n]*\n {2}✗ src\/screens\/login\.tsx:6 [^\n]*\n {2}✗ src\/screens\/login\.tsx:9 /, 'by file and line');
  assert.doesNotMatch(r.out, /[✗!] src\/screens\/login\.tsx:(7|10|18|19|23|24|26) /, 'a comment, the theme, an explained catch, an amk-ok line, JSX text, a labelled button');
  assert.doesNotMatch(r.out, /[✗!] src\/(old\.tsx:[12]|list\.tsx:\d+) /, 'the old code stays out');
  assert.ok(!r.out.includes(TOKEN), 'the secret itself is never printed');
  assert.match(r.out, /^ {2}kept with amk-ok: src\/screens\/login\.tsx:19: read once for the splash, which never turns \(\d{4}-\d{2}-\d{2}\)$/m);
  assert.match(r.out, /^ {2}! the app has no error boundary/m);
  assert.match(r.out, /Ask the user, for each one: fix it, or keep the line with `\/\/ amk-ok \d{4}-\d{2}-\d{2}: <their reason>` on it \(# in a flow\)\.\n {2}Never add an amk-ok without the user's reason\. One kept over two weeks ago comes back when its file changes/);

  // the user keeps one with a reason, and fixes the rest: warnings alone don't fail
  write(dir, 'src/screens/login.tsx', `import { SafeAreaView } from 'react-native-safe-area-context';
// amk-ok ${day(0)}: a push token, not a credential
AsyncStorage.setItem('push_token', t);
export function Boundary() { return <ErrorBoundary><App /></ErrorBoundary>; }
console.log('x');
`);
  const fixed = check(dir);
  assert.strictEqual(fixed.status, 0, fixed.out);
  assert.match(fixed.out, /^rn-check: 0 problems, 2 warnings/m);
  assert.match(fixed.out, new RegExp(`kept with amk-ok: src/screens/login\\.tsx:3: a push token, not a credential \\(${day(0)}\\)`));
  assert.doesNotMatch(fixed.out, /error boundary/);
  assert.match(fixed.out, /Fix each ! in the code this task changed, or tell the user why it stays\./);

  // nothing changed since main
  commit(dir, 'login');
  git(dir, 'checkout', '-q', 'main');
  assert.match(check(dir).out, /^rn-check: no changed code or flows since main$/m);
});

test('rn-check: the rest of the removed and deprecated APIs, React 19, and an Expo app on SDK 56', () => {
  const bare = app();
  write(bare, 'src/a.tsx', `const s = StyleSheet.absoluteFillObject;
InteractionManager.runAfterInteractions(go);
<Modal animated visible />;
<ScrollView keyboardShouldPersistTaps />;
const Field = forwardRef((props, ref) => null);
<ThemeContext.Provider value={dark}><App /></ThemeContext.Provider>;
let x: any = (y as any).z;
// @ts-ignore
z();
const img = 'data:image/png;base64,${'A'.repeat(9000)}';
`);
  // an image of several MB, which a regular expression's repetition can't measure
  write(bare, 'src/big.tsx', `export const big = 'data:image/png;base64,${'A'.repeat(7e6)}';
`);
  const r = check(bare);
  for (const [line, re] of [[1, /✗ src\/a\.tsx:1 {2}StyleSheet\.absoluteFillObject was removed/], [2, /✗ src\/a\.tsx:2 {2}InteractionManager was removed/],
    [3, /✗ src\/a\.tsx:3 {2}Modal's animated was removed/], [4, /✗ src\/a\.tsx:4 {2}ScrollView's boolean keyboardShouldPersistTaps was removed/],
    [5, /! src\/a\.tsx:5 {2}forwardRef isn't needed in React 19/], [6, /! src\/a\.tsx:6 {2}React 19 renders a context directly/],
    [7, /! src\/a\.tsx:7 {2}any turns off type checking/], [8, /! src\/a\.tsx:8 {2}@ts-ignore hides a type error/], [10, /✗ src\/a\.tsx:10 {2}a 7 KB base64 image in code/], [11, /✗ src\/big\.tsx:1 {2}a 5127 KB base64 image in code/]]) {
    assert.match(r.out, re, `line ${line}\n${r.out}`);
  }

  const expo = app({ dependencies: { expo: '~56.0.0', 'expo-router': '~6.0.0', react: '19.2.3', 'react-native': '0.85.2' } });
  write(expo, 'app/index.tsx', `import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
await AsyncStorage.setItem('refresh-token', t);
`);
  const e = check(expo);
  assert.match(e.out, /✗ app\/index\.tsx:1 {2}'@react-navigation\/native' doesn't work alongside Expo Router from SDK 56/);
  assert.match(e.out, /! app\/index\.tsx:2 {2}@expo\/vector-icons is deprecated from SDK 56/);
  assert.match(e.out, /✗ app\/index\.tsx:3 {2}a token or password saved to AsyncStorage, which isn't encrypted: use expo-secure-store/);
});

test('rn-check: platform guidelines (text, back, screen readers, tap areas, permissions, motion) warn, and the right way stays quiet', () => {
  const dir = app();
  write(dir, 'src/settings.tsx', `export function Settings({ on, setOn }: Props) {
  useEffect(() => {
    Notifications.requestPermissionsAsync();
  }, []);
  BackHandler.addEventListener('hardwareBackPress', () => true);
  BackHandler.exitApp();
  Vibration.vibrate(50);
  Text.defaultProps = { allowFontScaling: false };
  const pulse = Animated.loop(Animated.timing(v, { toValue: 1, useNativeDriver: true }));
  return (
    <View>
      <Text style={{ fontSize: 9 }} maxFontSizeMultiplier={1.3}>Fine print</Text>
      <Text style={{ fontSize: 0.1 }}>hidden title</Text>
      <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close button" style={{ width: 24, height: 24 }} />
      <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 24, height: 24 }} hitSlop={12} />
      <Pressable onPress={toggle} accessibilityRole="switch" accessibilityLabel="Dark mode" />
      <Pressable onPress={toggle} accessibilityRole="switch" accessibilityLabel="Sync" accessibilityState={{ checked: on }} />
      <RoleBadge role="admin" />
      <Row onLongPress={remove} />
      <Row onLongPress={remove} accessibilityActions={[{ name: 'delete' }]} />
      <Modal visible={open}><Text>Hi</Text></Modal>
      <Modal visible={open} onRequestClose={hide}><Text>Hi</Text></Modal>
      <Stack.Screen options={{ gestureEnabled: false }} />
    </View>
  );
}
`);
  // asked from a button, with a way to Settings once blocked, and Reduce Motion read: nothing to say
  write(dir, 'src/camera.tsx', `export async function openCamera() {
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
  if (r === 'never_ask_again') Linking.openSettings();
}
export const still = AccessibilityInfo.isReduceMotionEnabled();
const spin = Animated.loop(x);
`);
  const r = check(dir);
  assert.strictEqual(r.status, 0, 'warnings only');
  const at = (line, re) => assert.match(r.out, new RegExp(`^ {2}! src/settings\\.tsx:${line} {2}${re.source}`, 'm'), `line ${line}\n${r.out}`);
  at(3, /requestPermissionsAsync in an effect asks when the screen opens/);
  at(3, /a permission request with nothing for when it's blocked/);
  at(5, /a back handler that always returns true traps Android's back button/);
  at(6, /BackHandler\.exitApp: Android apps don't quit themselves/);
  at(7, /Vibration\.vibrate buzzes/);
  at(8, /allowFontScaling false ignores the user's text size/);
  at(9, /a looping animation that ignores Reduce Motion/);
  at(12, /fontSize 9 is under 11/);
  at(12, /maxFontSizeMultiplier 1\.3 caps the user's text size/);
  at(14, /the label "Close button" names the role or the gesture/);
  at(14, /a <Pressable> 24 points wide or high: tap areas are at least 44×44/);
  at(16, /a switch without accessibilityState/);
  at(19, /a long-press action screen readers can't reach/);
  at(21, /a Modal without onRequestClose/);
  at(23, /gestureEnabled false turns off swipe back/);
  assert.doesNotMatch(r.out, /settings\.tsx:(13|15|17|18|20|22) /, 'the hidden title, hitSlop, a switch with state, a role prop, an action, a modal that closes');
  assert.doesNotMatch(r.out, /camera\.tsx/, 'asked in context, blocked handled, Reduce Motion read');
});

test('rn-check: a line kept over two weeks ago comes back when its file changes again, for the user to decide again', () => {
  const dir = app({ dependencies: { react: '19.2.3', 'react-native': '0.87.1' } }, {
    'src/settings.tsx': `import { SafeAreaView } from 'react-native'; // amk-ok ${day(30)}: a screen only iOS shows
// amk-ok ${day(3)}: read once at start
const w = Dimensions.get('window');
export const a = 1;
`,
    // no date in the comment: the day git has for the line
    'src/profile.tsx': "await AsyncStorage.setItem('token', t); // amk-ok: the server rotates it hourly\nexport const b = 1;\n",
  });
  git(dir, 'checkout', '-q', 'main');
  fs.appendFileSync(path.join(dir, 'src/profile.tsx'), '');
  git(dir, 'add', '-A');
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--amend', '--no-edit'], { cwd: dir, env: { ...process.env, GIT_COMMITTER_DATE: `${day(20)}T12:00:00` } });
  git(dir, 'checkout', '-q', '-B', 'feature');
  assert.match(check(dir).out, /^rn-check: no changed code or flows since main$/m, 'files nobody changed stay quiet');

  // the files change again, on other lines
  fs.writeFileSync(path.join(dir, 'src/settings.tsx'), fs.readFileSync(path.join(dir, 'src/settings.tsx'), 'utf8').replace('a = 1', 'a = 2'));
  fs.writeFileSync(path.join(dir, 'src/profile.tsx'), fs.readFileSync(path.join(dir, 'src/profile.tsx'), 'utf8').replace('b = 1', 'b = 2'));
  const r = check(dir);
  assert.strictEqual(r.status, 1, r.out);
  assert.match(r.out, new RegExp(`✗ src/settings\\.tsx:1 {2}kept with amk-ok since ${day(30)}, over two weeks, and its file changed again: SafeAreaView from 'react-native' is deprecated[^\\n]*\\. The user's reason then: a screen only iOS shows`));
  assert.match(r.out, new RegExp(`✗ src/profile\\.tsx:1 {2}kept with amk-ok since ${day(20)}, over two weeks`));
  assert.doesNotMatch(r.out, /settings\.tsx:3/, 'kept three days ago: still kept');

  // the user keeps one again (today's date) and fixes the other
  fs.writeFileSync(path.join(dir, 'src/settings.tsx'), fs.readFileSync(path.join(dir, 'src/settings.tsx'), 'utf8').replace(day(30), day(0)));
  fs.writeFileSync(path.join(dir, 'src/profile.tsx'), "await SecureStore.setItemAsync('token', t);\nexport const b = 2;\n");
  const again = check(dir);
  assert.strictEqual(again.status, 0, again.out);
  assert.match(again.out, new RegExp(`kept with amk-ok: src/settings\\.tsx:1: a screen only iOS shows \\(${day(0)}\\)`));
});

test('rn-check: Maestro flows (syntax, missing files, taps by text, apostrophes, typed passwords, no assertion) and each scenario of a touched spec', () => {
  const dir = app(undefined, {
    // on main: a flow tapping by text, and a subflow, which aren't the branch's
    '.maestro/old.yaml': 'appId: ${APP_ID}\n---\n- launchApp\n- tapOn: "Old button"\n- assertVisible:\n    id: "home"\n',
    '.maestro/subflows/log-in.yaml': '- tapOn:\n    id: "login-email"\n- inputText: ${MAESTRO_EMAIL}\n',
  });
  // a stand-in for maestro check-syntax: a flow with tapOnn is invalid
  write(dir, 'fake-maestro', '#!/bin/sh\nif grep -q tapOnn "$2"; then echo "Invalid Command: tapOnn at /syntax-checker:4:9"; exit 1; fi\necho OK\n');
  fs.chmodSync(path.join(dir, 'fake-maestro'), 0o755);
  write(dir, 'specs/x2-login/requirements.md', `## ADDED Requirements: Login

### Requirement: Log in
People SHALL log in with their email.

#### Scenario: Log in with the test account
- WHEN they enter the test account
- THEN the home screen shows

#### Scenario: Wrong password
- WHEN the password is wrong
- THEN an error shows

#### Scenario: Offline
- WHEN there's no network
- THEN it says so
`);
  write(dir, '.maestro/x2-login.yaml', `appId: com.example.app
---
- launchApp
- runFlow: subflows/log-in.yaml
- runFlow: subflows/missing.yaml
# Scenario 1: Log in with the test account
- tapOn: "Log in"
- tapOn: "Allow"
- tapOn:
    id: "login-password"
- inputText: "hunter2"
- inputText: \${MAESTRO_PASSWORD}
- tapOn: { id: "submit" }
- assertVisible:
    id: "home"
- takeScreenshot: x2-1-home
# Scenario 2: Wrong password
- assertVisible: "You're offline"
- tapOn: "Retry" # amk-ok ${day(0)}: the retry button comes from a library without a testID
# amk-ok ${day(0)}: the library's sheet has no testIDs
- tapOn: "Share"
`);
  write(dir, '.maestro/x3-broken.yaml', 'appId: ${APP_ID}\n---\n- launchApp\n- tapOnn:\n    id: "x"\n');
  write(dir, '.maestro/x4-nothing.yaml', 'appId: ${APP_ID}\n---\n- launchApp\n- tapOn:\n    id: "x"\n- takeScreenshot: x4-1\n');
  // a copy verify.sh runs for a moment on Android, with view-tree steps: not the team's flow
  write(dir, '.maestro/.amk-android-x4-nothing.yaml', 'appId: com.other\n---\n- tapOn: "Copy"\n');
  const run = env => { const r = spawnSync(process.execPath, ['scripts/amk/rn-check.js'], { cwd: dir, encoding: 'utf8', env: { ...process.env, AMK_BASE: '', ...env } }); return { out: r.stdout + r.stderr, status: r.status }; };
  const r = run({ AMK_MAESTRO: path.join(dir, 'fake-maestro') });
  assert.strictEqual(r.status, 1, r.out);
  // Windows can't run the shell-script stand-in, so there the flows go unchecked by it, and it says so
  const sh = process.platform !== 'win32';
  for (const re of [
    /✗ \.maestro\/x2-login\.yaml:5 {2}runFlow subflows\/missing\.yaml: no such file next to this flow \(\.maestro\/\)/,
    sh ? /✗ \.maestro\/x3-broken\.yaml:4 {2}maestro check-syntax: Invalid Command: tapOnn/ : /flows not syntax-checked/,
    /! \.maestro\/x2-login\.yaml:1 {2}appId com\.example\.app: verify\.sh sets APP_ID/,
    /! \.maestro\/x2-login\.yaml:7 {2}tapOn "Log in" taps by text/,
    /! \.maestro\/x2-login\.yaml:11 {2}a password typed into the flow/,
    /! \.maestro\/x2-login\.yaml:18 {2}"You're offline" has an apostrophe/,
    /! \.maestro\/x4-nothing\.yaml:1 {2}this flow checks nothing/,
    /! specs\/x2-login\/requirements\.md:\d+ {2}scenario 2 "Wrong password" has no screenshot in \.maestro\/x2-login\.yaml/,
    /! specs\/x2-login\/requirements\.md:\d+ {2}scenario 3 "Offline" has no block in \.maestro\/x2-login\.yaml: add "# Scenario 3: Offline" above its steps/,
    /kept with amk-ok: \.maestro\/x2-login\.yaml:19: the retry button comes from a library without a testID[^\n]*\.maestro\/x2-login\.yaml:21: the library's sheet has no testIDs/,
  ]) assert.match(r.out, re, `${re}\n${r.out}`);
  assert.doesNotMatch(r.out, /x2-login\.yaml:(4|8|9|12|13|14) /, 'an existing subflow, a system dialog button, taps by id, a password from a variable');
  assert.doesNotMatch(r.out, /old\.yaml|log-in\.yaml/, 'flows the branch didn\'t change');
  assert.doesNotMatch(r.out, /\.amk-android/, 'verify.sh\'s copies');
  assert.doesNotMatch(r.out, /scenario 1 /, 'scenario 1 has its steps, an assertion and a screenshot');
  // without Maestro on the machine: the rest still runs, and it says the syntax wasn't checked
  const none = run({ AMK_MAESTRO: path.join(dir, 'no-such-maestro') });
  assert.match(none.out, /flows not syntax-checked: Maestro isn't installed here/);
  assert.doesNotMatch(none.out, /check-syntax/);
});

test('verify.sh quick: rn-check runs after lint, typecheck and tests, and its problems fail quick', { skip: process.platform === 'win32' && 'verify.sh needs sh' }, () => {
  const dir = app({ scripts: { lint: 'node -e ""', typecheck: 'node -e ""', test: 'node -e ""' }, dependencies: { react: '19.2.3', 'react-native': '0.87.1' } });
  for (const f of fs.readdirSync(KIT)) write(dir, `scripts/amk/${f}`, fs.readFileSync(path.join(KIT, f), 'utf8'));
  commit(dir, 'kit');
  const quick = () => spawnSync('sh', ['scripts/amk/verify.sh', 'quick'], { cwd: dir, encoding: 'utf8', env: { ...process.env, AMK_BASE: 'main' } });
  write(dir, 'src/b.tsx', "import { SafeAreaView } from 'react-native';\nconsole.log(1);\n");
  const failed = quick();
  assert.match(failed.stdout, /^quick: lint, typecheck and tests passed\nrn-check: 1 problem, 1 warning in the lines changed since main\n {2}✗ src\/b\.tsx:1 {2}SafeAreaView/m);
  assert.notStrictEqual(failed.status, 0);
  write(dir, 'src/b.tsx', "import { SafeAreaView } from 'react-native'; // amk-ok: a screen only iOS shows\nconsole.log(1);\n");
  const passed = quick();
  assert.match(passed.stdout, /^rn-check: 0 problems, 1 warning/m);
  assert.strictEqual(passed.status, 0, passed.stdout + passed.stderr);
});
