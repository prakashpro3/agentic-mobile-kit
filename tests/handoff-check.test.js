// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const tmpDir = require('./tmp');

const SCRIPT = path.join(__dirname, '../stacks/react-native/template/scripts/amk/handoff-check.js');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
const write = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
const IN_PROGRESS = 'Status: in progress\n';
// the stop hook's exit code: 2 asks the agent to update the handoff before stopping. It runs from the project's own
// scripts/amk, from the folder the agent is in (the project, or a subfolder it moved into)
const hook = (dir, from = '.') => spawnSync('node', [path.join(dir, 'scripts/amk/handoff-check.js')], { cwd: path.join(dir, from), input: '{}', encoding: 'utf8' }).status;

function app() {
  const dir = tmpDir('amk-handoff-');
  git(dir, 'init', '-q');
  write(dir, 'src/App.tsx', 'export {};\n');
  write(dir, 'scripts/amk/handoff-check.js', fs.readFileSync(SCRIPT, 'utf8'));
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'app');
  return dir;
}

test('handoff check: a new spec folder that isn\'t in git yet counts its progress.md', () => {
  const dir = app();
  write(dir, 'specs/20261016-x/progress.md', IN_PROGRESS);
  write(dir, 'specs/20261016-x/requirements.md', '# x\n');
  write(dir, 'src/App.tsx', 'export const x = 1;\n');
  assert.strictEqual(hook(dir), 0, 'git lists the untracked folder as one line unless asked for each file');
});

test('handoff check: code changed (a new folder too) without the handoff asks for it', () => {
  const dir = app();
  write(dir, 'specs/20261016-x/progress.md', IN_PROGRESS);
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'spec');
  write(dir, 'src/vehicles/Form.tsx', 'export {};\n');
  assert.strictEqual(hook(dir), 2);
  assert.strictEqual(hook(dir, 'src/vehicles'), 2, 'also from a subfolder the agent moved into');
  write(dir, 'specs/20261016-x/progress.md', `${IN_PROGRESS}Next: the form\n`);
  assert.strictEqual(hook(dir), 0);
});

test('the hook commands find the project from any folder a tool starts them in: the project, a subfolder, .agents', () => {
  // Claude Code keeps the agent's cd, Antigravity runs hooks from .agents/, Codex from the project. A command that
  // isn't found exits 1: Claude Code then lets every command through, and Antigravity blocks every one
  const hooks = fs.readFileSync(path.join(__dirname, '../stacks/react-native/template/.rulesync/hooks.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const { preToolUse: [guard], stop: [handoff] } = JSON.parse(hooks).hooks;
  const dir = app();
  write(dir, 'scripts/amk/guard.js', fs.readFileSync(path.join(path.dirname(SCRIPT), 'guard.js'), 'utf8'));
  for (const from of ['.', 'android', '.agents']) {
    fs.mkdirSync(path.join(dir, from), { recursive: true });
    const run = (command, input) => spawnSync('sh', ['-c', command], { cwd: path.join(dir, from), input, encoding: 'utf8' });
    assert.strictEqual(run(guard.command, '{"tool_input":{"command":"rm -rf build"}}').status, 2, `the guard blocks, from ${from}`);
    assert.strictEqual(run(guard.command, '{"tool_input":{"command":"echo hello"}}').status, 0, `the guard allows, from ${from}`);
    const stop = run(handoff.command, '{}');
    assert.strictEqual(stop.status, 0, `the stop hook runs, from ${from}: ${stop.stderr}`);
  }
});

test('handoff check: a feature marked done whose requirements never reached the living spec is asked to merge them', () => {
  const dir = app();
  git(dir, 'switch', '-q', '-c', 'feature/EV-3');
  write(dir, 'specs/EV-3/requirements.md', '# EV-3\n\n## ADDED Requirements: home\n\n### Requirement: Says hello\nThe app SHALL say hello.\n\n#### Scenario: Hello\n- THEN it says hello\n');
  write(dir, 'specs/EV-3/progress.md', 'Status:        done\nBlocked:       none\n');
  write(dir, 'specs/current/home.md', '# Home\n\n## Requirements\n');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'EV-3 done');
  const r = spawnSync('node', [path.join(dir, 'scripts/amk/handoff-check.js')], { cwd: dir, input: '{}', encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /specs\/EV-3 says done, but its requirements aren't in the living spec[\s\S]*node scripts\/amk\/specs\.js merge EV-3/);
  assert.strictEqual(spawnSync('node', [path.join(dir, 'scripts/amk/handoff-check.js')], { cwd: dir, input: '{"stop_hook_active":true}', encoding: 'utf8' }).status, 0, 'asked once');
  write(dir, 'specs/current/home.md', '# Home\n\n## Requirements\n\n### Requirement: Says hello\nThe app SHALL say hello.\n\nSource: specs/EV-3\n\n#### Scenario: Hello\n- THEN it says hello\n');
  assert.strictEqual(hook(dir), 0, 'merged');
  write(dir, 'specs/EV-3/requirements.md', '# EV-3\n\n## REMOVED Requirements: home\n\n### Requirement: Old\nReason: gone\n');
  write(dir, 'specs/current/home.md', '# Home\n\n## Requirements\n');
  assert.strictEqual(hook(dir), 0, 'only a removal: nothing to find in the living spec');
});


test('handoff check: a link git doesn\'t ignore (the project\'s node_modules in a git worktree) isn\'t a code change', { skip: process.platform === 'win32' }, () => {
  const dir = app();
  write(dir, 'specs/20261016-x/progress.md', IN_PROGRESS);
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'spec');
  // node_modules/ in .gitignore matches a folder, not a link: git lists the link as a new file
  write(dir, '.gitignore', 'node_modules/\n');
  git(dir, 'add', '.gitignore');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'ignore');
  const shared = tmpDir('amk-handoff-modules-');
  fs.symlinkSync(shared, path.join(dir, 'node_modules'));
  assert.match(git(dir, 'status', '--porcelain'), /^\?\? node_modules$/m);
  assert.strictEqual(hook(dir), 0, 'only the link changed');
  write(dir, 'src/App.tsx', 'export const x = 1;\n');
  assert.strictEqual(hook(dir), 2, 'a real code change still asks');
});

test('handoff check: Claude Code\'s worktrees inside the project (.claude/worktrees/) aren\'t this session\'s code', () => {
  const dir = app();
  write(dir, 'specs/20261016-x/progress.md', IN_PROGRESS);
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'spec');
  // another session's worktree, as git lists it when .gitignore doesn't keep it out
  write(dir, '.claude/worktrees/agenda/src/Agenda.tsx', 'export {};\n');
  assert.strictEqual(hook(dir), 0);
  write(dir, 'src/App.tsx', 'export const x = 1;\n');
  assert.strictEqual(hook(dir), 2, 'this session\'s own change still asks');
});
