// Run: node --test tests/
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { init, sync, uninstall, printSync, InitError, KIT_VERSION } = require('../lib/init');
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
  assert.match(agents, /^- Screens: phones only \(portrait only\), no iPad app\. Build every screen for each of them/m, 'nothing in ios/ to read: a phone, upright');
  assert.match(agents, /, TypeScript \d/);
  assert.match(agents, /^\| Typecheck, test \| `yarn typecheck`, `yarn test` \|$/m, 'only the checks the app has (no lint script here)');
  assert.match(read(dir, 'CLAUDE.md'), /@AGENTS\.md/);
  assert.match(agents, new RegExp(`KIT:START agentic-mobile-kit ${KIT_VERSION.replace(/\./g, '\\.')} ci=none `));
  assert.ok(!fs.existsSync(path.join(dir, '.github')) && !fs.existsSync(path.join(dir, 'codemagic.yaml')), 'no CI files');
  if (process.platform === 'win32') assert.match(git(dir, 'ls-files', '-s', '.githooks/pre-commit'), /^100755 /, 'staged as executable');
  else assert.ok(fs.statSync(path.join(dir, '.githooks/pre-commit')).mode & 0o111, 'pre-commit is executable');
  assert.strictEqual(fs.readlinkSync(path.join(dir, '.claude/skills')).replace(/\\/g, '/'), '../.agents/skills');
  for (const skill of ['m-feature', 'm-change', 'm-onboard', 'm-prototype', 'm-test']) assert.ok(fs.existsSync(path.join(dir, `.agents/skills/${skill}/SKILL.md`)), skill);
  // the app's words, and the questions for someone else to answer
  for (const f of ['docs/amk/glossary.md', 'specs/_templates/questions.md', 'docs/amk/design-system.md', '.rulesync/subagents/m-design-reviewer.md',
    '.rulesync/subagents/m-tester.md', 'specs/_templates/test-report.md', 'scripts/amk/coverage.js', 'scripts/amk/shots.js', 'scripts/amk/redact.js']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.match(read(dir, '.gitignore'), /^\.env$/m);
  assert.match(read(dir, '.gitignore'), /^\.amk\/$/m);
  assert.match(read(dir, '.gitignore'), /^\.maestro\/\.amk-\*$/m, 'the flow copies verify.sh runs for a moment');
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
  assert.ok(fs.existsSync(path.join(dir, '.github/workflows/ci.yml')) && fs.existsSync(path.join(dir, 'docs/amk/codemagic.md')));
  assert.match(read(dir, 'codemagic.yaml'), /bundle_identifier: org\.reactjs\.native\.example\.DemoApp\n/);
  assert.match(read(dir, 'AGENTS.md'), / ci=github,codemagic /);
  commitAll(dir);
  init(dir, { skipGenerate: true });
  assert.match(read(dir, 'AGENTS.md'), / ci=github,codemagic /, 'a second init without --ci keeps the CI choice');
  assert.throws(() => init(fakeApp(), { ci: ['jenkins'], skipGenerate: true }), /Unknown CI "jenkins"/);
});

