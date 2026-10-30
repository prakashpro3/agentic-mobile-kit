#!/usr/bin/env node
// Checks the lines this branch adds or changes for React Native mistakes that the app's rules (docs/amk/react-native.md
// or expo.md) list, and its Maestro flows (.maestro/): Maestro's own syntax check, files they run that aren't there,
// taps by text, and each scenario of a spec the branch touched with its steps, an assertion and a screenshot.
// Problems (✗) fail it, and so verify.sh quick; warnings (!) don't. Only changed lines: code already
// on the base branch is never reported. A line that's right as it is carries `// amk-ok <date>: <reason>`, on it or on
// the line above, with the user's reason and the day they gave it; it's listed as kept, for review. When a branch changes
// a file again, a kept line in it that's over two weeks old is reported again, for the user to decide again (the date
// from git when the comment has none).
// It warns too about a source file over a size limit that's new or grows, and a function over a complexity limit (as
// ESLint's complexity rule counts it, through the app's ESLint) that's new or got more complex. .amk-size-caps, which
// the project owns, holds the limits and a cap for each file already over the limit: `--write-caps` writes it from the
// code as it is, and later lowers caps as files shrink (never raises one).
// The base is the one baseline.js uses (AMK_BASE sets it). Usage: node scripts/amk/rn-check.js [--write-caps]
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { stripYamlComments, scenarios, flowBlocks, blockFor, allFlows, flowsOf } = require('./specs.js');

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
// Maestro flows: the ones verify.sh runs (.maestro/*.yaml) and the subflows they run (in folders below)
// (not the copies with view-tree steps verify.sh runs for a moment on Android: .amk-<screen>-<flow>.yaml)
const flowFile = f => /^\.maestro\/.+\.ya?ml$/.test(f) && !/(^|\/)\.amk-/.test(f);

