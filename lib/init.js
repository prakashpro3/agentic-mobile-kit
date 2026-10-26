'use strict';
// `agentic-mobile-kit init`: installs the kit into a bare React Native project.
// `sync` updates an installed project to this kit version; `uninstall` removes the kit.
// All three need a clean working tree, so git is the backup for everything they touch.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const KIT_VERSION = require('../package.json').version;
const TEMPLATE = path.join(__dirname, '..', 'stacks', 'react-native', 'template');
const screens = require(path.join(TEMPLATE, 'scripts', 'amk', 'screens.js'));
const RULESYNC = 'rulesync@27.0.0';
const MARKERS = /<!-- KIT:START[\s\S]*?<!-- KIT:END[^>]*-->\n?/;
// files with {{PLACEHOLDERS}} filled in from the project (the last three say what the CI chosen does, or that none does)
const FILLED = ['AGENTS.md', 'codemagic.yaml', 'scripts/amk/set-version.sh', 'docs/amk/team-process.md', '.githooks/pre-commit'];
// docs each team rewrites for its app: sync replaces them only while they're untouched, and never merges into them
const PROJECT_DOCS = ['product', 'tech', 'structure', 'conventions'].map(n => `docs/amk/${n}.md`);
const HOOKS_CMD = 'git config core.hooksPath .githooks || true';
// the app's own ESLint skips the kit's scripts: they follow the kit's style, not each app's rules
const ESLINT_IGNORE = 'scripts/amk/';
const ESLINT_NOTE = "# agentic-mobile-kit: its scripts follow the kit's style, not this app's lint rules";
// optional parts, installed only when a project chooses them with --ci: not every app uses CI
const CI = {
  github: rel => rel.startsWith('.github/'),
  codemagic: rel => rel === 'codemagic.yaml' || rel === 'docs/amk/codemagic.md',
};
const ciGroup = rel => Object.keys(CI).find(g => CI[g](rel));
// 0.7.0 renamed the kit's folders from "ai", which apps may already use for their own AI features
const RENAMED = [['docs/ai/', 'docs/amk/'], ['scripts/ai/', 'scripts/amk/']];
const renamedPath = rel => {
  const r = RENAMED.find(([from]) => rel.startsWith(from));
  return r ? r[1] + rel.slice(r[0].length) : rel;
};

// tool name -> rulesync targets
const TOOLS = {
  claude: ['claudecode'],
  codex: ['codexcli'],
  antigravity: ['antigravity-ide', 'antigravity-cli'],
  cursor: ['cursor'],
  opencode: ['opencode'],
  kiro: ['kiro-ide', 'kiro-cli'],
};
const TESTED = ['claude', 'codex', 'antigravity'];

class InitError extends Error {}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
// whether .gitignore keeps a path out of git (a team may keep .githooks out), so git add refuses it
const ignoredByGit = (cwd, rel) => { try { git(cwd, 'check-ignore', '-q', '--', rel); return true; } catch { return false; } };

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
// Windows line endings (git's autocrlf) read as plain newlines, so a Windows clone compares equal to the kit's files
const readIf = file => { try { return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };
const WIN = process.platform === 'win32';
// npm, npx and yarn are .cmd files on Windows, which Node can only start through a shell.
// Only arguments with spaces get quotes: a quoted .cmd name found on PATH can't locate its own folder (%~dp0).
const quote = a => (/[\s"]/.test(a) ? `"${a}"` : a);
const tool = (cmd, args, opts = {}) => (WIN
  ? spawnSync([cmd, ...args].map(quote).join(' '), { ...opts, shell: true })
  : spawnSync(cmd, args, opts));
function isLink(p) { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } }
// a link's target with "/" (Windows reports it with backslashes)
const linkTarget = p => fs.readlinkSync(p).replace(/\\/g, '/');

// when the kit runs under npx, npm_config_* variables (e.g. the outer --package) would leak into the npx/npm it starts
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_(config|package|lifecycle)_/i.test(k)));

function installedVersion(cwd, pkg, declared) {
  try { return readJson(path.join(cwd, 'node_modules', pkg, 'package.json')).version; } catch {}
  return declared ? String(declared).replace(/^[\^~>=<\s]+/, '') : 'unknown';
}

function detectPm(cwd, forced) {
  const pms = {
    yarn: { name: 'Yarn', run: 'yarn', lock: 'yarn.lock' },
    pnpm: { name: 'pnpm', run: 'pnpm', lock: 'pnpm-lock.yaml' },
    bun: { name: 'Bun', run: 'bun run', lock: 'bun.lock' },
    npm: { name: 'npm', run: 'npm run', lock: 'package-lock.json' },
  };
  if (forced) {
    if (!pms[forced]) throw new InitError(`Unknown package manager "${forced}". Use npm, yarn, pnpm or bun.`);
    return pms[forced];
  }
  for (const [, pm] of Object.entries(pms)) {
    if (fs.existsSync(path.join(cwd, pm.lock)) || (pm.lock === 'bun.lock' && fs.existsSync(path.join(cwd, 'bun.lockb')))) return pm;
  }
  return pms.npm;
}

// the app's folder first: in the wrong folder, "run git init" would be the wrong advice
function checkProject(cwd) {
  const pkgFile = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgFile)) throw new InitError('No package.json here. Run this in the root of your React Native app, or in an empty folder to create one.');
  const pkg = readJson(pkgFile);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps['react-native']) throw new InitError('This is not a React Native project (no "react-native" dependency).');
  try { git(cwd, 'rev-parse', '--is-inside-work-tree'); } catch {
    throw new InitError('This folder is not a git repository. Run "git init" and commit first; git is how init can be undone.');
  }
  if (git(cwd, 'status', '--porcelain')) {
    throw new InitError('You have uncommitted changes. Commit or stash them first, so this can be undone with git.');
  }
  const stack = detectStack(cwd, deps);
  if (stack === 'bare' && (!fs.existsSync(path.join(cwd, 'ios')) || !fs.existsSync(path.join(cwd, 'android')))) {
    throw new InitError('No ios/ and android/ folders found, and this isn\'t an Expo app. The kit supports bare React Native and Expo apps.');
  }
  return { pkg, deps, stack };
}

// a folder with nothing but these can get a new app: system and editor files, and the .git of an empty clone
const EMPTY_OK = ['.git', '.DS_Store', 'Thumbs.db', '.vscode', '.idea'];
const emptyFolder = cwd => fs.readdirSync(cwd).every(f => EMPTY_OK.includes(f));
// the React Native CLI wants an identifier: a folder "my-new-app" gives MyNewApp
const appName = folder => {
  const n = (folder.match(/[A-Za-z0-9]+/g) || []).map(w => w[0].toUpperCase() + w.slice(1)).join('');
  return /^[A-Za-z]/.test(n) ? n : `App${n}`;
};
// the CLI's pods step fetches and builds Ruby gems first, which is slow, and when that fails it reports a broken iOS
// setup: createApp installs the pods itself, as scripts/amk/pod-install.sh does
const NEW_APP = {
  bare: { by: 'the React Native CLI', args: name => ['@react-native-community/cli@latest', 'init', appName(name), '--directory', name, '--install-pods', 'false'] },
  expo: { by: 'create-expo-app', args: name => ['create-expo-app@latest', name, '--yes'] },
};