test('texts about CI say what the chosen CI does, and that nothing does without one', () => {
  const texts = dir => ['scripts/amk/set-version.sh', 'docs/amk/team-process.md', '.githooks/pre-commit'].map(f => read(dir, f)).join('\n');
  const both = fakeApp();
  init(both, { ci: ['github', 'codemagic'], skipGenerate: true });
  assert.match(texts(both), /# Build numbers are left alone \(codemagic\.yaml sets them at build time\)\./);
  assert.match(texts(both), /Keep PRs under 600 changed lines \(CI enforces it; the `large-pr` label overrides\)\./);
  assert.match(texts(both), /# 7\. warn about large commits \(the PR size check in CI is the hard limit\)/);
  const none = fakeApp();
  init(none, { skipGenerate: true });
  assert.match(read(none, 'AGENTS.md'), / ci=none /);
  assert.doesNotMatch(texts(none), /codemagic|CI enforces|check in CI is|\{\{/);
  assert.match(texts(none), /# Build numbers are left alone, and no CI here sets them: raise them for each store upload/);
  assert.match(texts(none), /Keep PRs under 600 changed lines \(nothing enforces it: the app has no CI check for it\)\./);
  assert.match(texts(none), /# 7\. warn about large commits \(there's no PR size check in CI here\)/);
  // choosing a CI later updates them, as the files are still the kit's
  commitAll(none);
  sync(none, { ci: ['github'], skipGenerate: true });
  assert.match(texts(none), /CI enforces it/);
  assert.match(texts(none), /no CI here sets them/, 'still no Codemagic');
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

  const noIos = fakeApp();
  fs.rmSync(path.join(noIos, 'ios'), { recursive: true });
  commitAll(noIos);
  assert.throws(() => init(noIos, { skipGenerate: true }), /isn.t an Expo app/);

  assert.throws(() => init(fakeApp(), { skipGenerate: true, tools: ['vscode'] }), /Unknown tool/);
});

test('JavaScript projects with typescript installed get no typecheck script, and AGENTS.md says JavaScript', () => {
  const dir = fakeApp({ pkg: { scripts: { lint: 'eslint .', test: 'jest' } } });
  fs.unlinkSync(path.join(dir, 'App.tsx'));
  fs.writeFileSync(path.join(dir, 'App.js'), 'export default {};\n');
  commitAll(dir);
  init(dir, { skipGenerate: true });
  assert.strictEqual(JSON.parse(read(dir, 'package.json')).scripts.typecheck, undefined);
  const agents = read(dir, 'AGENTS.md');
  assert.match(agents, /React 19\.2\.3, JavaScript, Node/);
  assert.match(agents, /^\| Lint, test \| `yarn lint`, `yarn test` \|$/m);
  assert.doesNotMatch(agents, /yarn typecheck/);
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
  edit('scripts/amk/pm-run.sh', t => `${t}# old line\n`);
  edit('.github/workflows/ci.yml', t => t.replace('name: ci\n', 'name: old ci\n'));
  edit('cliff.toml', t => t.replace('header = "# Changelog\\n"', 'header = "# Old\\n"'));
  edit('docs/amk/product.md', t => `${t}Old prompt.\n`);
  edit('AGENTS.md', t => t.replace('## Rules', '## Old rules'));
  fs.unlinkSync(path.join(dir, 'scripts/amk/set-version.sh'));
  fs.writeFileSync(path.join(dir, 'scripts/amk/retired.sh'), 'echo old\n');
  return dir;
}

test('sync: updates untouched kit files, merges the team\'s changes, flags conflicts, leaves filled-in docs alone', () => {
  const old = oldKit();
  for (const doc of ['glossary', 'design-system']) {
    const f = path.join(old, `docs/amk/${doc}.md`);
    fs.writeFileSync(f, `${fs.readFileSync(f, 'utf8')}Old outline.\n`);
  }
  const rn = path.join(old, 'docs/amk/react-native.md');
  fs.writeFileSync(rn, fs.readFileSync(rn, 'utf8').replace('# React Native rules (bare)', '# Old title'));
  const dir = fakeApp({ files: { 'AGENTS.md': '# Team notes\n' } });
  init(dir, { template: old, ci: ['github'], skipGenerate: true });
  commitAll(dir);
  // the team's own edits after installing
  fs.appendFileSync(path.join(dir, '.github/workflows/ci.yml'), '      - run: echo team step\n');
  fs.writeFileSync(path.join(dir, 'cliff.toml'), read(dir, 'cliff.toml').replace('header = "# Old\\n"', 'header = "# Team\\n"'));
  fs.writeFileSync(path.join(dir, 'docs/amk/product.md'), 'This app books meeting rooms.\n');
  fs.writeFileSync(path.join(dir, 'docs/amk/glossary.md'), '# Glossary\n\n**Room**: a space people book by the hour.\n');
  fs.writeFileSync(path.join(dir, 'docs/amk/design-system.md'), '# Design system\n\n- Primary: #0a7d4f (`src/theme.ts`)\n');
  fs.appendFileSync(path.join(dir, '.gitleaks.toml'), '# team addition\n');
  fs.writeFileSync(path.join(dir, 'docs/amk/react-native.md'), read(dir, 'docs/amk/react-native.md').replace('# Old title', '# Team title'));
  commitAll(dir);

  const result = sync(dir, { fromDir: old, skipGenerate: true });
  const { report } = result;
  const kit = f => fs.readFileSync(path.join(TEMPLATE, f), 'utf8');

  assert.strictEqual(read(dir, 'scripts/amk/pm-run.sh'), kit('scripts/amk/pm-run.sh'));
  assert.ok(report.updated.includes('scripts/amk/pm-run.sh'));
  const ci = read(dir, '.github/workflows/ci.yml');
  assert.match(ci, /^name: ci$/m, 'kit change applied');
  assert.match(ci, /echo team step/, 'team change kept');
  assert.ok(report.merged.includes('.github/workflows/ci.yml'));
  // a conflict in a file that markers would break (a config here; a script, a hook or a workflow too): the kit's version
  // goes in, so it works, and the team's beside it, to bring its changes back by hand (issue #12)
  assert.strictEqual(read(dir, 'cliff.toml'), kit('cliff.toml'));
  assert.match(read(dir, 'cliff.toml.mine'), /^header = "# Team\\n"$/m);
  assert.ok(report.byHand.includes('cliff.toml'));
  // Markdown shows the conflict in place
  assert.match(read(dir, 'docs/amk/react-native.md'), new RegExp(`^<<<<<<< your version\\n# Team title\\n=======\\n# React Native rules \\(bare\\)\\n>>>>>>> kit ${KIT_VERSION.replace(/\./g, '\\.')}$`, 'm'));
  assert.ok(report.conflicts.includes('docs/amk/react-native.md'));
  // and sync isn't finished until they're resolved: said last, and the command fails
  const said = [];
  assert.strictEqual(printSync(result, l => said.push(l)), 2);
  assert.match(said.join('\n'), /\nsync isn't finished: 2 conflicts to resolve \(above\)\. Then run the checks, and commit\.$/);
  assert.ok(fs.existsSync(path.join(dir, 'scripts/amk/set-version.sh')), 'new file added');
  if (process.platform !== 'win32') assert.ok(fs.statSync(path.join(dir, 'scripts/amk/set-version.sh')).mode & 0o111, 'and executable');
  assert.ok(report.added.includes('scripts/amk/set-version.sh'));
  assert.ok(!fs.existsSync(path.join(dir, 'scripts/amk/retired.sh')), 'dropped file removed');
  assert.strictEqual(read(dir, 'docs/amk/product.md'), 'This app books meeting rooms.\n');
  assert.strictEqual(read(dir, 'docs/amk/glossary.md'), '# Glossary\n\n**Room**: a space people book by the hour.\n', 'the team\'s glossary too');
  assert.strictEqual(read(dir, 'docs/amk/design-system.md'), '# Design system\n\n- Primary: #0a7d4f (`src/theme.ts`)\n', 'and its design system');
  assert.ok(!Object.values(report).flat().includes('.gitleaks.toml'), 'a file only the team changed is left out of the report');
  const agents = read(dir, 'AGENTS.md');
  assert.match(agents, /^# Team notes\n/);
  assert.match(agents, /^## Rules$/m);
  assert.doesNotMatch(agents, /Old rules/);
  assert.match(agents, new RegExp(`KIT:START agentic-mobile-kit ${KIT_VERSION.replace(/\./g, '\\.')} `));
});

test('sync: a script whose merge no longer parses gets the kit\'s version, and the team\'s beside it', () => {
  const old = oldKit();
  fs.appendFileSync(path.join(old, 'scripts/amk/report.js'), '// old line\n');
  const dir = fakeApp();
  init(dir, { template: old, skipGenerate: true });
  commitAll(dir);
  // the team's edit at the top merges cleanly with the kit's at the end, into a script that doesn't parse
  fs.writeFileSync(path.join(dir, 'scripts/amk/report.js'), read(dir, 'scripts/amk/report.js').replace("'use strict';\n", "'use strict';\nif (process.env.TEAM) {\n"));
  commitAll(dir);
  const { report } = sync(dir, { fromDir: old, skipGenerate: true });
  assert.strictEqual(read(dir, 'scripts/amk/report.js'), fs.readFileSync(path.join(TEMPLATE, 'scripts/amk/report.js'), 'utf8'));
  assert.match(read(dir, 'scripts/amk/report.js.mine'), /if \(process\.env\.TEAM\) \{/);
  assert.deepStrictEqual(report.byHand, ['scripts/amk/report.js']);
});

test('sync keeps the team\'s edits inside AGENTS.md\'s kit section, marks those the kit changed too; a new version isn\'t an edit', () => {
  const old = oldKit(); // its AGENTS.md says "## Old rules"
  const dir = fakeApp({ files: { 'AGENTS.md': '# Team notes\n' } });
  init(dir, { template: old, skipGenerate: true });
  commitAll(dir);
  // the team builds for Android phones only (the value the kit fills in, a team's decision), allows three attempts,
  // and renamed a heading the kit renames too; React Native was upgraded since
  const edit = (from, to) => fs.writeFileSync(path.join(dir, 'AGENTS.md'), read(dir, 'AGENTS.md').replace(from, to));
  edit(/^(- Screens: )[^.]*/m, (m, start) => `${start}Android phones only`);
  edit('After 2 failed attempts', 'After 3 failed attempts');
  edit('## Old rules', '## Team rules');
  // and the marker line says the version that installed it, as in an app
  edit(/(KIT:START agentic-mobile-kit )[\d.]+/, (m, start) => `${start}0.7.10`);
  const pkg = JSON.parse(read(dir, 'package.json'));
  pkg.dependencies['react-native'] = '0.88.0';
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  commitAll(dir);
  const { report } = sync(dir, { fromDir: old, skipGenerate: true });
  const agents = read(dir, 'AGENTS.md');
  assert.match(agents, /^- Screens: Android phones only\. Build every screen/m, 'the team\'s edits stay');
  assert.match(agents, /^- After 3 failed attempts/m);
  assert.match(agents, /^<<<<<<< your version\n## Team rules\n=======\n## Rules\n>>>>>>> kit /m, 'where the kit changed the line too, both, marked');
  assert.match(agents, /^- Bare React Native 0\.88\.0 /m, 'a new version isn\'t taken for an edit');
  assert.match(agents, new RegExp(`^<!-- KIT:START agentic-mobile-kit ${KIT_VERSION.replace(/\./g, '\\.')} `, 'm'), 'the marker lines are the kit\'s');
  assert.match(agents, /^# Team notes\n/);
  assert.deepStrictEqual(report.conflicts, ['AGENTS.md (your edits inside the kit\'s section)']);
  assert.ok(!report.updated.includes('AGENTS.md'));
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

test('sync with --from (no recorded version): a file matching neither kit version isn\'t merged silently', () => {
  const old = oldKit();
  const dir = fakeApp();
  init(dir, { template: old, ci: ['github'], skipGenerate: true });
  // installed from an even older kit than --from says: this file predates the "old" kit
  fs.writeFileSync(path.join(dir, '.github/workflows/ci.yml'), read(dir, '.github/workflows/ci.yml').replace('name: old ci\n', 'name: older ci\n'));
  commitAll(dir);
  const { report } = sync(dir, { fromDir: old, from: '0.2.0', skipGenerate: true });
  // a workflow with markers wouldn't run: the kit's version, and the team's beside it
  assert.match(read(dir, '.github/workflows/ci.yml'), /^name: ci$/m);
  assert.doesNotMatch(read(dir, '.github/workflows/ci.yml'), /<<<<<<<|older ci/);
  assert.match(read(dir, '.github/workflows/ci.yml.mine'), /^name: older ci$/m);
  assert.ok(report.byHand.includes('.github/workflows/ci.yml'));
  assert.ok(report.updated.includes('scripts/amk/pm-run.sh'), 'files matching the old kit still update');
});

test('sync adds CI files only to projects that chose that CI, or when asked with --ci', () => {
  const old = oldKit();
  fs.unlinkSync(path.join(old, '.github/workflows/ios.yml'));
  fs.unlinkSync(path.join(old, 'docs/amk/codemagic.md'));
  const none = fakeApp();
  init(none, { template: old, skipGenerate: true });
  commitAll(none);
  sync(none, { fromDir: old, skipGenerate: true });
  assert.ok(!fs.existsSync(path.join(none, '.github')) && !fs.existsSync(path.join(none, 'docs/amk/codemagic.md')));

  const github = fakeApp();
  init(github, { template: old, ci: ['github'], skipGenerate: true });
  commitAll(github);
  const { report } = sync(github, { fromDir: old, skipGenerate: true });
  assert.ok(report.added.includes('.github/workflows/ios.yml'), 'new CI file for a GitHub CI project');
  assert.ok(!fs.existsSync(path.join(github, 'docs/amk/codemagic.md')), 'no Codemagic files');
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
  for (const f of ['.githooks/pre-commit', '.githooks/pre-push', 'scripts/amk/verify.sh']) {
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
  assert.strictEqual(read(dir, '.husky/pre-commit'), `sh scripts/amk/run-hook.sh .githooks/pre-commit || exit 1 # agentic-mobile-kit\n${lintStaged}`);
  assert.strictEqual(read(dir, '.husky/pre-push'), '#!/usr/bin/env sh\nsh scripts/amk/run-hook.sh .githooks/pre-push "$@" || exit 1 # agentic-mobile-kit\n');
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
  // a clone without .githooks (a team may keep it out of git) skips the kit's checks with a hint, instead of failing
  // every commit and push
  fs.renameSync(path.join(dir, '.githooks'), path.join(dir, 'githooks-away'));
  const skipped = sh(dir, 'sh -e .husky/pre-push origin https://example.invalid/app.git');
  assert.strictEqual(skipped.status, 0, skipped.stderr);
  assert.match(skipped.stderr, /this clone has no \.githooks\/pre-push yet, so the kit's checks were skipped: run npx agentic-mobile-kit sync/);
  fs.renameSync(path.join(dir, 'githooks-away'), path.join(dir, '.githooks'));
  commitAll(dir);
  assert.ok(Object.values(sync(dir, { skipGenerate: true }).report).every(a => a.length === 0), 'sync adds nothing twice');
  // an earlier kit's plain call, which failed there: sync upgrades it
  fs.writeFileSync(path.join(dir, '.husky/pre-commit'), `sh .githooks/pre-commit || exit 1 # agentic-mobile-kit\n${lintStaged}`);
  commitAll(dir);
  sync(dir, { skipGenerate: true });
  assert.strictEqual(read(dir, '.husky/pre-commit'), `sh scripts/amk/run-hook.sh .githooks/pre-commit || exit 1 # agentic-mobile-kit\n${lintStaged}`);
  commitAll(dir);
  uninstall(dir, { skipGenerate: true });
  assert.strictEqual(read(dir, '.husky/pre-commit'), lintStaged);
  assert.ok(!fs.existsSync(path.join(dir, '.husky/pre-push')), 'the hook file the kit created is gone');
});

test('husky 8 and a team\'s own hooks folder: the kit\'s line goes after the setup lines and before any exit', () => {
  const dir = fakeApp({ pkg: { devDependencies: { husky: '^8.0.3' } }, files: { '.husky/pre-commit': '#!/usr/bin/env sh\n. "$(dirname -- "$0")/_/husky.sh"\n\nnpx lint-staged\n' } });
  git(dir, 'config', 'core.hooksPath', '.husky');
  init(dir, { skipGenerate: true });
  assert.strictEqual(read(dir, '.husky/pre-commit'), '#!/usr/bin/env sh\n. "$(dirname -- "$0")/_/husky.sh"\n\nsh scripts/amk/run-hook.sh .githooks/pre-commit || exit 1 # agentic-mobile-kit\nnpx lint-staged\n');
  assert.strictEqual(localHooks(dir), '.husky');

  const own = fakeApp({ files: { '.hooks/pre-commit': '#!/bin/sh\n# team checks\nset -e\n./scripts/check.sh\nexit 0\n' } });
  git(own, 'config', 'core.hooksPath', '.hooks/');
  init(own, { skipGenerate: true });
  assert.strictEqual(read(own, '.hooks/pre-commit'), '#!/bin/sh\n# team checks\nsh scripts/amk/run-hook.sh .githooks/pre-commit || exit 1 # agentic-mobile-kit\nset -e\n./scripts/check.sh\nexit 0\n');
  assert.ok(fs.existsSync(path.join(own, '.hooks/pre-push')));
  assert.strictEqual(localHooks(own), '.hooks/');

  // the project's own .githooks, set as a full path: the kit's folder, not a team's
  const full = fakeApp();
  git(full, 'config', 'core.hooksPath', path.join(full, '.githooks'));
  const { warnings } = init(full, { skipGenerate: true });
  assert.doesNotMatch(warnings.join('\n'), /already run from/);
  assert.strictEqual(localHooks(full), '.githooks');
});

test('husky 4 and simple-git-hooks: the kit\'s command goes first in package.json, and uninstall removes it', () => {
  const dir = fakeApp({ pkg: { devDependencies: { husky: '^4.3.8' }, husky: { hooks: { 'pre-commit': 'lint-staged' } } } });
  init(dir, { skipGenerate: true });
  assert.deepStrictEqual(JSON.parse(read(dir, 'package.json')).husky.hooks, { 'pre-commit': 'sh scripts/amk/run-hook.sh .githooks/pre-commit && lint-staged', 'pre-push': 'sh scripts/amk/run-hook.sh .githooks/pre-push' });
  assert.strictEqual(localHooks(dir), null, 'husky 4 hooks live in .git/hooks, so core.hooksPath stays unset');
  commitAll(dir);
  // an earlier kit's plain command: sync upgrades it, and the team's own still runs after it
  const pkg = JSON.parse(read(dir, 'package.json'));
  pkg.husky.hooks['pre-commit'] = 'sh .githooks/pre-commit && lint-staged';
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  commitAll(dir);
  sync(dir, { skipGenerate: true });
  assert.strictEqual(JSON.parse(read(dir, 'package.json')).husky.hooks['pre-commit'], 'sh scripts/amk/run-hook.sh .githooks/pre-commit && lint-staged');
  commitAll(dir);
  uninstall(dir, { skipGenerate: true });
  assert.deepStrictEqual(JSON.parse(read(dir, 'package.json')).husky.hooks, { 'pre-commit': 'lint-staged' });

  const sgh = fakeApp({ pkg: { 'simple-git-hooks': { 'pre-commit': 'npx lint-staged' } } });
  const { warnings } = init(sgh, { skipGenerate: true });
  assert.strictEqual(JSON.parse(read(sgh, 'package.json'))['simple-git-hooks']['pre-commit'], 'sh scripts/amk/run-hook.sh .githooks/pre-commit && npx lint-staged');
  assert.match(warnings.join('\n'), /run "npx simple-git-hooks" once/);
  // uninstall also takes out an earlier kit's plain command
  const sghPkg = JSON.parse(read(sgh, 'package.json'));
  sghPkg['simple-git-hooks'] = { 'pre-commit': 'sh .githooks/pre-commit && npx lint-staged', 'pre-push': 'sh .githooks/pre-push' };
  fs.writeFileSync(path.join(sgh, 'package.json'), `${JSON.stringify(sghPkg, null, 2)}\n`);
  commitAll(sgh);
  uninstall(sgh, { skipGenerate: true });
  assert.deepStrictEqual(JSON.parse(read(sgh, 'package.json'))['simple-git-hooks'], { 'pre-commit': 'npx lint-staged' });

  // a team that keeps .githooks out of git hears that each clone needs sync once
  const ignored = fakeApp({ pkg: { devDependencies: { husky: '^4.3.8' }, husky: { hooks: { 'pre-commit': 'lint-staged' } } }, files: { '.gitignore': '.githooks\n' } });
  assert.match(init(ignored, { skipGenerate: true }).warnings.join('\n'), /\.githooks is kept out of git here, so a fresh clone has none until it runs npx agentic-mobile-kit sync\. Until then, husky skips the kit's checks and says so/);
});

test('lefthook: the kit\'s command goes under commands: or jobs:, or into a new hook; uninstall restores the file', () => {
  const yml = 'pre-commit:\n  parallel: true\n  commands:\n    lint:\n      run: npx eslint {staged_files}\n';
  const dir = fakeApp({ files: { 'lefthook.yml': yml } });
  init(dir, { skipGenerate: true });
  assert.strictEqual(read(dir, 'lefthook.yml'), 'pre-commit:\n  parallel: true\n  commands:\n    agentic-mobile-kit:\n      run: sh scripts/amk/run-hook.sh .githooks/pre-commit\n    lint:\n      run: npx eslint {staged_files}\n'
    + 'pre-push: # agentic-mobile-kit\n  commands: # agentic-mobile-kit\n    agentic-mobile-kit:\n      run: sh scripts/amk/run-hook.sh .githooks/pre-push\n');
  assert.strictEqual(localHooks(dir), null);
  commitAll(dir);
  uninstall(dir, { skipGenerate: true });
  assert.strictEqual(read(dir, 'lefthook.yml'), yml);

  const jobs = 'pre-commit:\n  jobs:\n  - name: lint\n    run: yarn lint\npre-push:\n  scripts:\n    "check.sh":\n      runner: bash\n';
  const dir2 = fakeApp({ files: { '.lefthook.yml': jobs } });
  const { warnings } = init(dir2, { skipGenerate: true });
  assert.strictEqual(read(dir2, '.lefthook.yml'), 'pre-commit:\n  jobs:\n  - name: agentic-mobile-kit\n    run: sh scripts/amk/run-hook.sh .githooks/pre-commit\n  - name: lint\n    run: yarn lint\npre-push:\n  scripts:\n    "check.sh":\n      runner: bash\n');
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

test('other hooks a tool installed in .git/hooks keep running: a .githooks file passes each on; uninstall removes it', () => {
  const dir = fakeApp();
  // a time tracker's post-commit, which core.hooksPath .githooks would otherwise switch off
  fs.writeFileSync(path.join(dir, '.git/hooks/post-commit'), '#!/bin/sh\necho tracked >> "$(git rev-parse --git-dir)/tracked"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dir, '.git/hooks/commit-msg.sample'), '#!/bin/sh\n');
  const { warnings } = init(dir, { skipGenerate: true });
  assert.strictEqual(localHooks(dir), '.githooks', 'the kit\'s own checks still run');
  assert.match(warnings.join('\n'), /\.git\/hooks has post-commit from another tool, which core\.hooksPath would switch off: \.githooks\/post-commit now runs it\. Commit it with the kit, so it runs in every clone that has one/);
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, '.githooks')).sort(), ['post-commit', 'pre-commit', 'pre-push'], 'not for .sample files');
  if (process.platform !== 'win32') {
    // a commit runs it, and a clone without it commits all the same
    git(dir, 'add', 'App.tsx');
    fs.writeFileSync(path.join(dir, 'App.tsx'), 'export default { a: 1 };\n');
    git(dir, 'add', 'App.tsx');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'change', '--', 'App.tsx');
    assert.strictEqual(read(dir, '.git/tracked'), 'tracked\n');
    fs.unlinkSync(path.join(dir, '.git/hooks/post-commit'));
    fs.writeFileSync(path.join(dir, 'App.tsx'), 'export default { a: 2 };\n');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'again', '--', 'App.tsx');
    assert.strictEqual(read(dir, '.git/tracked'), 'tracked\n', 'no hook to pass on: nothing ran');
  }
  commitAll(dir);
  const { report } = uninstall(dir);
  assert.ok(report.removed.includes('.githooks/post-commit'), report.removed.join(', '));
  assert.strictEqual(fs.existsSync(path.join(dir, '.githooks')), false, 'the folder goes once it\'s empty');

  // a team that keeps .githooks and rulesync.jsonc out of git: a fresh clone has neither, and sync still works,
  // making the folder for the hook and saying why the tools' settings weren't generated
  const ignored = fakeApp({ files: { '.gitignore': '.githooks\nrulesync.jsonc\n' } });
  init(ignored, { skipGenerate: true });
  commitAll(ignored);
  fs.rmSync(path.join(ignored, '.githooks'), { recursive: true });
  fs.rmSync(path.join(ignored, 'rulesync.jsonc'));
  fs.writeFileSync(path.join(ignored, '.git/hooks/post-commit'), '#!/bin/sh\n', { mode: 0o755 });
  const synced = sync(ignored, { skipGenerate: true });
  assert.ok(synced.report.added.includes('.githooks/post-commit'), synced.report.added.join(', '));
  // the kit's own hooks come back too: git keeps them out, so the team didn't delete them
  assert.ok(['.githooks/pre-commit', '.githooks/pre-push'].every(f => synced.report.added.includes(f) && fs.existsSync(path.join(ignored, f))), synced.report.added.join(', '));
  assert.ok(synced.report.kept.includes('rulesync.jsonc (you deleted it)'), 'not rulesync.jsonc, which holds the team\'s choice of tools');
  assert.match(read(ignored, '.githooks/post-commit'), /runs this clone's own \.git\/hooks\/post-commit/);
  assert.match(synced.warnings.join('\n'), /\.githooks is kept out of git here, so each clone gets that when it runs sync/);
  assert.match(synced.warnings.join('\n'), /rulesync\.jsonc isn't here \(deleted, or kept out of git\), so the AI tools' settings, hooks and subagents weren't generated/);
});

test('.githooks kept out of git, no hook manager: install doesn\'t point git at a folder a fresh clone lacks; sync does', () => {
  // an earlier kit's postinstall line, after the app's own command
  const dir = fakeApp({ pkg: { scripts: { test: 'jest', postinstall: 'patch-package && (git config core.hooksPath .githooks || true)' } }, files: { '.gitignore': '.githooks\n' } });
  const { warnings } = init(dir, { skipGenerate: true });
  assert.strictEqual(JSON.parse(read(dir, 'package.json')).scripts.postinstall, 'patch-package', 'the line goes, the app\'s own command stays');
  assert.strictEqual(localHooks(dir), '.githooks', 'this clone has the folder, so its hooks are on');
  assert.match(warnings.join('\n'), /\.githooks is kept out of git here, so a fresh clone has none until it runs npx agentic-mobile-kit sync, which turns the kit's hooks on/);
  commitAll(dir);
  // a fresh clone: no .githooks and no core.hooksPath, so git runs .git/hooks, until sync puts both back
  git(dir, 'config', '--unset', 'core.hooksPath');
  fs.rmSync(path.join(dir, '.githooks'), { recursive: true });
  sync(dir, { skipGenerate: true });
  assert.strictEqual(JSON.parse(read(dir, 'package.json')).scripts.postinstall, 'patch-package', 'sync doesn\'t put the line back');
  assert.strictEqual(localHooks(dir), '.githooks');
  assert.ok(fs.existsSync(path.join(dir, '.githooks/pre-commit')));

  // tracked .githooks: install still turns the hooks on in every clone
  const tracked = fakeApp();
  init(tracked, { skipGenerate: true });
  assert.match(JSON.parse(read(tracked, 'package.json')).scripts.postinstall, /core\.hooksPath \.githooks/);
});

test('Antigravity\'s Stop hooks become a plain list of handlers, which is all its hook runner accepts', () => {
  const { flattenAntigravityStop } = require('../lib/init');
  const dir = tmpDir('amk-agy-');
  const guard = { type: 'command', command: 'node guard.js' };
  const stop = { type: 'command', command: 'node handoff-check.js' };
  // what rulesync before 40 writes
  const written = { rulesync: { PreToolUse: [{ hooks: [guard] }], Stop: [{ hooks: [stop] }] }, team: { Stop: [{ type: 'command', command: 'echo bye' }] } };
  fs.mkdirSync(path.join(dir, '.agents'));
  fs.writeFileSync(path.join(dir, '.agents/hooks.json'), JSON.stringify(written));
  flattenAntigravityStop(dir);
  const fixed = JSON.parse(read(dir, '.agents/hooks.json'));
  assert.deepStrictEqual(fixed.rulesync, { PreToolUse: [{ hooks: [guard] }], Stop: [stop] }, 'PreToolUse keeps its matcher shape');
  assert.deepStrictEqual(fixed.team, written.team, 'a handler list stays as it is');
  const before = read(dir, '.agents/hooks.json');
  flattenAntigravityStop(dir);
  assert.strictEqual(read(dir, '.agents/hooks.json'), before, 'nothing left to change');
  flattenAntigravityStop(tmpDir('amk-agy-none-')); // no Antigravity hooks: nothing to do
});

test('Codex asks with options to pick from in every mode: the project\'s config switches it on, once', () => {
  const { codexQuestions } = require('../lib/init');
  const dir = tmpDir('amk-codex-');
  // what rulesync writes, in part
  const written = 'default_permissions = "rulesync"\n\n[permissions.rulesync.filesystem.":workspace_roots"]\n".env" = "deny"\n';
  fs.mkdirSync(path.join(dir, '.codex'));
  fs.writeFileSync(path.join(dir, '.codex/config.toml'), written);
  codexQuestions(dir);
  const on = read(dir, '.codex/config.toml');
  assert.strictEqual(on, `${written}\n# agentic-mobile-kit: questions as options to pick from, in every mode\n[features]\ndefault_mode_request_user_input = true\n`);
  codexQuestions(dir);
  assert.strictEqual(read(dir, '.codex/config.toml'), on, 'once');
  // a [features] table of the team's: the setting goes in it; their own value of it stays
  fs.writeFileSync(path.join(dir, '.codex/config.toml'), '[features]\nweb_search = true\n');
  codexQuestions(dir);
  assert.strictEqual(read(dir, '.codex/config.toml'), '[features]\ndefault_mode_request_user_input = true\nweb_search = true\n');
  fs.writeFileSync(path.join(dir, '.codex/config.toml'), '[features]\ndefault_mode_request_user_input = false\n');
  codexQuestions(dir);
  assert.match(read(dir, '.codex/config.toml'), /= false\n$/);
  codexQuestions(tmpDir('amk-codex-none-')); // no Codex: nothing to do
});

test('scripts/amk/tool-configs.js, which CI\'s tool-config check runs after rulesync, finishes both files as init does', () => {
  const dir = tmpDir('amk-tool-configs-');
  fs.mkdirSync(path.join(dir, '.agents'));
  fs.mkdirSync(path.join(dir, '.codex'));
  fs.writeFileSync(path.join(dir, '.agents/hooks.json'), JSON.stringify({ rulesync: { Stop: [{ hooks: [{ type: 'command', command: 'node stop.js' }] }] } }));
  fs.writeFileSync(path.join(dir, '.codex/config.toml'), 'default_permissions = "rulesync"\n');
  const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, '../stacks/react-native/template/scripts/amk/tool-configs.js')], { cwd: dir, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(read(dir, '.agents/hooks.json')).rulesync.Stop, [{ type: 'command', command: 'node stop.js' }]);
  assert.match(read(dir, '.codex/config.toml'), /\[features\]\ndefault_mode_request_user_input = true\n$/);
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

// ---------- Expo ----------
// an app as create-expo-app makes it: no ios/ or android/, Expo's own AGENTS.md, and its Claude Code plugin setting
function expoApp(files = {}) {
  const dir = fakeApp({
    pkg: { dependencies: { expo: '~57.0.27', 'expo-router': '~57.0.25', 'react-native': '0.86.3', react: '19.2.3' }, devDependencies: { typescript: '~6.0.3' }, scripts: { start: 'expo start', lint: 'expo lint' } },
    files: {
      'app.json': JSON.stringify({ expo: { name: 'Demo', slug: 'demo', version: '1.0.0', ios: { bundleIdentifier: 'com.example.demo' }, android: { package: 'com.example.demo' } } }, null, 2),
      'AGENTS.md': 'This is an Expo/React Native mobile application.\n\n## Rules\n\n- Never edit ios/ or android/ by hand.\n',
      '.claude/settings.json': '{\n  "enabledPlugins": {\n    "expo@claude-plugins-official": true\n  }\n}\n',
      ...files,
    },
  });
  fs.rmSync(path.join(dir, 'ios'), { recursive: true });
  fs.rmSync(path.join(dir, 'android'), { recursive: true });
  commitAll(dir);
  return dir;
}

test('Expo app without native folders: Expo instructions, rules, skills and permissions next to Expo\'s own text', () => {
  const dir = expoApp();
  const { values } = init(dir, { skipGenerate: true });
  assert.strictEqual(values.KIT_STACK, 'expo');
  const agents = read(dir, 'AGENTS.md');
  assert.match(agents, /^This is an Expo\/React Native mobile application\./, 'Expo\'s own text stays first');
  assert.match(agents, /KIT:START agentic-mobile-kit [^ ]+ ci=none stack=expo /);
  assert.match(agents, /Expo SDK 57, React Native 0\.86\.3 \(New Architecture\)/);
  assert.match(agents, /Never edit `ios\/` or `android\/`/);
  assert.doesNotMatch(agents, /\{\{/);
  assert.ok(fs.existsSync(path.join(dir, 'docs/amk/expo.md')) && !fs.existsSync(path.join(dir, 'docs/amk/react-native.md')));
  for (const s of ['expo-router', 'expo-upgrade', 'expo-module', 'react-native-best-practices', 'm-feature']) {
    assert.ok(fs.existsSync(path.join(dir, `.agents/skills/${s}/SKILL.md`)), s);
  }
  assert.ok(!fs.existsSync(path.join(dir, '.agents/skills/upgrading-react-native')), 'Expo upgrades with expo-upgrade');
  assert.ok(!fs.existsSync(path.join(dir, '.agents/skills/react-navigation')), "expo-router's skill teaches its own navigation imports");
  assert.match(read(dir, '.rulesync/permissions.jsonc'), /"ios\/\*\*": "deny"/);
  assert.match(read(dir, '.gitignore'), /^\/ios$/m);
  assert.match(read(dir, '.gitignore'), /^\/android$/m);
  assert.strictEqual(read(dir, '.claude/settings.json'), '{\n  "enabledPlugins": {\n    "expo@claude-plugins-official": true\n  }\n}\n', 'Expo\'s plugin setting is kept');
  assert.ok(fs.existsSync(path.join(dir, '.claude/skills/expo-router/SKILL.md')), 'skills linked into the existing .claude folder');

  commitAll(dir);
  assert.ok(Object.values(sync(dir, { skipGenerate: true }).report).every(a => a.length === 0), 'sync right after init changes nothing');
  uninstall(dir, { skipGenerate: true });
  assert.strictEqual(read(dir, 'AGENTS.md'), 'This is an Expo/React Native mobile application.\n\n## Rules\n\n- Never edit ios/ or android/ by hand.\n');
  assert.ok(!fs.existsSync(path.join(dir, 'docs/amk/expo.md')) && !fs.existsSync(path.join(dir, '.agents/skills/expo-router')));
});

test('Expo: an app on React Navigation itself gets the react-navigation skill; sync takes it out of one on Expo Router', () => {
  const plain = fakeApp({ pkg: { dependencies: { expo: '~57.0.27', '@react-navigation/native': '^7.1.0', 'react-native': '0.86.3', react: '19.2.3' } } });
  for (const d of ['ios', 'android']) fs.rmSync(path.join(plain, d), { recursive: true });
  commitAll(plain);
  init(plain, { skipGenerate: true });
  assert.ok(fs.existsSync(path.join(plain, '.agents/skills/react-navigation/SKILL.md')));
  assert.match(read(plain, 'AGENTS.md'), /in an app on React Navigation without Expo Router, `react-navigation`/);

  // an Expo Router app with the skill from an earlier version
  const router = expoApp();
  init(router, { skipGenerate: true });
  fs.cpSync(path.join(TEMPLATE, '.agents/skills/react-navigation'), path.join(router, '.agents/skills/react-navigation'), { recursive: true });
  commitAll(router);
  const { report } = sync(router, { fromDir: TEMPLATE, skipGenerate: true });
  assert.ok(report.removed.includes('.agents/skills/react-navigation/SKILL.md'), JSON.stringify(report));
  assert.ok(!fs.existsSync(path.join(router, '.agents/skills/react-navigation')), 'its folders too');
});

test('an Expo app that keeps ios/ and android/ in git is set up like a bare app', () => {
  const dir = fakeApp({ pkg: { dependencies: { expo: '~57.0.27', 'react-native': '0.86.3', react: '19.2.3' } } });
  const { values } = init(dir, { skipGenerate: true });
  assert.strictEqual(values.KIT_STACK, 'bare');
  assert.match(read(dir, 'AGENTS.md'), /Bare React Native 0\.86\.3/);
  assert.ok(fs.existsSync(path.join(dir, 'docs/amk/react-native.md')));
});

test('apps on ESLint\'s eslintrc config get .eslintignore for the kit\'s scripts; uninstall takes it out again', () => {
  const dir = fakeApp({ files: { '.eslintrc.js': "module.exports = { root: true, extends: '@react-native' };\n" } });
  const { report } = init(dir, { skipGenerate: true });
  assert.ok(report.created.includes('.eslintignore'));
  assert.match(read(dir, '.eslintignore'), /^scripts\/amk\/$/m);
  commitAll(dir);
  uninstall(dir, { skipGenerate: true });
  assert.ok(!fs.existsSync(path.join(dir, '.eslintignore')), 'the file the kit created is gone');

  const own = fakeApp({ files: { '.eslintrc.json': '{}\n', '.eslintignore': 'vendor/\n' } });
  init(own, { skipGenerate: true });
  assert.match(read(own, '.eslintignore'), /^vendor\/\n\n# agentic-mobile-kit: .*\nscripts\/amk\/\n$/);
  commitAll(own);
  uninstall(own, { skipGenerate: true });
  assert.strictEqual(read(own, '.eslintignore'), 'vendor/\n');

  const flat = fakeApp({ files: { 'eslint.config.js': 'module.exports = [];\n' } });
  init(flat, { skipGenerate: true });
  assert.ok(!fs.existsSync(path.join(flat, '.eslintignore')), 'flat config doesn\'t read .eslintignore');
});

// the kit before 0.7.0: its folders were docs/ai and scripts/ai, and evidence went to .ai/
function preRenameKit() {
  const dir = tmpDir('amk-pre-rename-');
  fs.cpSync(TEMPLATE, dir, { recursive: true });
  fs.renameSync(path.join(dir, 'docs/amk'), path.join(dir, 'docs/ai'));
  fs.renameSync(path.join(dir, 'scripts/amk'), path.join(dir, 'scripts/ai'));
  for (const f of fs.readdirSync(dir, { recursive: true })) {
    const p = path.join(dir, f);
    if (!fs.lstatSync(p).isFile()) continue;
    const text = fs.readFileSync(p, 'utf8');
    const old = text.replace(/docs\/amk/g, 'docs/ai').replace(/scripts\/amk/g, 'scripts/ai').replace(/\.amk\//g, '.ai/');
    if (old !== text) fs.writeFileSync(p, old);
  }
  return dir;
}
// an app installed with that kit, as that kit left .gitignore and .eslintignore
function preRenameApp(old, files = {}) {
  const dir = fakeApp({ files: { '.eslintrc.js': 'module.exports = {};\n', ...files } });
  init(dir, { template: old, skipGenerate: true });
  fs.rmSync(path.join(dir, 'docs/ai/codemagic.md'), { force: true }); // that kit added it only with --ci codemagic
  for (const [f, from, to] of [['.gitignore', '.amk/', '.ai/'], ['.eslintignore', 'scripts/amk/', 'scripts/ai/']]) {
    fs.writeFileSync(path.join(dir, f), read(dir, f).split(from).join(to));
  }
  commitAll(dir);
  return dir;
}

test('sync from before 0.7.0 moves the kit\'s files to docs/amk and scripts/amk, with the team\'s edits; the app\'s own files stay', () => {
  const old = preRenameKit();
  const dir = preRenameApp(old, { 'docs/ai/chatbot.md': '# How our in-app chatbot works\n' });
  fs.writeFileSync(path.join(dir, 'docs/ai/product.md'), 'This app books meeting rooms.\n');
  fs.appendFileSync(path.join(dir, 'scripts/ai/verify.sh'), '# team: our own step\n');
  const pkg = JSON.parse(read(dir, 'package.json'));
  pkg.scripts.verify = 'sh scripts/ai/verify.sh quick';
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  commitAll(dir);

  const { report, warnings } = sync(dir, { fromDir: old, skipGenerate: true });
  assert.deepStrictEqual(report.moved.map(m => m.replace(/ \(\d+ files\)/, '')), ['docs/ai/ to docs/amk/', 'scripts/ai/ to scripts/amk/']);
  assert.strictEqual(read(dir, 'docs/amk/product.md'), 'This app books meeting rooms.\n', 'filled-in docs come along');
  const verify = read(dir, 'scripts/amk/verify.sh');
  assert.match(verify, /# team: our own step/, 'the team\'s edit is kept');
  assert.match(verify, /scripts\/amk\/maestro-env\.sh/, 'and the kit\'s new paths are in');
  assert.ok(!fs.existsSync(path.join(dir, 'scripts/ai')), 'nothing else was in scripts/ai, so it is gone');
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'docs/ai')), ['chatbot.md'], 'the app\'s own doc stays');
  assert.ok(report.kept.some(k => k.startsWith('docs/ai/chatbot.md (not the kit\'s')));
  assert.doesNotMatch(read(dir, 'AGENTS.md'), /docs\/ai|scripts\/ai/);
  assert.ok(warnings.some(w => /^still pointing to the kit's old folders: package\.json\./.test(w)), warnings.join('\n'));
  assert.match(read(dir, '.eslintignore'), /^scripts\/amk\/$/m);
  assert.doesNotMatch(read(dir, '.eslintignore'), /scripts\/ai/);
  assert.match(read(dir, '.gitignore'), /^\.ai\/$/m, 'old evidence stays out of git');
  assert.match(read(dir, '.gitignore'), /^\.amk\/$/m);
  assert.match(read(dir, '.gitignore'), /^\.maestro\/\.amk-\*$/m, 'sync adds the kit\'s new lines');
});

test('uninstall still removes an install from before 0.7.0', () => {
  const old = preRenameKit();
  const dir = preRenameApp(old);
  uninstall(dir, { fromDir: old, skipGenerate: true });
  for (const f of ['docs/ai', 'scripts/ai', 'AGENTS.md', '.eslintignore']) assert.ok(!fs.existsSync(path.join(dir, f)), f);
});

// ---------- init --new: create the app in an empty folder ----------
// what the React Native CLI and create-expo-app leave: the app in a new folder, committed in a new repository
// `template`: the files the tools' templates have that init --new changes; `installFails`: adding a package fails
function fakeCreator(calls, { fail = false, lock = true, podsFail = false, template = false, installFails = false, layout = 'src/app/_layout.tsx' } = {}) {
  return (cmd, args, opts) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'sh') { // pod install
      if (podsFail) return { status: 1 };
      fs.writeFileSync(path.join(opts.cwd, 'ios/Podfile.lock'), '');
      return { status: 0 };
    }
    if (args[0] === 'install') { // adding a dev dependency
      if (installFails) return { status: 1 };
      fs.writeFileSync(path.join(opts.cwd, 'package-lock.json'), '{"plugin": true}');
      return { status: 0 };
    }
    if (fail) return { status: 1 };
    const app = path.join(opts.cwd, path.basename(path.dirname(opts.cwd)));
    for (const f of ['ios/.keep', 'android/.keep', '.vscode/extensions.json']) {
      fs.mkdirSync(path.dirname(path.join(app, f)), { recursive: true });
      fs.writeFileSync(path.join(app, f), '');
    }
    fs.writeFileSync(path.join(app, '.gitignore'), '.DS_Store\n');
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'NewApp', dependencies: { 'react-native': '0.87.1' } }));
    if (lock) fs.writeFileSync(path.join(app, 'package-lock.json'), '{}');
    if (template && args.includes('create-expo-app@latest')) {
      fs.writeFileSync(path.join(app, 'app.json'), JSON.stringify({ expo: { name: 'app', orientation: 'portrait', ios: { icon: './icon.png' } } }, null, 2));
      fs.writeFileSync(path.join(app, 'tsconfig.json'), JSON.stringify({ extends: 'expo/tsconfig.base', compilerOptions: { strict: true, paths: { '@/*': ['./src/*'] } } }, null, 2));
      fs.writeFileSync(path.join(app, '.gitignore'), '.DS_Store\nexpo-env.d.ts\n');
      fs.mkdirSync(path.dirname(path.join(app, layout)), { recursive: true });
      fs.writeFileSync(path.join(app, layout), "import {\n  DarkTheme,\n  ThemeProvider,\n} from 'expo-router/react-navigation';\nimport { Stack } from 'expo-router';\n\nexport default function RootLayout() {\n  return <Stack />;\n}\n");
    } else if (template) {
      fs.mkdirSync(path.join(app, 'ios/NewApp'));
      fs.writeFileSync(path.join(app, 'ios/NewApp/Info.plist'), '<dict>\n\t<key>UISupportedInterfaceOrientations</key>\n\t<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t</array>\n</dict>\n');
      fs.writeFileSync(path.join(app, 'babel.config.js'), "module.exports = {\n  presets: ['module:@react-native/babel-preset'],\n};\n");
      fs.writeFileSync(path.join(app, 'tsconfig.json'), JSON.stringify({ extends: '@react-native/typescript-config', include: ['**/*.ts', '**/*.tsx'] }, null, 2));
      fs.writeFileSync(path.join(app, 'index.js'), "/**\n * @format\n */\n\nimport { AppRegistry } from 'react-native';\nimport App from './App';\nimport { name as appName } from './app.json';\n\nAppRegistry.registerComponent(appName, () => App);\n");
    }
    git(app, 'init', '-q');
    commitAll(app);
    return { status: 0 };
  };
}
const leftovers = dir => fs.readdirSync(dir).filter(f => f.startsWith('.amk-new-'));

test('init --new: the tool creates the app in a subfolder, and it moves up, committed and ready for init', () => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' });
  const { createApp, checkProject } = require('../lib/init');
  const quiet = { log: () => {} };

  // a new folder, which Finder has visited
  let dir = tmpDir('my-new-app-');
  fs.writeFileSync(path.join(dir, '.DS_Store'), '');
  let calls = [];
  createApp(dir, 'bare', { run: fakeCreator(calls), pods: true, ...quiet });
  const name = path.basename(dir);
  assert.strictEqual(calls[0], `npx -y @react-native-community/cli@latest init MyNewApp${name[11].toUpperCase()}${name.slice(12)} --directory ${name} --install-pods false`);
  assert.match(calls[1], /^sh .*scripts[/\\]amk[/\\]pod-install\.sh$/);
  assert.strictEqual(git(dir, 'log', '--format=%s'), 'Install the iOS pods\nkit', 'the tool\'s own commit, then the pods');
  assert.strictEqual(git(dir, 'status', '--porcelain'), '');
  assert.deepStrictEqual(leftovers(dir), []);
  assert.strictEqual(checkProject(dir).stack, 'bare');

  // pods that fail to install are left for later, with a note
  dir = tmpDir('amk-new-');
  const logs = [];
  createApp(dir, 'bare', { run: fakeCreator([], { podsFail: true }), pods: true, log: m => logs.push(m) });
  assert.ok(logs.some(m => /iOS pods aren't installed .* commit what it changes before the first feature/.test(m)));
  assert.strictEqual(git(dir, 'log', '--format=%s'), 'kit');
  assert.strictEqual(git(dir, 'status', '--porcelain'), '');

  // an empty clone with its own editor settings: its repository and settings stay
  dir = tmpDir('amk-new-');
  git(dir, 'init', '-q');
  git(dir, 'remote', 'add', 'origin', 'https://example.invalid/team/app.git');
  fs.mkdirSync(path.join(dir, '.vscode'));
  fs.writeFileSync(path.join(dir, '.vscode/settings.json'), '{"mine": true}');
  calls = [];
  createApp(dir, 'expo', { run: fakeCreator(calls), ...quiet });
  assert.strictEqual(calls[0], `npx -y create-expo-app@latest ${path.basename(dir)} --yes`);
  assert.strictEqual(git(dir, 'remote', 'get-url', 'origin'), 'https://example.invalid/team/app.git');
  assert.strictEqual(git(dir, 'log', '--format=%s'), 'Initial commit');
  assert.strictEqual(git(dir, 'status', '--porcelain'), '');
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, '.vscode')), ['settings.json']);
  assert.deepStrictEqual(leftovers(dir), []);
});

test('init --new: iPad and every orientation, stricter TypeScript and "@/" imports, and an error boundary, in a commit of their own', () => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' });
  const { createApp } = require('../lib/init');
  const quiet = { log: () => {} };
  const stricter = { noUncheckedIndexedAccess: true, noImplicitOverride: true, noImplicitReturns: true, noFallthroughCasesInSwitch: true };

  let dir = tmpDir('amk-new-');
  let calls = [];
  createApp(dir, 'bare', { run: fakeCreator(calls, { template: true }), pods: false, ...quiet });
  assert.strictEqual(calls[1], 'npm install --save-dev babel-plugin-module-resolver@5');
  assert.strictEqual(git(dir, 'log', '--format=%s'), 'Support tablets and landscape; stricter TypeScript with @/ imports; an error boundary\nkit');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'ios/NewApp/Info.plist'), 'utf8'),
    '<dict>\n\t<key>UISupportedInterfaceOrientations</key>\n\t<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t\t<string>UIInterfaceOrientationLandscapeLeft</string>\n\t\t<string>UIInterfaceOrientationLandscapeRight</string>\n\t</array>\n</dict>\n');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'babel.config.js'), 'utf8'),
    "module.exports = {\n  presets: ['module:@react-native/babel-preset'],\n  plugins: [['module-resolver', { alias: { '^@/(.+)': './src/\\\\1' } }]],\n};\n");
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'tsconfig.json'), 'utf8')).compilerOptions, { ...stricter, paths: { '@/*': ['./src/*'] } });
  assert.match(fs.readFileSync(path.join(dir, 'tsconfig.json'), 'utf8'), /^\{\n  "extends": "@react-native\/typescript-config",\n  "compilerOptions": \{[\s\S]*"@\/\*": \["\.\/src\/\*"\][\s\S]*"include": \["\*\*\/\*\.ts", "\*\*\/\*\.tsx"\]\n\}\n$/);
  // an error boundary around the app index.js registers
  const kitFile = f => fs.readFileSync(path.join(TEMPLATE, '../new-app', f), 'utf8');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'src/components/ErrorBoundary.tsx'), 'utf8'), kitFile('ErrorBoundary.tsx'));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'index.js'), 'utf8'),
    "/**\n * @format\n */\n\nimport { AppRegistry } from 'react-native';\nimport App from './App';\nimport { withErrorBoundary } from './src/components/ErrorBoundary';\nimport { name as appName } from './app.json';\n\nAppRegistry.registerComponent(appName, () => withErrorBoundary(App));\n");

  // the plugin didn't install: no "@/" imports, the rest as before
  dir = tmpDir('amk-new-');
  const logs = [];
  createApp(dir, 'bare', { run: fakeCreator([], { template: true, installFails: true }), pods: false, log: m => logs.push(m) });
  assert.ok(logs.some(m => /Couldn't install the Babel plugin for "@\/" imports \(see above\), so the app uses relative imports/.test(m)));
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'babel.config.js'), 'utf8'), /plugins/);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'tsconfig.json'), 'utf8')).compilerOptions, stricter);
  assert.strictEqual(git(dir, 'status', '--porcelain'), '');

  // Expo: turns and runs on iPad; its template has the "@/" paths, which Metro reads by itself
  dir = tmpDir('amk-new-');
  calls = [];
  createApp(dir, 'expo', { run: fakeCreator(calls, { template: true }), ...quiet });
  assert.strictEqual(calls.length, 1, 'no package to add');
  const expo = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8')).expo;
  assert.deepStrictEqual([expo.orientation, expo.ios], ['default', { icon: './icon.png', supportsTablet: true }]);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'tsconfig.json'), 'utf8')).compilerOptions, { strict: true, paths: { '@/*': ['./src/*'] }, ...stricter });
  assert.match(fs.readFileSync(path.join(dir, 'expo-types.d.ts'), 'utf8'), /^\/\/\/ <reference types="expo\/types" \/>$/m, 'type checks pass without expo start');
  // the root layout exports the error boundary, which sits with the app's other components
  assert.strictEqual(fs.readFileSync(path.join(dir, 'src/components/error-boundary.tsx'), 'utf8'), kitFile('error-boundary.tsx'));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'src/app/_layout.tsx'), 'utf8'),
    "import {\n  DarkTheme,\n  ThemeProvider,\n} from 'expo-router/react-navigation';\nimport { Stack } from 'expo-router';\nexport { ErrorBoundary } from '../components/error-boundary';\n\nexport default function RootLayout() {\n  return <Stack />;\n}\n");
  // routes in app/ at the root, with no src/
  dir = tmpDir('amk-new-');
  createApp(dir, 'expo', { run: fakeCreator([], { template: true, layout: 'app/_layout.tsx' }), ...quiet });
  assert.ok(fs.existsSync(path.join(dir, 'components/error-boundary.tsx')));
  assert.match(fs.readFileSync(path.join(dir, 'app/_layout.tsx'), 'utf8'), /^import \{ Stack \} from 'expo-router';\nexport \{ ErrorBoundary \} from '\.\.\/components\/error-boundary';$/m);
  assert.strictEqual(git(dir, 'status', '--porcelain'), '');
  assert.strictEqual(git(dir, 'log', '--format=%s'), 'Support tablets and landscape; stricter TypeScript with @/ imports; an error boundary\nkit');
});