// ---------- the size limits: .amk-size-caps ----------
const CAPS = '.amk-size-caps';
let capsText = null;
try { capsText = fs.readFileSync(path.join(root, CAPS), 'utf8').replace(/\r\n/g, '\n'); } catch {}
const limits = { limit: 400, complexity: 20 };
const caps = new Map(); // file -> the most lines it may have
for (const l of (capsText || '').split('\n')) {
  const m = /^\s*([^#\s]\S*)\s+(\d+)\s*$/.exec(l);
  if (m && m[1] in limits) limits[m[1]] = Number(m[2]); else if (m) caps.set(m[1], Number(m[2]));
}
const lineCount = text => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
// what the limits count: source files, not generated ones
const sized = (f, text) => source(f) && !/(^|\/)(__generated__|generated)\/|\.generated\.\w+$/.test(f) && !/@generated\b/.test(text.slice(0, 1000));
if (process.argv.includes('--write-caps')) {
  const now = new Map();
  for (const f of (git('ls-files') || '').split('\n')) {
    let text;
    try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    if (f && sized(f, text)) now.set(f, lineCount(text));
  }
  // the first time, every file over the limit at its size; later, caps only come down: to a file's size when it
  // shrank, and away when it's gone or under the limit
  const entries = capsText === null ? [...now].filter(([, n]) => n > limits.limit)
    : [...caps].filter(([f]) => (now.get(f) || 0) > limits.limit).map(([f, cap]) => [f, Math.min(cap, now.get(f))]);
  const head = capsText === null ? [
    '# rn-check (in verify.sh quick) warns about a source file over the limit, in lines, that\'s new or grows. These files were',
    '# over it already: each warns when it grows past its cap here. Caps only come down: `node scripts/amk/rn-check.js',
    '# --write-caps` lowers them as the files shrink. complexity: the most a new function may have (ESLint\'s complexity rule).',
    `limit ${limits.limit}`, `complexity ${limits.complexity}`,
  ] : capsText.split('\n').filter(l => { const m = /^\s*([^#\s]\S*)\s+\d+\s*$/.exec(l); return !m || m[1] in limits; });
  while (head.length && !head[head.length - 1].trim()) head.pop();
  fs.writeFileSync(path.join(root, CAPS), `${[...head, ...entries.sort().map(([f, n]) => `${f} ${n}`)].join('\n')}\n`);
  const lowered = capsText === null ? 0 : entries.filter(([f, n]) => n < caps.get(f)).length;
  console.log(capsText === null ? `${CAPS}: ${entries.length} file(s) over ${limits.limit} lines, each capped at its size now. Commit it.`
    : `${CAPS}: ${lowered} cap(s) lowered, ${caps.size - entries.length} removed (the file is gone or under the limit)`);
  process.exit(0);
}

const changed = new Map(); // file -> Set of line numbers, or 'all'
const hunks = new Map(); // file -> the diff's [base start, base lines, start, lines], to find a line's place in the base
if (sha) {
  let file = null;
  for (const line of (git('diff', '-U0', '--no-color', '--no-ext-diff', '--relative', '-M', '--diff-filter=ACMR', sha) || '').split('\n')) {
    if (line.startsWith('+++ ')) { file = line === '+++ /dev/null' ? null : line.slice(6); continue; }
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!h || !file || !(source(file) || flowFile(file))) continue;
    if (!changed.has(file)) { changed.set(file, new Set()); hunks.set(file, []); }
    hunks.get(file).push([Number(h[1]), Number(h[2] ?? 1), Number(h[3]), Number(h[4] ?? 1)]);
    for (let n = Number(h[3]), end = n + Number(h[4] ?? 1); n < end; n++) changed.get(file).add(n);
  }
}
for (const f of (git('ls-files', '--others', '--exclude-standard') || '').split('\n')) if (f && (source(f) || flowFile(f))) changed.set(f, 'all');

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
const BASE64 = new Set([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='].map(c => c.charCodeAt(0)));
const SECRETS = [
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/g, 'a GitHub token'], [/\bgithub_pat_[A-Za-z0-9_]{40,}/g, 'a GitHub token'],
  [/\b[sr]k_live_[A-Za-z0-9]{20,}/g, 'a Stripe secret key'], [/\bAKIA[0-9A-Z]{16}\b/g, 'an AWS access key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, 'a private key'], [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, 'a Slack token'],
  [/\bsk-(proj-|ant-)?[A-Za-z0-9_-]{32,}/g, 'an AI service API key'],
];
const importsFrom = (code, from) => [...code.matchAll(new RegExp(`import\\s+[^;'"]*?\\{([^}]*)\\}\\s*from\\s*['"]${from}['"]`, 'g'))];
const timers = /\bset(Timeout|Interval)\s*\(/;
// a permission prompt (not App Tracking Transparency's, which apps show early on purpose)
const ASK = /\b(PermissionsAndroid\.request(?:Multiple)?|request\(\s*PERMISSIONS\.|requestMultiple|request(?:Foreground|Background)?PermissionsAsync|requestNotifications|requestPermission|Geolocation\.requestAuthorization)\s*\(?/;
const TOUCHABLE = /^(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|TouchableNativeFeedback)$/;
const listeners = /\.(addEventListener|addListener|subscribe)\s*\(/;
const reduceMotion = /isReduceMotionEnabled|reduceMotionChanged|useReducedMotion|ReduceMotion\b/;

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
  for (const [re, what] of SECRETS) each(re, m => add('✗', m.index, null, `${what} in code: anyone with the repository or the app can read it. Revoke it and keep it on a server`), text);
  each(/\bAIza[0-9A-Za-z_-]{35}\b/g, m => add('!', m.index, null, 'a Google API key in code: ship it only if it is restricted to this app (Google Cloud console)'), text);
  // measured without a regular expression, whose repetition overflows the stack on an image of a few MB
  for (let i = text.indexOf('data:image/'); i !== -1; i = text.indexOf('data:image/', i + 1)) {
    const head = /^data:image\/[a-z+]+;base64,/.exec(text.slice(i, i + 40));
    if (!head) continue;
    let j = i + head[0].length;
    while (j < text.length && BASE64.has(text.charCodeAt(j))) j++;
    if (j - i >= 8000) add('✗', i, j, `a ${Math.round((j - i) * 0.75 / 1024)} KB base64 image in code: put it in an asset file`);
    i = j;
  }
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
  each(/\ballowFontScaling\s*(=\s*\{\s*false\s*\}|:\s*false\b)/g, m => add('!', m.index, null, 'allowFontScaling false ignores the user\'s text size: make the layout wrap instead'));
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
    const p = ASK.exec(body);
    if (p) add('!', m.index, close, `${p[1]} in an effect asks when the screen opens: ask when the user starts the feature that needs it`, lineAt(code, open + p.index));
    const l = listeners.exec(body);
    if (l && !/\breturn\b/.test(body)) add('!', m.index, close, `${l[1]} in an effect that returns no cleanup: return a function that removes it`, lineAt(code, open + l.index));
  });
  each(/\bconsole\s*\.\s*log\s*\(/g, m => add('!', m.index, null, 'console.log left in: remove it, or use the app\'s logger'));
  // the generated look: marketing filler for copy, placeholder text and names, emoji in place of the app's icons
  each(/\b(seamless(?:ly)?|effortless(?:ly)?|supercharge[ds]?|revolutioni[sz](?:e|es|ed|ing)|revolutionary|cutting-edge|next-level|game-?chang(?:er|ing)|unleash(?:es|ed)?|elevate your|empower your|unlock your (?:full )?potential)\b/gi,
    m => add('!', m.index, null, `"${m[0]}" reads as generated copy: say what it does, in the app's words (docs/amk/glossary.md)`));
  each(/\b(lorem ipsum|(?:john|jane) doe|acme)\b/gi, m => add('!', m.index, null, `"${m[0]}" is filler: the real text, or a placeholder the PR lists`));
  // not in translation files: an emoji there is part of a message ("Welcome 👋"), not an icon
  if (!/(^|\/)(i18n?|locales?|translations?|lang)\//i.test(file)) {
    each(/\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/gu,
      m => add('!', m.index, null, 'an emoji in the app: an icon from its icon set (docs/amk/design-system.md), unless it\'s content'));
  }
  each(/\bmask(AllTextInputs|AllText|AllInputs|TextInputs)\s*:\s*false\b/g, m => add('!', m.index, null, 'session replay that records what users type: mask text inputs'));
  each(/\bAccessibilityInfo\s*\.\s*setAccessibilityFocus\s*\(/g, m => add('!', m.index, null, 'AccessibilityInfo.setAccessibilityFocus is deprecated: use sendAccessibilityEvent'));
  // platform guidelines: text, back, screen readers, tap areas, permissions, motion
  each(/\bfontSize\s*:\s*(\d+(?:\.\d+)?)(?![\w.])/g, m => { if (Number(m[1]) >= 1 && Number(m[1]) < 11) add('!', m.index, null, `fontSize ${m[1]} is under 11, the smallest size Apple's guidelines allow for reading`); });
  each(/\bmaxFontSizeMultiplier\s*[=:]\s*\{?\s*(\d+(?:\.\d+)?)/g, m => { if (Number(m[1]) >= 1 && Number(m[1]) < 2) add('!', m.index, null, `maxFontSizeMultiplier ${m[1]} caps the user's text size: allow at least 2`); });
  each(/\bgestureEnabled\s*[:=]\s*\{?\s*false\b/g, m => add('!', m.index, null, 'gestureEnabled false turns off swipe back: keep it, and ask before leaving unsaved changes with usePreventRemove'));
  each(/['"]hardwareBackPress['"]\s*,\s*\(\s*\)\s*=>\s*true\b/g, m => add('!', m.index, null, 'a back handler that always returns true traps Android\'s back button: return true only while it closes something'));
  each(/\bBackHandler\s*\.\s*exitApp\s*\(/g, m => add('!', m.index, null, 'BackHandler.exitApp: Android apps don\'t quit themselves; leave back to the system'));
  each(/\bVibration\s*\.\s*vibrate\s*\(/g, m => add('!', m.index, null, 'Vibration.vibrate buzzes: use the app\'s haptics library, for success, error or a selection only'));
  each(/\bReduceMotion\s*\.\s*Never\b/g, m => add('!', m.index, null, 'ReduceMotion.Never ignores the user\'s Reduce Motion setting: let decoration stop'));
  each(/\baccessibilityLabel\s*=\s*\{?\s*["']([^"'\n]*)["']/g, m => { if (/\b(button|icon|image|tap|click)\b/i.test(m[1])) add('!', m.index, null, `the label "${m[1]}" names the role or the gesture: screen readers say the role; name the action`); });
  each(/<\s*([A-Z][\w.]*)\b/g, m => {
    const end = endOf(code, m.index);
    const tag = code.slice(m.index, end + 1);
    const at = re => m.index + Math.max(tag.search(re), 0);
    const role = /\b(?:accessibilityRole|role)\s*=\s*\{?\s*["'](switch|checkbox|radio|tab|togglebutton)["']/.exec(tag);
    if (role && !/\b(accessibilityState|aria-checked|aria-selected)\b/.test(tag)) add('!', at(/\b(accessibilityRole|role)\s*=/), null, `a ${role[1]} without accessibilityState: screen readers can't tell whether it's on`);
    if (m[1] === 'Modal' && !/\bonRequestClose\b/.test(tag)) add('!', m.index, null, 'a Modal without onRequestClose: Android\'s back button can\'t close it');
    if (/\bonLongPress\s*=/.test(tag) && !/\baccessibilityActions\b/.test(tag)) add('!', at(/\bonLongPress\s*=/), null, 'a long-press action screen readers can\'t reach: add it to accessibilityActions, and show it another way too');
    if ((m[1] === 'LottieView' || m[1] === 'Lottie') && /\sloop\b(?!\s*=\s*\{\s*false\s*\})/.test(tag) && !reduceMotion.test(code)) add('!', m.index, null, 'a looping animation that ignores Reduce Motion: read AccessibilityInfo.isReduceMotionEnabled() and stop it');
    const style = TOUCHABLE.test(m[1]) && !/\b(hitSlop|minWidth|minHeight)\b/.test(tag) && /\bstyle\s*=\s*\{\{([^{}]*)\}\}/.exec(tag);
    const sizes = style ? [...style[1].matchAll(/\b(?:width|height)\s*:\s*(\d+(?:\.\d+)?)(?![\w.%])/g)].map(s => Number(s[1])) : [];
    if (sizes.some(n => n < 44)) add('!', m.index, null, `a <${m[1]}> ${Math.min(...sizes)} points wide or high: tap areas are at least 44×44 (48×48 dp on Android); pad it, or add hitSlop`);
  });
  if (!reduceMotion.test(code)) each(/\bAnimated\s*\.\s*loop\s*\(/g, m => add('!', m.index, null, 'a looping animation that ignores Reduce Motion: read AccessibilityInfo.isReduceMotionEnabled() and stop it'));
  // a file that asks for a permission but never handles one the system won't ask for again
  const ask = ASK.exec(code);
  if (ask && !/canAskAgain|never_ask_again|NEVER_ASK_AGAIN|BLOCKED|\bblocked\b|openSettings/.test(code)) add('!', ask.index, null, 'a permission request with nothing for when it\'s blocked: then the button explains it and offers Linking.openSettings()');
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

// ---------- Maestro flows ----------
const TAPS = /^(tapOn|doubleTapOn|longPressOn)$/;
const SELECTS = /^(tapOn|doubleTapOn|longPressOn|assertVisible|assertNotVisible|scrollUntilVisible|extendedWaitUntil|copyTextFrom)$/;
const ASSERTS = /^(assertVisible|assertNotVisible|assertTrue|assertWithAI|assertNoDefectsWithAI)$/;
// buttons of system dialogs (permission prompts, alerts), which have no testID
const SYSTEM_BUTTON = /^(allow|allow while using (the )?app|allow once|only this time|while using the app|ok|cancel|continue|don.t allow|not now|deny|close)$/i;
const unquote = v => { v = v.trim(); return /^'.*'$/.test(v) ? v.slice(1, -1).replace(/''/g, "'") : /^".*"$/.test(v) ? v.slice(1, -1) : v; };
let noMaestro = false;
function checkFlow(file, text) {
  const out = [];
  const add = (level, at, message, always) => out.push({ level, at, end: at, message, always });
  const dir = path.dirname(file);
  let offset = 0;
  let cmd = null;
  let optional = false;
  let target = '';
  let asserts = 0;
  const done = () => { if (cmd === 'extendedWaitUntil' && !optional) asserts++; };
  for (const l of stripYamlComments(text).split('\n')) {
    const at = offset;
    offset += l.length + 1;
    const item = /^\s*-\s*([A-Za-z]+)\s*:?\s*(.*)$/.exec(l);
    if (item) { done(); cmd = item[1]; optional = false; if (ASSERTS.test(cmd)) asserts++; }
    if (/^\s*optional\s*:\s*true\b/.test(l)) optional = true;
    const app = /^appId\s*:\s*(.+)$/.exec(l);
    if (app && !/\$\{APP_ID\}/.test(app[1])) add('!', at, `appId ${app[1].trim()}: verify.sh sets APP_ID for the build it checks, which a flavor or scheme changes: use appId: \${APP_ID}`);
    // what this line selects: the command's own value (tapOn: Save), keys of an inline map, or a key below the command
    const sel = [];
    if (item && SELECTS.test(cmd) && item[2].trim() && !/^[{[|>]/.test(item[2].trim())) sel.push(['text', unquote(item[2])]);
    for (const m of (item && /^\{/.test(item[2].trim()) ? item[2] : !item ? l : '').matchAll(/\b(text|id|visible|notVisible)\s*:\s*("[^"]*"|'(?:[^']|'')*'|[^,}\n]+)/g)) {
      if (SELECTS.test(cmd || '') && unquote(m[2])) sel.push([m[1] === 'id' ? 'id' : 'text', unquote(m[2])]);
    }
    for (const [kind, value] of sel) {
      if (TAPS.test(cmd)) target = value;
      if (kind === 'text' && TAPS.test(cmd) && !SYSTEM_BUTTON.test(value) && !value.includes('${')) {
        add('!', at, `${cmd} "${value}" taps by text: on iOS a label and its control both match, and on a real iPhone a hidden one can; tap by testID (id:)`);
      }
      if (kind === 'text' && /['’]/.test(value)) add('!', at, `"${value}" has an apostrophe, which a real iPhone can't search for (maestro-runner): match a testID, or text without it`);
    }
    if (item && cmd === 'inputText' && item[2].trim() && !item[2].includes('${') && /pass(word|code)?\b|\bpin\b|otp|secret/i.test(target)) {
      add('!', at, `a password typed into the flow: use \${MAESTRO_PASSWORD} (or another MAESTRO_ variable) from .maestro/.env.local, which isn't committed`);
    }
    // a subflow or script it runs: there, or the flow fails when it gets to it
    const runs = (item && /^(runFlow|runScript)$/.test(cmd) && !/^[{[|>]/.test(item[2].trim()) && item[2].trim()) || (!item && /^(runFlow|runScript)$/.test(cmd || '') && (/^\s*file\s*:\s*(.+)$/.exec(l) || [])[1]);
    if (runs && !runs.includes('${') && /\.(ya?ml|js)$/.test(unquote(runs)) && !fs.existsSync(path.join(root, dir, unquote(runs)))) {
      add('✗', at, `${cmd} ${unquote(runs)}: no such file next to this flow (${dir}/)`, true);
    }
  }
  done();
  for (const [re, what] of SECRETS) for (const m of text.matchAll(re)) add('✗', m.index, `${what} in a flow: anyone with the repository can read it. Revoke it, and use a MAESTRO_ variable from .maestro/.env.local`);
  // a flow verify.sh runs (not a subflow) that never checks anything passes whatever the app shows
  if (/^\.maestro\/[^/]+$/.test(file) && !asserts) add('!', 0, 'this flow checks nothing: add an assertVisible for what each scenario\'s THEN expects', true);
  // Maestro's own syntax check (seconds, no device): AMK_MAESTRO names another maestro
  const r = noMaestro ? null : spawnSync(process.env.AMK_MAESTRO || 'maestro', ['check-syntax', file], { cwd: root, encoding: 'utf8' });
  if (r && r.error) noMaestro = true;
  else if (r && r.status !== 0) {
    const said = `${r.stdout || ''}\n${r.stderr || ''}`.split('\n').map(s => s.trim()).find(s => s && s !== 'OK') || 'invalid flow';
    const n = Number((/:(\d+):\d+/.exec(said) || [])[1]) || 1;
    add('✗', text.split('\n').slice(0, n - 1).reduce((a, s) => a + s.length + 1, 0), `maestro check-syntax: ${said.replace(/\s+at \/syntax-checker:\d+:\d+/, '')}`, true);
  }
  return out;
}

for (const [file, lines] of changed) {
  let text;
  try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
  const rows = text.split('\n');
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  const line = i => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= i) lo = mid; else hi = mid - 1; } return lo + 1; };
  for (const f of flowFile(file) ? checkFlow(file, text) : check(file, text)) {
    const from = line(f.at);
    const to = line(f.end);
    const touched = lines === 'all' || [...Array(to - from + 1).keys()].some(k => lines.has(from + k));
    const at = f.line || from;
    // on the line, or in a comment on the line above
    const above = /^\s*(\/\/|\/\*|\{\s*\/\*|#)/.test(rows[at - 2] || '') ? at - 1 : 0;
    const okAt = [at, above].find(n => n && /amk-ok\b/.test(rows[n - 1]));
    const ok = okAt && /amk-ok(?:\s+(\d{4}-\d{2}-\d{2}))?\s*:\s*(\S.*?)\s*(\*\/\s*\}?)?\s*$/.exec(rows[okAt - 1]);
    let message = f.message;
    if (ok) {
      const since = okSince(file, okAt, ok[1]);
      // kept: listed when its own lines changed; over two weeks old, asked again whenever its file changes
      if (Date.parse(today) - Date.parse(since) <= 14 * DAY) { if (touched) kept.push(`${file}:${at}: ${ok[2]} (${since})`); continue; }
      message = `kept with amk-ok since ${since}, over two weeks, and its file changed again: ${f.message}. The user's reason then: ${ok[2]}`;
    } else if (!touched && !f.always) continue;
    if (!findings.some(x => x.where === `${file}:${at}` && x.message === message)) findings.push({ ...f, message, where: `${file}:${at}` });
  }
}

// ---------- file size and complexity, in the files this branch changed ----------
// ESLint's complexity rule, run on its own through the app's ESLint, reporting every function (no other rule runs);
// beside it a rule that reports each function's whole range, to know which function each count is about. TypeScript
// files need the app's @typescript-eslint/parser. null without ESLint
const complexity = (() => {
  const req = name => { try { return require(require.resolve(name, { paths: [root] })); } catch { return null; } };
  const { Linter } = req('eslint') || {};
  if (!Linter) return null;
  const ts = req('@typescript-eslint/parser');
  const fns = { create: context => { const report = node => context.report({ node, message: 'function' }); return { FunctionDeclaration: report, FunctionExpression: report, ArrowFunctionExpression: report }; } };
  const parserOptions = { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } };
  let verify;
  try {
    if (Number(String(Linter.version).split('.')[0]) >= 9) {
      const linter = new Linter({ configType: 'flat' });
      verify = (text, file, parser) => linter.verify(text, [{ files: ['**/*.{js,jsx,ts,tsx,mjs,cjs}'], plugins: { amk: { rules: { fns } } },
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } }, ...(parser && { parser }) },
        rules: { complexity: ['warn', 0], 'amk/fns': 'warn' } }], file);
    } else {
      const linter = new Linter();
      linter.defineRule('amk-fns', fns);
      if (ts) linter.defineParser('amk-ts', ts);
      verify = (text, file, parser) => linter.verify(text, { ...(parser && { parser: 'amk-ts' }), parserOptions, rules: { complexity: ['warn', 0], 'amk-fns': 'warn' } }, { filename: file });
    }
  } catch { return null; }
  // the functions of a file: label ("Function 'save'"), complexity and first line; null when it can't be read
  return Object.assign((file, text) => {
    const parser = /\.tsx?$/.test(file) ? ts : null;
    if (/\.tsx?$/.test(file) && !ts) return null;
    let messages;
    try { messages = verify(text, file, parser); } catch { return null; }
    // a message from no rule: the file didn't parse, or the setup didn't take
    if (messages.some(m => !m.ruleId)) return null;
    const ranges = messages.filter(m => /^amk[-/]fns$/.test(m.ruleId));
    const holds = (r, m) => (r.line < m.line || (r.line === m.line && r.column <= m.column)) && (r.endLine > m.line || (r.endLine === m.line && r.endColumn >= m.column));
    return messages.filter(m => m.ruleId === 'complexity').map(m => {
      const [, label, n] = /^(.*?) has a complexity of (\d+)/.exec(m.message) || [];
      const fn = ranges.filter(r => holds(r, m)).sort((a, b) => b.line - a.line || b.column - a.column)[0];
      return { label, n: Number(n), start: fn ? fn.line : m.line };
    }).filter(f => f.label);
  }, { ts: Boolean(ts) });
})();
// line n of a file now, in its version on the base: through the diff's hunks (null for a line the branch added)
function baseLine(hs, n) {
  let shift = 0;
  for (const [a, b, c, d] of hs) {
    if (d && n >= c && n < c + d) return b ? a + Math.min(n - c, b - 1) : null;
    if (n < (d ? c : c + 1)) break;
    shift = (b ? a + b - 1 : a) - (d ? c + d - 1 : c);
  }
  return n + shift;
}
for (const [file, lines] of changed) {
  if (!source(file)) continue;
  let text;
  try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
  if (!sized(file, text)) continue;
  const say = (at, message) => findings.push({ level: '!', message, where: `${file}:${at}` });
  const before = lines === 'all' || !sha ? null : git('show', `${sha}:${file}`);
  const n = lineCount(text);
  if (caps.has(file)) {
    if (n > caps.get(file)) say(1, `${n} lines, past its cap of ${caps.get(file)} in ${CAPS}: move a part out (a component, a hook, a helper) rather than raise the cap`);
  } else if (n > limits.limit && before === null) {
    say(1, `a new file of ${n} lines, over the ${limits.limit}-line limit: split it (components, hooks, helpers in files of their own)`);
  } else if (n > limits.limit && n > lineCount(before)) {
    say(1, `${n} lines, over the ${limits.limit}-line limit, and this branch made it longer (it had ${lineCount(before)}): move a part out rather than add to it`);
  }
  if (!complexity) continue;
  const now = complexity(file, text);
  if (!now) continue;
  const old = before ? complexity(file, before) : null;
  for (const f of now.filter(x => x.n > limits.complexity)) {
    const at = old && baseLine(hunks.get(file) || [], f.start);
    const was = at && old.find(o => o.start === at && o.label === f.label);
    if (was && was.n >= f.n) continue;
    say(f.start, was ? `${f.label} went from a complexity of ${was.n} to ${f.n}, over ${limits.complexity}: move a branch out into a function of its own`
      : `${f.label} has a complexity of ${f.n}, over ${limits.complexity}: split it into smaller functions`);
  }
}
// caps that can come down: their file shrank, is under the limit, or is gone
const lower = [...caps].flatMap(([f, cap]) => {
  let text;
  try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { return [`${f} (gone)`]; }
  const n = lineCount(text);
  return n <= limits.limit ? [`${f} (now ${n} lines)`] : n < cap ? [`${f} (${cap} → ${n})`] : [];
});

// ---------- once for the app: an error boundary somewhere ----------
let boundary = true;
if ([...changed.keys()].some(source)) {
  boundary = false;
  const files = [...(git('ls-files') || '').split('\n'), ...changed.keys()].filter(f => f && source(f));
  for (const f of new Set(files)) {
    try {
      if (/componentDidCatch|getDerivedStateFromError|ErrorBoundary|Sentry\s*\.\s*wrap\b/.test(fs.readFileSync(path.join(root, f), 'utf8'))) { boundary = true; break; }
    } catch {}
  }
}

// ---------- each scenario of a spec the branch touched has its steps in the spec's flows ----------
// specs/<id>/requirements.md lists them ("#### Scenario: <name>"); the flows are .maestro/<id>*.yaml, with a
// "# Scenario <n>: <name>" comment above each one's steps, as specs/_templates/flow.yaml shows
const touchedPaths = [...(sha ? (git('diff', '--name-only', '--relative', sha) || '').split('\n') : []),
  ...(git('ls-files', '--others', '--exclude-standard') || '').split('\n')].filter(Boolean);
const specIds = fs.existsSync(path.join(root, 'specs')) ? fs.readdirSync(path.join(root, 'specs'), { withFileTypes: true })
  .filter(e => e.isDirectory() && !/^(_|current$)/.test(e.name)).map(e => e.name) : [];
const flowsDir = allFlows(path.join(root, '.maestro'));
for (const id of specIds) {
  const req = `specs/${id}/requirements.md`;
  let reqText;
  try { reqText = fs.readFileSync(path.join(root, req), 'utf8'); } catch { continue; }
  const flows = flowsOf(id, flowsDir).map(f => `.maestro/${f}`);
  if (!flows.length || !touchedPaths.some(p => p.startsWith(`specs/${id}/`) || flows.includes(p))) continue;
  const blocks = flows.flatMap(f => flowBlocks(fs.readFileSync(path.join(root, f), 'utf8')).map(b => ({ ...b, flow: f })));
  for (const s of scenarios(reqText)) {
    const b = blockFor(blocks, s.n, s.name);
    const say = message => findings.push({ level: '!', message, where: `${req}:${s.line}` });
    if (!b) say(`scenario ${s.n} "${s.name}" has no block in ${flows.join(', ')}: add "# Scenario ${s.n}: ${s.name}" above its steps, with an assertion for its THEN and a screenshot`);
    else {
      if (!/-\s*(assertVisible|assertNotVisible|assertTrue|assertWithAI|extendedWaitUntil)\b/.test(b.code)) say(`scenario ${s.n} "${s.name}" has no assertion in ${b.flow}: check what its THEN expects`);
      if (!/-\s*takeScreenshot\b/.test(b.code)) say(`scenario ${s.n} "${s.name}" has no screenshot in ${b.flow}, so it has no evidence`);
    }
  }
}

// ---------- report ----------
// by file, then line
const order = w => { const [, file, n] = /^(.*):(\d+)$/.exec(w); return [file, Number(n)]; };
findings.sort((a, b) => { const [fa, na] = order(a.where); const [fb, nb] = order(b.where); return fa === fb ? na - nb : fa < fb ? -1 : 1; });
const problems = findings.filter(f => f.level === '✗');
const warnings = findings.filter(f => f.level === '!');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
if (!changed.size && !findings.length) console.log(`rn-check: no changed code or flows since ${since}`);
else if (!findings.length) console.log(`rn-check: nothing to report in the lines changed since ${since}`);
else console.log(`rn-check: ${plural(problems.length, 'problem')}, ${plural(warnings.length, 'warning')} in the lines changed since ${since}`);
for (const f of [...problems, ...warnings]) console.log(`  ${f.level} ${f.where}  ${f.message}`);
if (noMaestro && [...changed.keys()].some(flowFile)) console.log('  flows not syntax-checked: Maestro isn\'t installed here');
const sources = [...changed.keys()].filter(source);
if (sources.length && !complexity) console.log('  complexity not counted: ESLint isn\'t installed here');
else if (sources.some(f => /\.tsx?$/.test(f)) && complexity && !complexity.ts) console.log('  complexity not counted in TypeScript files: rn-check can\'t find the app\'s @typescript-eslint/parser');
if (lower.length) console.log(`  size caps that can come down: ${lower.slice(0, 5).join(', ')}${lower.length > 5 ? ` and ${lower.length - 5} more` : ''}. node scripts/amk/rn-check.js --write-caps lowers them`);
if (!boundary) console.log(`  ! the app has no error boundary: a render error shows a blank screen or closes the app. Wrap the app in one`);
if (kept.length) console.log(`  kept with amk-ok: ${[...new Set(kept)].join('; ')}`);
if (problems.length) {
  console.log(`  Each ✗ fails verify.sh quick. Ask the user, for each one: fix it, or keep the line with \`// amk-ok ${today}: <their reason>\` on it (# in a flow).`);
  console.log('  Never add an amk-ok without the user\'s reason. One kept over two weeks ago comes back when its file changes: ask again, and to keep it, write today\'s date.');
}
if (warnings.length || !boundary) console.log('  Fix each ! in the code this task changed, or tell the user why it stays.');
process.exit(problems.length ? 1 : 0);
