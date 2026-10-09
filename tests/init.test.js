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
  if (process.platform === 'win32') assert.match(git(dir, 'ls-files', '-s', '.githooks/pre-commit'), /^100755 /, 'staged as executable');
  else assert.ok(fs.statSync(path.join(dir, '.githooks/pre-commit')).mode & 0o111, 'pre-commit is executable');
  assert.strictEqual(fs.readlinkSync(path.join(dir, '.claude/skills')).replace(/\\/g, '/'), '../.agents/skills');
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
  assert.ok(fs.existsSync(path.join(dir, 'scripts/ai/set-version.sh')), 'new file added');
  if (process.platform !== 'win32') assert.ok(fs.statSync(path.join(dir, 'scripts/ai/set-version.sh')).mode & 0o111, 'and executable');
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
  assert.strictEqual(fs.readlinkSync(path.join(dir, '.claude/skills/m-feature')).replace(/\\/g, '/'), '../../.agents/skills/m-feature');
  assert.match(read(dir, '.claude/skills/m-feature/SKILL.md'), /name: m-feature/);
  assert.strictEqual(read(dir, '.claude/skills/brainstorming/SKILL.md'), '---\nname: brainstorming\n---\nTheirs.\n');
  assert.ok(report.created.includes('.claude/skills/m-release -> .agents/skills/m-release'));
  commitAll(dir);

  uninstall(dir, { skipGenerate: true });
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, '.claude/skills')), ['brainstorming']);
});

