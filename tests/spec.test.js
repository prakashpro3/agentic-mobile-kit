// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
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

test('check: user stories and use cases, when a spec has them, name its requirements and scenarios; an old spec without them passes', () => {
  const good = app({ ok: feature(`## User stories

### US-1: Dark mode
As a night reader, I want a dark mode switch, so that reading at night is easier.
- Requirements: Dark mode switch, "Follows the system, on start"

## Use cases

### UC-1: Read at night
- Actors: night reader
- Stories: US-1
- Main flow: 1. Opens settings 2. Turns dark mode on
- Alternative flows: 2a. The system is already dark → Scenario: Follows the system. 2b. Turned on by hand → Scenario: Dark mode switch works; 2c. Again → Scenario: Dark mode switch works
- Exceptions: none
<!-- the template's guidance, in comments: "3a. <offline, denied permission> → Scenario: <name>" -->

## ADDED Requirements: home

${req('Dark mode switch', 'The app SHALL offer a dark mode switch.')}
${req('Follows the system, on start', 'The app SHALL start dark when the system is dark.', '#### Scenario: Follows the system\n- WHEN the system is dark\n- THEN the app starts dark\n')}`) });
  const ok = run(good, 'check');
  assert.strictEqual(ok.code, 0, ok.out);

  // a plan approves stories before their requirements exist: empty links pass
  const early = app({ early: feature('## User stories\n\n### US-1: Dark mode\nAs a reader, I want dark mode, so that my eyes rest.\n- Requirements:\n\n## Use cases\n\n### UC-1: Read\n- Stories: US-1\n- Alternative flows: none\n') });
  assert.strictEqual(run(early, 'check').code, 0);

  const bad = app({ bad: feature(`## User stories

### US-1: Dark mode
As a night reader, I want a dark mode switch.
- Requirements: Dark mode switch, Missing one

### US-2: Later
As a user, I want more, so that it's better.
- Requirements:

## Use cases

### UC-1: Read at night
- Stories: US-1, US-3
- Exceptions: 3a. Offline → Scenario: No network

## ADDED Requirements: home

${req('Dark mode switch', 'The app SHALL offer a dark mode switch.')}
${req('Orphan', 'The app SHALL do something no story asked for.')}`) });
  const { out, code } = run(bad, 'check');
  assert.strictEqual(code, 1);
  assert.match(out, /line 9: US-1 needs its sentence: "As a <user>, I want <capability>, so that <benefit>\."/);
  assert.match(out, /US-1 names "Missing one", which isn't a requirement in this spec/);
  assert.match(out, /"Orphan" is in no user story/);
  assert.doesNotMatch(out, /"Dark mode switch" is in no user story|US-2/);
  assert.match(out, /UC-1 names US-3, which isn't a story in this spec/);
  assert.match(out, /UC-1 names the scenario "No network", which isn't in this spec/);

  // a spec from before stories, use cases and tests: as it was
  const old = app({ old: feature(`## ADDED Requirements: home\n\n${req('Banner', 'The app SHALL show a banner.')}`, 'done') });
  assert.strictEqual(run(old, 'check').code, 0);
});

// an app with a living spec: what the areas' specs check, a change that modifies one of them, and flows of every kind
function testedApp() {
  const dir = app({
    'HOME-1': feature(`## ADDED Requirements: home\n\n${req('Dark mode switch', 'The app SHALL offer a dark mode switch.', '#### Scenario: Switch turns dark mode on\n- WHEN the user turns it on\n- THEN the screen is dark\n\n#### Scenario: Follows the system\n- WHEN the system is dark\n- THEN the app is dark\n')}`, 'done'),
    'HOME-2': feature(`## ADDED Requirements: home\n\n${req('Banner', 'The app SHALL show a banner.', '#### Scenario: Banner shows\n- WHEN the home screen opens\n- THEN the banner shows\n\n#### Scenario: Banner hides on scroll\n- WHEN the user scrolls\n- THEN the banner hides\n')}`, 'done'),
    'LOGIN-1': feature(`## ADDED Requirements: login\n\n${req('Sign in', 'The app SHALL sign the user in.', '#### Scenario: Correct code\n- WHEN the code is right\n- THEN the home screen shows\n')}`, 'done'),
    'NEW-1': feature(`## MODIFIED Requirements: home\n\n${req('Banner', 'The app SHALL show a banner with the date.', '#### Scenario: Banner shows the date\n- WHEN the home screen opens\n- THEN the banner shows the date\n')}\n## ADDED Requirements: home\n\n${req('Greeting', 'The app SHALL greet the user.', '#### Scenario: Says hello\n- GIVEN a signed-in user\n- WHEN the home screen opens\n- THEN it says hello\n')}`),
  });
  for (const id of ['HOME-1', 'HOME-2', 'LOGIN-1']) run(dir, 'merge', id);
  write(dir, '.maestro/HOME-1.yaml', 'appId: ${APP_ID}\n---\n- launchApp\n# Scenario 1: Switch turns dark mode on\n- tapOn:\n    id: "dark"\n- assertVisible:\n    id: "dark-screen"\n- takeScreenshot: home-1-1\n# Scenario 3: Old toggle\n- assertVisible:\n    id: "toggle"\n');
  write(dir, '.maestro/HOME-2.yaml', 'appId: ${APP_ID}\n---\n- launchApp\n# Scenario 1: Banner shows\n- assertVisible:\n    id: "banner"\n');
  // a block with only its number, as the flow template's "# Scenario 2: …"
  write(dir, '.maestro/LOGIN-1.yaml', 'appId: ${APP_ID}\n---\n- launchApp\n# Scenario 1: …\n- assertVisible:\n    id: "home"\n');
  write(dir, '.maestro/offline-start-sync-1.yaml', 'appId: ${APP_ID}\ntags: [smoke]\n---\n- launchApp\n');
  // "Follows the system" is checked by a Jest test named after it
  write(dir, 'src/__tests__/theme.test.ts', "describe('theme', () => {\n  it('follows the system', () => {});\n});\n");
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

test('tests <id>: the specs and flows behind its areas, what to change or retire, scenarios with no check, flows no spec links to, and the command', () => {
  const dir = testedApp();
  const { out, code } = run(dir, 'tests', 'NEW-1');
  assert.strictEqual(code, 0, out);
  assert.match(out, /^Tests for NEW-1: the area home$/m);
  assert.match(out, /NEW-1 \(this change\): no flow\n {2}HOME-1: \.maestro\/HOME-1\.yaml\n {2}HOME-2: \.maestro\/HOME-2\.yaml/);
  assert.doesNotMatch(out, /LOGIN-1:/, 'another area\'s spec');
  assert.match(out, /MODIFIED "Banner" \(home, from specs\/HOME-2\): \.maestro\/HOME-2\.yaml:4 \(scenario "Banner shows"\)/);
  assert.match(out, /home: "Greeting", scenario "Says hello" \(this change\)/);
  assert.match(out, /home: "Banner", scenario "Banner shows the date" \(this change\)/);
  assert.doesNotMatch(out, /scenario "Follows the system"|scenario "Switch turns dark mode on"|scenario "Banner hides on scroll"/, 'checked by Jest, a flow block, or replaced by this change');
  assert.match(out, /To retire[^\n]*\n {2}\.maestro\/HOME-1\.yaml:10 # Scenario 3: Old toggle/);
  assert.match(out, /Flows no spec links to[^\n]*\n {2}\.maestro\/offline-start-sync-1\.yaml \(tags: smoke\)/);
  assert.match(out, /Run them: sh scripts\/amk\/verify\.sh all --spec NEW-1,HOME-1,HOME-2 --label NEW-1$/m);

  // a release: every area, and every flow. A spec not merged yet keeps its flow's blocks
  write(dir, '.maestro/NEW-1.yaml', 'appId: ${APP_ID}\n---\n- launchApp\n# Scenario 2: Says hello\n- assertVisible:\n    id: "hello"\n');
  // a spec whose id starts others' (HOME, HOME-1): their flows are its flows too, and each block is listed once
  write(dir, 'specs/HOME/progress.md', 'Status: done\n');
  const all = run(dir, 'tests');
  assert.strictEqual((all.out.match(/HOME-1\.yaml:10 # Scenario 3: Old toggle/g) || []).length, 1, all.out);
  assert.match(all.out, /^Tests for a release: every area of the living spec \(2\)$/m);
  assert.match(all.out, /LOGIN-1: \.maestro\/LOGIN-1\.yaml/);
  assert.match(all.out, /home: "Banner", scenario "Banner hides on scroll" \(specs\/HOME-2\)/);
  assert.doesNotMatch(all.out, /scenario "Correct code"|LOGIN-1\.yaml:4|NEW-1\.yaml/, 'a block found by its number, and an unmerged spec\'s');
  assert.match(all.out, /Run them: sh scripts\/amk\/verify\.sh all --label release$/m);
  assert.strictEqual(run(dir, 'tests', 'NOPE').code, 1);
});

test('flow <id> writes a block for each scenario, never over a flow that\'s there, and lists the blocks it\'s missing', () => {
  const dir = testedApp();
  write(dir, 'specs/_templates/flow.yaml', fs.readFileSync(path.join(__dirname, '../stacks/react-native/template/specs/_templates/flow.yaml'), 'utf8'));
  assert.match(run(dir, 'flow', 'NEW-1').out, /\.maestro\/NEW-1\.yaml: a block for each of the 2 scenarios/);
  const text = read(dir, '.maestro/NEW-1.yaml');
  assert.match(text, /^appId: \$\{APP_ID\}[^\n]*\n[\s\S]*- extendedWaitUntil:/m, 'the template\'s start');
  assert.match(text, /# Scenario 1: Banner shows the date\n# {3}WHEN the home screen opens\n# {3}THEN the banner shows the date\n/);
  assert.match(text, /# Scenario 2: Says hello\n# {3}GIVEN a signed-in user\n[\s\S]*- takeScreenshot: NEW-1-2-says-hello\n$/);
  assert.doesNotMatch(text, /^- assertVisible/m, 'the assertions are left to write');

  fs.appendFileSync(path.join(dir, 'specs/NEW-1/requirements.md'), '\n#### Scenario: Says goodbye\n- WHEN the user leaves\n- THEN it says goodbye\n');
  const again = run(dir, 'flow', 'NEW-1');
  assert.match(again.out, /\.maestro\/NEW-1\.yaml already there, so nothing was written\. Blocks missing[^\n]*\n {2}# Scenario 3: Says goodbye$/m);
  assert.strictEqual(read(dir, '.maestro/NEW-1.yaml'), text);
  assert.match(run(dir, 'flow', 'LOGIN-1').out, /Each of the 1 scenarios has a block/);
});
