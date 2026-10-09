#!/usr/bin/env node
// Runs the app's lint, typecheck or test script. When it fails, it compares the problems with the base branch and
// passes if all of them were there already: an app that starts with lint errors or failing tests can still show
// that a change made nothing worse. What counts as new:
//   lint       ESLint errors in the files changed since the base, compared with those files at the base
//   typecheck  TypeScript errors (file, code, message), compared with a type check of the base
//   test       failing Jest tests and test files, compared with a test run of the base
// The base: AMK_BASE, else the remote's default branch, else main or master. Its merge base is checked out once
// into a temporary git worktree that shares node_modules, and its results are kept for the next run.
// Usage: node scripts/ai/baseline.js lint|typecheck|test
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');

const check = process.argv[2];
if (!['lint', 'typecheck', 'test'].includes(check)) {
  console.error('usage: node scripts/ai/baseline.js lint|typecheck|test');
  process.exit(2);
}
const root = process.cwd();
const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 2 ** 28 }).trim();
  } catch {
    return '';
  }
};
const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const jest = check === 'test' && /\bjest\b/.test((pkg.scripts || {}).test || '');
// the real path: on macOS the temp folder is behind a symlink, and test runners report real paths
const scratch = path.join(fs.realpathSync(os.tmpdir()), 'amk-baseline', hash(root));
const slash = p => p.split(path.sep).join('/');
// a minus b, counting duplicates
const minus = (a, b) => {
  const left = [...b];
  return a.filter(x => {
    const i = left.indexOf(x);
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
};

// the package.json script, through pm-run.sh, in dir (the app, or the base's worktree)
function runScript(dir) {
  fs.mkdirSync(scratch, { recursive: true });
  const json = path.join(scratch, `jest-${hash(dir)}.json`);
  fs.rmSync(json, { force: true });
  const r = spawnSync('sh', [path.join(root, 'scripts/ai/pm-run.sh'), check, ...(jest ? ['--json', `--outputFile=${json}`] : [])],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, CI: 'true' }, maxBuffer: 2 ** 28 });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, json, dir };
}

// TypeScript errors without their position, which moves when lines are added above them
function typeErrors(r) {
  const errors = [...r.out.matchAll(/^(\S.*?)\(\d+,\d+\): error (TS\d+): (.*)$/gm)].map(m => `${slash(m[1])}: ${m[2]} ${m[3]}`);
  return errors.length ? errors : null;
}

// failing tests, and test files that fail to run, from Jest's JSON report
function failingTests(r) {
  let report;
  try {
    report = JSON.parse(fs.readFileSync(r.json, 'utf8'));
  } catch {
    return null;
  }
  return report.testResults.flatMap(suite => {
    const file = slash(path.relative(r.dir, suite.name));
    const failed = (suite.assertionResults || []).filter(a => a.status === 'failed').map(a => `${file} › ${a.fullName}`);
    return failed.length || suite.status !== 'failed' ? failed : [`${file} (the file fails to run)`];
  });
}

function baseRef() {
  if (process.env.AMK_BASE) return process.env.AMK_BASE;
  const remoteDefault = git('symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD');
  return [remoteDefault, 'origin/main', 'origin/master', 'main', 'master'].find(r => r && git('rev-parse', '--verify', '--quiet', `${r}^{commit}`));
}

// the base commit, checked out once into a temporary worktree that shares the app's node_modules
function baseWorktree(sha) {
  const dir = path.join(scratch, sha);
  if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
  for (const old of fs.readdirSync(scratch).filter(f => !f.startsWith(sha) && /^[0-9a-f]{40}/.test(f))) {
    git('worktree', 'remove', '--force', path.join(scratch, old));
    fs.rmSync(path.join(scratch, old), { recursive: true, force: true });
  }
  git('worktree', 'prune');
  execFileSync('git', ['worktree', 'add', '--detach', '--force', dir, sha], { cwd: root, stdio: 'ignore' });
  if (fs.existsSync(path.join(root, 'node_modules'))) fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
  return dir;
}

function baseProblems(sha, extract) {
  const cache = path.join(scratch, `${sha}.${check}.json`);
  try {
    return JSON.parse(fs.readFileSync(cache, 'utf8'));
  } catch {}
  const dir = baseWorktree(sha);
  // the same check on the old code: the app's current script, which the base may not have yet (the kit adds typecheck)
  const basePkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if ((basePkg.scripts || {})[check] !== pkg.scripts[check]) {
    basePkg.scripts = { ...basePkg.scripts, [check]: pkg.scripts[check] };
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(basePkg, null, 2));
  }
  const r = runScript(dir);
  const problems = r.code === 0 ? [] : extract(r);
  if (problems) fs.writeFileSync(cache, JSON.stringify(problems));
  return problems;
}

