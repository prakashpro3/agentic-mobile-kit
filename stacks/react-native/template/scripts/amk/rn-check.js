#!/usr/bin/env node
// Checks the lines this branch adds or changes for React Native mistakes that the app's rules (docs/amk/react-native.md
// or expo.md) list. Problems (✗) fail it, and so verify.sh quick; warnings (!) don't. Only changed lines: code already
// on the base branch is never reported. A line that's right as it is carries `// amk-ok <date>: <reason>`, on it or on
// the line above, with the user's reason and the day they gave it; it's listed as kept, for review. When a branch changes
// a file again, a kept line in it that's over two weeks old is reported again, for the user to decide again (the date
// from git when the comment has none).
// The base is the one baseline.js uses (AMK_BASE sets it). Usage: node scripts/amk/rn-check.js
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = process.cwd();
const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 2 ** 28 });
  } catch {
    return null;
  }
};
if (git('rev-parse', '--git-dir') === null) {
  console.log('rn-check: skipped (not a git repository)');
  process.exit(0);
}

// ---------- the changed lines ----------
const found = spawnSync(process.execPath, [path.join(__dirname, 'baseline.js'), 'base'], { cwd: root, encoding: 'utf8' });
const baseRef = found.status === 0 ? found.stdout.trim() : '';
const sha = (baseRef && git('merge-base', 'HEAD', baseRef) || git('rev-parse', '--verify', '--quiet', 'HEAD') || '').trim();
const since = baseRef || 'the last commit';
const source = f => /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(f) && !f.endsWith('.d.ts')
  && !/(^|\/)(node_modules|scripts\/amk|__tests__|__mocks__|e2e)\//.test(f)
  && !/\.(test|spec)\.\w+$|(^|\/)(jest[.-]setup|setup-?tests)[^/]*$/i.test(f);
const changed = new Map(); // file -> Set of line numbers, or 'all'
if (sha) {
  let file = null;
  for (const line of (git('diff', '-U0', '--no-color', '--no-ext-diff', '--relative', '-M', '--diff-filter=ACMR', sha) || '').split('\n')) {
    if (line.startsWith('+++ ')) { file = line === '+++ /dev/null' ? null : line.slice(6); continue; }
    const h = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!h || !file || !source(file)) continue;
    if (!changed.has(file)) changed.set(file, new Set());
    for (let n = Number(h[1]), end = n + Number(h[2] ?? 1); n < end; n++) changed.get(file).add(n);
  }
}
for (const f of (git('ls-files', '--others', '--exclude-standard') || '').split('\n')) if (f && source(f)) changed.set(f, 'all');

// ---------- what the app uses ----------
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch {}
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const major = name => Number((/\d+/.exec(deps[name] || '') || [0])[0]);
const expoSdk = deps.expo ? major('expo') : 0;

// the code without its comments (each comment character a space, so positions and lines stay). A quote opened in
// JSX text (Don't) ends with its line, so it can't hide the rest of the file; a template string can span lines
function stripComments(text) {
  const out = text.split('');
  let block = false;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '\n') { if (quote !== '`') quote = null; continue; }
    if (block) {
      if (c === '*' && n === '/') { out[i] = out[i + 1] = ' '; i++; block = false; } else out[i] = ' ';
      continue;
    }
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '/' && n === '*') { block = true; out[i] = out[i + 1] = ' '; i++; continue; }
    // not a URL's // (https://) or one in a regular expression (\/\/)
    if (c === '/' && n === '/' && !/[:\w\\]/.test(text[i - 1] || '')) {
      while (i < text.length && text[i] !== '\n') out[i++] = ' ';
      i--;
    }
  }
  return out.join('');
}

// from an opening bracket or a tag's <, the index of its end: the matching bracket, or the tag's closing >
function endOf(code, start) {
  const open = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  let quote = null;
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if (quote) { if (c === '\\') i++; else if (c === quote || (c === '\n' && quote !== '`')) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (open[c]) stack.push(open[c]);
    else if (c === stack[stack.length - 1]) { stack.pop(); if (!stack.length && code[start] !== '<') return i; }
    else if (c === '>' && code[start] === '<' && !stack.length && code[i - 1] !== '=') return i;
  }
  return code.length - 1;
}

