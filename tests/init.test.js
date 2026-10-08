// Run: node --test tests/
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { init, sync, uninstall, InitError, KIT_VERSION } = require('../lib/init');
const tmpDir = require('./tmp');

const TEMPLATE = path.join(__dirname, '../stacks/react-native/template');

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const read = (cwd, f) => fs.readFileSync(path.join(cwd, f), 'utf8');

// a minimal bare React Native project in a new git repo
function fakeApp({ files = {}, pkg = {} } = {}) {
  const dir = tmpDir('amk-init-');
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
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'app');
  return dir;
}
const commitAll = dir => { git(dir, 'add', '-A'); git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'kit'); };

test('fresh install: files, filled AGENTS.md, links, hooks, scripts; no CI unless asked', () => {
  const dir = fakeApp();
  const { report } = init(dir, { skipGenerate: true });

  const agents = read(dir, 'AGENTS.md');
  assert.doesNotMatch(agents, /\{\{/);
  assert.match(agents, /Bare React Native 0\.87\.1/);
  assert.match(agents, /`yarn lint`/);
  assert.match(read(dir, 'CLAUDE.md'), /@AGENTS\.md/);
  assert.match(agents, new RegExp(`KIT:START agentic-mobile-kit ${KIT_VERSION.replace(/\./g, '\\.')} ci=none `));
  assert.ok(!fs.existsSync(path.join(dir, '.github')) && !fs.existsSync(path.join(dir, 'codemagic.yaml')), 'no CI files');
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

test('--ci github,codemagic adds the CI files, fills codemagic.yaml, and later runs keep the choice', () => {
  const dir = fakeApp({ files: { 'ios/DemoApp.xcodeproj/project.pbxproj': 'PRODUCT_BUNDLE_IDENTIFIER = "org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)";\n' } });
  init(dir, { ci: ['github', 'codemagic'], skipGenerate: true });
  assert.ok(fs.existsSync(path.join(dir, '.github/workflows/ci.yml')) && fs.existsSync(path.join(dir, 'docs/ai/codemagic.md')));
  assert.match(read(dir, 'codemagic.yaml'), /bundle_identifier: org\.reactjs\.native\.example\.DemoApp\n/);
  assert.match(read(dir, 'AGENTS.md'), / ci=github,codemagic /);
  commitAll(dir);
  init(dir, { skipGenerate: true });
  assert.match(read(dir, 'AGENTS.md'), / ci=github,codemagic /, 'a second init without --ci keeps the CI choice');
  assert.throws(() => init(fakeApp(), { ci: ['jenkins'], skipGenerate: true }), /Unknown CI "jenkins"/);
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

// an older kit: today's template with a few differences, as if those files changed between versions
function oldKit() {
  const dir = tmpDir('amk-oldkit-');
  fs.cpSync(TEMPLATE, dir, { recursive: true });
  const edit = (f, change) => fs.writeFileSync(path.join(dir, f), change(fs.readFileSync(path.join(dir, f), 'utf8')));
  edit('scripts/ai/pm-run.sh', t => `${t}# old line\n`);
  edit('.github/workflows/ci.yml', t => t.replace('name: ci\n', 'name: old ci\n'));
  edit('cliff.toml', t => t.replace('header = "# Changelog\\n"', 'header = "# Old\\n"'));
  edit('docs/ai/product.md', t => `${t}Old prompt.\n`);
  edit('AGENTS.md', t => t.replace('## Rules', '## Old rules'));
  fs.unlinkSync(path.join(dir, 'scripts/ai/set-version.sh'));
  fs.writeFileSync(path.join(dir, 'scripts/ai/retired.sh'), 'echo old\n');
  return dir;
}

test('sync: updates untouched kit files, merges the team\'s changes, flags conflicts, leaves filled-in docs alone', () => {
  const old = oldKit();
  const dir = fakeApp({ files: { 'AGENTS.md': '# Team notes\n' } });
  init(dir, { template: old, ci: ['github'], skipGenerate: true });
  commitAll(dir);
  // the team's own edits after installing
  fs.appendFileSync(path.join(dir, '.github/workflows/ci.yml'), '      - run: echo team step\n');
  fs.writeFileSync(path.join(dir, 'cliff.toml'), read(dir, 'cliff.toml').replace('header = "# Old\\n"', 'header = "# Team\\n"'));
  fs.writeFileSync(path.join(dir, 'docs/ai/product.md'), 'This app books meeting rooms.\n');
  fs.appendFileSync(path.join(dir, '.gitleaks.toml'), '# team addition\n');
  commitAll(dir);

  const { report } = sync(dir, { fromDir: old, skipGenerate: true });
  const kit = f => fs.readFileSync(path.join(TEMPLATE, f), 'utf8');

  assert.strictEqual(read(dir, 'scripts/ai/pm-run.sh'), kit('scripts/ai/pm-run.sh'));
  assert.ok(report.updated.includes('scripts/ai/pm-run.sh'));
  const ci = read(dir, '.github/workflows/ci.yml');
  assert.match(ci, /^name: ci$/m, 'kit change applied');
  assert.match(ci, /echo team step/, 'team change kept');
  assert.ok(report.merged.includes('.github/workflows/ci.yml'));
  assert.match(read(dir, 'cliff.toml'), new RegExp(`<<<<<<< your version[\\s\\S]*# Team[\\s\\S]*>>>>>>> kit ${KIT_VERSION.replace(/\./g, '\\.')}`));
  assert.ok(report.conflicts.includes('cliff.toml'));
  assert.ok(fs.statSync(path.join(dir, 'scripts/ai/set-version.sh')).mode & 0o111, 'new file added, executable');
  assert.ok(report.added.includes('scripts/ai/set-version.sh'));
  assert.ok(!fs.existsSync(path.join(dir, 'scripts/ai/retired.sh')), 'dropped file removed');
  assert.strictEqual(read(dir, 'docs/ai/product.md'), 'This app books meeting rooms.\n');
  assert.ok(!Object.values(report).flat().includes('.gitleaks.toml'), 'a file only the team changed is left out of the report');
  const agents = read(dir, 'AGENTS.md');
  assert.match(agents, /^# Team notes\n/);
  assert.match(agents, /^## Rules$/m);
  assert.doesNotMatch(agents, /Old rules/);
  assert.match(agents, new RegExp(`KIT:START agentic-mobile-kit ${KIT_VERSION.replace(/\./g, '\\.')} `));
});

test('sync right after init changes nothing', () => {
  const dir = fakeApp();
  init(dir, { skipGenerate: true });
  commitAll(dir);
  const { report } = sync(dir, { skipGenerate: true });
  assert.ok(Object.values(report).every(a => a.length === 0), JSON.stringify(report));
  assert.strictEqual(git(dir, 'status', '--porcelain'), '');
});

test('sync needs the kit installed, and the installed version for kits before 0.4.0', () => {
  assert.throws(() => sync(fakeApp(), { skipGenerate: true }), /Run init instead/);
  const before040 = '<!-- KIT:START agentic-mobile-kit (edit outside these markers; the kit updates what\'s inside) -->\nold\n<!-- KIT:END agentic-mobile-kit -->\n';
  assert.throws(() => sync(fakeApp({ files: { 'AGENTS.md': before040 } }), { skipGenerate: true }), /--from/);
  const fromTheFuture = before040.replace('agentic-mobile-kit (', 'agentic-mobile-kit 99.0.0 (');
  assert.throws(() => sync(fakeApp({ files: { 'AGENTS.md': fromTheFuture } }), { skipGenerate: true }), /newer than this one/);
});

test('uninstall: removes the kit and its sections, keeps changed files and the team\'s own content', () => {
  const dir = fakeApp({ files: { 'AGENTS.md': '# Team notes\n', 'CLAUDE.md': 'Be brief.\n' } });
  init(dir, { ci: ['github', 'codemagic'], skipGenerate: true });
  commitAll(dir);
  fs.appendFileSync(path.join(dir, '.github/workflows/ci.yml'), '# team change\n');
  commitAll(dir);

  const { report } = uninstall(dir, { skipGenerate: true });
  assert.strictEqual(read(dir, 'AGENTS.md'), '# Team notes\n');
  assert.strictEqual(read(dir, 'CLAUDE.md'), 'Be brief.\n');
  assert.ok(report.kept.includes('.github/workflows/ci.yml') && fs.existsSync(path.join(dir, '.github/workflows/ci.yml')));
  for (const gone of ['scripts', '.githooks', '.agents', '.rulesync', 'specs', 'docs', '.claude', 'rulesync.jsonc', 'codemagic.yaml', '.github/workflows/e2e.yml']) {
    assert.ok(!fs.existsSync(path.join(dir, gone)), `${gone} removed`);
  }
  const pkg = JSON.parse(read(dir, 'package.json'));
  assert.strictEqual(pkg.scripts.postinstall, undefined);
  assert.strictEqual(pkg.scripts.test, 'jest');
  assert.throws(() => git(dir, 'config', 'core.hooksPath'), 'hooks path unset');
  assert.ok(fs.existsSync(path.join(dir, 'App.tsx')));
  assert.match(read(dir, '.gitignore'), /^\.env$/m, '.gitignore left alone');
});

test('sync with --from (no recorded version): a file matching neither kit version gets conflict markers, not a silent merge', () => {
  const old = oldKit();
  const dir = fakeApp();
  init(dir, { template: old, ci: ['github'], skipGenerate: true });
  // installed from an even older kit than --from says: this file predates the "old" kit
  fs.writeFileSync(path.join(dir, '.github/workflows/ci.yml'), read(dir, '.github/workflows/ci.yml').replace('name: old ci\n', 'name: older ci\n'));
  commitAll(dir);
  const { report } = sync(dir, { fromDir: old, from: '0.2.0', skipGenerate: true });
  assert.match(read(dir, '.github/workflows/ci.yml'), /<<<<<<< your version\nname: older ci\n=======\nname: ci\n>>>>>>> kit /);
  assert.ok(report.conflicts.includes('.github/workflows/ci.yml'));
  assert.ok(report.updated.includes('scripts/ai/pm-run.sh'), 'files matching the old kit still update');
});

test('sync adds CI files only to projects that chose that CI, or when asked with --ci', () => {
  const old = oldKit();
  fs.unlinkSync(path.join(old, '.github/workflows/ios.yml'));
  fs.unlinkSync(path.join(old, 'docs/ai/codemagic.md'));
  const none = fakeApp();
  init(none, { template: old, skipGenerate: true });
  commitAll(none);
  sync(none, { fromDir: old, skipGenerate: true });
  assert.ok(!fs.existsSync(path.join(none, '.github')) && !fs.existsSync(path.join(none, 'docs/ai/codemagic.md')));

  const github = fakeApp();
  init(github, { template: old, ci: ['github'], skipGenerate: true });
  commitAll(github);
  const { report } = sync(github, { fromDir: old, skipGenerate: true });
  assert.ok(report.added.includes('.github/workflows/ios.yml'), 'new CI file for a GitHub CI project');
  assert.ok(!fs.existsSync(path.join(github, 'docs/ai/codemagic.md')), 'no Codemagic files');
  git(github, 'checkout', '-q', '.');
  git(github, 'clean', '-qfd');
  sync(github, { fromDir: old, ci: ['codemagic'], skipGenerate: true });
  assert.ok(fs.existsSync(path.join(github, 'codemagic.yaml')), '--ci adds Codemagic later');
});

test('another framework\'s .claude/skills folder: kit skills are linked into it, and uninstall removes only those', () => {
  const dir = fakeApp({ files: { '.claude/skills/brainstorming/SKILL.md': '---\nname: brainstorming\n---\nTheirs.\n' } });
  const { report } = init(dir, { skipGenerate: true });
  assert.ok(!fs.lstatSync(path.join(dir, '.claude/skills')).isSymbolicLink(), 'their folder stays a folder');
  assert.strictEqual(fs.readlinkSync(path.join(dir, '.claude/skills/m-feature')), '../../.agents/skills/m-feature');
  assert.match(read(dir, '.claude/skills/m-feature/SKILL.md'), /name: m-feature/);
  assert.strictEqual(read(dir, '.claude/skills/brainstorming/SKILL.md'), '---\nname: brainstorming\n---\nTheirs.\n');
  assert.ok(report.created.includes('.claude/skills/m-release -> .agents/skills/m-release'));
  commitAll(dir);

  uninstall(dir, { skipGenerate: true });
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, '.claude/skills')), ['brainstorming']);
});
