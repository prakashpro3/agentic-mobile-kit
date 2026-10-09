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
const RULESYNC = 'rulesync@27.0.0';
const MARKERS = /<!-- KIT:START[\s\S]*?<!-- KIT:END[^>]*-->\n?/;
// files with {{PLACEHOLDERS}} filled in from the project
const FILLED = ['AGENTS.md', 'codemagic.yaml'];
// docs each team rewrites for its app: sync replaces them only while they're untouched, and never merges into them
const PROJECT_DOCS = ['product', 'tech', 'structure', 'conventions'].map(n => `docs/ai/${n}.md`);
const HOOKS_CMD = 'git config core.hooksPath .githooks || true';
// optional parts, installed only when a project chooses them with --ci: not every app uses CI
const CI = {
  github: rel => rel.startsWith('.github/'),
  codemagic: rel => rel === 'codemagic.yaml' || rel === 'docs/ai/codemagic.md',
};
const ciGroup = rel => Object.keys(CI).find(g => CI[g](rel));

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

function checkProject(cwd) {
  try { git(cwd, 'rev-parse', '--is-inside-work-tree'); } catch {
    throw new InitError('This folder is not a git repository. Run "git init" and commit first; git is how init can be undone.');
  }
  if (git(cwd, 'status', '--porcelain')) {
    throw new InitError('You have uncommitted changes. Commit or stash them first, so this can be undone with git.');
  }
  const pkgFile = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgFile)) throw new InitError('No package.json here. Run this in the root of your React Native app.');
  const pkg = readJson(pkgFile);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps['react-native']) throw new InitError('This is not a React Native project (no "react-native" dependency).');
  const stack = detectStack(cwd, deps);
  if (stack === 'bare' && (!fs.existsSync(path.join(cwd, 'ios')) || !fs.existsSync(path.join(cwd, 'android')))) {
    throw new InitError('No ios/ and android/ folders found, and this isn\'t an Expo app. The kit supports bare React Native and Expo apps.');
  }
  return { pkg, deps, stack };
}

// Expo apps whose ios/ and android/ come from `expo prebuild` (Continuous Native Generation, not in git) get the
// Expo overlay. Expo apps that keep the native folders in git are set up like bare apps.
function detectStack(cwd, deps) {
  return deps.expo && !git(cwd, 'ls-files', 'ios', 'android') ? 'expo' : 'bare';
}

// a stack's files, rel -> source: the template, and for Expo the overlay next to it, which replaces or adds files
const EXPO_LEAVES_OUT = ['docs/ai/react-native.md', '.agents/skills/upgrading-react-native/'];
function stackFiles(template, stack) {
  const files = new Map(templateFiles(template).map(rel => [rel, path.join(template, rel)]));
  if (stack !== 'expo') return files;
  for (const rel of files.keys()) if (EXPO_LEAVES_OUT.some(f => (f.endsWith('/') ? rel.startsWith(f) : rel === f))) files.delete(rel);
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

function projectValues(cwd, pkg, deps, pm, ci, stack) {
  const rn = installedVersion(cwd, 'react-native', deps['react-native']);
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
    NODE_VERSION: (pkg.engines && pkg.engines.node) || `${process.versions.node.split('.')[0]}`,
    PM: pm.name,
    PM_RUN: pm.run,
    IOS_BUNDLE_ID: stack === 'expo' ? (expoConfig(cwd).ios || {}).bundleIdentifier || 'com.example.app' : iosBundleId(cwd),
  };
}