test('Windows without Developer Mode: a refused skills link is a warning, not a crash', () => {
  const dir = fakeApp();
  const real = fs.symlinkSync;
  fs.symlinkSync = () => { const e = new Error('operation not permitted'); e.code = 'EPERM'; throw e; };
  try {
    const { warnings } = init(dir, { skipGenerate: true });
    assert.match(warnings.join('\n'), /couldn't create the \.claude\/skills link \(EPERM\)\. On Windows, turn on Developer Mode/);
    assert.ok(fs.existsSync(path.join(dir, '.agents/skills/m-feature/SKILL.md')), 'everything else is installed');
  } finally { fs.symlinkSync = real; }
});

test('a clone with Windows line endings (autocrlf): hooks keep LF and run, and sync sees nothing to change', () => {
  const dir = fakeApp();
  init(dir, { skipGenerate: true });
  assert.match(read(dir, '.gitattributes'), /^\.githooks\/\* text eol=lf$/m);
  commitAll(dir);
  const clone = tmpDir('amk-clone-');
  execFileSync('git', ['clone', '-q', '-c', 'core.autocrlf=true', dir, clone]);
  assert.match(fs.readFileSync(path.join(clone, 'AGENTS.md'), 'utf8'), /\r\n/, 'text files were checked out with CRLF');
  for (const f of ['.githooks/pre-commit', '.githooks/pre-push', 'scripts/ai/verify.sh']) {
    assert.doesNotMatch(fs.readFileSync(path.join(clone, f), 'utf8'), /\r/, `${f} keeps LF`);
  }
  const hook = require('child_process').spawnSync('sh', ['.githooks/pre-commit'], { cwd: clone, encoding: 'utf8' });
  assert.strictEqual(hook.status, 0, hook.stderr);
  const { report } = sync(clone, { skipGenerate: true });
  assert.ok(Object.values(report).every(a => a.length === 0), JSON.stringify(report));
});

// ---------- the project's own git hook manager ----------
const sh = (cwd, cmd) => require('child_process').spawnSync('sh', ['-c', cmd], { cwd, encoding: 'utf8' });
const localHooks = dir => { try { return git(dir, 'config', '--local', 'core.hooksPath'); } catch { return null; } };

test('husky 9: the kit runs from husky\'s files, core.hooksPath stays husky\'s, and uninstall takes it out again', () => {
  const lintStaged = 'npx lint-staged\n';
  const dir = fakeApp({ pkg: { devDependencies: { husky: '^9.1.7' }, scripts: { prepare: 'husky' } }, files: { '.husky/pre-commit': lintStaged, '.husky/_/h': '' } });
  git(dir, 'config', 'core.hooksPath', '.husky/_');
  const { report } = init(dir, { skipGenerate: true });
  assert.strictEqual(read(dir, '.husky/pre-commit'), `sh .githooks/pre-commit || exit 1 # agentic-mobile-kit\n${lintStaged}`);
  assert.strictEqual(read(dir, '.husky/pre-push'), '#!/usr/bin/env sh\nsh .githooks/pre-push "$@" || exit 1 # agentic-mobile-kit\n');
  if (process.platform !== 'win32') assert.ok(fs.statSync(path.join(dir, '.husky/pre-push')).mode & 0o111, 'executable, for husky 5 to 8');
  assert.ok(report.merged.includes('.husky/pre-commit') && report.created.includes('.husky/pre-push'));
  assert.strictEqual(localHooks(dir), '.husky/_');
  assert.doesNotMatch(read(dir, 'package.json'), /core\.hooksPath/, 'no postinstall fighting husky');
  // the kit's checks run through husky's file: a staged .env stops the commit
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1\n');
  git(dir, 'add', '-f', '.env');
  const hook = sh(dir, 'sh -e .husky/pre-commit');
  assert.notStrictEqual(hook.status, 0);
  assert.match(hook.stderr, /don't commit \.env files/);
  git(dir, 'rm', '-q', '--cached', '.env');
  fs.unlinkSync(path.join(dir, '.env'));
  commitAll(dir);
  assert.ok(Object.values(sync(dir, { skipGenerate: true }).report).every(a => a.length === 0), 'sync adds nothing twice');
  uninstall(dir, { skipGenerate: true });
  assert.strictEqual(read(dir, '.husky/pre-commit'), lintStaged);
  assert.ok(!fs.existsSync(path.join(dir, '.husky/pre-push')), 'the hook file the kit created is gone');
});

test('husky 8 and a team\'s own hooks folder: the kit\'s line goes after the setup lines and before any exit', () => {
  const dir = fakeApp({ pkg: { devDependencies: { husky: '^8.0.3' } }, files: { '.husky/pre-commit': '#!/usr/bin/env sh\n. "$(dirname -- "$0")/_/husky.sh"\n\nnpx lint-staged\n' } });
  git(dir, 'config', 'core.hooksPath', '.husky');
  init(dir, { skipGenerate: true });
  assert.strictEqual(read(dir, '.husky/pre-commit'), '#!/usr/bin/env sh\n. "$(dirname -- "$0")/_/husky.sh"\n\nsh .githooks/pre-commit || exit 1 # agentic-mobile-kit\nnpx lint-staged\n');
  assert.strictEqual(localHooks(dir), '.husky');

  const own = fakeApp({ files: { '.hooks/pre-commit': '#!/bin/sh\n# team checks\nset -e\n./scripts/check.sh\nexit 0\n' } });
  git(own, 'config', 'core.hooksPath', '.hooks/');
  init(own, { skipGenerate: true });
  assert.strictEqual(read(own, '.hooks/pre-commit'), '#!/bin/sh\n# team checks\nsh .githooks/pre-commit || exit 1 # agentic-mobile-kit\nset -e\n./scripts/check.sh\nexit 0\n');
  assert.ok(fs.existsSync(path.join(own, '.hooks/pre-push')));
  assert.strictEqual(localHooks(own), '.hooks/');
});

test('husky 4 and simple-git-hooks: the kit\'s command goes first in package.json, and uninstall removes it', () => {
  const dir = fakeApp({ pkg: { devDependencies: { husky: '^4.3.8' }, husky: { hooks: { 'pre-commit': 'lint-staged' } } } });
  init(dir, { skipGenerate: true });
  assert.deepStrictEqual(JSON.parse(read(dir, 'package.json')).husky.hooks, { 'pre-commit': 'sh .githooks/pre-commit && lint-staged', 'pre-push': 'sh .githooks/pre-push' });
  assert.strictEqual(localHooks(dir), null, 'husky 4 hooks live in .git/hooks, so core.hooksPath stays unset');
  commitAll(dir);
  uninstall(dir, { skipGenerate: true });
  assert.deepStrictEqual(JSON.parse(read(dir, 'package.json')).husky.hooks, { 'pre-commit': 'lint-staged' });

  const sgh = fakeApp({ pkg: { 'simple-git-hooks': { 'pre-commit': 'npx lint-staged' } } });
  const { warnings } = init(sgh, { skipGenerate: true });
  assert.strictEqual(JSON.parse(read(sgh, 'package.json'))['simple-git-hooks']['pre-commit'], 'sh .githooks/pre-commit && npx lint-staged');
  assert.match(warnings.join('\n'), /run "npx simple-git-hooks" once/);
});

test('lefthook: the kit\'s command goes under commands: or jobs:, or into a new hook; uninstall restores the file', () => {
  const yml = 'pre-commit:\n  parallel: true\n  commands:\n    lint:\n      run: npx eslint {staged_files}\n';
  const dir = fakeApp({ files: { 'lefthook.yml': yml } });
  init(dir, { skipGenerate: true });
  assert.strictEqual(read(dir, 'lefthook.yml'), 'pre-commit:\n  parallel: true\n  commands:\n    agentic-mobile-kit:\n      run: sh .githooks/pre-commit\n    lint:\n      run: npx eslint {staged_files}\n'
    + 'pre-push: # agentic-mobile-kit\n  commands: # agentic-mobile-kit\n    agentic-mobile-kit:\n      run: sh .githooks/pre-push\n');
  assert.strictEqual(localHooks(dir), null);
  commitAll(dir);
  uninstall(dir, { skipGenerate: true });
  assert.strictEqual(read(dir, 'lefthook.yml'), yml);

  const jobs = 'pre-commit:\n  jobs:\n  - name: lint\n    run: yarn lint\npre-push:\n  scripts:\n    "check.sh":\n      runner: bash\n';
  const dir2 = fakeApp({ files: { '.lefthook.yml': jobs } });
  const { warnings } = init(dir2, { skipGenerate: true });
  assert.strictEqual(read(dir2, '.lefthook.yml'), 'pre-commit:\n  jobs:\n  - name: agentic-mobile-kit\n    run: sh .githooks/pre-commit\n  - name: lint\n    run: yarn lint\npre-push:\n  scripts:\n    "check.sh":\n      runner: bash\n');
  assert.match(warnings.join('\n'), /couldn't add the kit's pre-push check to \.lefthook\.yml/);
});

test('hooks another tool installed in .git/hooks: the kit leaves core.hooksPath alone and says what to add', () => {
  const dir = fakeApp();
  fs.writeFileSync(path.join(dir, '.git/hooks/pre-commit'), '#!/bin/sh\npre-commit run\n');
  const { warnings } = init(dir, { skipGenerate: true });
  assert.match(warnings.join('\n'), /git hooks already run from \.git\/hooks, so the kit left core\.hooksPath alone/);
  assert.strictEqual(localHooks(dir), null);
  assert.doesNotMatch(read(dir, 'package.json'), /core\.hooksPath/);
});

test('an earlier kit install next to husky: core.hooksPath goes back to husky and the kit\'s postinstall goes', () => {
  const dir = fakeApp({
    pkg: { devDependencies: { husky: '^9.1.7' }, scripts: { prepare: 'husky', postinstall: 'patch-package && (git config core.hooksPath .githooks || true)' } },
    files: { '.husky/pre-commit': 'npx lint-staged\n', '.husky/_/h': '' },
  });
  git(dir, 'config', 'core.hooksPath', '.githooks');
  init(dir, { skipGenerate: true });
  assert.strictEqual(localHooks(dir), '.husky/_');
  assert.strictEqual(JSON.parse(read(dir, 'package.json')).scripts.postinstall, 'patch-package');
});

test('refuses an app in a subfolder of its repository, as in a monorepo', () => {
  const root = fakeApp();
  const app = path.join(root, 'apps/mobile');
  fs.mkdirSync(app, { recursive: true });
  for (const f of ['package.json', 'App.tsx', 'yarn.lock', 'ios/.keep', 'android/.keep']) fs.cpSync(path.join(root, f), path.join(app, f));
  commitAll(root);
  assert.throws(() => init(app, { skipGenerate: true }), e => e instanceof InitError && /subfolder of its git repository \(apps\/mobile\)/.test(e.message));
});

test('AGENTS.md names the architecture: the Old one only before React Native 0.82 without the New one turned on', () => {
  const arch = (rn, props) => {
    const dir = fakeApp({ pkg: { dependencies: { 'react-native': rn, react: '18.3.1' } }, files: props ? { 'android/gradle.properties': props } : {} });
    init(dir, { skipGenerate: true });
    return read(dir, 'AGENTS.md').match(/Bare React Native ([^,]*)/)[1];
  };
  assert.strictEqual(arch('0.75.4', 'org.gradle.jvmargs=-Xmx2048m\nnewArchEnabled=false\n'), '0.75.4 (Old Architecture: newArchEnabled=false)');
  assert.strictEqual(arch('0.73.6'), '0.73.6 (Old Architecture: newArchEnabled=false)', 'opt-in before 0.76');
  assert.strictEqual(arch('0.74.5', 'newArchEnabled=true\n'), '0.74.5 (New Architecture)');
  assert.strictEqual(arch('0.80.2'), '0.80.2 (New Architecture)', 'the default from 0.76');
  assert.strictEqual(arch('0.84.1', 'newArchEnabled=false\n'), '0.84.1 (New Architecture)', 'ignored from 0.82');
});
