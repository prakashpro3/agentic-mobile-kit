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
  assert.strictEqual(setup.code, 1);
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
  assert.strictEqual(named.code, 1);
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
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /no base branch to compare with \(set AMK_BASE\)/);
  assert.strictEqual(check(dir, 'typecheck', { AMK_BASE: 'trunk' }).code, 0, 'AMK_BASE picks it');
});
