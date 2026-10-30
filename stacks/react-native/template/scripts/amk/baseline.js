#!/usr/bin/env node
// Runs the app's lint, typecheck or test script. When it fails, it compares the problems with the base branch and
// passes if all of them were there already: an app that starts with lint errors or failing tests can still show
// that a change made nothing worse. What counts as new:
//   lint       ESLint errors in the files changed since the base, compared with those files at the base
//   typecheck  TypeScript errors (file, code, message), compared with a type check of the base
//   test       failing Jest tests and test files, compared with a test run of the base
// The base: AMK_BASE, else the first of the remote's default branch, origin/main, origin/master, main and master
// whose merge base with HEAD has a package.json (a default branch left at an old first commit isn't the app's base).
// Its merge base is checked out once into a temporary git worktree that shares node_modules, and its results are kept
// for the next run.
// `test --related` runs only the Jest tests related to the files changed since the base (Jest's --changedSince, which
// follows the imports), for each task while building; the whole suite runs before a pull request.
// `base` prints the base, for reviews of a branch's changes. `staged <files>` is the pre-commit hook's lint: it passes
// when the files have no ESLint error they didn't have at HEAD, and exits with 3 when it can't find ESLint's CLI.
// Usage: node scripts/amk/baseline.js lint|typecheck|test [--related]|base|staged <files>
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');

