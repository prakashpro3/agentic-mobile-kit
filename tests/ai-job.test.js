// Run: node --test tests/*.test.js
// The AI jobs in CI (scripts/amk/ai-job.js): who may start one, the loop guard, pausing after three failures in a row,
// and init installing their workflows only when asked for (--ci github,ai)
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const tmpDir = require('./tmp');

const KIT = path.join(__dirname, '../stacks/react-native/template');
const job = require(path.join(KIT, 'scripts/amk/ai-job.js'));

// gh as the test plays it, by the start of the command; calls kept
function ctx(event, answers = {}, extra = {}) {
  const calls = [];
  const gh = args => {
    const line = args.join(' ');
    calls.push(line);
    const k = Object.keys(answers).find(p => line.startsWith(p));
    const v = k ? answers[k] : undefined;
    return typeof v === 'function' ? v(args) : v === undefined ? null : v;
  };
  return { c: { event, gh, env: { GITHUB_RUN_ID: '100' }, repo: 'o/r', workflow: 'amk-ai-review.yml', now: Date.UTC(2026, 10, 3, 12), settings: true, ...extra }, calls };
}
const prEvent = (login, msg) => ({ sender: { login }, pull_request: { head: { ref: 'feature/a', sha: 'abc' } }, _msg: msg });
const base = (extra = {}) => ({ 'issue list': [], 'run list': [], 'api repos/o/r/commits': ['feat: a'], 'api repos/o/r/collaborators/ana/permission': 'write', ...extra });

