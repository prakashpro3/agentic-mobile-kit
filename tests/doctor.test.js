// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { init } = require('../lib/init');
const { projectChecks } = require('../lib/doctor');
const tmpDir = require('./tmp');

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

function installedApp() {
  const dir = tmpDir('amk-doctor-');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'DemoApp', dependencies: { 'react-native': '0.87.1', react: '19.2.3' } }));
  for (const d of ['ios', 'android']) { fs.mkdirSync(path.join(dir, d)); fs.writeFileSync(path.join(dir, d, '.keep'), ''); }
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'app');
  return dir;
}
const levelOf = (checks, re) => (checks.find(c => re.test(c.label)) || {}).level;

test('reports a missing kit', () => {
  const dir = installedApp();
  const checks = projectChecks(dir, { skipNetwork: true });
  assert.strictEqual(levelOf(checks, /Kit installed/), 'fail');
});

test('a fresh install is healthy apart from unfilled docs', () => {
  const dir = installedApp();
  init(dir, { skipGenerate: true });
  const checks = projectChecks(dir, { skipNetwork: true });
  assert.strictEqual(levelOf(checks, /Kit installed/), 'ok');
  assert.strictEqual(levelOf(checks, /Git hooks/), 'ok');
  assert.strictEqual(levelOf(checks, /AGENTS\.md size/), 'ok');
  assert.strictEqual(levelOf(checks, /No \.env/), 'ok');
  assert.strictEqual(levelOf(checks, /skills link/), undefined, 'no Claude settings yet (generate skipped), so no link check');
  assert.strictEqual(levelOf(checks, /docs\/amk not filled/), 'warn');
});

test('finds inactive hooks, a tracked .env, an oversized AGENTS.md and a broken skills link', () => {
  const dir = installedApp();
  init(dir, { skipGenerate: true });
  git(dir, 'config', '--unset', 'core.hooksPath');
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=x');
  git(dir, 'add', '-f', '.env');
  fs.appendFileSync(path.join(dir, 'AGENTS.md'), 'x\n'.repeat(200));
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude/settings.json'), '{}');
  fs.unlinkSync(path.join(dir, '.claude/skills'));
  const checks = projectChecks(dir, { skipNetwork: true });
  assert.strictEqual(levelOf(checks, /Git hooks/), 'fail');
  assert.strictEqual(levelOf(checks, /Secret files tracked/), 'fail');
  assert.strictEqual(levelOf(checks, /AGENTS\.md is/), 'warn');
  assert.strictEqual(levelOf(checks, /skills link/), 'fail');
});

test('filled-in docs stop the warning', () => {
  const dir = installedApp();
  init(dir, { skipGenerate: true });
  for (const n of ['product', 'tech', 'structure', 'conventions']) fs.appendFileSync(path.join(dir, `docs/amk/${n}.md`), '\nReal content.\n');
  assert.strictEqual(levelOf(projectChecks(dir, { skipNetwork: true }), /docs\/amk/), 'ok');
});

test('with husky, the hooks check reads husky\'s files and whether husky is set up on this clone', () => {
  const dir = installedApp();
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ ...pkg, devDependencies: { husky: '^9.1.7' } }));
  fs.mkdirSync(path.join(dir, '.husky'));
  fs.writeFileSync(path.join(dir, '.husky/pre-commit'), 'npx lint-staged\n');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'husky');
  init(dir, { skipGenerate: true });
  const hooks = () => projectChecks(dir, { skipNetwork: true }).find(c => /husky|Git hooks/.test(c.label));
  assert.match(hooks().label, /husky isn't set up on this clone/);
  // what husky's install does
  fs.mkdirSync(path.join(dir, '.husky/_'));
  fs.writeFileSync(path.join(dir, '.husky/_/pre-commit'), '');
  git(dir, 'config', 'core.hooksPath', '.husky/_');
  assert.deepStrictEqual([hooks().level, hooks().detail], ['ok', 'the kit\'s checks run from husky']);
  fs.writeFileSync(path.join(dir, '.husky/pre-commit'), 'npx lint-staged\n');
  assert.match(hooks().label, /The kit's checks aren't in your husky hooks/);
});

test('reports files renamed only in letter case, which git missed', () => {
  const dir = installedApp();
  init(dir, { skipGenerate: true });
  assert.strictEqual(levelOf(projectChecks(dir, { skipNetwork: true }), /File names match git/), 'ok');
  fs.renameSync(path.join(dir, 'package.json'), path.join(dir, 'Package.json'));
  const c = projectChecks(dir, { skipNetwork: true }).find(x => /letter case/.test(x.label));
  assert.strictEqual(c.level, 'fail');
  assert.match(c.label, /package\.json {2}\(on disk: Package\.json\)/);
  assert.match(c.fix, /git mv/);
});

test('example env files (.env.local.example, .env.sample) aren\'t reported as secrets, and the hook lets them be committed', () => {
  const dir = installedApp();
  init(dir, { skipGenerate: true });
  fs.mkdirSync(path.join(dir, '.maestro'), { recursive: true });
  for (const f of ['.maestro/.env.local.example', '.env.sample', '.env.template']) fs.writeFileSync(path.join(dir, f), 'API_URL=\n');
  git(dir, 'add', '-f', '.maestro/.env.local.example', '.env.sample', '.env.template');
  assert.strictEqual(levelOf(projectChecks(dir, { skipNetwork: true }), /No \.env files in git/), 'ok');
  const hook = require('child_process').spawnSync('sh', ['.githooks/pre-commit'], { cwd: dir, encoding: 'utf8' });
  assert.doesNotMatch(hook.stderr, /don't commit \.env files/);
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^!\.env\*\.example$/m);
});

test('an install from before 0.7.0 is told to update, and its docs are still checked', () => {
  const dir = installedApp();
  init(dir, { skipGenerate: true });
  fs.renameSync(path.join(dir, 'docs/amk'), path.join(dir, 'docs/ai'));
  fs.renameSync(path.join(dir, 'scripts/amk'), path.join(dir, 'scripts/ai'));
  const checks = projectChecks(dir, { skipNetwork: true });
  assert.strictEqual(levelOf(checks, /old names/), 'warn');
  assert.strictEqual(levelOf(checks, /docs\/ai not filled/), 'warn');
});
