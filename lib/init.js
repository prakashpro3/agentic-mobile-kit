'use strict';
// `agentic-mobile-kit init`: installs the kit into a bare React Native project.
// Never overwrites existing files; merges AGENTS.md / CLAUDE.md; git is the backup (clean tree required).
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const TEMPLATE = path.join(__dirname, '..', 'stacks', 'react-native', 'template');
const RULESYNC = 'rulesync@27.0.0';
const MARKERS = /<!-- KIT:START[\s\S]*?<!-- KIT:END[^>]*-->\n?/;

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
    throw new InitError('You have uncommitted changes. Commit or stash them first, so init can be undone with git.');
  }
  const pkgFile = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgFile)) throw new InitError('No package.json here. Run init in the root of your React Native app.');
  const pkg = readJson(pkgFile);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps['react-native']) throw new InitError('This is not a React Native project (no "react-native" dependency).');
  if (!fs.existsSync(path.join(cwd, 'ios')) || !fs.existsSync(path.join(cwd, 'android'))) {
    throw new InitError('No ios/ and android/ folders found. Only bare React Native projects are supported for now (Expo support comes later).');
  }
  return { pkg, deps };
}

// all template files, relative paths, including dotfiles
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

function init(cwd, opts = {}) {
  const { pkg, deps } = checkProject(cwd);
  const pm = detectPm(cwd, opts.pm);
  const tools = opts.tools || TESTED;
  for (const t of tools) if (!TOOLS[t]) throw new InitError(`Unknown tool "${t}". Choose from: ${Object.keys(TOOLS).join(', ')}.`);

  const values = {
    APP_NAME: pkg.name || path.basename(cwd),
    RN_VERSION: installedVersion(cwd, 'react-native', deps['react-native']),
    REACT_VERSION: installedVersion(cwd, 'react', deps.react),
    TS_VERSION: installedVersion(cwd, 'typescript', deps.typescript),
    NODE_VERSION: (pkg.engines && pkg.engines.node) || `${process.versions.node.split('.')[0]}`,
    PM: pm.name,
    PM_RUN: pm.run,
    IOS_BUNDLE_ID: iosBundleId(cwd),
  };
  const report = { created: [], merged: [], skipped: [] };

  // 1. template files (never overwrite)
  for (const rel of templateFiles()) {
    const src = path.join(TEMPLATE, rel);
    const dest = path.join(cwd, rel);
    const kitText = () => fillPlaceholders(fs.readFileSync(src, 'utf8'), values);

    if (rel === 'AGENTS.md' && fs.existsSync(dest)) {
      const current = fs.readFileSync(dest, 'utf8');
      const section = kitText();
      const next = MARKERS.test(current) ? current.replace(MARKERS, section) : `${current.replace(/\n*$/, '\n\n')}${section}`;
      if (next !== current) { fs.writeFileSync(dest, next); report.merged.push(rel); } else report.skipped.push(rel);
      continue;
    }
    if (rel === 'CLAUDE.md' && fs.existsSync(dest)) {
      const current = fs.readFileSync(dest, 'utf8');
      if (/^@AGENTS\.md\s*$/m.test(current)) report.skipped.push(rel);
      else { fs.writeFileSync(dest, `${current.replace(/\n*$/, '\n\n')}@AGENTS.md\n`); report.merged.push(rel); }
      continue;
    }
    if (fs.existsSync(dest)) { report.skipped.push(rel); continue; }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (rel === 'AGENTS.md' || rel === 'codemagic.yaml') fs.writeFileSync(dest, kitText());
    else fs.copyFileSync(src, dest);
    // npm doesn't always keep the executable bit, and git silently skips non-executable hooks
    const executable = rel.startsWith(`.githooks${path.sep}`) || /\.(sh|js)$/.test(rel) && rel.startsWith(`scripts${path.sep}`);
    fs.chmodSync(dest, executable ? 0o755 : 0o644);
    report.created.push(rel);
  }

  // 2. skills folder links for tools that don't read .agents/skills
  const links = [['.claude/skills', 'claude'], ['.kiro/skills', 'kiro']];
  for (const [link, tool] of links) {
    if (!tools.includes(tool)) continue;
    const dest = path.join(cwd, link);
    if (fs.existsSync(dest) || isLink(dest)) { report.skipped.push(link); continue; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.symlinkSync('../.agents/skills', dest);
    report.created.push(`${link} -> .agents/skills`);
  }

  // 3. .gitignore: keep secrets out of git
  const gi = path.join(cwd, '.gitignore');
  const giText = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  const missing = ['.env', '.env.*', '!.env.example', '.ai/'].filter(l => !giText.split('\n').includes(l));
  if (missing.length) {
    fs.writeFileSync(gi, `${giText.replace(/\n*$/, giText ? '\n' : '')}\n# agentic-mobile-kit: secrets stay out of git; .ai/ holds local evidence (screenshots, logs)\n${missing.join('\n')}\n`);
    report.merged.push('.gitignore');
  }

  // 4. package.json scripts: typecheck, and hooks path on install (never overwrite existing scripts)
  const pkgFile = path.join(cwd, 'package.json');
  const scripts = (pkg.scripts = pkg.scripts || {});
  let pkgChanged = false;
  // only TypeScript projects get typecheck: tsc fails ("no inputs") in JavaScript apps that merely have typescript installed
  const hasTs = git(cwd, 'ls-files', '*.ts', '*.tsx').split('\n').some(f => f && !f.endsWith('.d.ts'));
  if (!scripts.typecheck && deps.typescript && hasTs) { scripts.typecheck = 'tsc --noEmit'; pkgChanged = true; }
  const hooksCmd = 'git config core.hooksPath .githooks || true';
  if (!(scripts.postinstall || '').includes('core.hooksPath')) {
    // parentheses keep the existing script's failure behavior: `a && b || true` would hide a failing `a`
    scripts.postinstall = scripts.postinstall ? `${scripts.postinstall} && (${hooksCmd})` : hooksCmd;
    pkgChanged = true;
  }
  if (pkgChanged) { fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`); report.merged.push('package.json (scripts)'); }

  // 5. activate the git hooks now
  git(cwd, 'config', 'core.hooksPath', '.githooks');

  // 6. tool configs for the chosen tools (permissions, hooks, subagents)
  const rsFile = path.join(cwd, 'rulesync.jsonc');
  const rs = fs.readFileSync(rsFile, 'utf8');
  const targets = tools.flatMap(t => TOOLS[t]);
  fs.writeFileSync(rsFile, rs.replace(/"targets":\s*\[[^\]]*\]/, `"targets": ${JSON.stringify(targets)}`));
  let generated = true;
  let generateError = '';
  if (!opts.skipGenerate) {
    // when init itself runs under npx, npm_config_* variables (e.g. the outer --package) would leak into this npx
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_(config|package|lifecycle)_/i.test(k)));
    const r = spawnSync('npx', ['-y', RULESYNC, 'generate'], { cwd, env, encoding: 'utf8' });
    generated = r.status === 0;
    if (!generated) generateError = `${r.stderr || ''}${r.stdout || ''}`.trim().split('\n').slice(-5).join('\n');
  }

  return { report, values, tools, generated, generateError };
}

function isLink(p) { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } }

function printSummary({ report, values, tools, generated, generateError }, log = console.log) {
  log(`agentic-mobile-kit installed for ${values.APP_NAME} (React Native ${values.RN_VERSION}, ${values.PM}).`);
  log(`Tools: ${tools.join(', ')}${tools.some(t => !TESTED.includes(t)) ? ' (cursor, opencode and kiro are not tested yet)' : ''}`);
  log(`  created: ${report.created.length} files`);
  if (report.merged.length) log(`  merged:  ${report.merged.join(', ')}`);
  if (report.skipped.length) log(`  kept as they were (already existed): ${report.skipped.join(', ')}`);
  if (!generated) log(`  ! could not generate tool configs; run: npx -y ${RULESYNC} generate\n${generateError.replace(/^/gm, '    ')}`);
  log('\nNext steps:');
  log('  1. Fill in docs/ai/product.md, tech.md, structure.md and conventions.md for this app.');
  log('  2. Commit on a branch and open a PR. Add the "large-pr" label (the vendored skills are large).');
  log('  3. Turn on branch protection for main: see docs/branch-protection.md in the kit repo.');
  log('  4. Signed store builds on Codemagic: one-time setup in docs/ai/codemagic.md.');
  if (tools.includes('codex')) log('  5. Codex users: open the project in Codex once and approve its hooks (they stay off until approved).');
}

module.exports = { init, printSummary, InitError, TOOLS };