const check = process.argv[2];
const related = check === 'test' && process.argv.includes('--related');
if (!['lint', 'typecheck', 'test', 'base', 'staged'].includes(check)) {
  console.error('usage: node scripts/amk/baseline.js lint|typecheck|test|base|staged <files>');
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

// the package.json script, through pm-run.sh, in dir (the app, or the base's worktree), with extra arguments for it
function runScript(dir, extra = []) {
  fs.mkdirSync(scratch, { recursive: true });
  const json = path.join(scratch, `jest-${hash(dir)}.json`);
  fs.rmSync(json, { force: true });
  const r = spawnSync('sh', [path.join(root, 'scripts/amk/pm-run.sh'), check, ...extra, ...(jest ? ['--json', `--outputFile=${json}`] : [])],
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

const hasApp = sha => Boolean(sha && git('rev-parse', '--verify', '--quiet', `${sha}:package.json`));
// { ref, note }: the note says when the remote's default branch was passed over
function baseRef() {
  if (process.env.AMK_BASE) return { ref: process.env.AMK_BASE, note: '' };
  const remoteDefault = git('symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD');
  const refs = [...new Set([remoteDefault, 'origin/main', 'origin/master', 'main', 'master'])]
    .filter(r => r && git('rev-parse', '--verify', '--quiet', `${r}^{commit}`));
  const ref = refs.find(r => hasApp(git('merge-base', 'HEAD', r))) || refs[0];
  if (!ref) return null;
  return { ref, note: ref === refs[0] ? '' : `comparing with ${ref}, as ${refs[0]} has no package.json where it meets this branch (AMK_BASE sets the base)` };
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

// the ESLint setup files among changed that differ from sha's: with them, any error could be new. The kit's own
// .eslintignore lines (for scripts/amk/, scripts/ai/ until 0.7.0) don't change how the app's code is checked
function eslintSetupChanges(changed, sha) {
  const withoutKit = t => t.split('\n').filter(l => !/^scripts\/(amk|ai)\/$/.test(l.trim()) && !l.startsWith('# agentic-mobile-kit')).join('\n').trim();
  return changed.filter(f => /(^|\/)(\.eslintrc(\.\w+)?|eslint\.config\.\w+|\.eslintignore)$/.test(f))
    .filter(f => path.basename(f) !== '.eslintignore' || withoutKit(git('show', `${sha}:${f}`)) !== withoutKit(fs.readFileSync(path.join(root, f), 'utf8')));
}

// ESLint 8 and 9 export only package.json, so find the CLI next to it
function eslintCli() {
  try {
    const cli = path.join(path.dirname(require.resolve('eslint/package.json', { paths: [root] })), 'bin', 'eslint.js');
    return fs.existsSync(cli) ? cli : null;
  } catch {
    return null;
  }
}

// ESLint errors in files that they didn't have at sha (null without ESLint's report)
function lintErrorsNotAt(sha, files, eslint) {
  const lint = (args, input) => {
    const r = spawnSync(process.execPath, [eslint, '--format', 'json', ...args], { cwd: root, input, encoding: 'utf8', maxBuffer: 2 ** 28 });
    try {
      return JSON.parse(r.stdout);
    } catch {
      return null;
    }
  };
  const errors = results => (results || []).flatMap(f => f.messages.filter(m => m.severity === 2).map(m => `${m.ruleId || 'parsing'}: ${m.message}`));
  const results = files.length ? lint(files) : [];
  if (!results) return null;
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
  return fresh;
}

// ESLint errors in the files changed since the base, minus the errors those files had at the base. Errors in
// files the change didn't touch were there before, unless the change edits the ESLint setup itself.
function newLintErrors(sha) {
  const changed = [...new Set([...git('diff', '--name-only', '--diff-filter=ACMR', sha).split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n')])].filter(Boolean);
  const setup = eslintSetupChanges(changed, sha);
  if (setup.length) return { reason: `the change edits the ESLint setup (${setup.join(', ')}), so any error could be new` };
  const eslint = eslintCli();
  if (!eslint) return { reason: 'ESLint isn\'t installed' };
  const files = changed.filter(f => /\.(js|jsx|ts|tsx)$/.test(f) && !f.startsWith('scripts/amk/') && fs.existsSync(path.join(root, f)));
  const fresh = lintErrorsNotAt(sha, files, eslint);
  return fresh ? { fresh, files: files.length } : { reason: 'ESLint gave no report' };
}

if (check === 'base') {
  const found = baseRef();
  if (!found) {
    console.error('no base branch found: set AMK_BASE to the branch this work is based on');
    process.exit(1);
  }
  if (found.note) console.error(found.note);
  console.log(found.ref);
  process.exit(0);
}

if (check === 'staged') {
  // ESLint's own report on the files first, then whether any error in them is new since HEAD: a commit that touches
  // a file with errors from before isn't blocked by them, as verify.sh isn't
  const files = process.argv.slice(3);
  if (!files.length) process.exit(0);
  const eslint = eslintCli();
  if (!eslint) process.exit(3); // can't compare: the hook lints the files as they are

  if (spawnSync(process.execPath, [eslint, ...files], { cwd: root, stdio: 'inherit' }).status === 0) process.exit(0);
  if (!git('rev-parse', '--verify', '--quiet', 'HEAD')) process.exit(1); // the first commit: nothing to compare with
  const setup = eslintSetupChanges(git('diff', '--cached', '--name-only', '--diff-filter=ACMR').split('\n').filter(Boolean), 'HEAD');
  if (setup.length) {
    console.log(`lint: the commit edits the ESLint setup (${setup.join(', ')}), so any of these errors could be new`);
    process.exit(1);
  }
  const fresh = lintErrorsNotAt('HEAD', files, eslint);
  if (!fresh) process.exit(1);
  if (!fresh.length) {
    console.log('lint: the files had all of these errors before this commit, so none is new');
    process.exit(0);
  }
  console.log(`lint: ${fresh.length} new compared with HEAD:`);
  for (const p of fresh.slice(0, 30)) console.log(`  ${p}`);
  if (fresh.length > 30) console.log(`  … and ${fresh.length - 30} more`);
  process.exit(1);
}

// --related: the tests of the files changed since where this branch left the base (the whole suite without one)
const since = related && jest && (() => { const f = baseRef(); return f && git('merge-base', 'HEAD', f.ref); })();
const now = runScript(root, since ? [`--changedSince=${since}`] : []);
process.stdout.write(now.out);
if (related) console.log(since ? `test: only the tests related to the files changed since ${since.slice(0, 7)} (verify.sh quick without --related runs them all)`
  : `test: every test ran, as ${jest ? 'there\'s no base branch to compare with' : 'the test script isn\'t Jest'}`);
if (now.code === 0) process.exit(0);

const found = baseRef();
const sha = found && git('merge-base', 'HEAD', found.ref);
if (!sha) {
  console.log(`${check}: failed, and there's no base branch to compare with (set AMK_BASE)`);
  process.exit(1);
}
const label = `${found.ref} (${sha.slice(0, 7)})`;
if (found.note) console.log(`${check}: ${found.note}`);
if (!hasApp(sha)) {
  console.log(`${check}: failed, and it can't be compared with ${label}, which has no package.json: set AMK_BASE to the branch this work is based on`);
  process.exit(1);
}
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
