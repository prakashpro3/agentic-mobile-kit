// Run: node --test tests/*.test.js
// scripts/amk/notify.js: what each hook says when the AI waits for the developer, the desktop notification, the
// webhook, and the stop hook notifying only once the turn really ends
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync, spawnSync } = require('child_process');
const tmpDir = require('./tmp');

const KIT = path.join(__dirname, '../stacks/react-native/template/scripts/amk');
const { message, lastWords } = require(path.join(KIT, 'notify.js'));
const write = (dir, f, text, mode) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text, mode ? { mode } : undefined); };
const on = { AMK_NOTIFY: '' };
const transcript = (...texts) => {
  const f = path.join(tmpDir('amk-notify-t-'), '.claude', 'projects', 'p', 's.jsonl');
  write(path.dirname(f), path.basename(f), texts.map(t => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } })).join('\n'));
  return f;
};

test('notify: what each hook says, and when it says nothing', () => {
  assert.match(message({ hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash', transcript_path: '/h/.claude/projects/x.jsonl' }, on).title, /Claude Code is waiting for you$/);
  assert.strictEqual(message({ hook_event_name: 'Notification', message: 'Claude is waiting for your input' }, on).text, 'Claude is waiting for your input');
  const codex = message({ hook_event_name: 'PermissionRequest', tool_name: 'shell', tool_input: { command: 'git push -u origin feature/a' }, transcript_path: '/h/.codex/sessions/x.jsonl' }, on);
  assert.match(codex.title, /Codex needs your approval$/);
  assert.strictEqual(codex.text, 'git push -u origin feature/a');
  assert.strictEqual(message({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', transcript_path: '/h/.claude/projects/x.jsonl' }, on), null, 'Claude Code says it through Notification');
  // a finished turn: the question it ends with, or its first words
  const asks = message({ hook_event_name: 'Stop', transcript_path: transcript('Working on it.', 'The flows passed.\n\n**Which fix should I make?**\n1. Revert it (Recommended)') }, on);
  assert.match(asks.title, /Claude Code asks you$/);
  assert.strictEqual(asks.text, 'Which fix should I make?');
  const done = message({ hook_event_name: 'Stop', last_assistant_message: 'All 12 tests pass.\nNothing else to do.' }, on);
  assert.match(done.title, /The AI finished$/);
  assert.strictEqual(done.text, 'All 12 tests pass.');
  assert.match(message({ hook_event_name: 'Stop', last_assistant_message: 'Approve the requirements, or change something.' }, on).title, /asks you$/);
  // AMK_NOTIFY=ask: approvals, waiting, questions; not every turn. off, and an unattended build: nothing
  assert.strictEqual(message({ hook_event_name: 'Stop', last_assistant_message: 'Done.' }, { AMK_NOTIFY: 'ask' }), null);
  assert.ok(message({ hook_event_name: 'Stop', last_assistant_message: 'Push it?' }, { AMK_NOTIFY: 'ask' }));
  assert.ok(message({ hook_event_name: 'Notification', message: 'x' }, { AMK_NOTIFY: 'ask' }));
  for (const env of [{ AMK_NOTIFY: 'off' }, { AMK_NOTIFY: '0' }, { AMK_AUTOPILOT: '1' }]) assert.strictEqual(message({ hook_event_name: 'Notification', message: 'x' }, env), null, JSON.stringify(env));
  assert.strictEqual(message({ hook_event_name: 'PreToolUse' }, on), null);
  assert.strictEqual(lastWords({ transcript_path: '/nowhere.jsonl' }), '');
});

// a project with the kit's hook scripts, and a stand-in for the desktop notifier that records what it was asked
function project() {
  const dir = tmpDir('amk-notify-');
  for (const f of ['notify.js', 'redact.js', 'handoff-check.js', 'specs.js']) write(dir, `scripts/amk/${f}`, fs.readFileSync(path.join(KIT, f), 'utf8'));
  write(dir, 'src/App.tsx', 'export {};\n');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'app'], { cwd: dir });
  const bin = tmpDir('amk-notify-bin-');
  for (const tool of ['osascript', 'notify-send']) write(bin, tool, `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done >> "${bin}/shown"\n`, 0o755);
  // CLAUDECODE cleared: these tests may run inside a Claude Code session, which sets it
  const env = { ...process.env, AMK_NOTIFY: '', CLAUDECODE: '', PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const shown = () => { try { return fs.readFileSync(path.join(bin, 'shown'), 'utf8'); } catch { return ''; } };
  return { dir, env, shown };
}
const desktop = process.platform === 'darwin' || process.platform === 'linux';

test('notify: the desktop notification, its text redacted, and the stop hook notifying only when the turn ends', { skip: !desktop && 'no stand-in for this platform' }, () => {
  const { dir, env, shown } = project();
  const hook = (script, payload, more = {}) => spawnSync('node', ['-e', `require(${JSON.stringify(path.join(dir, 'scripts/amk', script))})${script === 'notify.js' ? '.hook()' : ''}`],
    { cwd: dir, input: JSON.stringify(payload), encoding: 'utf8', env: { ...env, ...more } });
  hook('notify.js', { hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash (token ghp_abcdefghijklmnopqrstuvwxyz0123456789)' });
  assert.match(shown(), /Claude needs your permission to use Bash/);
  assert.doesNotMatch(shown(), /ghp_abcdefghijklmnopqrstuvwxyz0123456789/, 'redacted');
  assert.match(shown(), new RegExp(`${path.basename(dir)}: The AI is waiting for you`));
  // the stop hook: a turn that ends notifies; one it sends back to update the handoff doesn't
  const before = shown();
  assert.strictEqual(hook('handoff-check.js', { last_assistant_message: 'Shall I push the branch?' }).status, 0);
  const asked = shown().slice(before.length);
  assert.match(asked, /asks you/);
  assert.match(asked, /Shall I push the branch\?/);
  write(dir, 'specs/x/progress.md', 'Status: in progress\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'spec'], { cwd: dir });
  write(dir, 'src/App.tsx', 'export const x = 1;\n');
  const sentBack = shown();
  assert.strictEqual(hook('handoff-check.js', { last_assistant_message: 'Done.' }).status, 2);
  assert.strictEqual(shown(), sentBack, 'not while it goes on');
  assert.strictEqual(hook('handoff-check.js', { stop_hook_active: true, last_assistant_message: 'Updated. Done.' }).status, 0);
  const ended = shown().slice(sentBack.length);
  assert.match(ended, /finished/);
  assert.match(ended, /Updated\. Done\./);
  // off: nothing
  const quiet = shown();
  hook('notify.js', { hook_event_name: 'Notification', message: 'x' }, { AMK_NOTIFY: 'off' });
  assert.strictEqual(shown(), quiet);
});

test('notify: the webhook, posted from a process of its own so the hook returns at once', async () => {
  const { dir, env } = project();
  const got = [];
  const server = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { got.push(JSON.parse(b)); res.end('ok'); }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/hook`;
    spawnSync('node', ['-e', `require(${JSON.stringify(path.join(dir, 'scripts/amk/notify.js'))}).hook()`],
      { cwd: dir, input: JSON.stringify({ hook_event_name: 'PermissionRequest', tool_input: { command: 'git push' } }), encoding: 'utf8', env: { ...env, AMK_NOTIFY_URL: url } });
    for (let i = 0; i < 50 && !got.length; i++) await new Promise(r => setTimeout(r, 100));
    assert.strictEqual(got.length, 1);
    assert.match(got[0].text, /needs your approval: git push$/);
    assert.strictEqual(got[0].content, got[0].text);
  } finally { server.close(); }
});
