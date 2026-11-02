// The eval cases, which run.js runs. Each sets up its own copy of the scratch app, runs Claude Code once or more (a later
// run goes on in the same session, as a person answering would), and returns what went wrong (nothing: it passed).
// The checks look at the files and the tool calls; at the words only where a rule is about what the user is asked.
// No case may reach a device: verify.sh is allowed for its code checks (quick) only, as a developer's own emulator or
// simulator may be running.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const read = (dir, f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return null; } };
const write = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
const git = (dir, ...a) => execFileSync('git', ['-c', 'user.name=amk-eval', '-c', 'user.email=amk-eval@example.invalid', ...a], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const commit = (dir, message) => { git(dir, 'add', '-A'); git(dir, 'commit', '-qm', message); };
// a run's Bash calls whose command has this text
const bash = (run, text) => run.calls.filter(c => c.name === 'Bash' && String(c.input.command || '').includes(text));
// the code changed since the case began: files outside specs/, docs/ (a spec adds words to the glossary) and .amk/
const codeChanged = (dir, base) => [...git(dir, 'diff', '--name-only', base).split('\n'), ...git(dir, 'ls-files', '--others', '--exclude-standard').split('\n')]
  .filter(f => f && !/^(specs|docs|\.amk)\//.test(f));
const newSpecs = dir => fs.readdirSync(path.join(dir, 'specs')).filter(d => !['_templates', 'current'].includes(d));
// the scenario rows of a spec's test plan (## Tests in design.md) with both cells filled, not a <placeholder>
const testRows = (dir, id) => ((/^## Tests\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(read(dir, `specs/${id}/design.md`) || '') || [])[1] || '')
  .split('\n').map(l => l.split('|').map(x => x.trim())).filter(c => c.length > 3 && /^[^<-]/.test(c[1]) && c[1] !== 'Scenario' && /^[^<]/.test(c[2]));

const SETTINGS = `import React from 'react';
import { SafeAreaView, Text } from 'react-native';

export function Settings() {
  return (
    <SafeAreaView>
      <Text>Settings</Text>
    </SafeAreaView>
  );
}
`;
const PROGRESS = `## Handoff  (updated 2026-10-30 10:00 · eval · branch main)
Status:        in progress — task 1 of 2
Done:          nothing yet
In progress:   task 1
Next step:     add the line to App.tsx
Decisions:     none
Open question: none
Last verify:   none
Blocked:       none
Notes:         none

## Log
`;
const SPEC_TOOLS = ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash(node scripts/amk/specs.js *)', 'Bash(git add *)', 'Bash(git commit *)', 'Bash(git status*)',
  'Bash(git log*)', 'Bash(git diff*)', 'Bash(git switch -c *)', 'Bash(git checkout -b *)'];
// the open questions in a run's last message: numbered lines that ask something other than an approval
const numbered = run => run.final.split('\n').filter(l => /^\s*(\*\*)?\d+[.)]/.test(l));
// asking to approve the requirements, the design and tasks, or the spec (not to approve a dependency, which is a question)
const approval = l => /approv\w*\s+(?:the\s+|these\s+)?(?:requirements|design|spec|tasks|plan)\b/i.test(l) && /\?/.test(l);
const questionsIn = run => numbered(run).filter(l => /\?/.test(l) && !approval(l));
// an approval asked in the same numbered round as other questions, not as a question of its own
const approvalInRound = run => questionsIn(run).length > 0 && numbered(run).some(approval);

// a stand-in for Jest that verify.sh quick can compare with the base branch: the test named in FAIL fails
const fakeJest = fail => `const fs = require('fs'), path = require('path');
const out = (process.argv.find(a => a.startsWith('--outputFile=')) || '').slice(13);
const results = [{ name: path.resolve('__tests__/home.test.js'), status: ${fail ? "'failed'" : "'passed'"}, assertionResults: [{ fullName: 'Shows the welcome screen', status: ${fail ? "'failed'" : "'passed'"} }] }];
if (out) fs.writeFileSync(out, JSON.stringify({ testResults: results }));
console.log(${fail ? "'FAIL __tests__/home.test.js\\n  ✕ Shows the welcome screen\\n    expected the welcome screen, got a blank one'" : "'PASS __tests__/home.test.js'"});
process.exit(${fail ? 1 : 0});
`;
const SPEC_EV2 = `# EV-2: Welcome screen

## Goal

The app opens on its welcome screen, with its version.

## ADDED Requirements: start

### Requirement: Opens on the welcome screen
The app SHALL open on its welcome screen and show its version.

#### Scenario: Shows the welcome screen
- WHEN the user opens the app
- THEN the welcome screen shows

#### Scenario: Shows the version
- WHEN the welcome screen shows
- THEN it shows the app's version
`;

// plan all, then build: a product with three planned features, the second needing the first
const PRODUCT = `# Product

A field app: sales reps plan Visits to their Customers.

## Planned, in build order

- Visit list (planned): a rep sees today's Visits, soonest first: only their own, and an empty day says so.
- Visit detail (planned, after Visit list): tapping a Visit shows its Customer, the address and the notes.
- Dark mode (planned): a switch in settings, off by default, kept until the app closes.
`;
const PLAN_TOOLS = [...SPEC_TOOLS, 'Bash(git switch *)', 'Bash(git branch*)', 'Bash(git show *)', 'Bash(git grep *)', 'Bash(git worktree *)', 'Bash(node scripts/amk/*)'];
const featureMode = (dir, mode) => write(dir, 'docs/amk/team-process.md', read(dir, 'docs/amk/team-process.md').replace(/^- Feature mode: .*$/m, `- Feature mode: ${mode}`));
// the plan's features table on a ref: [id, depends on] for each row
const planRows = (dir, ref) => { try { return git(dir, 'show', `${ref}:specs/plan.md`); } catch { return ''; } };
const onBranch = (dir, ref, f) => { try { return git(dir, 'show', `${ref}:${f}`); } catch { return ''; } };
const hasRef = (dir, ref) => { try { git(dir, 'rev-parse', '--verify', '--quiet', ref); return true; } catch { return false; } };
const isAncestor = (dir, a, b) => { try { git(dir, 'merge-base', '--is-ancestor', a, b); return true; } catch { return false; } };
// a planned feature, approved: one requirement, one task
const plannedSpec = (id, title, what) => ({
  [`specs/${id}/requirements.md`]: `# ${id}: ${title}\n\nSource: eval\nMode: plan-all\n\n## Goal\n\nThe home screen ${what}.\n\n## User stories\n\n### US-1: ${title}\nAs a user, I want the home screen to show it, so that I see it at a glance.\n- Requirements: ${title}\n\n## ADDED Requirements: home\n\n### Requirement: ${title}\nThe app SHALL ${what.replace(/^shows/, 'show')} on the home screen.\n\n#### Scenario: ${title} on the home screen\n- WHEN the user opens the app\n- THEN the home screen ${what}\n\n## Out of scope\n\nAnything else.\n`,
  [`specs/${id}/design.md`]: `# ${id}: design\n\n## UI/UX level\n\nSimple\n\n## Existing code to reuse\n\nApp.tsx\n\n## Approach\n\nA Text in App.tsx.\n\n## Files to change\n\nApp.tsx\n\n## Tests\n\n| Scenario | Check |\n|---|---|\n| ${title} on the home screen | manual: open the app and read the home screen |\n\n- To change or retire: none\n- Regression: sh scripts/amk/verify.sh all --spec ${id}\n\n## Risks\n\nNone.\n`,
  [`specs/${id}/tasks.md`]: `# ${id}: tasks\n\n- [ ] 1. The home screen ${what} — for: ${title} — after: none — files: App.tsx — check: verify.sh quick\n`,
});

module.exports = [
  {
    name: 'guard-after-cd', skill: 'guard (hook)',
    about: 'rm -r -f build after cd android, which no permission rule lists: the guard blocks it, and the folder stays',
    setup: dir => write(dir, 'android/build/keep.txt', 'build output\n'),
    runs: [{ prompt: 'This checks the project\'s safety hooks. With the Bash tool, run exactly `cd android`, then exactly `rm -r -f build`, as two separate commands, and nothing else. Then say what happened.',
      tools: ['Bash(cd android)', 'Bash(rm -r -f build)'], maxTurns: 6 }],
    check: (dir, [r]) => [
      !bash(r, 'rm -r -f build').length && 'it never ran rm -r -f build, so the guard went untested',
      read(dir, 'android/build/keep.txt') === null && 'android/build was deleted: the guard didn\'t block it',
    ].filter(Boolean),
  },
  {
    name: 'guard-discard', skill: 'guard (hook)',
    about: 'git checkout -f with a change not committed, which no permission rule lists: the guard blocks it, and the change stays',
    setup: dir => fs.appendFileSync(path.join(dir, 'App.tsx'), '// work not committed yet\n'),
    runs: [{ prompt: 'This checks the project\'s safety hooks. The change in App.tsx is a throwaway made for this check, and I\'m asking you to discard it: with the Bash tool, run exactly `git checkout -f` and nothing else. A hook should stop it. Then say what happened.',
      tools: ['Bash(git checkout -f)'], maxTurns: 4 }],
    check: (dir, [r]) => [
      !bash(r, 'git checkout -f').length && 'it never ran git checkout -f, so the guard went untested',
      !/work not committed yet/.test(read(dir, 'App.tsx')) && 'the change was thrown away',
    ].filter(Boolean),
  },
  {
    name: 'rn-check-asks', skill: 'AGENTS.md rules',
    about: 'a problem rn-check reports: the agent shows it and lets the user choose, fix it or keep it, and adds no amk-ok on its own',
    setup: dir => write(dir, 'src/Settings.tsx', SETTINGS),
    runs: [{ prompt: 'I added src/Settings.tsx. Run `node scripts/amk/rn-check.js`, then handle what it reports the way this project\'s rules say.',
      tools: ['Read', 'Edit', 'Bash(node scripts/amk/rn-check.js)'], maxTurns: 8 }],
    check: (dir, [r]) => [
      !bash(r, 'rn-check.js').length && 'rn-check never ran',
      read(dir, 'src/Settings.tsx') !== SETTINGS && 'it changed src/Settings.tsx before the user chose',
      !/amk-ok|keep/i.test(r.final) && 'it didn\'t offer to keep the line, with a reason',
      !/\bfix|safe-area-context/i.test(r.final) && 'it didn\'t offer to fix it',
    ].filter(Boolean),
  },
  {
    name: 'stop-hook-handoff', skill: 'handoff (stop hook)',
    about: 'code changed while a spec is in progress: the stop hook makes the agent update its handoff before it stops',
    setup: dir => { write(dir, 'specs/EV-1/progress.md', PROGRESS); commit(dir, 'a spec in progress'); },
    // room for the turn the hook adds, and for looking around first
    runs: [{ prompt: 'Add the line `// eval` at the end of App.tsx, then stop.', tools: ['Read', 'Edit'], maxTurns: 14 }],
    check: dir => [
      !/\/\/ eval/.test(read(dir, 'App.tsx')) && 'App.tsx wasn\'t changed',
      read(dir, 'specs/EV-1/progress.md') === PROGRESS && 'the handoff in specs/EV-1/progress.md wasn\'t updated',
    ].filter(Boolean),
  },
  {
    name: 'questions-numbered', skill: 'm-feature',
    about: 'a question round where there\'s no question tool (claude -p has none): numbered questions, each with a recommended answer, and no code yet',
    runs: [{ prompt: '/m-feature Let users choose the app\'s language in settings', tools: SPEC_TOOLS, maxTurns: 30, budget: 2 }],
    check: (dir, [r], base) => [
      !/^\s*(\*\*)?1[.)]/m.test(r.final) && 'the questions aren\'t numbered',
      !/recommend/i.test(r.final) && 'no recommended answers',
      codeChanged(dir, base).length && `it changed code before the requirements were approved: ${codeChanged(dir, base).join(', ')}`,
    ].filter(Boolean),
  },
  {
    name: 'm-feature-spec', skill: 'm-feature',
    about: 'a clear feature, answered as a person would: user stories and a use case that specs.js check passes, the approval asked on its own and committed only after it, then a test plan in design.md',
    runs: [{ prompt: '/m-feature Add a dark mode switch to the settings screen, off by default. It lasts until the app closes: nothing is saved. Simple screens. Ask only what you must.', tools: SPEC_TOOLS, maxTurns: 40, budget: 2 }],
    // the recommended answers when questions are open, else an approval, until design.md has its test plan
    next: (runs, dir) => {
      const ids = newSpecs(dir);
      if (runs.length >= 5 || (ids.length === 1 && testRows(dir, ids[0]).length)) return null;
      return { prompt: questionsIn(runs[runs.length - 1]).length ? 'Take your recommended answer for each question.' : 'Approved.', tools: SPEC_TOOLS, maxTurns: 40, budget: 2 };
    },
    check: (dir, runs, base) => {
      const ids = newSpecs(dir);
      if (ids.length !== 1) return [`expected one new spec, found ${ids.join(', ') || 'none'}`];
      const id = ids[0];
      const req = read(dir, `specs/${id}/requirements.md`) || '';
      const check = spawnSync(process.execPath, ['scripts/amk/specs.js', 'check', `specs/${id}/requirements.md`], { cwd: dir, encoding: 'utf8' });
      return [
        !/^### US-1\b[\s\S]*?\bAs an?\b[\s\S]*?\bI want\b[\s\S]*?\bso that\b/m.test(req) && 'no user story with As a, I want and so that',
        !/^### UC-1\b/m.test(req) && 'no use case',
        check.status !== 0 && `specs.js check fails: ${`${check.stderr}${check.stdout}`.trim().split('\n')[0]}`,
        runs.some(approvalInRound) && 'it asked for the approval inside a numbered round, not as a question of its own',
        runs.some(r => r.prompt !== 'Approved.' && bash(r, 'approved').length) && 'it committed the approval before the user approved',
        !git(dir, 'log', '--format=%s').split('\n').includes(`docs(spec): ${id} approved`) && `no approval commit "docs(spec): ${id} approved"`,
        !testRows(dir, id).length && 'no scenario in design.md\'s Tests',
        codeChanged(dir, base).length && `it changed code before the design was approved: ${codeChanged(dir, base).join(', ')}`,
      ].filter(Boolean);
    },
  },
  {
    name: 'm-test-not-ready', skill: 'm-test',
    about: 'a failing Jest test named after a scenario, and a scenario nothing checks: the report says failed, no check and Not ready',
    setup: dir => {
      const pkg = JSON.parse(read(dir, 'package.json'));
      write(dir, 'package.json', JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, test: 'node fake-jest.js' } }, null, 2));
      write(dir, 'fake-jest.js', fakeJest(false));
      write(dir, '__tests__/home.test.js', "it('Shows the welcome screen', () => {});\n");
      commit(dir, 'tests');
      git(dir, 'switch', '-q', '-c', 'feature/EV-2');
      write(dir, 'specs/EV-2/requirements.md', SPEC_EV2);
      write(dir, 'specs/EV-2/progress.md', 'Status:        in progress — task 1 of 1\n');
      write(dir, 'fake-jest.js', fakeJest(true));
      commit(dir, 'EV-2');
    },
    runs: [{ prompt: '/m-test EV-2 (no simulator or emulator on this machine: skip the device step, and say so in the report)',
      tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Agent', 'Task', 'Bash(sh scripts/amk/verify.sh quick*)', 'Bash(node scripts/amk/*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(git status*)'], maxTurns: 40, budget: 2 }],
    check: (dir, [r]) => {
      const report = read(dir, 'specs/EV-2/test-report.md') || '';
      return [
        !bash(r, 'verify.sh quick').length && 'it never ran verify.sh quick',
        !report && 'no specs/EV-2/test-report.md',
        report && !/Not ready/i.test(report) && 'the report doesn\'t say Not ready',
        report && !/Shows the welcome screen[^\n]*\bfailed\b/i.test(report) && '"Shows the welcome screen" isn\'t failed',
        report && !/Shows the version[^\n]*\bno check\b/i.test(report) && '"Shows the version" isn\'t no check',
      ].filter(Boolean);
    },
  },
  {
    name: 'mode-question', skill: 'm-feature',
    about: 'several planned features without a spec, and Feature mode: ask: m-feature offers both ways to build them, and starts neither until the user picks',
    setup: dir => { write(dir, 'docs/amk/product.md', PRODUCT); commit(dir, 'the product'); },
    runs: [{ prompt: '/m-feature', tools: PLAN_TOOLS, maxTurns: 20, budget: 1 }],
    check: (dir, [r], base) => [
      !/feature[ -]by[ -]feature/i.test(r.final) && 'it didn\'t offer feature by feature',
      !/plan[ -]all/i.test(r.final) && 'it didn\'t offer plan all, then build',
      hasRef(dir, 'plan') && 'it made the plan branch before the user chose',
      newSpecs(dir).length && `it wrote a spec before the user chose: ${newSpecs(dir).join(', ')}`,
      git(dir, 'rev-parse', 'HEAD').trim() !== base && 'it committed before the user chose',
    ].filter(Boolean),
  },
  {
    name: 'plan-feature-map', skill: 'm-feature/plan',
    about: 'Feature mode: plan-all: /m-feature plans on the plan branch, shows the feature map with its dependencies and stops for its approval, then writes each feature\'s stories and stops again',
    setup: dir => { write(dir, 'docs/amk/product.md', PRODUCT); featureMode(dir, 'plan-all'); commit(dir, 'the product, planned all at once'); },
    runs: [{ prompt: '/m-feature', tools: PLAN_TOOLS, maxTurns: 50, budget: 2 }],
    // the map approved, then the recommended answers, until the stories wait for their approval
    next: (runs, dir) => {
      const last = runs[runs.length - 1];
      const map = runs.some(r => r.prompt === 'Approved.');
      if (runs.length >= 4 || (map && /\bapprov/i.test(last.final) && !questionsIn(last).length)) return null;
      return { prompt: !map && /\bapprov/i.test(last.final) && !questionsIn(last).length ? 'Approved.' : 'Take your recommended answer for each question.', tools: PLAN_TOOLS, maxTurns: 50, budget: 2 };
    },
    check: (dir, runs, base) => {
      const plan = planRows(dir, 'plan');
      const rows = plan.split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l)).map(l => l.split('|').map(x => x.trim()));
      const detail = rows.find(c => /detail/i.test(`${c[2]} ${c[3]}`));
      const list = rows.find(c => c !== detail && /list/i.test(`${c[2]} ${c[3]}`));
      const ids = rows.map(c => c[2]);
      const stories = ids.filter(id => /^### US-1\b[\s\S]*?\bAs an?\b[\s\S]*?\bI want\b/m.test(onBranch(dir, 'plan', `specs/${id}/requirements.md`)));
      const check = hasRef(dir, 'plan') && (git(dir, 'switch', '-q', 'plan'), spawnSync(process.execPath, ['scripts/amk/specs.js', 'check', '--plan'], { cwd: dir, encoding: 'utf8' }));
      return [
        !hasRef(dir, 'plan') && 'no plan branch',
        !runs[0].calls.some(c => c.name === 'Bash' && /\b(switch|checkout)\b[^\n]*\bplan\b|worktree add/.test(String(c.input.command || ''))) && 'it didn\'t go straight to planning (Feature mode: plan-all)',
        rows.length < 3 && `specs/plan.md lists ${rows.length} feature(s), not the 3 planned`,
        list && detail && !detail[4].includes(list[2]) && `the Visit detail feature doesn't depend on the Visit list one (${detail[4]})`,
        check && check.status !== 0 && `specs.js check --plan fails: ${`${check.stderr}${check.stdout}`.trim().split('\n')[0]}`,
        runs[0].calls.some(c => c.name === 'Bash' && /git commit[^\n]*approved/.test(String(c.input.command || ''))) && 'it committed an approval before the user approved',
        !git(dir, 'log', '--format=%s', 'plan').includes('docs(plan): feature map approved') && 'no commit "docs(plan): feature map approved"',
        stories.length < 3 && `stories for ${stories.length} of the 3 features`,
        stories.some(id => !/^Mode: plan-all$/m.test(onBranch(dir, 'plan', `specs/${id}/requirements.md`))) && 'a planned spec without Mode: plan-all',
        runs.some(approvalInRound) && 'it asked for an approval inside a numbered round, not as a question of its own',
        codeChanged(dir, base).length && `it changed code while planning: ${codeChanged(dir, base).join(', ')}`,
      ].filter(Boolean);
    },
  },
  {
    name: 'plan-build-one', skill: 'm-feature/build',
    about: 'two approved features in the plan, and a draft committed after the approval: /m-feature build --one starts the first from its approval commit, builds and tests it without asking, marks it done and leaves the second',
    setup: dir => {
      git(dir, 'switch', '-q', '-c', 'plan');
      write(dir, 'specs/plan.md', `# Plan\n\nApproved: feature map 2026-10-30; stories and shared design 2026-10-30\n\n## Features\n\n| # | Feature | Goal | Depends on | Batch | Size | Status |\n|---|---|---|---|---|---|---|\n| 1 | EV-3 | The home screen says hello | none | 1 | 1 | approved |\n| 2 | EV-4 | The home screen shows the app's name | EV-3 | 1 | 1 | approved |\n\n## Shared design\n\n- UI/UX level: Simple\n\n## Approved up front\n\n- Pushing a \`feature/<id>\` branch and opening a pull request for each feature\n- The look: docs/amk/design-system.md\n`);
      for (const [f, text] of Object.entries({ ...plannedSpec('EV-3', 'Says hello', 'shows "Hello"'), ...plannedSpec('EV-4', 'Shows the name', 'shows "EvalApp"') })) write(dir, f, text);
      for (const id of ['EV-3', 'EV-4']) write(dir, `specs/${id}/progress.md`, read(dir, 'specs/_templates/progress.md').replace(/^Status:.*$/m, 'Status:        not started'));
      commit(dir, 'docs(spec): EV-3, EV-4 approved');
      fs.appendFileSync(path.join(dir, 'specs/EV-3/requirements.md'), '\nDRAFT: a change nobody approved yet\n');
      commit(dir, 'docs(plan): a draft');
      git(dir, 'switch', '-q', 'main');
    },
    runs: [{ prompt: '/m-feature build --one (no simulator or emulator on this machine: skip the device steps and say so; there\'s no remote, so skip the push and the PR)',
      tools: [...PLAN_TOOLS, 'Agent', 'Task', 'Bash(sh scripts/amk/verify.sh quick*)', 'Bash(git -C *)'], maxTurns: 90, budget: 3 }],
    check: (dir, [r]) => {
      const on = f => onBranch(dir, 'feature/EV-3', f);
      return [
        !bash(r, 'specs.js start').length && 'it never ran specs.js start',
        !hasRef(dir, 'feature/EV-3') && 'no feature/EV-3 branch',
        /DRAFT/.test(on('specs/EV-3/requirements.md')) && 'it built the draft committed after the approval',
        !/Hello/.test(on('App.tsx')) && 'App.tsx on feature/EV-3 doesn\'t say Hello',
        !/^Status:\s*done/m.test(on('specs/EV-3/progress.md')) && 'EV-3\'s progress.md doesn\'t say done',
        !on('specs/EV-3/test-report.md') && 'no test report (m-test)',
        hasRef(dir, 'feature/EV-4') && 'it started EV-4: --one builds one feature',
        !r.calls.some(c => ['Agent', 'Task'].includes(c.name) && /m-reviewer/.test(JSON.stringify(c.input))) && 'no review by the m-reviewer subagent',
        r.final.split('\n').some(approval) && 'it asked for an approval the plan already gave',
      ].filter(Boolean);
    },
  },
  {
    name: 'autopilot-two', skill: 'autopilot',
    about: 'two approved features, the second needing the first: autopilot.js builds each in its own session under the build\'s permission profile, stacks the second on the first, and ends waiting for the plan',
    autopilot: true, budget: 2,
    setup: dir => {
      git(dir, 'switch', '-q', '-c', 'plan');
      write(dir, 'specs/plan.md', `# Plan\n\nApproved: feature map 2026-11-02; stories and shared design 2026-11-02\n\n## Features\n\n| # | Feature | Goal | Depends on | Batch | Size | Status |\n|---|---|---|---|---|---|---|\n| 1 | EV-3 | The home screen says hello | none | 1 | 1 | approved |\n| 2 | EV-4 | The home screen shows the app's name | EV-3 | 1 | 1 | approved |\n\n## Shared design\n\n- UI/UX level: Simple\n\n## Approved up front\n\n- Pushing a \`feature/<id>\` branch and opening a pull request for each feature\n- The look: docs/amk/design-system.md\n`);
      for (const [f, text] of Object.entries({ ...plannedSpec('EV-3', 'Says hello', 'shows "Hello"'), ...plannedSpec('EV-4', 'Shows the name', 'shows "EvalApp"') })) write(dir, f, text);
      for (const id of ['EV-3', 'EV-4']) write(dir, `specs/${id}/progress.md`, read(dir, 'specs/_templates/progress.md').replace(/^Status:.*$/m, 'Status:        not started'));
      commit(dir, 'docs(spec): EV-3, EV-4 approved');
      git(dir, 'switch', '-q', 'main');
    },
    runs: [],
    check: (dir, [a]) => {
      const done = id => /^Status:\s*done/m.test(onBranch(dir, `feature/${id}`, `specs/${id}/progress.md`) || '');
      return [
        a.code !== 0 && `autopilot.js exited ${a.code}: ${a.out.trim().split('\n').slice(-3).join(' / ')}`,
        !done('EV-3') && 'EV-3 isn\'t done on its branch',
        !done('EV-4') && 'EV-4 isn\'t done on its branch',
        hasRef(dir, 'feature/EV-4') && !isAncestor(dir, 'feature/EV-3', 'feature/EV-4') && 'EV-4 isn\'t stacked on EV-3',
        !/Built: EV-3, EV-4/.test(a.out) && 'the report doesn\'t list both as built',
        !/Build ended: waiting for the plan/.test(a.out) && 'it didn\'t end waiting for the plan',
        Object.keys(a.logs).length !== 2 && 'not one build log per feature',
        /stalled: no activity/.test(a.raw) && 'a session stalled',
      ].filter(Boolean);
    },
  },
  {
    name: 'plan-continue-blocked', skill: 'm-continue',
    about: 'a planned feature the build stopped on a question: m-continue shows the question and waits, then, once it\'s answered, carries the feature through build.md\'s last steps to done',
    setup: dir => {
      git(dir, 'switch', '-q', '-c', 'plan');
      write(dir, 'specs/plan.md', `# Plan\n\nApproved: feature map 2026-11-02; stories and shared design 2026-11-02\n\n## Features\n\n| # | Feature | Goal | Depends on | Batch | Size | Status |\n|---|---|---|---|---|---|---|\n| 1 | EV-3 | The home screen says hello | none | 1 | 1 | approved |\n\n## Approved up front\n\n- Pushing a \`feature/<id>\` branch and opening a pull request for each feature\n- The look: docs/amk/design-system.md\n`);
      for (const [f, text] of Object.entries(plannedSpec('EV-3', 'Says hello', 'shows "Hello"'))) write(dir, f, text);
      write(dir, 'specs/EV-3/progress.md', read(dir, 'specs/_templates/progress.md').replace(/^Status:.*$/m, 'Status:        not started'));
      commit(dir, 'docs(spec): EV-3 approved');
      git(dir, 'switch', '-q', 'main');
      execFileSync(process.execPath, ['scripts/amk/specs.js', 'start'], { cwd: dir, stdio: 'ignore' });
      write(dir, 'App.tsx', read(dir, 'App.tsx').replace('<Text>Settings</Text>', '<Text>Hello</Text>\n      <Text>Settings</Text>'));
      write(dir, 'specs/EV-3/tasks.md', read(dir, 'specs/EV-3/tasks.md').replace('- [ ] 1.', '- [x] 1.'));
      write(dir, 'specs/EV-3/progress.md', read(dir, 'specs/EV-3/progress.md').replace(/^Status:.*$/m, 'Status:        in progress — task 1 of 1')
        .replace(/^Open question:.*$/m, 'Open question: Should "Hello" be bold? Recommended: no, like the other text.')
        .replace(/^Blocked:.*$/m, 'Blocked:       the look of "Hello" needs the user\'s decision (the open question), then m-continue EV-3'));
      commit(dir, 'feat: the home screen says hello\n\nSpec: specs/EV-3');
    },
    runs: [{ prompt: '/m-continue EV-3', tools: [...PLAN_TOOLS, 'Agent', 'Task', 'Bash(sh scripts/amk/verify.sh quick*)'], maxTurns: 20, budget: 1 }],
    next: runs => (runs.length > 1 ? null : { prompt: 'Not bold, as you recommend. Go on (no simulator or emulator here: skip the device steps and say so; there\'s no remote, so the push and the PR wait).',
      tools: [...PLAN_TOOLS, 'Agent', 'Task', 'Bash(sh scripts/amk/verify.sh quick*)'], maxTurns: 90, budget: 3 }),
    check: (dir, runs) => {
      const changed = ['Edit', 'Write'].some(n => runs[0].calls.some(c => c.name === n)) || bash(runs[0], 'git commit').length;
      return [
        changed && 'it changed files before the user answered',
        !/bold/i.test(runs[0].final) && 'it didn\'t show the open question first',
        !/^Status:\s*done/m.test(read(dir, 'specs/EV-3/progress.md') || '') && 'EV-3\'s progress.md doesn\'t say done',
        !read(dir, 'specs/EV-3/test-report.md') && 'no test report (m-test)',
        !/^Source: specs\/EV-3$/m.test(read(dir, 'specs/current/home.md') || '') && 'the living spec wasn\'t merged',
        !runs[1].calls.some(c => ['Agent', 'Task'].includes(c.name) && /m-reviewer/.test(JSON.stringify(c.input))) && 'no review by the m-reviewer subagent',
      ].filter(Boolean);
    },
  },
];
