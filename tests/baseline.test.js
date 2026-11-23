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

// an app whose main branch already fails: stand-ins for tsc (types.txt lists the errors), Jest (tests.json lists
// failing tests) and ESLint (every line with BAD in a .js file is an error)
function app() {
  const dir = tmpDir('amk-baseline-');
  write(dir, 'package.json', JSON.stringify({ scripts: { lint: 'node lint-all.js', typecheck: 'node tsc.js', test: 'node fake-jest.js' } }));
  write(dir, 'tsc.js', `const e = require('fs').readFileSync('types.txt', 'utf8').trim().split('\\n').filter(Boolean);
e.forEach(l => console.log(l)); process.exit(e.length ? 2 : 0);
`);
  write(dir, 'fake-jest.js', `const fs = require('fs'), path = require('path');
const out = process.argv.find(a => a.startsWith('--outputFile=')).slice(13);
const failing = JSON.parse(fs.readFileSync('tests.json', 'utf8'));
const results = Object.entries(failing).map(([file, tests]) => ({ name: path.resolve(file), status: 'failed', message: tests ? '' : 'Your test suite must contain at least one test.', assertionResults: (tests || []).map(t => ({ fullName: t, status: 'failed' })) }));
fs.writeFileSync(out, JSON.stringify({ testResults: results })); process.exit(results.length ? 1 : 0);
`);
  write(dir, 'lint-all.js', `const fs = require('fs');
const bad = require('child_process').execSync('git ls-files -co --exclude-standard', { encoding: 'utf8' }).split('\\n').filter(f => f.endsWith('.js') && fs.existsSync(f) && /BAD/.test(fs.readFileSync(f, 'utf8')));
process.exit(bad.length ? 1 : 0);
`);
  write(dir, 'node_modules/eslint/package.json', '{"name":"eslint","exports":{"./package.json":"./package.json"}}');
  write(dir, 'node_modules/eslint/bin/eslint.js', `const fs = require('fs'), path = require('path');
const args = process.argv.slice(2).filter(a => a !== '--format' && a !== 'json');
const report = (file, text) => ({ filePath: path.resolve(file), messages: text.split('\\n').filter(l => /BAD/.test(l)).map(l => ({ ruleId: 'no-bad', message: l.trim(), severity: 2 })) });
const i = args.indexOf('--stdin-filename');
const results = i >= 0 ? [report(args[i + 1], fs.readFileSync(0, 'utf8'))] : args.map(f => report(f, fs.readFileSync(f, 'utf8')));
console.log(JSON.stringify(results));
process.exit(results.some(r => r.messages.length) ? 1 : 0);
`);
  write(dir, '.gitignore', 'node_modules/\n');
  fs.mkdirSync(path.join(dir, 'scripts/amk'), { recursive: true });
  fs.copyFileSync(path.join(KIT, 'pm-run.sh'), path.join(dir, 'scripts/amk/pm-run.sh'));
  write(dir, 'types.txt', 'src/old.ts(3,7): error TS2322: Type \'string\' is not assignable to type \'number\'.\n');
  write(dir, 'tests.json', JSON.stringify({ 'src/__tests__/old.test.js': ['Old › still broken'], 'src/__tests__/empty.test.js': null }));
  write(dir, 'src/a.js', 'const x = 1; // BAD old\n');
  git(dir, 'init', '-q', '-b', 'main');
  commit(dir, 'main, already failing');
  git(dir, 'switch', '-q', '-c', 'feature');
  return dir;
}
const temp = tmpDir('amk-baseline-tmp-');
const check = (dir, what, env = {}) => {
  const r = spawnSync(process.execPath, [path.join(KIT, 'baseline.js'), what], { cwd: dir, encoding: 'utf8', env: { ...process.env, TMPDIR: temp, TEMP: temp, TMP: temp, ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

test('a check whose output can\'t be read: the line that says what went wrong, not its last (where a tool asks you to report the crash)', () => {
  const dir = app();
  write(dir, 'types.txt', 'Oops! Something went wrong.\nError: Cannot find module \'typescript\'\nPlease report it in our chat: https://example.invalid/chat\n');
  const r = check(dir, 'typecheck');
  assert.strictEqual(r.code, 3, r.out);
  assert.match(r.out, /\(exit 2: Error: Cannot find module 'typescript'\)/);
});

test('typecheck and tests: failures the base branch already had pass; new ones fail and are listed', () => {
  const dir = app();
  write(dir, 'src/b.ts', 'export const b = 2;\n'); // a change with no new problems; the old error moved down a line
  write(dir, 'types.txt', 'src/old.ts(9,7): error TS2322: Type \'string\' is not assignable to type \'number\'.\n');
  const types = check(dir, 'typecheck');
  assert.strictEqual(types.code, 0, types.out);
  assert.match(types.out, /typecheck: 1 problem\(s\), all already on main \([0-9a-f]{7}\): this change adds none/);
  const tests = check(dir, 'test');
  assert.strictEqual(tests.code, 0, tests.out);
  assert.match(tests.out, /test: 2 problem\(s\), all already on main/);

  write(dir, 'types.txt', 'src/old.ts(9,7): error TS2322: Type \'string\' is not assignable to type \'number\'.\nsrc/b.ts(1,14): error TS2304: Cannot find name \'c\'.\n');
  write(dir, 'tests.json', JSON.stringify({ 'src/__tests__/old.test.js': ['Old › still broken'], 'src/__tests__/empty.test.js': null, 'src/__tests__/b.test.js': ['B › adds'] }));
  const newType = check(dir, 'typecheck');
  assert.strictEqual(newType.code, 1);
  assert.match(newType.out, /typecheck: 1 new compared with main \([0-9a-f]{7}\):\n {2}src\/b\.ts: TS2304 Cannot find name 'c'\./);
  const newTest = check(dir, 'test');
  assert.strictEqual(newTest.code, 1);
  assert.match(newTest.out, /test: 1 new compared with main[^\n]*:\n {2}src\/__tests__\/b\.test\.js › B › adds/);
});

test('lint: old errors in a changed file pass, a new error fails, and a changed ESLint setup is never compared', () => {
  const dir = app();
  write(dir, 'src/a.js', 'const x = 1; // BAD old\nconst y = 2;\n');
  const old = check(dir, 'lint');
  assert.strictEqual(old.code, 0, old.out);
  assert.match(old.out, /lint: failed, but the 1 file\(s\) changed since main [^ ]+ have no new errors/);

  write(dir, 'src/c.js', 'const z = 3; // BAD new\n');
  const fresh = check(dir, 'lint');
  assert.strictEqual(fresh.code, 1);
  assert.match(fresh.out, /lint: 1 new compared with main[^\n]*:\n {2}src\/c\.js: no-bad: const z = 3; \/\/ BAD new/);

  fs.rmSync(path.join(dir, 'src/c.js'));
  write(dir, '.eslintignore', "# agentic-mobile-kit: its scripts follow the kit's style, not this app's lint rules\nscripts/amk/\n");
  assert.strictEqual(check(dir, 'lint').code, 0, 'the kit\'s own .eslintignore lines are no setup change');
  write(dir, '.eslintrc.json', '{}\n');
  const setup = check(dir, 'lint');
  assert.strictEqual(setup.code, 3, 'not compared: 3');
  assert.match(setup.out, /the change edits the ESLint setup/);
});

test('a script the base branch doesn\'t have yet (the kit adds typecheck) runs on the old code all the same', () => {
  const dir = app();
  git(dir, 'switch', '-q', 'main');
  write(dir, 'package.json', JSON.stringify({ scripts: { lint: 'node lint-all.js', test: 'node fake-jest.js' } }));
  commit(dir, 'main without a typecheck script');
  git(dir, 'switch', '-q', '-C', 'feature');
  write(dir, 'package.json', JSON.stringify({ scripts: { lint: 'node lint-all.js', typecheck: 'node tsc.js', test: 'node fake-jest.js' } }));
  const r = check(dir, 'typecheck');
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /all already on main/);
});

test('a default branch left at an old first commit without the app is passed over for the branch that has it', () => {
  // main: a first commit with no package.json; master: the app; work branches from master
  const dir = tmpDir('amk-baseline-stale-');
  write(dir, 'README.md', 'first\n');
  git(dir, 'init', '-q', '-b', 'main');
  commit(dir, 'first');
  git(dir, 'switch', '-q', '-c', 'master');
  const full = app();
  for (const f of git(full, 'ls-files').split('\n')) write(dir, f, fs.readFileSync(path.join(full, f), 'utf8'));
  fs.cpSync(path.join(full, 'node_modules'), path.join(dir, 'node_modules'), { recursive: true });
  commit(dir, 'the app');
  git(dir, 'switch', '-q', '-c', 'feature');
  write(dir, 'src/b.ts', 'export const b = 2;\n');
  const r = check(dir, 'typecheck');
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /typecheck: comparing with master, as main has no package\.json where it meets this branch \(AMK_BASE sets the base\)/);
  assert.match(r.out, /all already on master/);
  // what reviews diff against
  const base = spawnSync(process.execPath, [path.join(KIT, 'baseline.js'), 'base'], { cwd: dir, encoding: 'utf8' });
  assert.strictEqual(base.stdout, 'master\n');
  // named, but without the app: says so, not a stack trace
  const named = check(dir, 'typecheck', { AMK_BASE: 'main' });
  assert.strictEqual(named.code, 3, 'not compared: 3');
  assert.match(named.out, /typecheck: failed, and it can't be compared with main \([0-9a-f]{7}\), which has no package\.json: set AMK_BASE to the branch this work is based on/);
  assert.doesNotMatch(named.out, /ENOENT|at /);
});

test('pre-commit lint (staged): errors a file had at HEAD don\'t block a commit; a new one does', () => {
  const dir = app();
  const staged = (...files) => {
    const r = spawnSync(process.execPath, [path.join(KIT, 'baseline.js'), 'staged', ...files], { cwd: dir, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  write(dir, 'src/a.js', 'const x = 1; // BAD old\nconst y = 2;\n');
  git(dir, 'add', 'src/a.js');
  const old = staged('src/a.js');
  assert.strictEqual(old.code, 0, old.out);
  assert.match(old.out, /lint: the files had all of these errors before this commit, so none is new/);
  write(dir, 'src/a.js', 'const x = 1; // BAD old\nconst y = 2; // BAD new\n');
  git(dir, 'add', 'src/a.js');
  const fresh = staged('src/a.js');
  assert.strictEqual(fresh.code, 1);
  assert.match(fresh.out, /lint: 1 new compared with HEAD:\n {2}src\/a\.js: no-bad: const y = 2; \/\/ BAD new/);
  // a clean file passes at once
  write(dir, 'src/clean.js', 'const z = 3;\n');
  git(dir, 'add', 'src/clean.js');
  assert.strictEqual(staged('src/clean.js').code, 0);
  // no ESLint CLI to compare with: 3, so the hook lints the files as before
  fs.rmSync(path.join(dir, 'node_modules/eslint/bin'), { recursive: true });
  assert.strictEqual(staged('src/a.js').code, 3);
});

test('no base branch to compare with: a failure stays a failure', () => {
  const dir = app();
  git(dir, 'branch', '-q', '-m', 'main', 'trunk');
  const r = check(dir, 'typecheck');
  assert.strictEqual(r.code, 3, 'a failure it can\'t compare: 3, which the pre-push hook names');
  assert.match(r.out, /no base branch to compare with \(set AMK_BASE\)/);
  assert.strictEqual(check(dir, 'typecheck', { AMK_BASE: 'trunk' }).code, 0, 'AMK_BASE picks it');
});

test('git worktrees: another one inside this checkout (.claude/worktrees/) isn\'t this branch\'s; one with no node_modules of its own compares all the same; a comparison it can\'t make says why, with 3', () => {
  const dir = app();
  // a stand-in tsc the app finds in node_modules, as Node does: in its own folder or one above
  write(dir, 'node_modules/faketsc/index.js', fs.readFileSync(path.join(dir, 'tsc.js'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  write(dir, 'package.json', JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, typecheck: 'node -e "require(\'faketsc\')"' } }));
  commit(dir, 'typecheck through node_modules');
  git(dir, 'worktree', 'add', '-q', '.claude/worktrees/rel', '-b', 'rel');
  const wt = path.join(dir, '.claude/worktrees/rel');
  // the main checkout: the other worktree's failures are left out
  write(dir, 'types.txt', `${fs.readFileSync(path.join(dir, 'types.txt'), 'utf8')}.claude/worktrees/rel/src/old.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n`);
  write(dir, 'tests.json', JSON.stringify({ 'src/__tests__/old.test.js': ['Old › still broken'], 'src/__tests__/empty.test.js': null, '.claude/worktrees/rel/src/__tests__/old.test.js': ['Old › still broken'] }));
  for (const what of ['typecheck', 'test']) {
    const r = check(dir, what);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, new RegExp(`${what}: left out 1 in other git worktrees inside this folder \\(\\.claude/worktrees/rel/\\)`));
  }
  // the worktree, with no node_modules: the app's dependencies can't be found, so neither run can be read: why, and 3
  fs.renameSync(path.join(dir, 'node_modules'), path.join(dir, 'nm-away'));
  const none = check(wt, 'typecheck', { AMK_BASE: 'main' });
  assert.strictEqual(none.code, 3, none.out);
  assert.match(none.out, /typecheck: failed, and it can't be compared with main \([0-9a-f]{7}\): this branch's output couldn't be read \(exit 1: .+\)/);

  // installed in the main checkout: found from the worktree, and linked into the base's copy made before they were
  fs.renameSync(path.join(dir, 'nm-away'), path.join(dir, 'node_modules'));
  const r = check(wt, 'typecheck', { AMK_BASE: 'main' });
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /typecheck: 1 problem\(s\), all already on main/);
});

test('typecheck: an old error whose words differ only by a checkout\'s path or an "and N more" count isn\'t new', () => {
  const dir = app();
  git(dir, 'switch', '-q', 'main');
  // a stand-in tsc that writes the folder it runs in, as TypeScript does in an import("…/node_modules/…") type
  write(dir, 'tsc.js', `const e = require('fs').readFileSync('types.txt', 'utf8').trim().split('\\n').filter(Boolean).map(l => l.split('{cwd}').join(process.cwd()));
e.forEach(l => console.log(l)); process.exit(e.length ? 2 : 0);
`);
  const old = n => `src/nav.ts(4,7): error TS2322: Type 'import("{cwd}/node_modules/lib/types").Routes' is not assignable to type 'Props', and ${n} more.\n`;
  write(dir, 'types.txt', old(117));
  commit(dir, 'a typecheck that writes its folder');
  git(dir, 'switch', '-q', '-C', 'feature');
  write(dir, 'src/routes.ts', 'export const more = 1;\n');
  write(dir, 'types.txt', old(118).replace('(4,7)', '(5,7)'));
  const same = check(dir, 'typecheck');
  assert.strictEqual(same.code, 0, same.out);
  assert.match(same.out, /typecheck: 1 problem\(s\), all already on main/);
  write(dir, 'types.txt', `${old(118)}src/routes.ts(1,1): error TS2304: Cannot find name 'c' in import("{cwd}/node_modules/x").\n`);
  const fresh = check(dir, 'typecheck');
  assert.strictEqual(fresh.code, 1, fresh.out);
  assert.match(fresh.out, /typecheck: 1 new compared with main[^\n]*:\n {2}src\/routes\.ts: TS2304 Cannot find name 'c' in import\(".+\/node_modules\/x"\)\./, 'listed as TypeScript wrote it');
});

test('pre-commit lint (staged) in a git worktree inside the main checkout: ESLint gets plugins from the worktree\'s folder; ESLint failing itself is 4, not an error in the files', () => {
  const dir = app();
  write(dir, '.eslintrc.json', '{}\n');
  // a stand-in ESLint 8: run in a folder below another one with a config, it finds a plugin twice and stops, unless
  // told where to get plugins from
  write(dir, 'node_modules/eslint/bin/eslint.js', `const fs = require('fs'), path = require('path');
let args = process.argv.slice(2).filter(a => a !== '--format' && a !== 'json');
const at = args.indexOf('--resolve-plugins-relative-to');
if (process.env.FAKE_CRASH || (process.cwd() !== path.resolve(__dirname, '../../..') && at < 0)) { console.error('ESLint couldn\\'t determine the plugin "@typescript-eslint" uniquely.'); process.exit(2); }
if (at >= 0) args.splice(at, 2);
const report = (file, text) => ({ filePath: path.resolve(file), messages: text.split('\\n').filter(l => /BAD/.test(l)).map(l => ({ ruleId: 'no-bad', message: l.trim(), severity: 2 })) });
const i = args.indexOf('--stdin-filename');
const results = i >= 0 ? [report(args[i + 1], fs.readFileSync(0, 'utf8'))] : args.map(f => report(f, fs.readFileSync(f, 'utf8')));
console.log(JSON.stringify(results));
process.exit(results.some(r => r.messages.length) ? 1 : 0);
`);
  commit(dir, 'an ESLint config');
  git(dir, 'worktree', 'add', '-q', '.claude/worktrees/wt', '-b', 'wt');
  const wt = path.join(dir, '.claude/worktrees/wt');
  write(wt, 'src/a.js', `${fs.readFileSync(path.join(wt, 'src/a.js'), 'utf8')}const y = 2; // BAD new\n`);
  const staged = env => spawnSync(process.execPath, [path.join(KIT, 'baseline.js'), 'staged', 'src/a.js'], { cwd: wt, encoding: 'utf8', env: { ...process.env, ...env } });
  const r = staged();
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /lint: 1 new compared with HEAD:\n {2}src\/a\.js: no-bad: const y = 2; \/\/ BAD new/);
  const crash = staged({ FAKE_CRASH: '1' });
  assert.strictEqual(crash.status, 4, crash.stdout + crash.stderr);
  assert.match(crash.stdout, /lint: ESLint couldn't check the files \(its error is above\)/);
});

test('pushed: deleting a branch, or a branch changing only specs and docs (the plan\'s), needs no checks; code does, and needs dependencies', () => {
  const dir = app();
  const sha = ref => git(dir, 'rev-parse', ref);
  const ZERO = '0'.repeat(40);
  const pushed = (lines, cwd = dir) => spawnSync(process.execPath, [path.join(KIT, 'baseline.js'), 'pushed'], { cwd, input: lines, encoding: 'utf8' }).stdout.trim();
  assert.strictEqual(pushed(`(delete) ${ZERO} refs/heads/old ${sha('main')}\n`), 'skip: only deleting, so no typecheck or tests');
  git(dir, 'switch', '-q', '-c', 'plan');
  write(dir, 'specs/plan.md', '# Plan\n');
  write(dir, 'docs/amk/glossary.md', '# Glossary\n');
  commit(dir, 'docs(plan): a draft');
  assert.strictEqual(pushed(`refs/heads/plan ${sha('plan')} refs/heads/plan ${ZERO}\n`), 'skip: only specs and docs change, so no typecheck or tests', 'a new branch: since it left main');
  const before = sha('plan');
  write(dir, 'src/plan.ts', 'export const p = 1;\n');
  commit(dir, 'code on it');
  assert.strictEqual(pushed(`refs/heads/plan ${sha('plan')} refs/heads/plan ${before}\n`), 'checks', 'since what the remote has');
  fs.renameSync(path.join(dir, 'node_modules'), path.join(dir, 'nm-away'));
  assert.strictEqual(pushed(`refs/heads/plan ${sha('plan')} refs/heads/plan ${before}\n`), 'no-deps');
  fs.renameSync(path.join(dir, 'nm-away'), path.join(dir, 'node_modules'));
  assert.strictEqual(pushed(''), 'checks', 'nothing read: checks');
  // the hook itself: a docs-only push goes through without its checks
  fs.mkdirSync(path.join(dir, '.githooks'), { recursive: true });
  fs.copyFileSync(path.join(KIT, '../../.githooks/pre-push'), path.join(dir, '.githooks/pre-push'));
  fs.copyFileSync(path.join(KIT, 'baseline.js'), path.join(dir, 'scripts/amk/baseline.js'));
  git(dir, 'reset', '-q', '--hard', before);
  const hook = spawnSync('sh', ['.githooks/pre-push', 'origin', 'url'], { cwd: dir, input: `refs/heads/plan ${before} refs/heads/plan ${ZERO}\n`, encoding: 'utf8' });
  assert.strictEqual(hook.status, 0, hook.stderr);
  assert.match(hook.stderr, /^pre-push: only specs and docs change, so no typecheck or tests$/m);
});

test('the pre-commit hook: a git worktree without node_modules lints with its main checkout\'s ESLint; an app without its own ESLint isn\'t linted with one found above it', () => {
  const dir = app();
  write(dir, 'node_modules/.bin/eslint', '#!/bin/sh\nexec node "$(dirname "$0")/../eslint/bin/eslint.js" "$@"\n');
  fs.chmodSync(path.join(dir, 'node_modules/.bin/eslint'), 0o755);
  for (const f of ['baseline.js']) fs.copyFileSync(path.join(KIT, f), path.join(dir, `scripts/amk/${f}`));
  fs.mkdirSync(path.join(dir, '.githooks'), { recursive: true });
  fs.copyFileSync(path.join(KIT, '../../.githooks/pre-commit'), path.join(dir, '.githooks/pre-commit'));
  commit(dir, 'the hook');
  git(dir, 'worktree', 'add', '-q', '.claude/worktrees/wt', '-b', 'wt');
  const wt = path.join(dir, '.claude/worktrees/wt');
  write(wt, 'src/a.js', `${fs.readFileSync(path.join(wt, 'src/a.js'), 'utf8')}const y = 2; // BAD new\n`);
  git(wt, 'add', 'src/a.js');
  const hook = cwd => spawnSync('sh', ['.githooks/pre-commit'], { cwd, encoding: 'utf8', env: { ...process.env, PATH: `/nonexistent:${process.env.PATH}` } });
  const inWt = hook(wt);
  assert.strictEqual(inWt.status, 1, inWt.stdout + inWt.stderr);
  assert.match(inWt.stdout + inWt.stderr, /lint: 1 new compared with HEAD[\s\S]*pre-commit: fix the ESLint errors listed above/);
  // an app with no ESLint of its own, in a folder whose parent has one: not linted, as before
  const outer = tmpDir('amk-baseline-outer-');
  write(outer, 'node_modules/eslint/package.json', '{"name":"eslint","exports":{"./package.json":"./package.json"}}');
  write(outer, 'node_modules/eslint/bin/eslint.js', 'console.error("the folder above\'s ESLint ran"); process.exit(2);\n');
  write(outer, 'node_modules/.bin/eslint', '#!/bin/sh\nexec node "$(dirname "$0")/../eslint/bin/eslint.js" "$@"\n');
  fs.chmodSync(path.join(outer, 'node_modules/.bin/eslint'), 0o755);
  const inner = path.join(outer, 'app');
  fs.cpSync(dir, inner, { recursive: true, filter: f => !/node_modules|\.claude/.test(f) });
  write(inner, 'src/b.js', 'const z = 1; // BAD\n');
  git(inner, 'add', 'src/b.js');
  const alone = hook(inner);
  assert.strictEqual(alone.status, 0, alone.stdout + alone.stderr);
  assert.match(alone.stderr, /ESLint isn't installed, so staged files weren't linted/);
  assert.doesNotMatch(alone.stderr, /the folder above's ESLint ran/);
});

test('a release branch is compared with the last release: a test that broke on main since then is new', () => {
  const dir = app();
  git(dir, 'switch', '-q', 'main');
  git(dir, 'tag', 'v1.0.0');
  write(dir, 'tests.json', JSON.stringify({ 'src/__tests__/old.test.js': ['Old › still broken'], 'src/__tests__/empty.test.js': null, 'src/__tests__/shift.test.js': ['Shift › 90 minutes'] }));
  commit(dir, 'fix: round the hours');
  git(dir, 'switch', '-q', '-c', 'release/v1.1.0');
  const r = check(dir, 'test');
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /test: 1 new compared with v1\.0\.0 \([0-9a-f]{7}\):\n {2}src\/__tests__\/shift\.test\.js › Shift › 90 minutes/);
  assert.strictEqual(check(dir, 'base').out.trim(), 'v1.0.0');
  assert.strictEqual(check(dir, 'test', { AMK_BASE: 'main' }).code, 0, 'AMK_BASE still picks the base');
  // another branch, or a release branch before any release: compared with main, as before
  git(dir, 'switch', '-q', 'feature');
  assert.strictEqual(check(dir, 'base').out.trim(), 'main');
  git(dir, 'switch', '-q', 'release/v1.1.0');
  git(dir, 'tag', '-d', 'v1.0.0');
  assert.strictEqual(check(dir, 'test').code, 0);
});

test('test --related: only the Jest tests related to the files changed since the base, and failures compared as before', () => {
  const dir = app();
  write(dir, 'fake-jest.js', `require('fs').appendFileSync('args.txt', process.argv.slice(2).join(' ') + '\\n');\n${fs.readFileSync(path.join(dir, 'fake-jest.js'), 'utf8')}`);
  const run = (...a) => { const r = spawnSync(process.execPath, [path.join(KIT, 'baseline.js'), 'test', ...a], { cwd: dir, encoding: 'utf8', env: { ...process.env, TMPDIR: temp, TEMP: temp, TMP: temp } }); return { code: r.status, out: `${r.stdout}${r.stderr}` }; };
  const sha = git(dir, 'merge-base', 'HEAD', 'main');
  const related = run('--related');
  assert.strictEqual(related.code, 0, related.out);
  assert.match(related.out, /test: only the tests related to the files changed since [0-9a-f]{7} \(verify\.sh quick without --related runs them all\)/);
  assert.match(related.out, /test: 2 problem\(s\), all already on main/, 'the base\'s failures still pass');
  assert.strictEqual(run().code, 0);
  const calls = fs.readFileSync(path.join(dir, 'args.txt'), 'utf8').trim().split('\n');
  assert.match(calls[0], new RegExp(`^--changedSince=${sha} --json --outputFile=`));
  assert.doesNotMatch(calls[1], /changedSince/, 'without --related, every test');
});