// `init --new bare|expo`: creates the app with the official tool, which makes a new folder, so the tool runs in an
// empty subfolder and the app moves up. In place, the React Native CLI offers to delete a folder that has any file
// (even .git), and create-expo-app refuses .vscode.
function createApp(cwd, kind, { run = tool, log = console.log, pods = process.platform === 'darwin' } = {}) {
  const how = Object.hasOwn(NEW_APP, kind) && NEW_APP[kind];
  if (!how) throw new InitError(`Unknown app type "${kind}". Choose bare (the React Native CLI) or expo (create-expo-app).`);
  if (!emptyFolder(cwd)) throw new InitError('This folder isn\'t empty. To create a new app, run this in an empty folder.');
  let prefix = null;
  try { prefix = git(cwd, 'rev-parse', '--show-prefix'); } catch {}
  if (prefix) throw new InitError(`This folder is inside another git repository (${git(cwd, 'rev-parse', '--show-toplevel')}), as in a monorepo. The kit doesn't support that yet.`);
  const own = prefix === ''; // the folder is its own repository: keep it, with its remote
  const name = path.basename(cwd);
  const args = ['-y', ...how.args(name)];
  const tmp = fs.mkdtempSync(path.join(cwd, '.amk-new-'));
  const held = path.join(tmp, '.held-git');
  // Ctrl-C stops the tool, which takes minutes; this process stays to put the folder back
  const stay = () => {};
  process.on('SIGINT', stay);
  try {
    if (own) fs.renameSync(path.join(cwd, '.git'), held); // otherwise the tools skip git, or ask
    log(`Creating the app with ${how.by}: npx ${args.join(' ')}\n`);
    const r = run('npx', args, { cwd: tmp, stdio: 'inherit', env: cleanEnv() });
    const app = path.join(tmp, name);
    if (r.status !== 0 || !fs.existsSync(path.join(app, 'package.json'))) throw new InitError(`${how.by} didn't create the app (${r.signal || `exit code ${r.status}`}). This folder is as it was.`);
    // both tools finish, and commit, even when installing the packages failed: the lockfile shows it worked
    if (!fs.readdirSync(app).some(f => /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/.test(f))) {
      throw new InitError(`${how.by} created the app, but installing its packages failed (see above). This folder is as it was. Check the network, then run this again.`);
    }
    for (const f of fs.readdirSync(app)) {
      if (f === '.git' && own) continue;
      if (!fs.existsSync(path.join(cwd, f))) fs.renameSync(path.join(app, f), path.join(cwd, f)); // the folder's own editor settings stay
    }
  } finally {
    process.off('SIGINT', stay);
    if (own && fs.existsSync(held)) fs.renameSync(held, path.join(cwd, '.git'));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  log(`\nThe app is in ${cwd} (the folder in the tool's instructions above was temporary).`);
  const commit = msg => {
    if (!git(cwd, 'status', '--porcelain')) return;
    git(cwd, 'add', '-A');
    git(cwd, 'commit', '-q', '-m', msg);
  };
  try {
    // the tools commit only in a repository they create; init needs everything committed
    commit(own ? 'Initial commit' : 'Add the files that were already in the folder');
    newAppDefaults(cwd, kind, { run, log });
    commit('Support tablets and landscape; stricter TypeScript with @/ imports; an error boundary');
    // the first pod install changes the Xcode project and Info.plist: a commit of its own keeps that out of the first feature
    if (kind === 'bare' && pods) {
      log('Installing the iOS pods\n');
      if (run('sh', [path.join(TEMPLATE, 'scripts/amk/pod-install.sh')], { cwd, stdio: 'inherit' }).status === 0) commit('Install the iOS pods');
      else log('! The iOS pods aren\'t installed (see above). Run sh scripts/amk/pod-install.sh, and commit what it changes before the first feature.');
    }
  } catch (e) {
    throw new InitError(`The app is created, but git couldn't commit it: ${String(e.stderr || e.message).trim()}\nCommit it, then run: npx agentic-mobile-kit init`);
  }
}

// What a new app starts with beyond the tool's template: iPad and every orientation (the React Native template locks
// iPhones to portrait; Expo's locks everything to portrait and leaves iPad out), stricter TypeScript with "@/"
// imports for src/, and an error boundary around the app (neither template has one, so a render error leaves a blank
// screen). Expo's template has the "@/" paths already, and Metro reads them; bare apps need a Babel plugin.
const STRICTER = { noUncheckedIndexedAccess: true, noImplicitOverride: true, noImplicitReturns: true, noFallthroughCasesInSwitch: true };
const ALIAS_PLUGIN = 'babel-plugin-module-resolver@5';
const ADD_DEV = { npm: ['npm', 'install', '--save-dev'], Yarn: ['yarn', 'add', '--dev'], pnpm: ['pnpm', 'add', '--save-dev'], Bun: ['bun', 'add', '--dev'] };
function newAppDefaults(cwd, kind, { run, log }) {
  const edit = (rel, change) => {
    const text = readIf(path.join(cwd, rel));
    const next = text === null ? null : change(text);
    if (next !== null && next !== text) fs.writeFileSync(path.join(cwd, rel), next);
  };
  errorBoundary(cwd, kind, edit, log);
  const json = text => { try { return JSON.parse(text); } catch { return null; } };
  // short lists stay on one line, as the templates write them
  const format = j => `${JSON.stringify(j, null, 2).replace(/\[\n\s*([^[\]{}]*?)\n\s*\]/g, (m, items) => `[${items.split(/,\n\s*/).join(', ')}]`)}\n`;
  const stricter = paths => text => {
    const j = json(text);
    if (!j) { log('! tsconfig.json isn\'t plain JSON, so the stricter TypeScript settings weren\'t added'); return null; }
    const { extends: base, compilerOptions, ...rest } = j;
    return format({ ...(base ? { extends: base } : {}), compilerOptions: { ...compilerOptions, ...STRICTER, ...(paths ? { paths: { '@/*': ['./src/*'] } } : {}) }, ...rest });
  };
  if (kind === 'expo') {
    edit('app.json', text => {
      const j = json(text);
      if (!j || !j.expo) return null;
      j.expo = { ...j.expo, orientation: 'default', ios: { ...j.expo.ios, supportsTablet: true } };
      return `${JSON.stringify(j, null, 2)}\n`;
    });
    edit('tsconfig.json', stricter(false));
    // Expo's types (CSS modules, assets) come from expo-env.d.ts, which `expo start` generates and git ignores: in a
    // fresh clone or CI the template's own typecheck fails without them
    if ((readIf(path.join(cwd, '.gitignore')) || '').split('\n').includes('expo-env.d.ts') && !fs.existsSync(path.join(cwd, 'expo-types.d.ts'))) {
      fs.writeFileSync(path.join(cwd, 'expo-types.d.ts'), '// Expo\'s types, as expo-env.d.ts has them: that file is generated by `expo start` and not in git,\n// so type checks in a fresh clone or in CI need this one\n/// <reference types="expo/types" />\n');
    }
    return;
  }
  // bare: iPhones turn too; iPads already do, and Android doesn't lock
  const plist = (fs.existsSync(path.join(cwd, 'ios')) ? fs.readdirSync(path.join(cwd, 'ios')) : [])
    .map(d => `ios/${d}/Info.plist`).find(f => !/Tests\//.test(f) && fs.existsSync(path.join(cwd, f)));
  if (plist) {
    edit(plist, text => text.replace(/(<key>UISupportedInterfaceOrientations<\/key>\s*<array>)([\s\S]*?)(\s*<\/array>)/, (m, open, items, close) => {
      if (items.includes('Landscape')) return m;
      const indent = (items.match(/\n[ \t]*(?=<string>)/) || ['\n\t\t'])[0];
      return `${open}${items}${indent}<string>UIInterfaceOrientationLandscapeLeft</string>${indent}<string>UIInterfaceOrientationLandscapeRight</string>${close}`;
    }));
  }
  // "@/" imports: the Babel plugin rewrites them for Metro and Jest, tsconfig's paths for the type checker
  const babel = readIf(path.join(cwd, 'babel.config.js'));
  let alias = false;
  if (babel !== null && !babel.includes('plugins') && /\n(\s*)presets: \[[^\]]*\],\n/.test(babel)) {
    const [bin, ...args] = ADD_DEV[detectPm(cwd).name];
    log(`Adding ${ALIAS_PLUGIN} for "@/" imports\n`);
    if (run(bin, [...args, ALIAS_PLUGIN], { cwd, stdio: 'inherit', env: cleanEnv() }).status === 0) {
      edit('babel.config.js', text => text.replace(/\n(\s*)presets: \[[^\]]*\],\n/, (m, indent) => `${m}${indent}plugins: [['module-resolver', { alias: { '^@/(.+)': './src/\\\\1' } }]],\n`));
      alias = true;
    } else log('! Couldn\'t install the Babel plugin for "@/" imports (see above), so the app uses relative imports.');
  }
  edit('tsconfig.json', stricter(alias));
}

// the error boundary: the component next to the app's others, used by the root layout (Expo Router shows an
// ErrorBoundary that a route exports) or around the root component index.js registers. Relative imports, which work
// whether or not the "@/" alias is set up
const NEW_APP_FILES = path.join(TEMPLATE, '..', 'new-app');
function errorBoundary(cwd, kind, edit, log) {
  const place = (rel, source) => {
    if (fs.existsSync(path.join(cwd, rel))) return false;
    fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
    fs.copyFileSync(path.join(NEW_APP_FILES, source), path.join(cwd, rel));
    return true;
  };
  const from = (file, target) => { const r = path.relative(path.dirname(file), target).split(path.sep).join('/'); return r.startsWith('.') ? r : `./${r}`; };
  if (kind === 'expo') {
    const layout = ['src/app/_layout.tsx', 'app/_layout.tsx'].find(f => fs.existsSync(path.join(cwd, f)));
    if (!layout) { log('! No app/_layout.tsx or src/app/_layout.tsx, so no error boundary was added: export an ErrorBoundary from the root layout'); return; }
    if (/\bErrorBoundary\b/.test(readIf(path.join(cwd, layout)))) return;
    const component = `${layout.startsWith('src/') || fs.existsSync(path.join(cwd, 'src')) ? 'src/' : ''}components/error-boundary.tsx`;
    if (!place(component, 'error-boundary.tsx')) { log(`! ${component} is already there, so no error boundary was added`); return; }
    const line = `export { ErrorBoundary } from '${from(layout, component.replace(/\.tsx$/, ''))}';`;
    // after the last import, which may span lines
    edit(layout, text => {
      const imports = [...text.matchAll(/^import\b[^;]*?(?:from\s*)?['"][^'"]+['"];?[ \t]*$/gm)];
      const at = imports.length ? imports[imports.length - 1].index + imports[imports.length - 1][0].length : 0;
      return at ? `${text.slice(0, at)}\n${line}${text.slice(at)}` : `${line}\n${text}`;
    });
    return;
  }
  const index = readIf(path.join(cwd, 'index.js'));
  const register = /AppRegistry\.registerComponent\(\s*appName\s*,\s*\(\)\s*=>\s*App\s*\)/;
  if (!index || !register.test(index) || !/^import App from '\.\/App';$/m.test(index)) {
    log('! index.js doesn\'t register App the usual way, so no error boundary was added: wrap the app in one');
    return;
  }
  if (!place('src/components/ErrorBoundary.tsx', 'ErrorBoundary.tsx')) { log('! src/components/ErrorBoundary.tsx is already there, so no error boundary was added'); return; }
  edit('index.js', text => text
    .replace(/^import App from '\.\/App';$/m, "import App from './App';\nimport { withErrorBoundary } from './src/components/ErrorBoundary';")
    .replace(register, 'AppRegistry.registerComponent(appName, () => withErrorBoundary(App))'));
}

