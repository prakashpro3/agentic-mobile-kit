// Run: node --test tests/*.test.js
// Plan all, then build: specs.js check --plan, status and start, on git repositories with a plan branch
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const tmpDir = require('./tmp');

const KIT = path.join(__dirname, '../stacks/react-native/template');
const write = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
// git with a fixed date for each commit, so "after the approval" is exact
let clock = Date.UTC(2026, 9, 1) / 1000;
const git = (dir, ...a) => {
  const date = `@${clock += 60} +0000`;
  return execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
};
const commit = (dir, message) => { git(dir, 'add', '-A'); git(dir, 'commit', '-qm', message); };
const run = (dir, ...a) => {
  const r = spawnSync(process.execPath, ['scripts/amk/specs.js', ...a], { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_COMMITTER_DATE: `@${clock += 60} +0000`, GIT_AUTHOR_DATE: `@${clock} +0000` } });
  return { out: r.stdout + r.stderr, code: r.status };
};

const req = (name, word = 'SHALL') => `### Requirement: ${name}\nThe app ${word} do ${name.toLowerCase()}.\n\n#### Scenario: ${name} works\n- WHEN the driver asks\n- THEN it happens\n`;
// a planned spec: a story naming its ADDED and MODIFIED requirements, and a task each
function spec(dir, id, { add = [], modify = [], remove = [], area = 'home', story, text = '' } = {}) {
  const names = story === undefined ? [...add, ...modify].join(', ') : story;
  write(dir, `specs/${id}/requirements.md`, [`# ${id}\n\nMode: plan-all\n\n## Goal\n\nSomething.\n${text}`,
    `## User stories\n\n### US-1: it\nAs a driver, I want it, so that it works.\n- Requirements: ${names}\n`,
    add.length ? `## ADDED Requirements: ${area}\n\n${add.map(n => req(n)).join('\n')}` : '',
    modify.length ? `## MODIFIED Requirements: ${area}\n\n${modify.map(n => req(n, 'MUST')).join('\n')}` : '',
    remove.length ? `## REMOVED Requirements: ${area}\n\n${remove.map(n => `### Requirement: ${n}\nNot needed.\n`).join('\n')}` : ''].join('\n'));
  write(dir, `specs/${id}/tasks.md`, `# ${id}: tasks\n\n${[...add, ...modify, ...remove].map((n, i) => `- [ ] ${i + 1}. ${n} — for: ${n}`).join('\n')}\n`);
  write(dir, `specs/${id}/progress.md`, fs.readFileSync(path.join(KIT, 'specs/_templates/progress.md'), 'utf8').replace(/^Status:.*$/m, 'Status:        not started'));
}
// rows: [id, depends on, batch, status]
const plan = (dir, rows, extra = '') => write(dir, 'specs/plan.md', `# Plan\n\nApproved: feature map 2026-10-01\n\n## Features\n\n| # | Feature | Goal | Depends on | Batch | Size | Status |\n|---|---|---|---|---|---|---|\n${
  rows.map(([id, deps, batch, status], i) => `| ${i + 1} | ${id} | does ${id} | ${deps || 'none'} | ${batch || 1} | ~4 | ${status || 'approved'} |`).join('\n')}\n\n## Shared design\n\n- New words: ${extra}\n`);

// an app on main with a living spec (home: Greeting, Old banner), and a plan branch made from it
function app() {
  const dir = tmpDir('amk-plan-');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'amk-test');
  git(dir, 'config', 'user.email', 'amk-test@example.invalid');
  write(dir, 'package.json', '{"name":"app"}\n');
  for (const f of ['specs.js', 'baseline.js']) write(dir, `scripts/amk/${f}`, fs.readFileSync(path.join(KIT, 'scripts/amk', f), 'utf8'));
  write(dir, 'specs/_templates/progress.md', fs.readFileSync(path.join(KIT, 'specs/_templates/progress.md'), 'utf8'));
  write(dir, 'specs/current/home.md', `# Home\n\n## Requirements\n\n${req('Greeting')}\n${req('Old banner')}`);
  write(dir, 'docs/amk/glossary.md', '# Glossary\n\n**Visit**: a planned call on a customer.\n_Not:_ appointment, meeting.\n\n**Driver**: who drives the car.\n_Not:_ user.\n');
  commit(dir, 'the app');
  git(dir, 'switch', '-qc', 'plan');
  return dir;
}

test('check --plan: the table, each spec, and what the specs get wrong together', () => {
  const dir = app();
  plan(dir, [['a'], ['b', 'a, ghost'], ['c', 'd', 1, 'approved'], ['d', 'none', 2], ['e', 'f'], ['f', 'e'], ['g', '', 1, 'waiting'], ['h', '', 1, 'ready for approval']]);
  spec(dir, 'a', { add: ['Sign in'] });
  spec(dir, 'b', { add: ['Sign in', 'Profile'], modify: ['Greeting'] });
  spec(dir, 'c', { modify: ['Profile', 'Nowhere'], remove: ['Old banner'] });
  spec(dir, 'd', { add: ['Greeting', 'Visits list'], story: 'Visits list', text: '\nA list of each appointment.\n' });
  spec(dir, 'e', { add: ['Export'], story: '' });
  write(dir, 'specs/h/requirements.md', '# h\n\n## Goal\n\nLater.\n');
  const { out, code } = run(dir, 'check', '--plan');
  assert.strictEqual(code, 1, out);
  for (const want of [
    /b depends on ghost, which is neither in the plan nor built on main/,
    /c depends on d, which comes after it/,
    /e is in a dependency loop/,
    /f is in a dependency loop/,
    /g: status "waiting" isn't one of: drafting, questions open, ready for approval, approved, changes requested, held/,
    /specs\/h: ready for approval, but its requirements or tasks aren't written yet/,
    /"sign in" \(home\) is added by both a and b/,
    /specs\/c modifies "Profile", which b adds: add b to its Depends on/,
    /specs\/c modifies "Nowhere" \(home\), which neither the living spec on main nor another planned feature has/,
    /specs\/d adds "Greeting" \(home\), which the living spec on main already has: list it under MODIFIED/,
    /specs\/d\/requirements\.md: line \d+: "Greeting" is in no user story/,
    /specs\/e\/requirements\.md:\d+ US-1 names no requirement/,
    /e depends on f, which comes after it/,
    /specs\/f: approved, but its requirements or tasks aren't written yet/,
    /! specs\/d says "appointment": the glossary's word is Visit/,
  ]) assert.match(out, want);
  assert.doesNotMatch(out, /Old banner/, 'removing a requirement the living spec has is fine');
  assert.doesNotMatch(out, /specs\/b modifies "Greeting"/, 'b modifies a requirement main has (d adding it again is d\'s mistake)');

  // the same plan, put right: it passes, and a word to avoid is only a warning
  plan(dir, [['a'], ['b', 'a'], ['c', 'b'], ['d', 'none', 2]], '**Customer**: who the Visits are for. _Not:_ client.');
  spec(dir, 'b', { add: ['Profile'], modify: ['Greeting'] });
  spec(dir, 'c', { modify: ['Profile'], remove: ['Old banner'] });
  spec(dir, 'd', { add: ['Visits list'], text: '\nEach client\'s visits.\n' });
  for (const f of ['e', 'h']) fs.rmSync(path.join(dir, 'specs', f), { recursive: true });
  const ok = run(dir, 'check', '--plan');
  assert.strictEqual(ok.code, 0, ok.out);
  assert.match(ok.out, /✓ plan: 4 feature\(s\), 4 with a spec, checked together against main/);
  assert.match(ok.out, /! specs\/d says "client": the glossary's word is Customer/);
  assert.doesNotMatch(ok.out, /says "user"/, 'the template\'s "## User stories" heading isn\'t the spec\'s word');
});

test('start: the next ready feature, its spec as approved (not a later draft), stacked on the last one done', () => {
  const dir = app();
  plan(dir, [['a'], ['b', 'a'], ['c'], ['d', '', 1, 'drafting']]);
  spec(dir, 'a', { add: ['Sign in'] });
  spec(dir, 'b', { add: ['Profile'] });
  spec(dir, 'c', { add: ['Settings'] });
  commit(dir, 'docs(spec): a, b, c approved');
  // a draft of a's change, committed later with the plan (d's questions) while a still says approved: never the build's
  fs.appendFileSync(path.join(dir, 'specs/a/requirements.md'), '\nDRAFT LINE\n');
  write(dir, 'specs/plan.md', read(dir, 'specs/plan.md').replace('| drafting |', '| questions open |'));
  commit(dir, 'docs(plan): a draft, and d\'s questions');
  git(dir, 'switch', '-q', 'main');

  const one = run(dir, 'start');
  assert.strictEqual(one.code, 0, one.out);
  assert.match(one.out, /Started a on feature\/a, from main \(its PR's base\), with the spec as approved in [0-9a-f]{7}/);
  assert.strictEqual(git(dir, 'branch', '--show-current').trim(), 'feature/a');
  assert.doesNotMatch(read(dir, 'specs/a/requirements.md'), /DRAFT LINE/);
  assert.match(read(dir, 'specs/a/progress.md'), /## Log\n\n<!--[^\n]*-->\n\n- [\d-]+ [\d:]+: started from main \(its PR goes to main\), with the spec as approved in [0-9a-f]{7} on plan\n/);
  assert.match(git(dir, 'log', '-1', '--format=%B'), /^docs\(spec\): a from the plan, as approved in [0-9a-f]{7}\n\nSpec: specs\/a/);

  // a is taken but not done: b waits for it, c starts from main
  const two = run(dir, 'start');
  assert.match(two.out, /Started c on feature\/c, from main/);
  // a done: b stacks on it; c done too, on main, isn't in b's way
  for (const id of ['a', 'c']) {
    git(dir, 'switch', '-q', `feature/${id}`);
    write(dir, `specs/${id}/progress.md`, read(dir, `specs/${id}/progress.md`).replace(/^Status:.*$/m, 'Status:        done'));
    commit(dir, `${id} done`);
  }
  const three = run(dir, 'start');
  assert.strictEqual(three.code, 0, three.out);
  assert.match(three.out, /Started b on feature\/b, from feature\/a \(its PR's base\)/, 'the branch that holds its dependency, though c is later');
  assert.ok(git(dir, 'merge-base', '--is-ancestor', 'feature/a', 'feature/b') === '', 'b holds a, which it needs');

  // nothing left: what waits, and why
  git(dir, 'switch', '-q', 'main');
  const none = run(dir, 'start');
  assert.strictEqual(none.code, 3, none.out);
  assert.match(none.out, /Waiting for the plan: no feature is ready/);
  assert.match(none.out, /b: taken: feature\/b, not started/);
  assert.match(none.out, /d: questions open/);
  assert.match(run(dir, 'start', 'd').out, /d can't start[\s\S]*d: questions open/);
});

test('start: a requirement changed outside the plan after the approval stops the feature; a dependency\'s change doesn\'t', () => {
  const dir = app();
  plan(dir, [['a'], ['b', 'a']]);
  spec(dir, 'a', { modify: ['Greeting'] });
  spec(dir, 'b', { modify: ['Greeting', 'Old banner'] });
  commit(dir, 'docs(spec): a, b approved');
  git(dir, 'switch', '-q', 'main');
  // after the approval: an m-change outside the plan changes Old banner; a (b's dependency) changes Greeting
  write(dir, 'specs/current/home.md', read(dir, 'specs/current/home.md').replace('do old banner.', 'do old banner twice.\n\nSource: specs/chg-1'));
  commit(dir, 'chg-1');
  const a = run(dir, 'start');
  assert.strictEqual(a.code, 0, a.out);
  write(dir, 'specs/current/home.md', read(dir, 'specs/current/home.md').replace('do greeting.', 'do greeting kindly.\n\nSource: specs/a'));
  write(dir, 'specs/a/progress.md', read(dir, 'specs/a/progress.md').replace(/^Status:.*$/m, 'Status:        done'));
  commit(dir, 'a built');
  git(dir, 'switch', '-q', 'main');
  git(dir, 'merge', '-q', '--no-ff', 'feature/a', '-m', 'merge a');
  const b = run(dir, 'start');
  assert.strictEqual(b.code, 4, b.out);
  assert.match(b.out, /Started b on feature\/b, from main/);
  assert.match(b.out, /"Old banner" \(home\) changed after the plan approved b, in specs\/chg-1/);
  assert.doesNotMatch(b.out, /Greeting/, 'a, which b depends on, changed it: expected');
});

test('status: the plan\'s features where they stand (built, being built, approved, drafting), sizes per batch', () => {
  const dir = app();
  plan(dir, [['a'], ['b', 'a'], ['c', '', 2], ['d', '', 2, 'held: waiting on the client']]);
  spec(dir, 'a', { add: ['Sign in'] });
  spec(dir, 'b', { add: ['Profile', 'Avatar'] });
  spec(dir, 'c', { add: ['Settings'] });
  // planning copies the templates: b's handoff still has the template's placeholder status
  write(dir, 'specs/b/progress.md', fs.readFileSync(path.join(KIT, 'specs/_templates/progress.md'), 'utf8').replace(/^Blocked:.*$/m, 'Blocked:       None in this build'));
  commit(dir, 'docs(spec): a, b, c approved');
  const onPlan = run(dir, 'status');
  assert.match(onPlan.out, /Plan \(specs\/plan\.md on this folder\): 4 feature\(s\)/);
  assert.match(onPlan.out, /d +batch 2 +held: waiting on the client +\(no spec yet, ~4 h\)/);
  git(dir, 'switch', '-q', 'main');
  run(dir, 'start');
  write(dir, 'specs/current/home.md', `${read(dir, 'specs/current/home.md')}\n${req('Sign in').replace('#### Scenario', 'Source: specs/a\n\n#### Scenario')}`);
  write(dir, 'specs/a/progress.md', read(dir, 'specs/a/progress.md').replace(/^Status:.*$/m, 'Status:        done'));
  commit(dir, 'a built');
  git(dir, 'switch', '-q', 'main');
  git(dir, 'merge', '-q', '--no-ff', 'feature/a', '-m', 'merge a');
  run(dir, 'start');
  git(dir, 'switch', '-q', 'main');
  const { out, code } = run(dir, 'status');
  assert.strictEqual(code, 0, out);
  assert.match(out, /Plan \(specs\/plan\.md on plan\): 4 feature\(s\)/);
  assert.match(out, /\ba +batch 1 +built\b/);
  assert.match(out, /\bb +batch 1 +being built on feature\/b: not started +\(1 stories, 2 requirements, 2 scenarios, 2 tasks\)/, '"None in this build" blocks nothing');
  assert.match(out, /\bc +batch 2 +approved +\(1 stories, 1 requirements, 1 scenarios, 1 tasks\)/);
  assert.match(out, /Size: batch 1 3 h, batch 2 ~5 h/);
});

test('tests <id> on the plan branch reads the living spec and flows of main, not the plan branch\'s old copies', () => {
  const dir = app();
  spec(dir, 'a', { modify: ['Greeting'] });
  plan(dir, [['a']]);
  commit(dir, 'plan');
  git(dir, 'switch', '-q', 'main');
  write(dir, '.maestro/greet.yaml', 'appId: x\n---\n- launchApp\n');
  commit(dir, 'a flow on main');
  git(dir, 'switch', '-q', 'plan');
  const { out, code } = run(dir, 'tests', 'a');
  assert.strictEqual(code, 0, out);
  assert.match(out, /as they are on main/);
  assert.match(out, /\.maestro\/greet\.yaml/);
  assert.deepStrictEqual(git(dir, 'worktree', 'list').trim().split('\n').length, 1, 'the temporary worktree is gone');
});

test('start with a remote: fetches, starts from origin/main, and the branch tracks nothing (a plain push can\'t reach main)', () => {
  const dir = app();
  plan(dir, [['a']]);
  spec(dir, 'a', { add: ['Sign in'] });
  commit(dir, 'docs(spec): a approved');
  const origin = tmpDir('amk-plan-origin-');
  git(origin, 'init', '-q', '--bare');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '-q', 'origin', 'main', 'plan');
  git(dir, 'remote', 'set-head', 'origin', 'main');
  git(dir, 'switch', '-q', 'main');
  git(dir, 'branch', '-q', '-D', 'plan');
  const { out, code } = run(dir, 'start');
  assert.strictEqual(code, 0, out);
  assert.match(out, /Started a on feature\/a, from origin\/main/);
  assert.match(read(dir, 'specs/a/progress.md'), /as approved in [0-9a-f]{7} on origin\/plan/);
  assert.throws(() => git(dir, 'rev-parse', '--abbrev-ref', 'feature/a@{upstream}'));
});

test('built on main: a feature whose progress.md there says done counts, without a Source line (it only removed)', () => {
  const dir = app();
  plan(dir, [['a'], ['b', 'a']]);
  spec(dir, 'a', { remove: ['Old banner'] });
  spec(dir, 'b', { add: ['Profile'] });
  commit(dir, 'docs(spec): a, b approved');
  git(dir, 'switch', '-q', 'main');
  write(dir, 'specs/a/progress.md', 'Status:        done\n');
  commit(dir, 'a, merged');
  const { out, code } = run(dir, 'start');
  assert.strictEqual(code, 0, out);
  assert.match(out, /Started b on feature\/b, from main/);
});

test('check --plan on the plan branch says when main\'s kit is newer: the branch never takes main\'s changes', () => {
  const dir = app();
  plan(dir, [['a']]);
  spec(dir, 'a', { add: ['Sign in'] });
  commit(dir, 'plan');
  assert.doesNotMatch(run(dir, 'check', '--plan').out, /kit's scripts/);
  git(dir, 'switch', '-q', 'main');
  fs.appendFileSync(path.join(dir, 'scripts/amk/specs.js'), '// a kit update\n');
  commit(dir, 'the kit, updated');
  git(dir, 'switch', '-q', 'plan');
  const { out, code } = run(dir, 'check', '--plan');
  assert.strictEqual(code, 0, out);
  assert.match(out, /! the kit's scripts here aren't main's \(a kit update there\?\): git checkout main -- scripts\/amk \.agents\/skills \.rulesync, then commit/);
});

test('a feature whose summary waits on someone (the client) isn\'t built, even approved; "none" builds on the assumptions', () => {
  const dir = app();
  plan(dir, [['a'], ['b']]);
  spec(dir, 'a', { add: ['Sign in'] });
  spec(dir, 'b', { add: ['Banner'] });
  fs.appendFileSync(path.join(dir, 'specs/plan.md'), '\n## Summaries\n\n### a\n- Risk: low\n- Waiting on: the client, for specs/a/questions-client.md\n\n### b\n- Waiting on: none (building on the working assumptions)\n');
  const check = run(dir, 'check', '--plan');
  assert.strictEqual(check.code, 1, check.out);
  assert.match(check.out, /a is approved, but its summary waits on the client, for specs\/a\/questions-client\.md: hold it \(held: <who>\)/);
  assert.doesNotMatch(check.out, /\bb is approved, but/);
  commit(dir, 'docs(spec): a, b approved');
  assert.match(run(dir, 'status').out, /\ba +batch 1 +approved, but waits on the client/);
  git(dir, 'switch', '-q', 'main');
  const first = run(dir, 'start');
  assert.match(first.out, /Started b on feature\/b/, 'a waits, so b goes first');
  git(dir, 'switch', '-q', 'main');
  const none = run(dir, 'start');
  assert.strictEqual(none.code, 3, none.out);
  assert.match(none.out, /a: approved, but waits on the client, for specs\/a\/questions-client\.md/);
});

test('plan-folder: a second folder on the plan branch, with the kit\'s files git doesn\'t track copied in', () => {
  const dir = app();
  git(dir, 'switch', '-q', 'main');
  git(dir, 'branch', '-q', '-D', 'plan');
  write(dir, '.gitignore', '.agents\n.githooks\n.claude\n');
  write(dir, '.agents/skills/m-feature/plan.md', 'the planning steps\n');
  write(dir, '.githooks/pre-commit', '#!/bin/sh\nexit 0\n');
  fs.chmodSync(path.join(dir, '.githooks/pre-commit'), 0o755);
  if (process.platform !== 'win32') { fs.mkdirSync(path.join(dir, '.claude')); fs.symlinkSync('../.agents/skills', path.join(dir, '.claude/skills')); }
  commit(dir, 'the kit, its folders out of git');
  const second = `${dir}-plan`;
  try {
    const { out, code } = run(dir, 'plan-folder');
    assert.strictEqual(code, 0, out);
    assert.match(out, /-plan: on the plan branch, with the \d+ kit file\(s\) git doesn't track here/);
    assert.strictEqual(git(second, 'branch', '--show-current').trim(), 'plan');
    assert.strictEqual(read(second, '.agents/skills/m-feature/plan.md'), 'the planning steps\n');
    assert.ok(fs.existsSync(path.join(second, 'scripts/amk/specs.js')), 'what git tracks is there');
    if (process.platform !== 'win32') {
      assert.ok(fs.statSync(path.join(second, '.githooks/pre-commit')).mode & 0o111, 'the hook stays executable');
      assert.strictEqual(fs.readlinkSync(path.join(second, '.claude/skills')), '../.agents/skills');
    }
    assert.match(run(dir, 'plan-folder').out, /is there already/);
  } finally {
    try { git(dir, 'worktree', 'remove', '--force', second); } catch {}
    fs.rmSync(second, { recursive: true, force: true });
  }
});

test('a planned spec in the second layer: the template\'s requirement placeholders and a note in the story\'s Requirements line are "not written yet"', () => {
  const dir = app();
  plan(dir, [['a', '', 1, 'drafting']]);
  const tpl = fs.readFileSync(path.join(KIT, 'specs/_templates/requirements.md'), 'utf8');
  write(dir, 'specs/a/requirements.md', tpl.replace('# <ID>: <title>', '# a: notes').replace(/### US-1: <short title>\n[^\n]*\n- Requirements: [^\n]*/, '### US-1: Notes\nAs a driver, I want my notes, so that I remember.\n- Requirements: (written with the requirements)'));
  const ok = run(dir, 'check', '--plan');
  assert.strictEqual(ok.code, 0, ok.out);
  assert.strictEqual(run(dir, 'check', 'specs/a/requirements.md').code, 0);
  // real requirements under the template's "<area>" still need the area named, and merge never takes a placeholder
  write(dir, 'specs/a/requirements.md', fs.readFileSync(path.join(dir, 'specs/a/requirements.md'), 'utf8').replace('### Requirement: <name>', `${req('Real one').trim()}\n\n### Requirement: <name>`));
  assert.match(run(dir, 'check', 'specs/a/requirements.md').out, /name the area, e\.g\. "## ADDED Requirements: login"/);
  write(dir, 'specs/b/requirements.md', `# b\n\n## ADDED Requirements: home\n\n${req('Real one')}\n### Requirement: <name>\nThe app SHALL <behavior>.\n\n## MODIFIED Requirements: <area>\n`);
  const merged = run(dir, 'merge', 'b');
  assert.strictEqual(merged.code, 0, merged.out);
  assert.doesNotMatch(read(dir, 'specs/current/home.md'), /<name>/);
  assert.ok(!fs.existsSync(path.join(dir, 'specs/current/undefined.md')));
});

test('branch: a feature built feature by feature starts on a feature branch not merged yet (part 1 of a split), else on main', () => {
  const dir = app();
  git(dir, 'switch', '-q', 'main');
  const built = (id, name) => {
    write(dir, `specs/${id}/requirements.md`, `# ${id}\n\n## Goal\n\nIt.\n\n## ADDED Requirements: home\n\n${req(name)}`);
    write(dir, 'specs/current/home.md', `${read(dir, 'specs/current/home.md')}\n${req(name)}Source: specs/${id}\n`);
    write(dir, `specs/${id}/progress.md`, read(dir, `specs/${id}/progress.md`).replace(/^Status:.*$/m, 'Status:        done'));
    commit(dir, `${id} built`);
  };
  const startLine = id => (/started from (\S+) \(its PR goes to ([^)\s]+)\)/.exec(read(dir, `specs/${id}/progress.md`)) || []).slice(1);
  // part 1, from main
  let r = run(dir, 'branch', 'p1');
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /^Started feature\/p1 from main\.$/m);
  assert.deepStrictEqual(startLine('p1'), ['main', 'main']);
  built('p1', 'Part one');
  // part 2, while part 1's PR is open: on part 1, so it has that code, and its PR goes there
  git(dir, 'switch', '-q', 'main');
  r = run(dir, 'branch', 'p2');
  assert.match(r.out, /^Started feature\/p2 from feature\/p1, which isn't merged into main yet: p2 builds on it, and its PR goes there/m);
  assert.deepStrictEqual(startLine('p2'), ['feature/p1', 'feature/p1']);
  assert.match(git(dir, 'log', '--format=%s', 'feature/p2'), /p1 built/, 'part 1\'s code is there');
  built('p2', 'Part two');
  // part 3: the newest of them, or the one you're on
  git(dir, 'switch', '-q', 'main');
  run(dir, 'branch', 'p3');
  assert.deepStrictEqual(startLine('p3'), ['feature/p2', 'feature/p2']);
  git(dir, 'switch', '-q', 'feature/p1');
  run(dir, 'branch', 'p4');
  assert.deepStrictEqual(startLine('p4'), ['feature/p1', 'feature/p1'], 'the branch you\'re on');
  // an existing branch: switched to, nothing written
  git(dir, 'switch', '-q', 'main');
  assert.match(run(dir, 'branch', 'p2').out, /^Switched to feature\/p2/m);
  // merged ones don't count: p1 by a merge, p2 squashed (only its living spec says so)
  git(dir, 'switch', '-q', 'main');
  for (const b of ['feature/p3', 'feature/p4']) git(dir, 'branch', '-q', '-D', b);
  git(dir, 'merge', '-q', '--no-ff', '-m', 'Merge p1', 'feature/p1');
  git(dir, 'merge', '-q', '--squash', 'feature/p2');
  commit(dir, 'p2 (squashed)');
  r = run(dir, 'branch', 'next');
  assert.match(r.out, /^Started feature\/next from main\.$/m, r.out);
});

test('changed-flows: the flows using a testID a changed file sets, through a subflow too, and the flows changed themselves', () => {
  const dir = app();
  git(dir, 'switch', '-q', 'main');
  write(dir, 'src/Home.tsx', 'export const H = () => <Text testID="home-title" />;\n');
  write(dir, 'src/Login.tsx', "export const L = () => <TextInput testID={'login-email'} />;\n");
  write(dir, '.maestro/home.yaml', 'appId: x\n---\n- launchApp\n- assertVisible:\n    id: "home-title"\n');
  write(dir, '.maestro/orders.yaml', 'appId: x\n---\n- launchApp\n- runFlow: { file: subflows/login.yaml, when: { visible: { id: "login-email" } } }\n- tapOn: { id: orders-list }\n');
  write(dir, '.maestro/subflows/login.yaml', 'appId: x\n---\n- tapOn:\n    id: login-email\n');
  write(dir, '.maestro/about.yaml', 'appId: x\n---\n- launchApp\n# id: "home-title" in a comment only\n');
  commit(dir, 'screens and flows');
  git(dir, 'switch', '-q', '-c', 'feature/x');
  const flows = () => run(dir, 'changed-flows').out.split('\n').filter(Boolean).map(f => path.basename(f));
  assert.deepStrictEqual(flows(), [], 'nothing changed yet');
  write(dir, 'src/Home.tsx', 'export const H = () => <Text testID="home-title" style={s.big} />;\n');
  assert.deepStrictEqual(flows(), ['home.yaml']);
  write(dir, 'src/Login.tsx', "export const L = () => <TextInput testID={'login-email'} autoComplete=\"email\" />;\n");
  assert.deepStrictEqual(flows(), ['home.yaml', 'orders.yaml'], 'orders runs the login subflow');
  write(dir, '.maestro/about.yaml', 'appId: x\n---\n- launchApp\n- takeScreenshot: about\n');
  assert.deepStrictEqual(flows(), ['about.yaml', 'home.yaml', 'orders.yaml'], 'a flow changed itself');
});
