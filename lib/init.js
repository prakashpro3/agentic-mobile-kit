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
const PROJECT_DOCS = ['product', 'tech', 'structure', 'conventions'].map(n => path.join('docs', 'ai', `${n}.md`));
const HOOKS_CMD = 'git config core.hooksPath .githooks || true';
// optional parts, installed only when a project chooses them with --ci: not every app uses CI
const CI = {
  github: rel => rel.startsWith(`.github${path.sep}`),
  codemagic: rel => rel === 'codemagic.yaml' || rel === path.join('docs', 'ai', 'codemagic.md'),
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
// npm, npx and yarn are .cmd files on Windows, which Node can only start through a shell
const tool = (cmd, args, opts = {}) => (WIN
  ? spawnSync([cmd, ...args].map(a => `"${a}"`).join(' '), { ...opts, shell: true })
  : spawnSync(cmd, args, opts));
function isLink(p) { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } }

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
  if (!fs.existsSync(path.join(cwd, 'ios')) || !fs.existsSync(path.join(cwd, 'android'))) {
    throw new InitError('No ios/ and android/ folders found. Only bare React Native projects are supported for now (Expo support comes later).');
  }
  return { pkg, deps };
}

// all files under dir, as relative paths, including dotfiles
function templateFiles(dir = TEMPLATE, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const rel = path.join(base, e.name);
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

function projectValues(cwd, pkg, deps, pm, ci) {
  return {
    KIT_VERSION,
    KIT_CI: ci.join(',') || 'none',
    APP_NAME: pkg.name || path.basename(cwd),
    RN_VERSION: installedVersion(cwd, 'react-native', deps['react-native']),
    REACT_VERSION: installedVersion(cwd, 'react', deps.react),
    TS_VERSION: installedVersion(cwd, 'typescript', deps.typescript),
    NODE_VERSION: (pkg.engines && pkg.engines.node) || `${process.versions.node.split('.')[0]}`,
    PM: pm.name,
    PM_RUN: pm.run,
    IOS_BUNDLE_ID: iosBundleId(cwd),
  };
}

// a template file's text as the kit writes it into this project
function kitText(templateDir, rel, values, targets) {
  const text = fs.readFileSync(path.join(templateDir, rel), 'utf8');
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
  const executable = rel.startsWith(`.githooks${path.sep}`) || /\.(sh|js)$/.test(rel) && rel.startsWith(`scripts${path.sep}`);
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

// what the kit marker in AGENTS.md records: the kit version since 0.4.0, the CI choice since 0.5.0
function recorded(agents) {
  const m = (agents || '').match(/KIT:START agentic-mobile-kit (\d[^\s>]*)(?: ci=([\w,]+))?/);
  return { version: m ? m[1] : null, ci: m && m[2] ? m[2].split(',').filter(g => CI[g]) : null };
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

const SKILL_LINKS = [['.claude/skills', 'claude'], ['.kiro/skills', 'kiro']];
const kitSkills = template => fs.readdirSync(path.join(template, '.agents', 'skills'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);

// steps 2–6, shared by init and sync
function finish(cwd, { pkg, deps, tools, template, skipGenerate }) {
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
    for (const name of kitSkills(template)) {
      const p = path.join(dest, name);
      const target = `../../.agents/skills/${name}`;
      if (isLink(p) && fs.readlinkSync(p) === target) continue;
      if (fs.existsSync(p) || isLink(p)) { done.skipped.push(`${linkPath}/${name} (another skill has this name)`); continue; }
      if (!link(target, p, `${linkPath}/${name}`)) break;
      done.created.push(`${linkPath}/${name} -> .agents/skills/${name}`);
    }
  }

  // 3. .gitignore: keep secrets out of git
  const gi = path.join(cwd, '.gitignore');
  const giText = readIf(gi) || '';
  const missing = ['.env', '.env.*', '!.env.example', '.ai/'].filter(l => !giText.split('\n').includes(l));
  if (missing.length) {
    fs.writeFileSync(gi, `${giText.replace(/\n*$/, giText ? '\n' : '')}\n# agentic-mobile-kit: secrets stay out of git; .ai/ holds local evidence (screenshots, logs)\n${missing.join('\n')}\n`);
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
  if (!(scripts.postinstall || '').includes('core.hooksPath')) {
    // parentheses keep the existing script's failure behavior: `a && b || true` would hide a failing `a`
    scripts.postinstall = scripts.postinstall ? `${scripts.postinstall} && (${HOOKS_CMD})` : HOOKS_CMD;
    pkgChanged = true;
  }
  if (pkgChanged) { fs.writeFileSync(path.join(cwd, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`); done.merged.push('package.json (scripts)'); }

  // 5. activate the git hooks now
  git(cwd, 'config', 'core.hooksPath', '.githooks');

  // 6. tool configs for the chosen tools (permissions, hooks, subagents)
  const rsFile = path.join(cwd, 'rulesync.jsonc');
  fs.writeFileSync(rsFile, setTargets(fs.readFileSync(rsFile, 'utf8'), tools.flatMap(t => TOOLS[t])));
  let generated = true;
  let generateError = '';
  if (!skipGenerate) {
    const r = tool('npx', ['-y', RULESYNC, 'generate'], { cwd, env: cleanEnv(), encoding: 'utf8' });
    generated = r.status === 0;
    if (!generated) generateError = `${r.stderr || ''}${r.stdout || ''}`.trim().split('\n').slice(-5).join('\n');
  }
  return { done, generated, generateError };
}

function init(cwd, opts = {}) {
  const { pkg, deps } = checkProject(cwd);
  const pm = detectPm(cwd, opts.pm);
  const tools = opts.tools || TESTED;
  for (const t of tools) if (!TOOLS[t]) throw new InitError(`Unknown tool "${t}". Choose from: ${Object.keys(TOOLS).join(', ')}.`);
  const template = opts.template || TEMPLATE;
  const ci = chooseCi(cwd, readIf(path.join(cwd, 'AGENTS.md')), opts.ci);
  const values = projectValues(cwd, pkg, deps, pm, ci);
  const targets = tools.flatMap(t => TOOLS[t]);
  const report = { created: [], merged: [], skipped: [] };

  // 1. template files (never overwrite)
  for (const rel of templateFiles(template)) {
    if (ciGroup(rel) && !ci.includes(ciGroup(rel))) continue;
    const dest = path.join(cwd, rel);
    const text = kitText(template, rel, values, targets);
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

  const { done, generated, generateError } = finish(cwd, { pkg, deps, tools, template, skipGenerate: opts.skipGenerate });
  for (const k of Object.keys(report)) report[k].push(...done[k]);
  return { report, warnings: done.warnings, values, tools, ci, generated, generateError };
}

function sync(cwd, opts = {}) {
  const { pkg, deps } = checkProject(cwd);
  const agents = readIf(path.join(cwd, 'AGENTS.md'));
  if (!agents || !MARKERS.test(agents)) throw new InitError('The kit isn\'t installed here (AGENTS.md has no KIT section). Run init instead.');
  const { from, dir: oldDir, exact } = oldTemplate(agents, opts);
  const template = opts.template || TEMPLATE;
  const ci = chooseCi(cwd, agents, opts.ci);
  // a CI part chosen just now was never installed, so its files are new rather than deleted by the team
  const hadCi = installedCi(cwd, agents);
  const wasInstalled = rel => !ciGroup(rel) || hadCi.includes(ciGroup(rel));
  const values = projectValues(cwd, pkg, deps, detectPm(cwd, opts.pm), ci);
  const tools = installedTools(cwd);
  const targets = tools.flatMap(t => TOOLS[t]);
  const report = { updated: [], added: [], merged: [], conflicts: [], removed: [], kept: [] };
  const newFiles = templateFiles(template);
  const oldFiles = new Set(templateFiles(oldDir));

  for (const rel of newFiles) {
    if (ciGroup(rel) && !ci.includes(ciGroup(rel))) continue;
    const kitNew = kitText(template, rel, values, targets);
    const kitOld = oldFiles.has(rel) && wasInstalled(rel) ? kitText(oldDir, rel, values, targets) : null;
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
  for (const rel of oldFiles) {
    if (newFiles.includes(rel) || !wasInstalled(rel)) continue;
    const current = projectText(cwd, rel, targets);
    if (current === null) continue;
    if (current === kitText(oldDir, rel, values, targets)) { fs.unlinkSync(path.join(cwd, rel)); report.removed.push(rel); } else report.kept.push(`${rel} (the kit dropped it; you changed it)`);
  }

  const { done, generated, generateError } = finish(cwd, { pkg, deps, tools, template, skipGenerate: opts.skipGenerate });
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
  const files = templateFiles(dir).filter(f => !f.startsWith(`.rulesync${path.sep}`) && !['rulesync.jsonc', '.gitignore'].includes(f));
  const out = files.map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

function uninstall(cwd, opts = {}) {
  const { pkg, deps } = checkProject(cwd);
  const agents = readIf(path.join(cwd, 'AGENTS.md'));
  if (!agents || !MARKERS.test(agents)) throw new InitError('The kit isn\'t installed here (AGENTS.md has no KIT section).');
  const { from, dir: template } = oldTemplate(agents, opts);
  const values = projectValues(cwd, pkg, deps, detectPm(cwd, opts.pm), installedCi(cwd, agents));
  const targets = installedTools(cwd).flatMap(t => TOOLS[t]);
  const report = { removed: [], kept: [], left: [] };
  const remove = rel => { fs.unlinkSync(path.join(cwd, rel)); report.removed.push(rel); };
  // listed before their sources are removed
  const generated = opts.skipGenerate ? [] : generatedFiles(cwd);

  for (const rel of templateFiles(template)) {
    const current = projectText(cwd, rel, targets);
    if (current === null) continue;
    if (rel === 'AGENTS.md' || rel === 'CLAUDE.md') {
      const rest = rel === 'AGENTS.md' ? current.replace(MARKERS, () => '') : current.replace(/^@AGENTS\.md[ \t]*\n?/m, '');
      if (!rest.trim()) remove(rel);
      else if (rest !== current) { fs.writeFileSync(path.join(cwd, rel), rest.replace(/\n+$/, '\n')); report.removed.push(`${rel} (the kit's part)`); }
      continue;
    }
    if (current === kitText(template, rel, values, targets)) remove(rel); else report.kept.push(rel);
  }
  for (const [rel, text] of generated) {
    const current = readIf(path.join(cwd, rel));
    if (current === null) continue;
    if (current === text) remove(rel); else report.kept.push(`${rel} (also has your own settings; remove the kit's entries by hand)`);
  }
  for (const [link] of SKILL_LINKS) {
    const p = path.join(cwd, link);
    if (isLink(p) && fs.readlinkSync(p) === '../.agents/skills') { fs.unlinkSync(p); report.removed.push(link); continue; }
    // per-skill links inside another framework's skills folder
    if (!fs.existsSync(p) || isLink(p)) continue;
    for (const name of fs.readdirSync(p)) {
      const q = path.join(p, name);
      if (isLink(q) && fs.readlinkSync(q) === `../../.agents/skills/${name}`) { fs.unlinkSync(q); report.removed.push(path.join(link, name)); }
    }
  }
  // folders left empty (rmdir refuses non-empty ones)
  const dirs = [...new Set(report.removed.map(r => path.dirname(r.split(' (')[0])))].sort((a, b) => b.length - a.length);
  for (let d of dirs) {
    for (; d && d !== '.'; d = path.dirname(d)) { try { fs.rmdirSync(path.join(cwd, d)); } catch { break; } }
  }

  // git hooks
  const scripts = pkg.scripts || {};
  const postinstall = scripts.postinstall === HOOKS_CMD ? undefined : (scripts.postinstall || '').replace(` && (${HOOKS_CMD})`, '') || undefined;
  if (postinstall !== scripts.postinstall) {
    if (postinstall) scripts.postinstall = postinstall; else delete scripts.postinstall;
    fs.writeFileSync(path.join(cwd, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    report.removed.push('package.json postinstall (git hooks)');
  }
  try { if (git(cwd, 'config', 'core.hooksPath') === '.githooks') git(cwd, 'config', '--unset', 'core.hooksPath'); } catch {}

  report.left.push('.gitignore lines for .env files and .ai/ (they keep secrets and local evidence out of git)');
  if (scripts.typecheck === 'tsc --noEmit') report.left.push('the "typecheck" script in package.json');
  return { report, from };
}

function printSummary({ report, warnings = [], values, tools, ci, generated, generateError }, log = console.log) {
  log(`agentic-mobile-kit installed for ${values.APP_NAME} (React Native ${values.RN_VERSION}, ${values.PM}).`);
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

module.exports = { init, sync, uninstall, printSummary, printSync, printUninstall, InitError, TOOLS, CI, KIT_VERSION, tool };