// Expo apps whose ios/ and android/ come from `expo prebuild` (Continuous Native Generation, not in git) get the
// Expo overlay. Expo apps that keep the native folders in git are set up like bare apps.
function detectStack(cwd, deps) {
  return deps.expo && !git(cwd, 'ls-files', 'ios', 'android') ? 'expo' : 'bare';
}

// a stack's files, rel -> source: the template, and for Expo the overlay next to it, which replaces or adds files
// deps, when given, are the app's: an app on Expo Router doesn't get the react-navigation skill, as from SDK 56 it imports
// navigation from expo-router, which its own skill teaches (one on React Navigation itself still needs it)
const EXPO_LEAVES_OUT = ['docs/amk/react-native.md', '.agents/skills/upgrading-react-native/'];
function stackFiles(template, stack, deps = {}) {
  const files = new Map(templateFiles(template).map(rel => [rel, path.join(template, rel)]));
  if (stack !== 'expo') return files;
  const out = [...EXPO_LEAVES_OUT, ...(deps['expo-router'] ? ['.agents/skills/react-navigation/'] : [])];
  for (const rel of files.keys()) if (out.some(f => (f.endsWith('/') ? rel.startsWith(f) : rel === f))) files.delete(rel);
  const overlay = path.join(template, '..', 'expo');
  if (fs.existsSync(overlay)) for (const rel of templateFiles(overlay)) files.set(rel, path.join(overlay, rel));
  return files;
}

// app.json's expo section, for the values the kit fills in (app.config.* would need the Expo CLI to evaluate)
function expoConfig(cwd) {
  try { return readJson(path.join(cwd, 'app.json')).expo || {}; } catch { return {}; }
}

// all files under dir, as relative paths with "/" on every OS (as git shows them), including dotfiles
function templateFiles(dir = TEMPLATE, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const rel = base ? `${base}/${e.name}` : e.name;
    return e.isDirectory() ? templateFiles(path.join(dir, e.name), rel) : [rel];
  });
}

// the app's bundle ID, for Codemagic signing; React Native's template derives it from the product name
function iosBundleId(cwd) {
  const proj = fs.readdirSync(path.join(cwd, 'ios')).find(f => f.endsWith('.xcodeproj')) || '';
  let pbx = '';
  try { pbx = fs.readFileSync(path.join(cwd, 'ios', proj, 'project.pbxproj'), 'utf8'); } catch {}
  const ids = [...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = "?([^";]+)"?;/g)].map(m => m[1]).filter(id => !/Tests$/.test(id));
  const id = ids.find(i => !i.includes('$(')) || ids[0] || 'com.example.app';
  return id.replace(/\$\(PRODUCT_NAME(:rfc1034identifier)?\)/, proj.replace(/\.xcodeproj$/, '').replace(/[^A-Za-z0-9.-]/g, '-'));
}

function fillPlaceholders(text, values) {
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in values ? values[k] : m));
}

// React Native 0.82 and later run only the New Architecture. Before that, android/gradle.properties chooses:
// the New Architecture was opt-in before 0.76 and the default from 0.76.
function architecture(cwd, rnVersion) {
  const [major, minor] = String(rnVersion).split('.').map(Number);
  if (!(major === 0 && minor < 82)) return 'New Architecture';
  // Expo apps without native folders set it in app.json
  const flag = ((readIf(path.join(cwd, 'android', 'gradle.properties')) || '').match(/^\s*newArchEnabled\s*=\s*(true|false)/m) || [])[1]
    || (typeof expoConfig(cwd).newArchEnabled === 'boolean' ? String(expoConfig(cwd).newArchEnabled) : undefined);
  return (flag ? flag === 'true' : minor >= 76) ? 'New Architecture' : 'Old Architecture: newArchEnabled=false';
}

// TypeScript files, not just the typescript package: the React Native template installs it in JavaScript apps too
const usesTs = cwd => git(cwd, 'ls-files', '*.ts', '*.tsx').split('\n').some(f => f && !f.endsWith('.d.ts'));

// what the kit's texts say about CI: what the chosen CI does, or that nothing does
const ciTexts = ci => ({
  BUILD_NUMBERS: ci.includes('codemagic') ? 'Build numbers are left alone (codemagic.yaml sets them at build time).'
    : 'Build numbers are left alone, and no CI here sets them: raise them for each store upload (Android versionCode, iOS build number).',
  PR_SIZE_LIMIT: ci.includes('github') ? 'CI enforces it; the `large-pr` label overrides' : 'nothing enforces it: the app has no CI check for it',
  PR_SIZE_HOOK: ci.includes('github') ? 'the PR size check in CI is the hard limit' : 'there\'s no PR size check in CI here',
});

function projectValues(cwd, pkg, deps, pm, ci, stack) {
  const rn = installedVersion(cwd, 'react-native', deps['react-native']);
  const ts = usesTs(cwd);
  // the checks agents can run: the app's own scripts, and the typecheck script init adds to TypeScript apps
  const checks = ['lint', 'typecheck', 'test'].filter(s => (pkg.scripts || {})[s] || (s === 'typecheck' && ts && deps.typescript));
  return {
    KIT_VERSION,
    KIT_CI: ci.join(',') || 'none',
    KIT_STACK: stack,
    EXPO_SDK: deps.expo ? installedVersion(cwd, 'expo', deps.expo).split('.')[0] : '',
    APP_NAME: pkg.name || path.basename(cwd),
    RN_VERSION: rn,
    RN_ARCH: architecture(cwd, rn),
    REACT_VERSION: installedVersion(cwd, 'react', deps.react),
    TS_VERSION: installedVersion(cwd, 'typescript', deps.typescript),
    LANGUAGE: ts ? `TypeScript${deps.typescript ? ` ${installedVersion(cwd, 'typescript', deps.typescript)}` : ''}` : 'JavaScript',
    CHECK_TASKS: checks.length ? checks.join(', ').replace(/^./, c => c.toUpperCase()) : 'Lint, typecheck, test',
    CHECK_COMMANDS: checks.map(s => `\`${pm.run} ${s}\``).join(', ') || 'none in `package.json` yet',
    NODE_VERSION: (pkg.engines && pkg.engines.node) || `${process.versions.node.split('.')[0]}`,
    PM: pm.name,
    PM_RUN: pm.run,
    SCREENS: screens.describe(screens.screens(cwd)),
    ...ciTexts(ci),
    IOS_BUNDLE_ID: stack === 'expo' ? (expoConfig(cwd).ios || {}).bundleIdentifier || 'com.example.app' : iosBundleId(cwd),
  };
}

// a template file's text as the kit writes it into this project
function kitText(src, rel, values, targets) {
  const text = fs.readFileSync(src, 'utf8');
  if (FILLED.includes(renamedPath(rel))) return fillPlaceholders(text, values);
  if (rel === 'rulesync.jsonc') return setTargets(text, targets);
  return text;
}

const setTargets = (text, targets) => text.replace(/"targets":\s*\[[^\]]*\]/, () => `"targets": ${JSON.stringify(targets)}`);
// a project file's text for comparing with the kit's: the targets line is the project's own (init rewrites it)
const projectText = (cwd, rel, targets) => {
  const text = readIf(path.join(cwd, rel));
  return text !== null && rel === 'rulesync.jsonc' ? setTargets(text, targets) : text;
};
// a function replacement, so "$" in the kit's text is never read as a replacement pattern
const mergeAgents = (current, section) => (MARKERS.test(current) ? current.replace(MARKERS, () => section) : `${current.replace(/\n*$/, '\n\n')}${section}`);
const mergeClaude = current => (/^@AGENTS\.md\s*$/m.test(current) ? current : `${current.replace(/\n*$/, '\n\n')}@AGENTS.md\n`);

function writeKitFile(cwd, rel, text) {
  const dest = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
  // npm doesn't always keep the executable bit, and git silently skips non-executable hooks
  const executable = rel.startsWith('.githooks/') || /\.(sh|js)$/.test(rel) && rel.startsWith('scripts/');
  fs.chmodSync(dest, executable ? 0o755 : 0o644);
}

// the tools a project was set up for, read back from its rulesync targets
function installedTools(cwd) {
  const m = (readIf(path.join(cwd, 'rulesync.jsonc')) || '').match(/"targets":\s*\[([^\]]*)\]/);
  let targets = [];
  try { targets = JSON.parse(`[${m ? m[1] : ''}]`); } catch {}
  const tools = Object.keys(TOOLS).filter(t => TOOLS[t].every(x => targets.includes(x)));
  return tools.length ? tools : TESTED;
}

