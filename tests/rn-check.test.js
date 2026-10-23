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
  assert.match(r.out, /Ask the user, for each one: fix it, or keep the line with `\/\/ amk-ok \d{4}-\d{2}-\d{2}: <their reason>` on it\.\n {2}Never add an amk-ok without the user's reason\. One kept over two weeks ago comes back when its file changes/);

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
  assert.match(check(dir).out, /^rn-check: no changed source files since main$/m);
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
  const r = check(bare);
  for (const [line, re] of [[1, /✗ src\/a\.tsx:1 {2}StyleSheet\.absoluteFillObject was removed/], [2, /✗ src\/a\.tsx:2 {2}InteractionManager was removed/],
    [3, /✗ src\/a\.tsx:3 {2}Modal's animated was removed/], [4, /✗ src\/a\.tsx:4 {2}ScrollView's boolean keyboardShouldPersistTaps was removed/],
    [5, /! src\/a\.tsx:5 {2}forwardRef isn't needed in React 19/], [6, /! src\/a\.tsx:6 {2}React 19 renders a context directly/],
    [7, /! src\/a\.tsx:7 {2}any turns off type checking/], [8, /! src\/a\.tsx:8 {2}@ts-ignore hides a type error/], [10, /✗ src\/a\.tsx:10 {2}a 7 KB base64 image in code/]]) {
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
  assert.match(check(dir).out, /^rn-check: no changed source files since main$/m, 'files nobody changed stay quiet');

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