// ESLint errors in the files changed since the base, minus the errors those files had at the base. Errors in
// files the change didn't touch were there before, unless the change edits the ESLint setup itself.
function newLintErrors(sha) {
  const changed = [...new Set([...git('diff', '--name-only', '--diff-filter=ACMR', sha).split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n')])].filter(Boolean);
  // the kit's own .eslintignore lines (for scripts/ai/) don't change how the app's code is checked
  const withoutKit = t => t.split('\n').filter(l => l.trim() !== 'scripts/ai/' && !l.startsWith('# agentic-mobile-kit')).join('\n').trim();
  const setup = changed.filter(f => /(^|\/)(\.eslintrc(\.\w+)?|eslint\.config\.\w+|\.eslintignore)$/.test(f))
    .filter(f => path.basename(f) !== '.eslintignore' || withoutKit(git('show', `${sha}:${f}`)) !== withoutKit(fs.readFileSync(path.join(root, f), 'utf8')));
  if (setup.length) return { reason: `the change edits the ESLint setup (${setup.join(', ')}), so any error could be new` };
  // ESLint 8 and 9 export only package.json, so find the CLI next to it
  let eslint;
  try {
    eslint = path.join(path.dirname(require.resolve('eslint/package.json', { paths: [root] })), 'bin', 'eslint.js');
    if (!fs.existsSync(eslint)) throw new Error('no CLI');
  } catch {
    return { reason: 'ESLint isn\'t installed' };
  }
  const lint = (args, input) => {
    const r = spawnSync(process.execPath, [eslint, '--format', 'json', ...args], { cwd: root, input, encoding: 'utf8', maxBuffer: 2 ** 28 });
    try {
      return JSON.parse(r.stdout);
    } catch {
      return null;
    }
  };
  const errors = results => (results || []).flatMap(f => f.messages.filter(m => m.severity === 2).map(m => `${m.ruleId || 'parsing'}: ${m.message}`));
  const files = changed.filter(f => /\.(js|jsx|ts|tsx)$/.test(f) && !f.startsWith('scripts/ai/') && fs.existsSync(path.join(root, f)));
  const results = files.length ? lint(files) : [];
  if (!results) return { reason: 'ESLint gave no report' };
  const fresh = [];
  for (const result of results) {
    const file = slash(path.relative(root, result.filePath));
    const now = errors([result]);
    if (!now.length) continue;
    let before = [];
    if (git('rev-parse', '--verify', '--quiet', `${sha}:${file}`)) {
      const text = execFileSync('git', ['show', `${sha}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 2 ** 28 });
      before = errors(lint(['--stdin', '--stdin-filename', file], text));
    }
    fresh.push(...minus(now, before).map(p => `${file}: ${p}`));
  }
  return { fresh, files: files.length };
}

const now = runScript(root);
process.stdout.write(now.out);
if (now.code === 0) process.exit(0);

const base = baseRef();
const sha = base && git('merge-base', 'HEAD', base);
if (!sha) {
  console.log(`${check}: failed, and there's no base branch to compare with (set AMK_BASE)`);
  process.exit(1);
}
const label = `${base} (${sha.slice(0, 7)})`;
let fresh;
let summary;
if (check === 'lint') {
  const r = newLintErrors(sha);
  if (r.reason) {
    console.log(`lint: failed, and it can't be compared with ${label}: ${r.reason}`);
    process.exit(1);
  }
  fresh = r.fresh;
  summary = `lint: failed, but the ${r.files} file(s) changed since ${label} have no new errors: the failures were there already`;
} else {
  const extract = check === 'typecheck' ? typeErrors : failingTests;
  const mine = check === 'test' && !jest ? null : extract(now);
  const old = mine && baseProblems(sha, extract);
  if (!mine || !old) {
    console.log(`${check}: failed, and it can't be compared with ${label}: ${check === 'test' && !jest ? 'only Jest results can be compared' : 'its output couldn\'t be read'}`);
    process.exit(1);
  }
  fresh = minus(mine, old);
  summary = `${check}: ${mine.length} problem(s), all already on ${label}: this change adds none`;
}
if (!fresh.length) {
  console.log(summary);
  process.exit(0);
}
console.log(`${check}: ${fresh.length} new compared with ${label}:`);
for (const p of fresh.slice(0, 30)) console.log(`  ${p}`);
if (fresh.length > 30) console.log(`  … and ${fresh.length - 30} more`);
process.exit(1);
