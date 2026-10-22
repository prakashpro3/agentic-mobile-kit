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