test('init --new refuses a folder with files, a folder inside a repository and an unknown type; a failed tool leaves the folder as it was', () => {
  const { createApp } = require('../lib/init');
  const quiet = { log: () => {} };
  const calls = [];
  const refused = (dir, kind, re) => assert.throws(() => createApp(dir, kind, { run: fakeCreator(calls), ...quiet }), e => e instanceof InitError && re.test(e.message));

  let dir = tmpDir('amk-new-');
  fs.writeFileSync(path.join(dir, 'notes.txt'), '');
  refused(dir, 'bare', /isn't empty/);
  const inside = path.join(fakeApp(), 'mobile');
  fs.mkdirSync(inside);
  refused(inside, 'expo', /inside another git repository/);
  refused(tmpDir('amk-new-'), 'ionic', /Unknown app type "ionic"/);
  refused(tmpDir('amk-new-'), 'constructor', /Unknown app type/);
  assert.deepStrictEqual(calls, [], 'nothing was run');

  dir = tmpDir('amk-new-');
  git(dir, 'init', '-q');
  assert.throws(() => createApp(dir, 'expo', { run: fakeCreator(calls, { fail: true }), ...quiet }), /create-expo-app didn't create the app \(exit code 1\)\. This folder is as it was/);
  assert.deepStrictEqual(fs.readdirSync(dir), ['.git']);
  // the tools finish even when installing the packages failed
  assert.throws(() => createApp(dir, 'expo', { run: fakeCreator(calls, { lock: false }), ...quiet }), /installing its packages failed \(see above\)\. This folder is as it was/);
  assert.deepStrictEqual(fs.readdirSync(dir), ['.git']);
  // Ctrl-C stops the tool, and the folder is put back the same way
  assert.throws(() => createApp(dir, 'bare', { run: () => ({ status: null, signal: 'SIGINT' }), ...quiet }), /\(SIGINT\)\. This folder is as it was/);
  assert.deepStrictEqual(fs.readdirSync(dir), ['.git']);
});
