// Run: node --test tests/
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { init, InitError } = require('../lib/init');

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const read = (cwd, f) => fs.readFileSync(path.join(cwd, f), 'utf8');

// a minimal bare React Native project in a new git repo
function fakeApp({ files = {}, pkg = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amk-init-'));
  const base = {
    name: 'DemoApp',
    dependencies: { 'react-native': '0.87.1', react: '19.2.3' },
    devDependencies: { typescript: '^6.0.3' },
    scripts: { test: 'jest' },
  };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ ...base, ...pkg }, null, 2));
  for (const d of ['ios', 'android']) { fs.mkdirSync(path.join(dir, d)); fs.writeFileSync(path.join(dir, d, '.keep'), ''); }
  fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
  fs.writeFileSync(path.join(dir, 'App.tsx'), 'export default {};\n');
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text);
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'app');
  return dir;
}
const commitAll = dir => { git(dir, 'add', '-A'); git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'kit'); };

test('fresh install: files, filled AGENTS.md, links, hooks, scripts', () => {
  const dir = fakeApp();
  const { report } = init(dir, { skipGenerate: true });

  const agents = read(dir, 'AGENTS.md');
  assert.doesNotMatch(agents, /\{\{/);
  assert.match(agents, /Bare React Native 0\.87\.1/);
  assert.match(agents, /`yarn lint`/);
  assert.match(read(dir, 'CLAUDE.md'), /@AGENTS\.md/);
  assert.ok(fs.statSync(path.join(dir, '.githooks/pre-commit')).mode & 0o111, 'pre-commit is executable');
  assert.strictEqual(fs.readlinkSync(path.join(dir, '.claude/skills')), '../.agents/skills');
  assert.ok(fs.existsSync(path.join(dir, '.agents/skills/m-feature/SKILL.md')));
  assert.match(read(dir, '.gitignore'), /^\.env$/m);
  assert.match(read(dir, '.gitignore'), /^\.ai\/$/m);
  const pkg = JSON.parse(read(dir, 'package.json'));
  assert.strictEqual(pkg.scripts.typecheck, 'tsc --noEmit');
  assert.match(pkg.scripts.postinstall, /core\.hooksPath \.githooks/);
  assert.strictEqual(pkg.scripts.test, 'jest', 'existing scripts untouched');
  assert.strictEqual(git(dir, 'config', 'core.hooksPath'), '.githooks');
  assert.match(read(dir, 'rulesync.jsonc'), /"targets": \["claudecode","codexcli","antigravity-ide","antigravity-cli"\]/);
  assert.ok(report.created.length > 40);
});

test('running init twice changes nothing the second time', () => {
  const dir = fakeApp();
  init(dir, { skipGenerate: true });
  commitAll(dir);
  const { report } = init(dir, { skipGenerate: true });
  assert.deepStrictEqual(report.created, []);
  assert.deepStrictEqual(report.merged, []);
  assert.strictEqual(git(dir, 'status', '--porcelain'), '');
});

test('merges into an existing AGENTS.md and CLAUDE.md, keeping the team\'s text', () => {
  const dir = fakeApp({ files: { 'AGENTS.md': '# Team notes\nUse the blue theme.\n', 'CLAUDE.md': 'Be brief.\n' } });
  const { report } = init(dir, { skipGenerate: true });
  const agents = read(dir, 'AGENTS.md');
  assert.match(agents, /^# Team notes\nUse the blue theme\./);
  assert.strictEqual((agents.match(/KIT:START/g) || []).length, 1);
  assert.match(read(dir, 'CLAUDE.md'), /^Be brief\.\n\n@AGENTS\.md\n$/);
  assert.ok(report.merged.includes('AGENTS.md') && report.merged.includes('CLAUDE.md'));
});

test('replaces an older kit section instead of adding a second one', () => {
  const old = '# Mine\n\n<!-- KIT:START agentic-mobile-kit -->\nold kit text\n<!-- KIT:END agentic-mobile-kit -->\n\n## After\nkeep me\n';
  const dir = fakeApp({ files: { 'AGENTS.md': old } });
  init(dir, { skipGenerate: true });
  const agents = read(dir, 'AGENTS.md');
  assert.doesNotMatch(agents, /old kit text/);
  assert.strictEqual((agents.match(/KIT:START/g) || []).length, 1);
  assert.match(agents, /## After\nkeep me/);
});

test('only the chosen tools: no Claude link, rulesync targets Codex only', () => {
  const dir = fakeApp();
  init(dir, { skipGenerate: true, tools: ['codex'] });
  assert.ok(!fs.existsSync(path.join(dir, '.claude/skills')));
  assert.match(read(dir, 'rulesync.jsonc'), /"targets": \["codexcli"\]/);
});

test('refuses: uncommitted changes, not React Native, no native folders, unknown tool', () => {
  const dirty = fakeApp();
  fs.writeFileSync(path.join(dirty, 'x.txt'), 'x');
  assert.throws(() => init(dirty, { skipGenerate: true }), e => e instanceof InitError && /uncommitted/.test(e.message));

  const notRn = fakeApp({ pkg: { dependencies: { react: '19.2.3' } } });
  assert.throws(() => init(notRn, { skipGenerate: true }), /not a React Native project/);

  const expo = fakeApp();
  fs.rmSync(path.join(expo, 'ios'), { recursive: true });
  commitAll(expo);
  assert.throws(() => init(expo, { skipGenerate: true }), /Only bare React Native/);

  assert.throws(() => init(fakeApp(), { skipGenerate: true, tools: ['vscode'] }), /Unknown tool/);
});

test('JavaScript projects with typescript installed get no typecheck script', () => {
  const dir = fakeApp();
  fs.unlinkSync(path.join(dir, 'App.tsx'));
  commitAll(dir);
  init(dir, { skipGenerate: true });
  assert.strictEqual(JSON.parse(read(dir, 'package.json')).scripts.typecheck, undefined);
});

test('an existing postinstall keeps failing when it fails (hooks command is grouped)', () => {
  const dir = fakeApp({ pkg: { scripts: { postinstall: 'patch-package' } } });
  init(dir, { skipGenerate: true });
  const post = JSON.parse(read(dir, 'package.json')).scripts.postinstall;
  assert.strictEqual(post, 'patch-package && (git config core.hooksPath .githooks || true)');
  assert.notStrictEqual(require('child_process').spawnSync('sh', ['-c', post.replace('patch-package', 'false')]).status, 0);
});