// a template file's text as the kit writes it into this project
function kitText(src, rel, values, targets) {
  const text = fs.readFileSync(src, 'utf8');
  if (FILLED.includes(rel)) return fillPlaceholders(text, values);
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

// Git hook managers a project may already use. The kit's hooks then run from theirs and core.hooksPath stays theirs:
// two tools setting it undo each other on every install (husky's prepare script runs after the kit's postinstall).
const KIT_HOOKS = ['pre-commit', 'pre-push'];
const MARK = 'agentic-mobile-kit';
const hookCall = h => `sh .githooks/${h}${h === 'pre-push' ? ' "$@"' : ''} || exit 1 # ${MARK}`;
const localHooksPath = cwd => {
  let v = '';
  try { v = git(cwd, 'config', '--local', 'core.hooksPath'); } catch {}
  return v && path.posix.normalize(v.replace(/\\/g, '/')).replace(/\/+$/, '');
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
const hooksWired = (cwd, m) => KIT_HOOKS.every(h => (m.json ? m.json[h] || '' : readIf(path.join(cwd, hookFile(m, h))) || '').includes(`.githooks/${h}`));

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
  const run = `sh .githooks/${h}`;
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
    done.warnings.push(`git hooks already run from ${m.name}, so the kit left core.hooksPath alone. To run the kit's checks too, add "sh .githooks/pre-commit" and "sh .githooks/pre-push" to those hooks.`);
    return false;
  }
  let pkgChanged = false;
  for (const h of KIT_HOOKS) {
    if (m.json) {
      if ((m.json[h] || '').includes(`.githooks/${h}`)) continue;
      m.json[h] = m.json[h] ? `sh .githooks/${h} && ${m.json[h]}` : `sh .githooks/${h}`;
      pkgChanged = true;
      continue;
    }
    const rel = hookFile(m, h);
    const file = path.join(cwd, rel);
    const text = readIf(file);
    if ((text || '').includes(`.githooks/${h}`)) continue;
    if (m.yaml) {
      const next = lefthookAdd(text, h);
      if (next === null) { done.warnings.push(`couldn't add the kit's ${h} check to ${rel}: add a command there that runs "sh .githooks/${h}"`); continue; }
      fs.writeFileSync(file, next);
      if (!done.merged.includes(rel)) done.merged.push(rel);
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text === null ? `#!/usr/bin/env sh\n${hookCall(h)}\n` : insertCall(text, hookCall(h)));
    // husky 5 to 8 and plain hook folders run the file itself
    fs.chmodSync(file, 0o755);
    if (WIN) git(cwd, 'add', '--chmod=+x', '--', rel);
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
      if (before === `sh .githooks/${h}`) delete m.json[h];
      else if (before) m.json[h] = before.replace(`sh .githooks/${h} && `, '');
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
  const ignored = ['.env', '.env.*', '!.env.example', '.ai/', ...(stack === 'expo' ? ['/ios', '/android'] : [])];
  const missing = ignored.filter(l => !giText.split('\n').includes(l));
  if (missing.length) {
    fs.writeFileSync(gi, `${giText.replace(/\n*$/, giText ? '\n' : '')}\n# agentic-mobile-kit: secrets stay out of git; .ai/ holds local evidence (screenshots, logs)${stack === 'expo' ? '; ios/ and android/ are generated' : ''}\n${missing.join('\n')}\n`);
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

  // 4. package.json scripts: typecheck, and hooks path on install (never overwrite existing scripts)
  const scripts = (pkg.scripts = pkg.scripts || {});
  let pkgChanged = false;
  // only TypeScript projects get typecheck: tsc fails ("no inputs") in JavaScript apps that merely have typescript installed
  const hasTs = git(cwd, 'ls-files', '*.ts', '*.tsx').split('\n').some(f => f && !f.endsWith('.d.ts'));
  if (!scripts.typecheck && deps.typescript && hasTs) { scripts.typecheck = 'tsc --noEmit'; pkgChanged = true; }
  const manager = hookManager(cwd, pkg);
  if (manager) {
    // the project's hook manager runs the kit's hooks; drop the postinstall earlier kit versions added, which fought it
    if (dropHooksCmd(scripts)) pkgChanged = true;
    if (wireHooks(cwd, manager, done)) pkgChanged = true;
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
  // Windows files have no executable bit, and git skips non-executable hooks on Mac and Linux clones:
  // stage the hooks as executable so the commit carries it
  const hooks = ['.githooks/pre-commit', '.githooks/pre-push'].filter(h => fs.existsSync(path.join(cwd, h)));
  if (WIN && hooks.length) git(cwd, 'add', '--chmod=+x', '--', ...hooks);

  // 6. tool configs for the chosen tools (permissions, hooks, subagents)
  const rsFile = path.join(cwd, 'rulesync.jsonc');
  fs.writeFileSync(rsFile, setTargets(fs.readFileSync(rsFile, 'utf8'), tools.flatMap(t => TOOLS[t])));
  let generated = true;
  let generateError = '';
  if (!skipGenerate) {
    const r = tool('npx', ['-y', RULESYNC, 'generate'], { cwd, env: cleanEnv(), encoding: 'utf8' });
    generated = r.status === 0;
    if (!generated) generateError = `${r.stderr || ''}${r.stdout || ''}`.trim().split('\n').slice(-12).join('\n');
  }
  return { done, generated, generateError };
}

function init(cwd, opts = {}) {
  // monorepos: git runs hooks from the repository root, and GitHub reads workflows only there
  let prefix = '';
  try { prefix = git(cwd, 'rev-parse', '--show-prefix').replace(/\/$/, ''); } catch {}
  if (prefix) throw new InitError(`This app is in a subfolder of its git repository (${prefix}), as in a monorepo. The kit doesn't support that yet: git runs hooks from the repository root, and GitHub reads workflows only there.`);
  const { pkg, deps, stack } = checkProject(cwd);
  const pm = detectPm(cwd, opts.pm);
  const tools = opts.tools || TESTED;
  for (const t of tools) if (!TOOLS[t]) throw new InitError(`Unknown tool "${t}". Choose from: ${Object.keys(TOOLS).join(', ')}.`);
  const files = stackFiles(opts.template || TEMPLATE, stack);
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
  const tools = installedTools(cwd);
  const targets = tools.flatMap(t => TOOLS[t]);
  const report = { updated: [], added: [], merged: [], conflicts: [], removed: [], kept: [] };
  const newFiles = stackFiles(opts.template || TEMPLATE, stack);
  const oldFiles = stackFiles(oldDir, stack);

  for (const [rel, src] of newFiles) {
    if (ciGroup(rel) && !ci.includes(ciGroup(rel))) continue;
    const kitNew = kitText(src, rel, values, targets);
    const kitOld = oldFiles.has(rel) && wasInstalled(rel) ? kitText(oldFiles.get(rel), rel, values, targets) : null;
    const current = projectText(cwd, rel, targets);
    if (rel === 'AGENTS.md' || rel === 'CLAUDE.md') {
      const next = current === null ? kitNew : rel === 'AGENTS.md' ? mergeAgents(current, kitNew) : mergeClaude(current);
      if (next !== current) { fs.writeFileSync(path.join(cwd, rel), next); report.updated.push(rel); }
      continue;
    }
    if (current === null) {
      if (kitOld === null) { writeKitFile(cwd, rel, kitNew); report.added.push(rel); } else report.kept.push(`${rel} (you deleted it)`);
      continue;
    }
    if (current === kitNew) continue;
    if (kitOld === null) { report.kept.push(`${rel} (your own file; the kit now has one with this name)`); continue; }
    if (current === kitOld) { writeKitFile(cwd, rel, kitNew); report.updated.push(rel); continue; }
    // the team changed it and the kit didn't: nothing to bring in
    if (kitOld === kitNew || PROJECT_DOCS.includes(rel)) continue;
    // without an exact base, an old unchanged file would look like your edit and be kept: show every difference instead
    const { text, conflicts } = merge3(current, exact ? kitOld : '', kitNew, from);
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

  const { done, generated, generateError } = finish(cwd, { pkg, deps, tools, files: newFiles, stack, skipGenerate: opts.skipGenerate });
  report.added.push(...done.created);
  report.updated.push(...done.merged);
  return { report, warnings: done.warnings, from, to: KIT_VERSION, tools, generated, generateError };
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
  // folders left empty (rmdir refuses non-empty ones)
  const dirs = [...new Set(report.removed.map(r => path.dirname(r.split(' (')[0])))].sort((a, b) => b.length - a.length);
  for (let d of dirs) {
    for (; d && d !== '.'; d = path.dirname(d)) { try { fs.rmdirSync(path.join(cwd, d)); } catch { break; } }
  }

  // git hooks: the kit's postinstall, or its lines in the project's hook manager (which would fail once .githooks is gone)
  const scripts = pkg.scripts || {};
  let pkgChanged = false;
  if (dropHooksCmd(scripts)) { pkgChanged = true; report.removed.push('package.json postinstall (git hooks)'); }
  const manager = hookManager(cwd, pkg);
  if (manager && !manager.manual && unwireHooks(cwd, manager, report)) pkgChanged = true;
  if (pkgChanged) fs.writeFileSync(path.join(cwd, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  try { if (git(cwd, 'config', 'core.hooksPath') === '.githooks') git(cwd, 'config', '--unset', 'core.hooksPath'); } catch {}

  report.left.push('.gitignore lines for .env files and .ai/ (they keep secrets and local evidence out of git)');
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
  log('  1. Fill in docs/ai/product.md, tech.md, structure.md and conventions.md for this app.');
  log('  2. Commit on a branch and open a PR. Add the "large-pr" label (the vendored skills are large).');
  const more = [
    ci.includes('github') && 'Turn on branch protection for main: see docs/branch-protection.md in the kit repo.',
    ci.includes('codemagic') && 'Signed store builds on Codemagic: one-time setup in docs/ai/codemagic.md.',
    tools.includes('codex') && 'Codex users: open the project in Codex once and approve its hooks (they stay off until approved).',
  ].filter(Boolean);
  more.forEach((m, i) => log(`  ${i + 3}. ${m}`));
}

function printSync({ report, warnings = [], from, to, generated, generateError }, log = console.log) {
  log(`agentic-mobile-kit updated from ${from} to ${to}.`);
  const lines = [
    ['updated', report.updated], ['added', report.added], ['removed', report.removed],
    ['merged with your changes', report.merged], ['CONFLICTS, resolve the <<<<<<< markers', report.conflicts], ['left alone', report.kept],
  ];
  for (const [label, files] of lines) if (files.length) log(`  ${label}: ${files.join(', ')}`);
  if (!Object.values(report).some(a => a.length)) log('  Nothing to change.');
  for (const w of warnings) log(`  ! ${w}`);
  if (!generated) log(`  ! could not generate tool configs; run: npx -y ${RULESYNC} generate\n${generateError.replace(/^/gm, '    ')}`);
  log('\nReview it with "git diff", run the checks, then commit on a branch and open a PR.');
}

function printUninstall({ report }, log = console.log) {
  log(`agentic-mobile-kit removed: ${report.removed.length} files and sections.`);
  if (report.kept.length) log(`  kept because you changed them: ${report.kept.join(', ')}`);
  for (const l of report.left) log(`  left in place: ${l}`);
  log('\nReview it with "git status" and "git diff", then commit. Undo it with git if you change your mind.');
}

module.exports = { init, sync, uninstall, printSummary, printSync, printUninstall, InitError, TOOLS, CI, KIT_VERSION, tool, hookManager, hooksWired };