// what the kit marker in AGENTS.md records: the kit version since 0.4.0, the CI choice since 0.5.0, the stack since 0.6.0
function recorded(agents) {
  const m = (agents || '').match(/KIT:START agentic-mobile-kit (\d[^\s>]*)(?: ci=([\w,]+))?(?: stack=(\w+))?/);
  return { version: m ? m[1] : null, ci: m && m[2] ? m[2].split(',').filter(g => CI[g]) : null, stack: m && m[3] ? m[3] : null };
}

// the CI parts a project has: as recorded, or (installs before 0.5.0 got them by default) recognized by the kit's own files
function installedCi(cwd, agents) {
  return recorded(agents).ci || Object.keys(CI).filter(g => (g === 'github'
    ? /agentic-mobile-kit/.test(readIf(path.join(cwd, '.github', 'workflows', 'ci.yml')) || '')
    : fs.existsSync(path.join(cwd, 'docs', 'ai', 'codemagic.md'))));
}

function chooseCi(cwd, agents, wanted = []) {
  for (const g of wanted) if (!CI[g]) throw new InitError(`Unknown CI "${g}". Choose from: ${Object.keys(CI).join(', ')}.`);
  return Object.keys(CI).filter(g => wanted.includes(g) || installedCi(cwd, agents).includes(g));
}

// the kit version that installed the project: recorded in AGENTS.md since 0.4.0, or given with --from.
// A --from version is a guess (installs may predate it), so it isn't trusted as a merge base.
function oldTemplate(agents, opts) {
  if (opts.fromDir) return { from: opts.from || 'old', dir: opts.fromDir, exact: !opts.from };
  const from = opts.from || recorded(agents).version;
  if (!from) {
    throw new InitError('This project doesn\'t record which kit version installed it (versions before 0.4.0 didn\'t). '
      + 'Pass it with --from, for example --from 0.3.0; the commit that added or last updated the kit usually says.');
  }
  const [a, b] = [from, KIT_VERSION].map(v => v.split('.').map(n => parseInt(n, 10) || 0));
  const newer = a.findIndex((n, i) => n !== b[i]);
  if (newer >= 0 && a[newer] > b[newer]) throw new InitError(`This project uses kit ${from}, which is newer than this one (${KIT_VERSION}). Use the latest: npx agentic-mobile-kit@latest`);
  return { from, dir: from === KIT_VERSION ? TEMPLATE : fetchTemplate(from), exact: !opts.from };
}

function fetchTemplate(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amk-kit-'));
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  const r = tool('npm', ['pack', `agentic-mobile-kit@${version}`, '--pack-destination', dir, '--silent'], { cwd: dir, env: cleanEnv(), encoding: 'utf8' });
  if (r.status !== 0) throw new InitError(`Couldn't download agentic-mobile-kit@${version} from npm: ${(r.stderr || '').trim().split('\n').pop()}`);
  execFileSync('tar', ['-xzf', path.join(dir, r.stdout.trim().split('\n').pop()), '-C', dir]);
  return path.join(dir, 'package', 'stacks', 'react-native', 'template');
}

// three-way merge: your changes and the kit's changes since the old version, both kept
function merge3(current, base, kitNew, from) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amk-merge-'));
  const files = [current, base, kitNew].map((text, i) => { const f = path.join(dir, String(i)); fs.writeFileSync(f, text); return f; });
  const r = spawnSync('git', ['merge-file', '-p', '-L', 'your version', '-L', `kit ${from}`, '-L', `kit ${KIT_VERSION}`, ...files], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status === null || r.status < 0 || r.status > 127) throw new Error(`git merge-file failed: ${r.stderr}`);
  return { text: r.stdout, conflicts: r.status };
}

// AGENTS.md's kit section as the team left it, merged with the kit's new one: a team's edit inside it (the screens it
// builds for, say) stays. A line the kit fills in with what it finds (the versions, the package manager, the app's
// checks) is the kit's, whatever it says now: there the old version's line, filled in today, stands in for the team's.
// The screens are a team's decision, so a line with them counts as an edit. The marker lines are the kit's
function mergeSection(mine, rawOld, kitOld, kitNew, from) {
  const lines = s => s.replace(/\n$/, '').split('\n');
  const [raw, base, theirs] = [rawOld, kitOld, kitNew].map(lines);
  const found = raw.length !== base.length ? [] : raw.map((l, i) => /\{\{\w+\}\}/.test(l) && !l.includes('{{SCREENS}}')
    && [new RegExp(`^${l.split(/\{\{\w+\}\}/).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`), base[i]]).filter(Boolean);
  const ours = lines(mine).map(l => (base.includes(l) ? l : (found.find(([re]) => re.test(l)) || [null, l])[1]));
  const inner = a => `${a.slice(1, -1).join('\n')}\n`;
  const { text, conflicts } = merge3(inner(ours), inner(base), inner(theirs), from);
  return { text: !conflicts && text === inner(theirs) ? kitNew : `${theirs[0]}\n${text}${theirs[theirs.length - 1]}\n`, conflicts };
}