// ---------- the checks ----------
const findings = [];
const kept = [];
const DAY = 24 * 3600 * 1000;
// a day as the user's calendar has it
const localDay = ms => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const today = localDay(Date.now());
// when the amk-ok on line n of file was given: its date, else the day git has for the line (today when uncommitted)
function okSince(file, n, date) {
  if (date) return date;
  const t = /^committer-time (\d+)$/m.exec(git('blame', '--porcelain', '-L', `${n},${n}`, '--', file) || '');
  return t ? localDay(Number(t[1]) * 1000) : today;
}
const importsFrom = (code, from) => [...code.matchAll(new RegExp(`import\\s+[^;'"]*?\\{([^}]*)\\}\\s*from\\s*['"]${from}['"]`, 'g'))];
const timers = /\bset(Timeout|Interval)\s*\(/;
const listeners = /\.(addEventListener|addListener|subscribe)\s*\(/;

function check(file, text) {
  const code = stripComments(text);
  const ts = /\.tsx?$/.test(file);
  const out = [];
  const add = (level, at, end, message, line) => out.push({ level, at, end: end ?? at, message, line });
  const each = (re, fn, src = code) => { for (const m of src.matchAll(re)) fn(m); };

  // problems: removed or private APIs, secrets and tokens in the open, images in code
  each(/\bInteractionManager\b/g, m => add('✗', m.index, null, 'InteractionManager was removed in React Native 0.87: use requestIdleCallback'));
  each(/\babsoluteFillObject\b/g, m => add('✗', m.index, null, 'StyleSheet.absoluteFillObject was removed in React Native 0.85: use StyleSheet.absoluteFill'));
  each(/\bStatusBar\s*\.\s*set(BackgroundColor|Translucent)\s*\(/g, m => add('✗', m.index, null, `StatusBar.set${m[1]} was removed in React Native 0.87 (edge to edge, it did nothing)`));
  each(/<\s*(StatusBar|Modal|ScrollView|FlatList|SectionList|KeyboardAwareScrollView)\b/g, m => {
    const end = endOf(code, m.index);
    const tag = code.slice(m.index, end + 1);
    const prop = m[1] === 'StatusBar' ? /\s(backgroundColor|translucent)\b/.exec(tag)
      : m[1] === 'Modal' ? /\s(animated)\b(?!Type)/.exec(tag)
        : /\s(keyboardShouldPersistTaps)(\s*=\s*\{\s*(true|false)\s*\}|(?=[\s/>]))/.exec(tag);
    if (!prop) return;
    const instead = { backgroundColor: 'edge to edge, it did nothing', translucent: 'edge to edge, it did nothing', animated: 'use animationType', keyboardShouldPersistTaps: 'use "handled"' }[prop[1]];
    add('✗', m.index + prop.index + 1, null, `${m[1]}'s ${prop[1] === 'keyboardShouldPersistTaps' ? 'boolean keyboardShouldPersistTaps' : prop[1]} was removed in React Native 0.87: ${instead}`);
  });
  each(/(['"])react-native\/Libraries\/[^'"\n]*\1/g, m => add('✗', m.index, null, `${m[0]} is React Native's private code (a type error from 0.87): import from 'react-native'`));
  // at the name itself: a branch that adds another name to an old import statement didn't add this one
  for (const m of importsFrom(code, 'react-native')) {
    const name = n => { const i = m[0].search(new RegExp(`\\b${n}\\b`)); return i < 0 ? null : m.index + i; };
    if (name('SafeAreaView') !== null) add('✗', name('SafeAreaView'), null, "SafeAreaView from 'react-native' is deprecated and iOS-only: use react-native-safe-area-context");
    for (const n of ['ImageBackground', 'InputAccessoryView', 'DrawerLayoutAndroid']) {
      if (name(n) !== null) add('!', name(n), null, `${n} is deprecated in React Native: see the React Native rules for its replacement`);
    }
    for (const n of ['NativeModules', 'requireNativeComponent']) {
      if (name(n) !== null) add('!', name(n), null, `${n} is the old architecture: write a Turbo Module or a Fabric component`);
    }
  }
  each(/\bAsyncStorage\s*\.\s*(setItem|multiSet|mergeItem)\s*\(/g, m => {
    const open = m.index + m[0].length - 1;
    if (/token|password|passwd|secret|credential|api[_-]?key/i.test(code.slice(open, endOf(code, open)))) {
      add('✗', m.index, null, `a token or password saved to AsyncStorage, which isn't encrypted: use ${expoSdk ? 'expo-secure-store' : 'the Keychain/Keystore (react-native-keychain)'}`);
    }
  });
  // secrets are reported without their value; comments too, as they ship in the repository
  const secrets = [
    [/\bgh[pousr]_[A-Za-z0-9]{36,}/g, 'a GitHub token'], [/\bgithub_pat_[A-Za-z0-9_]{40,}/g, 'a GitHub token'],
    [/\b[sr]k_live_[A-Za-z0-9]{20,}/g, 'a Stripe secret key'], [/\bAKIA[0-9A-Z]{16}\b/g, 'an AWS access key'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, 'a private key'], [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, 'a Slack token'],
    [/\bsk-(proj-|ant-)?[A-Za-z0-9_-]{32,}/g, 'an AI service API key'],
  ];
  for (const [re, what] of secrets) each(re, m => add('✗', m.index, null, `${what} in code: anyone with the repository or the app can read it. Revoke it and keep it on a server`), text);
  each(/\bAIza[0-9A-Za-z_-]{35}\b/g, m => add('!', m.index, null, 'a Google API key in code: ship it only if it is restricted to this app (Google Cloud console)'), text);
  each(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]{8000,}/g, m => add('✗', m.index, m.index + m[0].length, `a ${Math.round(m[0].length * 0.75 / 1024)} KB base64 image in code: put it in an asset file`), text);
  if (expoSdk >= 56 && deps['expo-router']) {
    each(/(['"])@react-navigation\/[^'"\n]+\1/g, m => add('✗', m.index, null, `${m[0]} doesn't work alongside Expo Router from SDK 56: import from expo-router (see the expo-router skill)`));
  }

  // warnings: likely mistakes, which an app's own components can make right
  each(/<\s*(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|TouchableNativeFeedback)\b/g, m => {
    const end = endOf(code, m.index);
    const tag = code.slice(m.index, end + 1);
    if (/\{\s*\.\.\./.test(tag) || /\baccessible\s*=\s*\{\s*false\s*\}/.test(tag) || /onPress\s*=\s*\{\s*Keyboard\.dismiss\s*\}/.test(tag)) return;
    const missing = [!/\b(accessibilityLabel|aria-label|accessibilityLabelledBy)\b/.test(tag) && 'accessibilityLabel', !/\b(accessibilityRole|role)\s*=/.test(tag) && 'accessibilityRole'].filter(Boolean);
    if (missing.length) add('!', m.index, end, `<${m[1]}> without ${missing.join(' and ')}: screen readers can't tell what it does`);
  });
  each(/\bDimensions\s*\.\s*get\s*\(/g, m => add('!', m.index, null, "Dimensions.get doesn't update on rotation or resizing: use useWindowDimensions()"));
  each(/\ballowFontScaling\s*=\s*\{\s*false\s*\}/g, m => add('!', m.index, null, 'allowFontScaling={false} ignores the user\'s text size: make the layout wrap instead'));
  each(/\bkey\s*=\s*\{\s*(index|idx|i)\s*\}/g, m => add('!', m.index, null, 'a list key from the index mixes up rows when items change: use the item\'s ID'));
  each(/\bkeyExtractor\s*=\s*\{\s*\(\s*[^,()]*,\s*(\w+)\s*(?::\s*number\s*)?\)\s*=>\s*(String\(\s*\1\s*\)|\1\s*\.\s*toString\(\s*\)|`\$\{\s*\1\s*\}`|\1)\s*\}/g, m => add('!', m.index, null, 'a list key from the index mixes up rows when items change: use the item\'s ID'));
  each(/\bcatch\s*(\([^)]*\))?\s*\{|\.catch\(\s*(\(\s*\w*\s*\)|\w+)\s*=>\s*\{/g, m => {
    const open = m.index + m[0].length - 1;
    const close = endOf(code, open);
    if (!text.slice(open + 1, close).trim()) add('!', m.index, close, 'an empty catch: the error disappears. Show it, or report it to the crash reporter');
  });
  each(/\buse(Layout)?Effect\s*\(/g, m => {
    const open = m.index + m[0].length - 1;
    const close = endOf(code, open);
    const body = code.slice(open, close);
    const t = timers.exec(body);
    if (t && !/\bclear(Timeout|Interval)\s*\(/.test(body)) add('!', m.index, close, `a set${t[1]} in an effect with nothing clearing it: clear it in the effect's cleanup`, lineAt(code, open + t.index));
    const l = listeners.exec(body);
    if (l && !/\breturn\b/.test(body)) add('!', m.index, close, `${l[1]} in an effect that returns no cleanup: return a function that removes it`, lineAt(code, open + l.index));
  });
  each(/\bconsole\s*\.\s*log\s*\(/g, m => add('!', m.index, null, 'console.log left in: remove it, or use the app\'s logger'));
  each(/\bmask(AllTextInputs|AllText|AllInputs|TextInputs)\s*:\s*false\b/g, m => add('!', m.index, null, 'session replay that records what users type: mask text inputs'));
  each(/\bAccessibilityInfo\s*\.\s*setAccessibilityFocus\s*\(/g, m => add('!', m.index, null, 'AccessibilityInfo.setAccessibilityFocus is deprecated: use sendAccessibilityEvent'));
  if (major('react') >= 19) {
    each(/\bforwardRef\s*[<(]/g, m => add('!', m.index, null, 'forwardRef isn\'t needed in React 19: take ref as a prop'));
    each(/<\s*[\w.]+\.Provider\b/g, m => add('!', m.index, null, 'React 19 renders a context directly: <SomeContext value={…}> instead of .Provider'));
  }
  if (expoSdk) each(/(['"])expo-av\1/g, m => add('!', m.index, null, 'expo-av isn\'t maintained any more: use expo-audio and expo-video'));
  if (expoSdk >= 56) each(/(['"])@expo\/vector-icons[^'"\n]*\1/g, m => add('!', m.index, null, '@expo/vector-icons is deprecated from SDK 56: use @react-native-vector-icons/*'));
  if (ts) {
    each(/@ts-ignore\b/g, m => add('!', m.index, null, '@ts-ignore hides a type error: fix the type instead'), text);
    // in a type, not in JSX text ("Note: any change")
    each(/\bas\s+any\b(?!\s+[a-z])|:\s*any(?=\s*[;,)=>\]|&}[\n])|<any>/g, m => add('!', m.index, null, 'any turns off type checking here: give it a type'));
  }
  return out;
}

// the 1-based line of index i
function lineAt(code, i) {
  let n = 1;
  for (let j = code.indexOf('\n'); j !== -1 && j < i; j = code.indexOf('\n', j + 1)) n++;
  return n;
}

for (const [file, lines] of changed) {
  let text;
  try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
  const rows = text.split('\n');
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  const line = i => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= i) lo = mid; else hi = mid - 1; } return lo + 1; };
  for (const f of check(file, text)) {
    const from = line(f.at);
    const to = line(f.end);
    const touched = lines === 'all' || [...Array(to - from + 1).keys()].some(k => lines.has(from + k));
    const at = f.line || from;
    // on the line, or in a comment on the line above
    const above = /^\s*(\/\/|\/\*|\{\s*\/\*)/.test(rows[at - 2] || '') ? at - 1 : 0;
    const okAt = [at, above].find(n => n && /amk-ok\b/.test(rows[n - 1]));
    const ok = okAt && /amk-ok(?:\s+(\d{4}-\d{2}-\d{2}))?\s*:\s*(\S.*?)\s*(\*\/\s*\}?)?\s*$/.exec(rows[okAt - 1]);
    let message = f.message;
    if (ok) {
      const since = okSince(file, okAt, ok[1]);
      // kept: listed when its own lines changed; over two weeks old, asked again whenever its file changes
      if (Date.parse(today) - Date.parse(since) <= 14 * DAY) { if (touched) kept.push(`${file}:${at}: ${ok[2]} (${since})`); continue; }
      message = `kept with amk-ok since ${since}, over two weeks, and its file changed again: ${f.message}. The user's reason then: ${ok[2]}`;
    } else if (!touched) continue;
    if (!findings.some(x => x.where === `${file}:${at}` && x.message === message)) findings.push({ ...f, message, where: `${file}:${at}` });
  }
}

// ---------- once for the app: an error boundary somewhere ----------
let boundary = true;
if (changed.size) {
  boundary = false;
  const files = [...(git('ls-files') || '').split('\n'), ...changed.keys()].filter(f => f && source(f));
  for (const f of new Set(files)) {
    try {
      if (/componentDidCatch|getDerivedStateFromError|ErrorBoundary|Sentry\s*\.\s*wrap\b/.test(fs.readFileSync(path.join(root, f), 'utf8'))) { boundary = true; break; }
    } catch {}
  }
}

// ---------- report ----------
// by file, then line
const order = w => { const [, file, n] = /^(.*):(\d+)$/.exec(w); return [file, Number(n)]; };
findings.sort((a, b) => { const [fa, na] = order(a.where); const [fb, nb] = order(b.where); return fa === fb ? na - nb : fa < fb ? -1 : 1; });
const problems = findings.filter(f => f.level === '✗');
const warnings = findings.filter(f => f.level === '!');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
if (!changed.size) console.log(`rn-check: no changed source files since ${since}`);
else if (!findings.length) console.log(`rn-check: nothing to report in the lines changed since ${since}`);
else console.log(`rn-check: ${plural(problems.length, 'problem')}, ${plural(warnings.length, 'warning')} in the lines changed since ${since}`);
for (const f of [...problems, ...warnings]) console.log(`  ${f.level} ${f.where}  ${f.message}`);
if (!boundary) console.log(`  ! the app has no error boundary: a render error shows a blank screen or closes the app. Wrap the app in one`);
if (kept.length) console.log(`  kept with amk-ok: ${[...new Set(kept)].join('; ')}`);
if (problems.length) {
  console.log(`  Each ✗ fails verify.sh quick. Ask the user, for each one: fix it, or keep the line with \`// amk-ok ${today}: <their reason>\` on it.`);
  console.log('  Never add an amk-ok without the user\'s reason. One kept over two weeks ago comes back when its file changes: ask again, and to keep it, write today\'s date.');
}
if (warnings.length || !boundary) console.log('  Fix each ! in the code this task changed, or tell the user why it stays.');
process.exit(problems.length ? 1 : 0);
