// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const tmpDir = require('./tmp');

const SCRIPT = path.join(__dirname, '../stacks/react-native/template/scripts/amk/specs.js');
const run = (dir, ...a) => { const r = spawnSync(process.execPath, [SCRIPT, ...a], { cwd: dir, encoding: 'utf8' }); return { out: r.stdout + r.stderr, code: r.status }; };
const write = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');

const req = (name, sentence, scenario = `#### Scenario: ${name} works\n- GIVEN the app is open\n- WHEN it happens\n- THEN it works\n`) =>
  `### Requirement: ${name}\n${sentence}\n\n${scenario}`;
const feature = (sections, status = 'in progress — task 1 of 2') => ({
  requirements: `# F: feature\n\n## Goal\n\nSomething.\n\n${sections}\n## Out of scope\n`,
  progress: `# Progress\n\nStatus:        ${status}\n`,
});
function app(specs = {}) {
  const dir = tmpDir('amk-spec-');
  for (const [id, f] of Object.entries(specs)) {
    write(dir, `specs/${id}/requirements.md`, f.requirements);
    write(dir, `specs/${id}/progress.md`, f.progress);
    if (f.tasks) write(dir, `specs/${id}/tasks.md`, f.tasks);
  }
  return dir;
}

test('check: a well-formed spec passes; missing SHALL, scenario, THEN, area or section fail', () => {
  const good = app({ ok: feature(`## ADDED Requirements: home\n\n${req('Dark mode switch', 'The app SHALL offer a dark mode switch on the home screen.')}\n## REMOVED Requirements: home\n\n### Requirement: Old banner\nNo longer shown.\n`) });
  assert.strictEqual(run(good, 'check').code, 0);

  const bad = app({ bad: feature([
    '## ADDED Requirements: home\n',
    req('No keyword', 'The app shows a switch.'),
    '### Requirement: No scenario\nThe app SHALL do something.\n',
    req('No then', 'The app SHALL do more.', '#### Scenario: Half\n- WHEN it happens\n'),
    '## MODIFIED Requirements\n',
    req('Where', 'The app SHALL be somewhere.'),
  ].join('\n')) });
  write(bad, 'specs/stray/requirements.md', `# S\n\n${req('Loose', 'The app SHALL float.')}`);
  write(bad, 'specs/stray/progress.md', 'Status: done\n');
  const { out, code } = run(bad, 'check');
  assert.strictEqual(code, 1);
  assert.match(out, /"No keyword": needs a sentence with SHALL or MUST/);
  assert.match(out, /"No scenario": needs at least one "#### Scenario:"/);
  assert.match(out, /scenario "Half" needs WHEN and THEN/);
  assert.match(out, /name the area, e\.g\. "## MODIFIED Requirements: login"/);
  assert.match(out, /"Loose" isn't under an "## ADDED\/MODIFIED\/REMOVED Requirements: <area>" heading/);
});

test('check --skip-drafts leaves out specs whose work hasn\'t started; the living spec is always checked', () => {
  const dir = app({ draft: feature('## ADDED Requirements: home\n\n### Requirement: <name>\n<sentence>\n', 'not started') });
  write(dir, 'specs/current/home.md', `# Home\n\n## Requirements\n\n${req('Dup', 'The app SHALL a.')}\n${req('Dup', 'The app SHALL b.')}`);
  const { out, code } = run(dir, 'check', '--skip-drafts', 'specs/draft/requirements.md', 'specs/current/home.md');
  assert.strictEqual(code, 1);
  assert.doesNotMatch(out, /draft/);
  assert.match(out, /specs\/current\/home\.md:\d+ "Dup": appears twice/);
});

test('merge: ADDED creates the area with sources; later MODIFIED, REMOVED and ADDED apply by name; re-running changes nothing', () => {
  const dir = app({
    one: feature(`## ADDED Requirements: home\n\n${req('Dark mode switch', 'The app SHALL offer a dark mode switch.')}\n${req('Banner', 'The app SHALL show a welcome banner.')}`),
    two: feature(`## MODIFIED Requirements: home\n\n${req('Dark mode switch', 'The app SHALL offer a dark mode switch that follows the system setting.')}\n## REMOVED Requirements: home\n\n### Requirement: Banner\nReplaced by onboarding.\n\n## ADDED Requirements: settings\n\n${req('Language', 'The app SHALL let the user pick a language.')}`),
  });
  assert.match(run(dir, 'merge', 'one').out, /specs\/current\/home\.md: 2 added, 0 changed, 0 removed/);
  const home = read(dir, 'specs/current/home.md');
  assert.match(home, /^# Home\n\n## Requirements\n\n### Requirement: Dark mode switch\nThe app SHALL offer a dark mode switch\.\n\nSource: specs\/one\n\n#### Scenario:/);

  const r = run(dir, 'merge', 'two');
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /home\.md: 0 added, 1 changed, 1 removed/);
  assert.match(r.out, /settings\.md: 1 added/);
  const after = read(dir, 'specs/current/home.md');
  assert.match(after, /follows the system setting\.\n\nSource: specs\/two/);
  assert.doesNotMatch(after, /Banner/);
  assert.match(read(dir, 'specs/current/settings.md'), /^# Settings\n/);

  const again = run(dir, 'merge', 'two');
  assert.strictEqual(again.code, 0);
  assert.match(again.out, /"Banner" isn't in specs\/current\/home\.md/);
  assert.strictEqual(read(dir, 'specs/current/home.md'), after, 'unchanged');
  assert.strictEqual(run(dir, 'check').code, 0, 'the merged living spec is well-formed');
});

test('merge refuses a wrong change type and changes nothing; removing the last requirement deletes the area file', () => {
  const dir = app({
    one: feature(`## ADDED Requirements: home\n\n${req('Switch', 'The app SHALL show a switch.')}`),
    clash: feature(`## ADDED Requirements: home\n\n${req('Switch', 'The app SHALL show a different switch.')}\n## MODIFIED Requirements: home\n\n${req('Missing', 'The app SHALL exist.')}`),
    gone: feature('## REMOVED Requirements: home\n\n### Requirement: Switch\nNot needed.\n'),
  });
  run(dir, 'merge', 'one');
  const before = read(dir, 'specs/current/home.md');
  const { out, code } = run(dir, 'merge', 'clash');
  assert.strictEqual(code, 1);
  assert.match(out, /"Switch" already exists in specs\/current\/home\.md: list it under MODIFIED instead/);
  assert.match(out, /no requirement "Missing" in specs\/current\/home\.md to modify: list it under ADDED instead/);
  assert.strictEqual(read(dir, 'specs/current/home.md'), before);

  assert.match(run(dir, 'merge', 'gone').out, /last requirement was removed, so the file was deleted/);
  assert.ok(!fs.existsSync(path.join(dir, 'specs/current/home.md')));
});

test('status lists each spec\'s state and task progress, and counts the living spec', () => {
  const dir = app({
    'DM-1': { ...feature('', 'done'), tasks: '- [x] 1. a\n- [x] 2. b\n' },
    'DM-2': { ...feature('', 'in progress — task 2 of 3'), tasks: '- [x] 1. a\n- [ ] 2. b\n- [ ] 3. c\n' },
  });
  write(dir, 'specs/current/home.md', `# Home\n\n${req('One', 'The app SHALL a.')}`);
  const { out } = run(dir, 'status');
  assert.match(out, /DM-1\s+done\s+tasks 2\/2/);
  assert.match(out, /DM-2\s+in progress — task 2 of 3\s+tasks 1\/3/);
  assert.match(out, /Living spec: 1 area\(s\), 1 requirement\(s\)/);
});