// whether a merged script still parses (two edits can merge cleanly into one that doesn't): sh -n for shell scripts
// and git hooks, node --check for JavaScript. Without sh on the PATH (Windows without Git's), shell isn't checked
function parses(rel, text) {
  const shell = rel.endsWith('.sh') || rel.startsWith('.githooks/');
  if (!shell && !/\.[cm]?js$/.test(rel)) return true;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amk-parse-'));
  const file = path.join(dir, path.basename(rel));
  fs.writeFileSync(file, text);
  const r = spawnSync(shell ? 'sh' : process.execPath, [shell ? '-n' : '--check', file], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return Boolean(r.error) || r.status === 0;
}

// Git hook managers a project may already use. The kit's hooks then run from theirs and core.hooksPath stays theirs:
// two tools setting it undo each other on every install (husky's prepare script runs after the kit's postinstall).
const KIT_HOOKS = ['pre-commit', 'pre-push'];
const MARK = 'agentic-mobile-kit';
// the kit's command in a hook manager. A team may keep .githooks out of git, so a fresh clone has none until it runs
// sync: run-hook.sh then skips the hook with a hint, where a plain `sh .githooks/<hook>` failed every commit and push
const kitRun = h => `sh scripts/amk/run-hook.sh .githooks/${h}`;
// that plain command, which kits up to 0.7.12 added: sync upgrades it
const oldRun = h => new RegExp(`(^|[\\s"'])sh \\.githooks/${h}(?=$|[\\s"'])`, 'gm');
const hookCall = h => `${kitRun(h)}${h === 'pre-push' ? ' "$@"' : ''} || exit 1 # ${MARK}`;
// git's other client-side hooks. One another tool installed into .git/hooks (a time tracker's post-commit, say) stops
// running once core.hooksPath points at .githooks, so a .githooks file passes it on, in every clone that has one
const OTHER_HOOKS = ['applypatch-msg', 'pre-applypatch', 'post-applypatch', 'pre-merge-commit', 'prepare-commit-msg', 'commit-msg',
  'post-commit', 'pre-rebase', 'post-checkout', 'post-merge', 'pre-auto-gc', 'post-rewrite', 'reference-transaction', 'post-index-change'];
const FORWARD = `# ${MARK}: runs this clone's own`;
const forwarder = h => `#!/bin/sh\n${FORWARD} .git/hooks/${h}, which core.hooksPath (.githooks) would switch off\nhook="$(git rev-parse --git-common-dir)/hooks/${h}"\n[ ! -x "$hook" ] || exec "$hook" "$@"\n`;
const localHooksPath = cwd => {
  let v = '';
  try { v = git(cwd, 'config', '--local', 'core.hooksPath'); } catch {}
  v = v && path.posix.normalize(v.replace(/\\/g, '/')).replace(/\/+$/, '');
  // the project's own .githooks as a full path (git config core.hooksPath "$PWD/.githooks") is the kit's folder too
  const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  return v && path.isAbsolute(v) && real(v) === real(path.join(cwd, '.githooks')) ? '.githooks' : v;
};

function hookManager(cwd, pkg) {
  const local = localHooksPath(cwd);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if ((deps.husky && fs.existsSync(path.join(cwd, '.husky'))) || local.startsWith('.husky')) return { name: 'husky', dir: '.husky' };
  if (pkg.husky && pkg.husky.hooks) return { name: 'husky', json: pkg.husky.hooks }; // husky 4
  if (pkg['simple-git-hooks']) return { name: 'simple-git-hooks', json: pkg['simple-git-hooks'] };
  const yaml = ['lefthook.yml', '.lefthook.yml', 'lefthook.yaml', '.lefthook.yaml'].find(f => fs.existsSync(path.join(cwd, f)));
  if (yaml) return { name: 'lefthook', yaml };
  // the team's own hooks folder; one outside the repo isn't the kit's to edit
  if (local && local !== '.githooks') return path.isAbsolute(local) || local.startsWith('..') ? { name: local, manual: true } : { name: local, dir: local };
  // hooks another tool installed into .git/hooks, which core.hooksPath would switch off
  let gitHooks = '';
  try { gitHooks = git(cwd, 'rev-parse', '--git-path', 'hooks'); } catch {}
  if (!local && gitHooks && KIT_HOOKS.some(h => fs.existsSync(path.join(cwd, gitHooks, h)))) return { name: '.git/hooks', manual: true };
  return null;
}

const hookFile = (m, h) => (m.dir ? `${m.dir}/${h}` : m.yaml);
// the kit's command, or the team's own call to the hook; not an earlier kit's plain one, which sync upgrades
const hooksWired = (cwd, m) => KIT_HOOKS.every(h => {
  const text = m.json ? m.json[h] || '' : readIf(path.join(cwd, hookFile(m, h))) || '';
  return text.includes(`.githooks/${h}`) && !oldRun(h).test(text);
});

// after the shebang, comments and husky's own setup line: a command after the team's `exit` would never run
function insertCall(text, line) {
  const lines = text.replace(/\n+$/, '').split('\n');
  let i = 0;
  while (i < lines.length && /^(#|\s*$|\.\s|source\s)/.test(lines[i])) i++;
  lines.splice(i, 0, line);
  return `${lines.join('\n')}\n`;
}

// adds the kit's command to a lefthook hook (under its commands: or jobs:), or the hook itself; null if it can't tell where
function lefthookAdd(text, h) {
  const run = kitRun(h);
  const lines = text.replace(/\n+$/, '').split('\n');
  const start = lines.findIndex(l => new RegExp(`^["']?${h}["']?\\s*:`).test(l));
  if (start < 0) return `${lines.join('\n')}\n${h}: # ${MARK}\n  commands: # ${MARK}\n    ${MARK}:\n      run: ${run}\n`;
  if (!/:\s*(#.*)?$/.test(lines[start])) return null; // written inline ({ … }) or with an anchor
  let end = lines.findIndex((l, i) => i > start && /^[^\s#]/.test(l));
  if (end < 0) end = lines.length;
  const at = lines.findIndex((l, i) => i > start && i < end && /^\s+(commands|jobs):\s*(#.*)?$/.test(l));
  if (at < 0) return null;
  const indent = lines[at].match(/^\s*/)[0];
  const next = lines.slice(at + 1, end).find(l => l.trim() && !l.trim().startsWith('#'));
  const nextIndent = next ? next.match(/^\s*/)[0] : '';
  if (/jobs:/.test(lines[at])) {
    // a list: its items may sit at the same indent as "jobs:"
    const item = next && next.trim().startsWith('-') ? nextIndent : `${indent}  `;
    lines.splice(at + 1, 0, `${item}- name: ${MARK}`, `${item}  run: ${run}`);
  } else {
    const key = nextIndent.length > indent.length ? nextIndent : `${indent}  `;
    lines.splice(at + 1, 0, `${key}${MARK}:`, `${key}${key.slice(indent.length)}run: ${run}`);
  }
  return `${lines.join('\n')}\n`;
}

// runs the kit's hooks from the project's hook manager; true if package.json changed
function wireHooks(cwd, m, done) {
  if (m.manual) {
    done.warnings.push(`git hooks already run from ${m.name}, so the kit left core.hooksPath alone. To run the kit's checks too, add "${kitRun('pre-commit')}" and "${kitRun('pre-push')}" to those hooks.`);
    return false;
  }
  let pkgChanged = false;
  for (const h of KIT_HOOKS) {
    if (m.json) {
      const v = m.json[h] || '';
      if (oldRun(h).test(v)) m.json[h] = v.replace(oldRun(h), `$1${kitRun(h)}`);
      else if (v.includes(`.githooks/${h}`)) continue;
      else m.json[h] = v ? `${kitRun(h)} && ${v}` : kitRun(h);
      pkgChanged = true;
      continue;
    }
    const rel = hookFile(m, h);
    const file = path.join(cwd, rel);
    const text = readIf(file);
    if (text !== null && oldRun(h).test(text)) {
      fs.writeFileSync(file, text.replace(oldRun(h), `$1${kitRun(h)}`));
      if (!done.merged.includes(rel)) done.merged.push(rel);
      continue;
    }
    if ((text || '').includes(`.githooks/${h}`)) continue;
    if (m.yaml) {
      const next = lefthookAdd(text, h);
      if (next === null) { done.warnings.push(`couldn't add the kit's ${h} check to ${rel}: add a command there that runs "${kitRun(h)}"`); continue; }
      fs.writeFileSync(file, next);
      if (!done.merged.includes(rel)) done.merged.push(rel);
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text === null ? `#!/usr/bin/env sh\n${hookCall(h)}\n` : insertCall(text, hookCall(h)));
    // husky 5 to 8 and plain hook folders run the file itself
    fs.chmodSync(file, 0o755);
    if (WIN && !ignoredByGit(cwd, rel)) git(cwd, 'add', '--chmod=+x', '--', rel);
    (text === null ? done.created : done.merged).push(rel);
  }
  if (pkgChanged && m.name === 'simple-git-hooks') done.warnings.push('run "npx simple-git-hooks" once, so it installs the hooks with the kit\'s checks in them');
  return pkgChanged;
}

// takes the kit's lines back out of the project's hook manager
function unwireHooks(cwd, m, report) {
  let pkgChanged = false;
  for (const h of KIT_HOOKS) {
    if (m.json) {
      const before = m.json[h];
      if (before === kitRun(h) || before === `sh .githooks/${h}`) delete m.json[h];
      else if (before) m.json[h] = before.replace(`${kitRun(h)} && `, '').replace(`sh .githooks/${h} && `, '');
      if (m.json[h] !== before) { pkgChanged = true; report.removed.push(`package.json ${m.name} ${h} (the kit's command)`); }
      continue;
    }
    const rel = hookFile(m, h);
    const text = readIf(path.join(cwd, rel));
    if (text === null || !text.includes(MARK) && !text.includes('.githooks/')) continue;
    const rest = text.split('\n').filter(l => !l.includes(MARK) && !l.includes('.githooks/')).join('\n');
    if (/^(#![^\n]*)?\s*$/.test(rest)) fs.unlinkSync(path.join(cwd, rel)); else fs.writeFileSync(path.join(cwd, rel), rest);
    if (!report.removed.some(r => r.startsWith(rel))) report.removed.push(`${rel} (the kit's lines)`);
  }
  return pkgChanged;
}

// takes the kit's command out of postinstall; true if it was there
function dropHooksCmd(scripts) {
  const next = scripts.postinstall === HOOKS_CMD ? undefined : (scripts.postinstall || '').replace(` && (${HOOKS_CMD})`, '') || undefined;
  if (next === scripts.postinstall) return false;
  if (next) scripts.postinstall = next; else delete scripts.postinstall;
  return true;
}

const SKILL_LINKS = [['.claude/skills', 'claude'], ['.kiro/skills', 'kiro']];
const kitSkills = files => [...files.keys()].filter(rel => /^\.agents\/skills\/[^/]+\/SKILL\.md$/.test(rel)).map(rel => rel.split('/')[2]);

// steps 2–6, shared by init and sync
function finish(cwd, { pkg, deps, tools, files, stack, skipGenerate }) {
  const done = { created: [], merged: [], skipped: [], warnings: [] };
  // Windows creates symbolic links only with Developer Mode on (or as admin)
  const link = (target, p, label) => {
    try { fs.symlinkSync(target, p); return true; } catch (e) {
      if (!['EPERM', 'EACCES'].includes(e.code)) throw e;
      done.warnings.push(`couldn't create the ${label} link (${e.code}). On Windows, turn on Developer Mode (Settings > System > For developers), run "git config core.symlinks true", then run this again. Codex and Antigravity read .agents/skills directly and don't need it.`);
      return false;
    }
  };

  // 2. skills links for tools that don't read .agents/skills
  for (const [linkPath, forTool] of SKILL_LINKS) {
    if (!tools.includes(forTool)) continue;
    const dest = path.join(cwd, linkPath);
    if (!fs.existsSync(dest) && !isLink(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (link('../.agents/skills', dest, linkPath)) done.created.push(`${linkPath} -> .agents/skills`);
      continue;
    }
    if (isLink(dest) || !fs.statSync(dest).isDirectory()) { done.skipped.push(linkPath); continue; }
    // the folder already holds another framework's skills: link each kit skill into it
    for (const name of kitSkills(files)) {
      const p = path.join(dest, name);
      const target = `../../.agents/skills/${name}`;
      if (isLink(p) && linkTarget(p) === target) continue;
      if (fs.existsSync(p) || isLink(p)) { done.skipped.push(`${linkPath}/${name} (another skill has this name)`); continue; }
      if (!link(target, p, `${linkPath}/${name}`)) break;
      done.created.push(`${linkPath}/${name} -> .agents/skills/${name}`);
    }
  }

  // 3. .gitignore: keep secrets out of git
  const gi = path.join(cwd, '.gitignore');
  const giText = readIf(gi) || '';
  // Expo: ios/ and android/ are generated by prebuild, so they stay out of git too
  // .maestro/.amk-*: the copies of flows with view-tree steps that verify.sh runs on Android, there only while they run
  const ignored = ['.env', '.env.*', '!.env*.example', '!.env*.sample', '!.env*.template', '.amk/', '.maestro/.amk-*', ...(stack === 'expo' ? ['/ios', '/android'] : [])];
  const missing = ignored.filter(l => !giText.split('\n').includes(l));
  if (missing.length) {
    fs.writeFileSync(gi, `${giText.replace(/\n*$/, giText ? '\n' : '')}\n# agentic-mobile-kit: secrets stay out of git; .amk/ holds local evidence (screenshots, logs), .maestro/.amk-* the flows verify.sh is running${stack === 'expo' ? '; ios/ and android/ are generated' : ''}\n${missing.join('\n')}\n`);
    done.merged.push('.gitignore');
  }

  // 3b. .gitattributes: shell scripts keep Unix line endings, or they fail on Windows checkouts (autocrlf)
  const ga = path.join(cwd, '.gitattributes');
  const gaText = readIf(ga) || '';
  const gaMissing = ['.githooks/* text eol=lf', '*.sh text eol=lf'].filter(l => !gaText.split('\n').includes(l));
  if (gaMissing.length) {
    fs.writeFileSync(ga, `${gaText.replace(/\n*$/, gaText ? '\n' : '')}${gaText ? '\n' : ''}# agentic-mobile-kit: shell scripts keep LF line endings, so they run on Windows too\n${gaMissing.join('\n')}\n`);
    done.merged.push('.gitattributes');
  }

  // 3c. .eslintignore, for apps on ESLint's eslintrc config (ESLint 9's flat config doesn't read the file;
  // the kit's scripts pass React Native's default rules, but stricter configs such as Airbnb's flag them)
  const eslintrc = fs.readdirSync(cwd).some(f => /^\.eslintrc(\.\w+)?$/.test(f)) || Boolean(pkg.eslintConfig);
  const ei = path.join(cwd, '.eslintignore');
  const eiOld = readIf(ei) || '';
  // before 0.7.0 the kit's line named scripts/ai/
  let eiText = eiOld.replace(`${ESLINT_NOTE}\nscripts/ai/\n`, `${ESLINT_NOTE}\n${ESLINT_IGNORE}\n`);
  if (eslintrc && !eiText.split('\n').includes(ESLINT_IGNORE)) eiText = `${eiText.replace(/\n*$/, eiText ? '\n' : '')}${eiText ? '\n' : ''}${ESLINT_NOTE}\n${ESLINT_IGNORE}\n`;
  if (eiText !== eiOld) {
    fs.writeFileSync(ei, eiText);
    (eiOld ? done.merged : done.created).push('.eslintignore');
  }

  // 4. package.json scripts: typecheck, and hooks path on install (never overwrite existing scripts)
  const scripts = (pkg.scripts = pkg.scripts || {});
  let pkgChanged = false;
  // only TypeScript projects get typecheck: tsc fails ("no inputs") in JavaScript apps that merely have typescript installed
  if (!scripts.typecheck && deps.typescript && usesTs(cwd)) { scripts.typecheck = 'tsc --noEmit'; pkgChanged = true; }
  const manager = hookManager(cwd, pkg);
  // a team may keep .githooks out of git: a fresh clone has none until it runs sync, which also turns the hooks on
  const keptOut = ignoredByGit(cwd, '.githooks/pre-commit');
  if (manager) {
    // the project's hook manager runs the kit's hooks; drop the postinstall earlier kit versions added, which fought it
    if (dropHooksCmd(scripts)) pkgChanged = true;
    if (wireHooks(cwd, manager, done)) pkgChanged = true;
    if (!manager.manual && keptOut) {
      done.warnings.push(`.githooks is kept out of git here, so a fresh clone has none until it runs npx agentic-mobile-kit sync. Until then, ${manager.name} skips the kit's checks and says so`);
    }
  } else if (keptOut) {
    // pointing git at a folder a fresh clone doesn't have would switch off every hook there, other tools' too
    if (dropHooksCmd(scripts)) pkgChanged = true;
    done.warnings.push('.githooks is kept out of git here, so a fresh clone has none until it runs npx agentic-mobile-kit sync, which turns the kit\'s hooks on. Until then, git runs only the hooks in .git/hooks there');
  } else if (!(scripts.postinstall || '').includes('core.hooksPath')) {
    // parentheses keep the existing script's failure behavior: `a && b || true` would hide a failing `a`
    scripts.postinstall = scripts.postinstall ? `${scripts.postinstall} && (${HOOKS_CMD})` : HOOKS_CMD;
    pkgChanged = true;
  }
  if (pkgChanged) { fs.writeFileSync(path.join(cwd, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`); done.merged.push('package.json (scripts)'); }

  // 5. activate the git hooks now
  if (!manager) git(cwd, 'config', 'core.hooksPath', '.githooks');
  else if (localHooksPath(cwd) === '.githooks') {
    // an earlier kit version took core.hooksPath over: give it back (husky 9 uses .husky/_, husky 5 to 8 .husky)
    const husky = manager.dir === '.husky' && ['.husky/_/h', '.husky/_/husky.sh'].find(f => fs.existsSync(path.join(cwd, f)));
    if (husky) git(cwd, 'config', 'core.hooksPath', husky.endsWith('/h') ? '.husky/_' : '.husky');
    else git(cwd, 'config', '--unset', 'core.hooksPath');
  }
  let gitHooks = '';
  try { gitHooks = path.resolve(cwd, git(cwd, 'rev-parse', '--git-common-dir'), 'hooks'); } catch {}
  const forwarded = manager || !gitHooks ? []
    : OTHER_HOOKS.filter(h => fs.existsSync(path.join(gitHooks, h)) && !fs.existsSync(path.join(cwd, '.githooks', h)));
  for (const h of forwarded) {
    // a team may keep .githooks out of git, so a fresh clone has none yet
    fs.mkdirSync(path.join(cwd, '.githooks'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.githooks', h), forwarder(h), { mode: 0o755 });
    done.created.push(`.githooks/${h}`);
  }
  if (forwarded.length) {
    const ignored = ignoredByGit(cwd, `.githooks/${forwarded[0]}`);
    const files = forwarded.map(h => `.githooks/${h}`).join(', ');
    done.warnings.push(`.git/hooks has ${forwarded.join(', ')} from another tool, which core.hooksPath would switch off: ${files} now run${forwarded.length > 1 ? '' : 's'} it. ${ignored
      ? '.githooks is kept out of git here, so each clone gets that when it runs sync'
      : `Commit ${forwarded.length > 1 ? 'them' : 'it'} with the kit, so it runs in every clone that has one`}`);
  }
  // Windows files have no executable bit, and git skips non-executable hooks on Mac and Linux clones:
  // stage the hooks as executable so the commit carries it (not where the team keeps them out of git)
  const hooks = ['.githooks/pre-commit', '.githooks/pre-push', ...forwarded.map(h => `.githooks/${h}`)]
    .filter(h => WIN && fs.existsSync(path.join(cwd, h)) && !ignoredByGit(cwd, h));
  if (hooks.length) git(cwd, 'add', '--chmod=+x', '--', ...hooks);

  // 6. tool configs for the chosen tools (permissions, hooks, subagents), from rulesync.jsonc, which a team that keeps
  // it out of git doesn't have in a fresh clone
  const rsFile = path.join(cwd, 'rulesync.jsonc');
  const rs = readIf(rsFile);
  if (rs === null) {
    done.warnings.push('rulesync.jsonc isn\'t here (deleted, or kept out of git), so the AI tools\' settings, hooks and subagents weren\'t generated. npx agentic-mobile-kit init puts it back');
    return { done, generated: true, generateError: '' };
  }
  fs.writeFileSync(rsFile, setTargets(rs, tools.flatMap(t => TOOLS[t])));
  let generated = true;
  let generateError = '';
  if (!skipGenerate) {
    const r = tool('npx', ['-y', RULESYNC, 'generate'], { cwd, env: cleanEnv(), encoding: 'utf8' });
    generated = r.status === 0;
    if (generated) flattenAntigravityStop(cwd);
    if (!generated) generateError = `${r.stderr || ''}${r.stdout || ''}`.trim().split('\n').slice(-12).join('\n');
  }
  return { done, generated, generateError };
}

// rulesync before 40 writes Antigravity's Stop hooks in the matcher shape ([{ hooks: [...] }]). Antigravity takes them
// as a plain list of handlers and rejects the rest, which drops the whole hook set, guard included
function flattenAntigravityStop(cwd) {
  const file = path.join(cwd, '.agents/hooks.json');
  let hooks;
  try { hooks = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
  let changed = false;
  for (const set of Object.values(hooks)) {
    if (!set || !Array.isArray(set.Stop) || !set.Stop.some(e => e && Array.isArray(e.hooks) && !e.command)) continue;
    set.Stop = set.Stop.flatMap(e => (e && Array.isArray(e.hooks) && !e.command ? e.hooks : [e]));
    changed = true;
  }
  if (changed) fs.writeFileSync(file, `${JSON.stringify(hooks, null, 2)}\n`);
}

function init(cwd, opts = {}) {
  const { pkg, deps, stack } = checkProject(cwd);
  // monorepos: git runs hooks from the repository root, and GitHub reads workflows only there
  const prefix = git(cwd, 'rev-parse', '--show-prefix').replace(/\/$/, '');
  if (prefix) throw new InitError(`This app is in a subfolder of its git repository (${prefix}), as in a monorepo. The kit doesn't support that yet: git runs hooks from the repository root, and GitHub reads workflows only there.`);
  const pm = detectPm(cwd, opts.pm);
  const tools = opts.tools || TESTED;
  for (const t of tools) if (!TOOLS[t]) throw new InitError(`Unknown tool "${t}". Choose from: ${Object.keys(TOOLS).join(', ')}.`);
  const files = stackFiles(opts.template || TEMPLATE, stack, deps);
  const ci = chooseCi(cwd, readIf(path.join(cwd, 'AGENTS.md')), opts.ci);
  const values = projectValues(cwd, pkg, deps, pm, ci, stack);
  const targets = tools.flatMap(t => TOOLS[t]);
  const report = { created: [], merged: [], skipped: [] };

  // 1. template files (never overwrite)
  for (const [rel, src] of files) {
    if (ciGroup(rel) && !ci.includes(ciGroup(rel))) continue;
    const dest = path.join(cwd, rel);
    const text = kitText(src, rel, values, targets);
    const current = readIf(dest);
    if (current !== null && (rel === 'AGENTS.md' || rel === 'CLAUDE.md')) {
      const next = rel === 'AGENTS.md' ? mergeAgents(current, text) : mergeClaude(current);
      if (next !== current) { fs.writeFileSync(dest, next); report.merged.push(rel); } else report.skipped.push(rel);
      continue;
    }
    if (fs.existsSync(dest)) { report.skipped.push(rel); continue; }
    writeKitFile(cwd, rel, text);
    report.created.push(rel);
  }

  const { done, generated, generateError } = finish(cwd, { pkg, deps, tools, files, stack, skipGenerate: opts.skipGenerate });
  for (const k of Object.keys(report)) report[k].push(...done[k]);
  return { report, warnings: done.warnings, values, tools, ci, generated, generateError };
}

function sync(cwd, opts = {}) {
  const { pkg, deps, stack: detected } = checkProject(cwd);
  const agents = readIf(path.join(cwd, 'AGENTS.md'));
  if (!agents || !MARKERS.test(agents)) throw new InitError('The kit isn\'t installed here (AGENTS.md has no KIT section). Run init instead.');
  const { from, dir: oldDir, exact } = oldTemplate(agents, opts);
  // installs before 0.6.0 don't record it, and were all bare
  const stack = recorded(agents).stack || detected;
  const ci = chooseCi(cwd, agents, opts.ci);
  // a CI part chosen just now was never installed, so its files are new rather than deleted by the team
  const hadCi = installedCi(cwd, agents);
  const wasInstalled = rel => !ciGroup(rel) || hadCi.includes(ciGroup(rel));
  const values = projectValues(cwd, pkg, deps, detectPm(cwd, opts.pm), ci, stack);
  // the kit's files as installed: their texts about CI said what the CI chosen then does
  const oldValues = { ...values, ...ciTexts(hadCi) };
  const tools = installedTools(cwd);
  const targets = tools.flatMap(t => TOOLS[t]);
  const report = { moved: [], updated: [], added: [], merged: [], conflicts: [], byHand: [], removed: [], kept: [] };
  const newFiles = stackFiles(opts.template || TEMPLATE, stack, deps);
  // an install from before 0.7.0: the kit's files move to the new folders first, so the team's edits come along.
  // Other files in the old folders may be the app's own, so they stay where they are.
  // all the old version installed, whatever the app uses now: what this one leaves out goes
  const oldKit = stackFiles(oldDir, stack);
  const moved = [...oldKit.keys()].filter(rel => renamedPath(rel) !== rel
    && fs.existsSync(path.join(cwd, rel)) && !fs.existsSync(path.join(cwd, renamedPath(rel))));
  for (const rel of moved) {
    fs.mkdirSync(path.dirname(path.join(cwd, renamedPath(rel))), { recursive: true });
    fs.renameSync(path.join(cwd, rel), path.join(cwd, renamedPath(rel)));
  }
  for (const [from, to] of RENAMED) {
    const n = moved.filter(rel => rel.startsWith(from)).length;
    if (!n) continue;
    report.moved.push(`${from} to ${to} (${n} files)`);
    const left = templateFiles(path.join(cwd, from));
    if (left.length) report.kept.push(`${left.map(f => from + f).join(', ')} (not the kit's; its files moved to ${to})`);
    else fs.rmSync(path.join(cwd, from), { recursive: true, force: true });
  }
  const oldFiles = new Map([...oldKit].map(([rel, src]) => [renamedPath(rel), src]));

  for (const [rel, src] of newFiles) {
    if (ciGroup(rel) && !ci.includes(ciGroup(rel))) continue;
    const kitNew = kitText(src, rel, values, targets);
    const kitOld = oldFiles.has(rel) && wasInstalled(rel) ? kitText(oldFiles.get(rel), rel, oldValues, targets) : null;
    const current = projectText(cwd, rel, targets);
    if (rel === 'AGENTS.md' || rel === 'CLAUDE.md') {
      // the team's edits inside the kit's section stay, merged like any file's
      const mine = rel === 'AGENTS.md' && exact && kitOld !== null && current !== null && (current.match(MARKERS) || [])[0];
      const { text: section, conflicts } = mine ? mergeSection(mine, fs.readFileSync(oldFiles.get(rel), 'utf8'), kitOld, kitNew, from) : { text: kitNew, conflicts: 0 };
      const next = current === null ? kitNew : rel === 'AGENTS.md' ? mergeAgents(current, section) : mergeClaude(current);
      if (next === current) continue;
      fs.writeFileSync(path.join(cwd, rel), next);
      if (section === kitNew) report.updated.push(rel);
      else (conflicts ? report.conflicts : report.merged).push(`${rel} (your edits inside the kit's section)`);
      continue;
    }
    if (current === null) {
      // new in the kit, or kept out of git, so this clone doesn't have it yet (a team may keep .githooks out of git).
      // Not rulesync.jsonc: it holds the team's choice of tools, which the kit's own copy doesn't know
      if (kitOld === null || rel !== 'rulesync.jsonc' && ignoredByGit(cwd, rel)) { writeKitFile(cwd, rel, kitNew); report.added.push(rel); } else report.kept.push(`${rel} (you deleted it)`);
      continue;
    }
    if (current === kitNew) continue;
    if (kitOld === null) { report.kept.push(`${rel} (your own file; the kit now has one with this name)`); continue; }
    if (current === kitOld) { writeKitFile(cwd, rel, kitNew); report.updated.push(rel); continue; }
    // the team changed it and the kit didn't: nothing to bring in
    if (kitOld === kitNew || PROJECT_DOCS.includes(rel)) continue;
    // without an exact base, an old unchanged file would look like your edit and be kept: show every difference instead
    const { text, conflicts } = merge3(current, exact ? kitOld : '', kitNew, from);
    // markers, or a merge that no longer parses, would stop a script, a hook, a workflow or a config from working (and
    // every check with it): those get the kit's version, and the team's goes beside it to bring its changes back
    if (!rel.endsWith('.md') && (conflicts || !parses(rel, text))) {
      fs.copyFileSync(path.join(cwd, rel), path.join(cwd, `${rel}.mine`));
      writeKitFile(cwd, rel, kitNew);
      report.byHand.push(rel);
      continue;
    }
    writeKitFile(cwd, rel, text);
    (conflicts ? report.conflicts : report.merged).push(rel);
  }
  // files the kit no longer ships
  for (const [rel, src] of oldFiles) {
    if (newFiles.has(rel) || !wasInstalled(rel)) continue;
    const current = projectText(cwd, rel, targets);
    if (current === null) continue;
    if (current === kitText(src, rel, values, targets)) { fs.unlinkSync(path.join(cwd, rel)); report.removed.push(rel); } else report.kept.push(`${rel} (the kit dropped it; you changed it)`);
  }
  removeEmptyFolders(cwd, report.removed);

  const { done, generated, generateError } = finish(cwd, { pkg, deps, tools, files: newFiles, stack, skipGenerate: opts.skipGenerate });
  report.added.push(...done.created);
  report.updated.push(...done.merged);
  // the team's own files that still name a moved file: scripts in package.json, other CI, their docs
  let stale = '';
  try { if (moved.length) stale = git(cwd, 'grep', '-l', '--untracked', '-F', ...moved.flatMap(rel => ['-e', rel])); } catch {}
  if (stale) done.warnings.push(`still pointing to the kit's old folders: ${stale.split('\n').join(', ')}. Change docs/ai/ to docs/amk/ and scripts/ai/ to scripts/amk/ there.`);
  // it started from a clean working tree, so git shows everything it changed (tool configs too)
  const changed = git(cwd, 'status', '--porcelain') !== '';
  return { report, warnings: done.warnings, from, to: KIT_VERSION, tools, changed, generated, generateError };
}

// what rulesync generates from the project's kit sources, regenerated in an empty folder: [[path, text]]
function generatedFiles(cwd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amk-gen-'));
  fs.cpSync(path.join(cwd, '.rulesync'), path.join(dir, '.rulesync'), { recursive: true });
  fs.copyFileSync(path.join(cwd, 'rulesync.jsonc'), path.join(dir, 'rulesync.jsonc'));
  const r = tool('npx', ['-y', RULESYNC, 'generate'], { cwd: dir, env: cleanEnv(), encoding: 'utf8' });
  if (r.status !== 0) throw new InitError(`Couldn't work out which tool configs rulesync generated: ${`${r.stderr}${r.stdout}`.trim().split('\n').pop()}`);
  const files = templateFiles(dir).filter(f => !f.startsWith('.rulesync/') && !['rulesync.jsonc', '.gitignore'].includes(f));
  const out = files.map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

// the folders that removed files (paths from cwd, maybe followed by " (why)") left empty; rmdir refuses non-empty ones
function removeEmptyFolders(cwd, removed) {
  const dirs = [...new Set(removed.map(r => path.dirname(r.split(' (')[0])))].sort((a, b) => b.length - a.length);
  for (let d of dirs) {
    for (; d && d !== '.'; d = path.dirname(d)) { try { fs.rmdirSync(path.join(cwd, d)); } catch { break; } }
  }
}

function uninstall(cwd, opts = {}) {
  const { pkg, deps, stack: detected } = checkProject(cwd);
  const agents = readIf(path.join(cwd, 'AGENTS.md'));
  if (!agents || !MARKERS.test(agents)) throw new InitError('The kit isn\'t installed here (AGENTS.md has no KIT section).');
  const { from, dir: template } = oldTemplate(agents, opts);
  const stack = recorded(agents).stack || detected;
  const values = projectValues(cwd, pkg, deps, detectPm(cwd, opts.pm), installedCi(cwd, agents), stack);
  const targets = installedTools(cwd).flatMap(t => TOOLS[t]);
  const report = { removed: [], kept: [], left: [] };
  const remove = rel => { fs.unlinkSync(path.join(cwd, rel)); report.removed.push(rel); };
  // listed before their sources are removed
  const generated = opts.skipGenerate ? [] : generatedFiles(cwd);

  for (const [rel, src] of stackFiles(template, stack)) {
    const current = projectText(cwd, rel, targets);
    if (current === null) continue;
    if (rel === 'AGENTS.md' || rel === 'CLAUDE.md') {
      const rest = rel === 'AGENTS.md' ? current.replace(MARKERS, () => '') : current.replace(/^@AGENTS\.md[ \t]*\n?/m, '');
      if (!rest.trim()) remove(rel);
      else if (rest !== current) { fs.writeFileSync(path.join(cwd, rel), rest.replace(/\n+$/, '\n')); report.removed.push(`${rel} (the kit's part)`); }
      continue;
    }
    if (current === kitText(src, rel, values, targets)) remove(rel); else report.kept.push(rel);
  }
  for (const [rel, text] of generated) {
    const current = readIf(path.join(cwd, rel));
    if (current === null) continue;
    if (current === text) remove(rel); else report.kept.push(`${rel} (also has your own settings; remove the kit's entries by hand)`);
  }
  for (const [link] of SKILL_LINKS) {
    const p = path.join(cwd, link);
    if (isLink(p) && linkTarget(p) === '../.agents/skills') { fs.unlinkSync(p); report.removed.push(link); continue; }
    // per-skill links inside another framework's skills folder
    if (!fs.existsSync(p) || isLink(p)) continue;
    for (const name of fs.readdirSync(p)) {
      const q = path.join(p, name);
      if (isLink(q) && linkTarget(q) === `../../.agents/skills/${name}`) { fs.unlinkSync(q); report.removed.push(`${link}/${name}`); }
    }
  }
  for (const h of OTHER_HOOKS) if ((readIf(path.join(cwd, '.githooks', h)) || '').includes(FORWARD)) remove(`.githooks/${h}`);
  removeEmptyFolders(cwd, report.removed);

  // git hooks: the kit's postinstall, or its lines in the project's hook manager (which would fail once .githooks is gone)
  const scripts = pkg.scripts || {};
  let pkgChanged = false;
  if (dropHooksCmd(scripts)) { pkgChanged = true; report.removed.push('package.json postinstall (git hooks)'); }
  const manager = hookManager(cwd, pkg);
  if (manager && !manager.manual && unwireHooks(cwd, manager, report)) pkgChanged = true;
  if (pkgChanged) fs.writeFileSync(path.join(cwd, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  try { if (git(cwd, 'config', 'core.hooksPath') === '.githooks') git(cwd, 'config', '--unset', 'core.hooksPath'); } catch {}

  // .eslintignore: the kit's lines, and the file if nothing else is in it
  const eiText = readIf(path.join(cwd, '.eslintignore'));
  // installs from before 0.7.0 have scripts/ai/ under the kit's note
  const ours = l => l === ESLINT_NOTE || l === ESLINT_IGNORE || (l === 'scripts/ai/' && eiText.includes(ESLINT_NOTE));
  if (eiText !== null && eiText.split('\n').some(l => l !== ESLINT_NOTE && ours(l))) {
    const rest = eiText.split('\n').filter(l => !ours(l)).join('\n').replace(/\n{3,}/g, '\n\n');
    if (!rest.trim()) fs.unlinkSync(path.join(cwd, '.eslintignore')); else fs.writeFileSync(path.join(cwd, '.eslintignore'), rest.replace(/\n*$/, '\n'));
    report.removed.push('.eslintignore (the kit\'s lines)');
  }

  report.left.push('the kit\'s .gitignore lines (they keep .env files and local evidence out of git)');
  if (scripts.typecheck === 'tsc --noEmit') report.left.push('the "typecheck" script in package.json');
  return { report, from };
}

function printSummary({ report, warnings = [], values, tools, ci, generated, generateError }, log = console.log) {
  log(`agentic-mobile-kit installed for ${values.APP_NAME} (${values.KIT_STACK === 'expo' ? `Expo SDK ${values.EXPO_SDK}, ` : ''}React Native ${values.RN_VERSION}, ${values.PM}).`);
  log(`Tools: ${tools.join(', ')}${tools.some(t => !TESTED.includes(t)) ? ' (cursor, opencode and kiro are not tested yet)' : ''}`);
  log(`CI: ${ci.length ? ci.join(', ') : 'none (add it any time with --ci github,codemagic)'}`);
  log(`  created: ${report.created.length} files`);
  if (report.merged.length) log(`  merged:  ${report.merged.join(', ')}`);
  if (report.skipped.length) log(`  kept as they were (already existed): ${report.skipped.join(', ')}`);
  for (const w of warnings) log(`  ! ${w}`);
  if (!generated) log(`  ! could not generate tool configs; run: npx -y ${RULESYNC} generate\n${generateError.replace(/^/gm, '    ')}`);
  log('\nNext steps:');
  log('  1. In your AI tool, run m-onboard (/m-onboard, or $m-onboard in Codex). It drafts docs/amk/product.md, tech.md,\n     structure.md and conventions.md from the code, asks what the code can\'t show, and writes them once you approve.');
  log('  2. Commit on a branch and open a PR. Add the "large-pr" label (the vendored skills are large).');
  const more = [
    ci.includes('github') && 'Turn on branch protection for main: see docs/branch-protection.md in the kit repo.',
    ci.includes('codemagic') && 'Signed store builds on Codemagic: one-time setup in docs/amk/codemagic.md.',
    tools.includes('codex') && 'Codex users: open the project in Codex once and approve its hooks (they stay off until approved).',
  ].filter(Boolean);
  more.forEach((m, i) => log(`  ${i + 3}. ${m}`));
}

function printSync({ report, warnings = [], from, to, changed, generated, generateError }, log = console.log) {
  log(from === to ? `agentic-mobile-kit is already ${to}.` : `agentic-mobile-kit updated from ${from} to ${to}.`);
  const lines = [
    ['moved to the new folders', report.moved || []], ['updated', report.updated], ['added', report.added], ['removed', report.removed],
    ['merged with your changes', report.merged], ['CONFLICTS, resolve the <<<<<<< markers', report.conflicts],
    ['CONFLICTS where markers would stop the file from working, so the kit\'s version is in place: bring your changes back from <file>.mine, then delete it', report.byHand || []],
    ['left alone', report.kept],
  ];
  for (const [label, files] of lines) if (files.length) log(`  ${label}: ${files.join(', ')}`);
  if (!changed) log('  Nothing changed.');
  for (const w of warnings) log(`  ! ${w}`);
  if (!generated) log(`  ! could not generate tool configs; run: npx -y ${RULESYNC} generate\n${generateError.replace(/^/gm, '    ')}`);
  // a conflict left is an update not finished: said last, and the command fails
  const open = report.conflicts.length + (report.byHand || []).length;
  if (open) log(`\nsync isn't finished: ${open === 1 ? 'a conflict' : `${open} conflicts`} to resolve (above). Then run the checks, and commit.`);
  else if (changed) log('\nReview it with "git diff", run the checks, then commit on a branch and open a PR.');
  return open;
}

function printUninstall({ report }, log = console.log) {
  log(`agentic-mobile-kit removed: ${report.removed.length} files and sections.`);
  if (report.kept.length) log(`  kept because you changed them: ${report.kept.join(', ')}`);
  for (const l of report.left) log(`  left in place: ${l}`);
  log('\nReview it with "git status" and "git diff", then commit. Undo it with git if you change your mind.');
}

module.exports = {
  init, sync, uninstall, printSummary, printSync, printUninstall, InitError, TOOLS, TESTED, CI, KIT_VERSION, tool, cleanEnv,
  hookManager, hooksWired, kitRun, ignoredByGit, flattenAntigravityStop, checkProject, recorded, installedCi, emptyFolder, createApp,
};
