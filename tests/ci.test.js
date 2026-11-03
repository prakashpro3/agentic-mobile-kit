// Run: node --test tests/*.test.js
// CI by what a change touches (scripts/amk/ci-scope.js and .github/workflows/ci.yml's summary job), and the nightly
// e2e run's issue (report.js --issue)
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const tmpDir = require('./tmp');

const KIT = path.join(__dirname, '../stacks/react-native/template');
const { scope, verdict } = require(path.join(KIT, 'scripts/amk/ci-scope.js'));
const write = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('scope: only specs or docs run neither; code runs the tests and Android; native files add iOS; an unreadable change runs all', () => {
  const s = files => { const r = scope(files); return `${r.code}/${r.native}`; };
  assert.strictEqual(s(['specs/20261103-x/requirements.md', 'docs/amk/product.md', 'README.md', '.github/pull_request_template.md']), 'false/false');
  assert.strictEqual(s(['src/home.tsx', 'docs/amk/product.md']), 'true/false');
  for (const f of ['ios/Podfile', 'android/app/build.gradle', 'package.json', 'yarn.lock', 'app.config.ts', 'app.json', 'plugins/withX.js', 'patches/react-native+0.88.0.patch', '.github/workflows/ci.yml']) {
    assert.strictEqual(s(['src/a.ts', f]), 'true/true', f);
  }
  assert.strictEqual(s(null), 'true/true');
});

test('scope from git: a pull request\'s changes since its base, and a first push that has no base', () => {
  const dir = tmpDir('amk-scope-');
  git(dir, 'init', '-q', '-b', 'main');
  write(dir, 'README.md', 'app\n');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'app');
  git(dir, 'switch', '-qc', 'feature/x');
  write(dir, 'specs/x/requirements.md', '# x\n');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'spec');
  const run = base => spawnSync(process.execPath, [path.join(KIT, 'scripts/amk/ci-scope.js'), base], { cwd: dir, encoding: 'utf8' });
  const docs = run('main');
  assert.strictEqual(docs.stdout, 'code=false\nnative=false\n');
  assert.match(docs.stderr, /scope: only specs or docs \(1 file\(s\)\)/);
  write(dir, 'ios/Podfile', 'x\n');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'pods');
  assert.strictEqual(run('main').stdout, 'code=true\nnative=true\n');
  assert.strictEqual(run('0000000000000000000000000000000000000000').stdout, 'code=true\nnative=true\n', 'a first push: everything');
});

test('the summary job: passes when every job the change calls for passed, and fails on a failure, a cancel or a skip it didn\'t allow', () => {
  const needs = (code, native, results) => ({ scope: { result: 'success', outputs: { code: String(code), native: String(native) } }, basics: { result: 'success' }, ...Object.fromEntries(Object.entries(results).map(([j, r]) => [j, { result: r }])) });
  assert.ok(verdict(needs(false, false, { tests: 'skipped', android: 'skipped', ios: 'skipped' })).ok, 'docs only');
  assert.ok(verdict(needs(true, false, { tests: 'success', android: 'success', ios: 'skipped' })).ok, 'code, no native files');
  assert.ok(verdict(needs(true, true, { tests: 'success', android: 'success', ios: 'success' })).ok);
  assert.deepStrictEqual(verdict(needs(true, false, { tests: 'failure', android: 'success', ios: 'skipped' })).problems, ['tests failed']);
  assert.deepStrictEqual(verdict(needs(true, true, { tests: 'success', android: 'cancelled', ios: 'skipped' })).problems, ['android was cancelled', 'ios was skipped, though this change calls for it']);
  assert.deepStrictEqual(verdict({ ...needs(true, false, { tests: 'skipped', android: 'skipped', ios: 'skipped' }), scope: { result: 'failure', outputs: {} } }).problems.slice(0, 1), ['scope failed']);
  const r = spawnSync(process.execPath, [path.join(KIT, 'scripts/amk/ci-scope.js'), 'verdict'], { encoding: 'utf8', env: { ...process.env, NEEDS: JSON.stringify(needs(true, false, { tests: 'failure', android: 'success', ios: 'skipped' })) } });
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /tests: failure[\s\S]*✗ tests failed/);
});

test('the nightly issue: the flows that failed twice, no paths or device IDs, the run\'s link; and a run that failed before any flow', () => {
  const dir = tmpDir('amk-e2e-');
  write(dir, 'ci/android/.flows', ['home\tpassed\t\t', 'checkout\tfailed\tat step 3 on emulator-5554: Assertion is false: "Paid" is visible (see /Users/dev/app/.amk/x.log)\t',
    'login\tflaky\twhen the keyboard covered the button\t'].join('\n'));
  const text = spawnSync(process.execPath, [path.join(KIT, 'scripts/amk/report.js'), path.join(dir, 'ci'), '--issue-text', 'https://github.com/o/r/actions/runs/9'], { encoding: 'utf8' });
  assert.strictEqual(text.status, 0, text.stderr);
  assert.match(text.stdout, /^Nightly e2e: flows fail\n\n2 of 3 flows passed on 1 screen, 1 flaky\. These failed twice:\n\n- android: checkout, failed at step 3 on <device>: Assertion is false: "Paid" is visible \(see <path>\)\n/);
  assert.doesNotMatch(text.stdout, /- android: login/, 'a flaky flow isn\'t listed');
  assert.match(text.stdout, /The run, with each flow's screenshots and logs as an artifact: https:\/\/github\.com\/o\/r\/actions\/runs\/9/);
  const before = spawnSync(process.execPath, [path.join(KIT, 'scripts/amk/report.js'), path.join(dir, 'missing'), '--issue-text', ''], { encoding: 'utf8' });
  assert.match(before.stdout, /The nightly e2e run failed before any flow ran/);
});