test('gate: a person with write access starts the review; not a reader, a bot, an AI fix commit, a paused job, or unreadable settings', () => {
  assert.deepStrictEqual(job.gate('review', ctx(prEvent('ana'), base()).c), { go: true, why: 'started by ana on feature/a' });
  assert.match(job.gate('review', ctx(prEvent('bo'), base({ 'api repos/o/r/collaborators/bo/permission': 'read' })).c).why, /bo doesn't have write access/);
  assert.match(job.gate('review', ctx(prEvent('dependabot[bot]'), base()).c).why, /started by dependabot\[bot\], a bot/);
  assert.match(job.gate('review', ctx(prEvent('the-ai-app[bot]'), base()).c).why, /a bot/);
  assert.match(job.gate('review', ctx(prEvent('ana'), base({ 'api repos/o/r/commits': ['fix: types\n\nAMK-Agent-Fix: deps (CI run 9)'] })).c).why, /the latest commit is an AI job's fix/);
  assert.match(job.gate('review', ctx(prEvent('ana'), base({ 'issue list': [{ title: 'AI job paused: review' }] })).c).why, /paused: close the issue "AI job paused: review"/);
  assert.match(job.gate('review', ctx(prEvent('ana'), base(), { settings: false }).c).why, /can't be read, so the job does nothing/);
  assert.match(job.gate('review', ctx(prEvent('ana'), { ...base(), 'issue list': null }).c).why, /its state can't be read/);
});

test('gate: the dependency job runs for Dependabot or Renovate, once per failed CI run, and stops after three fixes in a row or six runs in an hour', () => {
  const run = (login, id = 55) => ({ workflow_run: { id, head_branch: 'dependabot/npm/x', head_sha: 'def', triggering_actor: { login }, head_repository: { full_name: 'o/r' } } });
  const fix = n => `fix: build\n\nAMK-Agent-Fix: deps (CI run ${n})`;
  assert.strictEqual(job.gate('deps', ctx(run('dependabot[bot]'), base()).c).go, true);
  assert.strictEqual(job.gate('deps', ctx(run('renovate[bot]'), base()).c).go, true);
  assert.match(job.gate('deps', ctx(run('ana'), base()).c).why, /not a dependency update/);
  assert.match(job.gate('deps', ctx({ workflow_run: { ...run('dependabot[bot]').workflow_run, head_repository: { full_name: 'fork/r' } } }, base()).c).why, /another repository/);
  assert.match(job.gate('deps', ctx(run('dependabot[bot]', 55), base({ 'api repos/o/r/commits': [fix(55), 'chore(deps): bump x'] })).c).why, /CI run 55 was fixed once already/);
  assert.strictEqual(job.gate('deps', ctx(run('dependabot[bot]', 56), base({ 'api repos/o/r/commits': [fix(54), fix(55), 'chore(deps): bump x'] })).c).go, true, 'two in a row: one more');
  assert.match(job.gate('deps', ctx(run('dependabot[bot]', 57), base({ 'api repos/o/r/commits': [fix(54), fix(55), fix(56), 'bump'] })).c).why, /3 of its fix commits in a row on dependabot\/npm\/x/);
  const busy = ctx(run('dependabot[bot]'), base({ 'run list': Array.from({ length: 7 }, (_, i) => ({ databaseId: i })) }));
  assert.match(job.gate('deps', busy.c).why, /7 runs in the last hour: it waits/);
  assert.ok(busy.calls.some(l => l.includes('--created >=2026-11-03T11:00:00.000Z')), 'the last hour');
});

test('after: the third failure in a row pauses the job with an issue; a success between, or runs that didn\'t go, don\'t count', () => {
  const runs = conclusions => ({
    'run list': conclusions.map((_, i) => ({ databaseId: 200 + i })),
    'run view': args => ({ jobs: [{ name: 'review', conclusion: conclusions[Number(args[2]) - 200] }] }),
  });
  const paused = ctx({}, runs(['failure', 'skipped', 'timed_out']));
  assert.deepStrictEqual(job.after('review', 'failure', paused.c), { paused: true });
  assert.ok(paused.calls.some(l => l.startsWith('issue create --repo o/r --title AI job paused: review')));
  const between = ctx({}, runs(['failure', 'success', 'failure']));
  assert.deepStrictEqual(job.after('review', 'failure', between.c), { paused: false });
  assert.ok(!between.calls.some(l => l.startsWith('issue create')));
  const ok = ctx({}, runs(['failure', 'failure']));
  assert.deepStrictEqual(job.after('review', 'success', ok.c), { paused: false }, 'a success never pauses');
  assert.deepStrictEqual(job.after('review', 'cancelled', ctx({}, runs(['cancelled', 'failure'])).c), { paused: true }, 'a cancel counts');
});

test('init installs the AI jobs\' workflows only with --ci github,ai, and refuses ai without github', () => {
  const { init } = require('../lib/init');
  const app = () => {
    const dir = tmpDir('amk-ai-init-');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: { react: '19.2.3', 'react-native': '0.87.1' } }));
    fs.mkdirSync(path.join(dir, 'ios'));
    fs.mkdirSync(path.join(dir, 'android'));
    const git = (...a) => require('child_process').execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    git('init', '-q');
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'app');
    return dir;
  };
  const plain = app();
  init(plain, { ci: ['github'], skipGenerate: true });
  assert.ok(fs.existsSync(path.join(plain, '.github/workflows/ci.yml')) && fs.existsSync(path.join(plain, '.github/workflows/amk-ready.yml')));
  assert.ok(!fs.existsSync(path.join(plain, '.github/workflows/amk-ai-review.yml')), 'not without ai');
  assert.match(fs.readFileSync(path.join(plain, '.github/workflows/amk-kit-update.yml'), 'utf8'), /npx -y agentic-mobile-kit@latest sync[\s\S]*permissions:\n      contents: write/, 'the weekly kit update, its write rights in the job that runs nothing from npm');
  const ai = app();
  init(ai, { ci: ['github', 'ai'], skipGenerate: true });
  for (const f of ['amk-ai-review.yml', 'amk-ai-deps.yml']) assert.ok(fs.existsSync(path.join(ai, '.github/workflows', f)), f);
  assert.match(fs.readFileSync(path.join(ai, '.github/workflows/amk-ai-deps.yml'), 'utf8'), /allowed_bots: "dependabot\[bot\],renovate\[bot\]"/, 'the action turns away a bot\'s run unless it\'s named');
  assert.match(fs.readFileSync(path.join(ai, 'AGENTS.md'), 'utf8'), /ci=ai,github/);
  assert.throws(() => init(app(), { ci: ['ai'], skipGenerate: true }), /The AI jobs run on GitHub Actions: choose both, --ci github,ai/);
});
