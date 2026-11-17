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
// the scripts in a folder of their own: what the status line keeps (.amk/state/) stays out of the kit
const COPY = path.join(tmpDir('amk-notify-kit-'), 'scripts/amk');
fs.cpSync(KIT, COPY, { recursive: true });
const { message, lastWords } = require(path.join(COPY, 'notify.js'));
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
  for (const f of ['notify.js', 'redact.js', 'handoff-check.js', 'specs.js', 'status.js', 'progress.js']) write(dir, `scripts/amk/${f}`, fs.readFileSync(path.join(KIT, f), 'utf8'));
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

test('notify: a turn that ends while a job it started runs (Claude Code) says what it waits for, and the status line hears of it', { skip: !desktop && 'no stand-in for this platform' }, () => {
  const { dir, env, shown } = project();
  const t = transcript('Both checks run in the background: I go on when they end.');
  const job = (s, id, extra) => JSON.stringify({ type: 'user', timestamp: new Date(Date.now() - s * 1000).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: id }] }, toolUseResult: extra });
  fs.appendFileSync(t, `\n${job(90, 'b', { backgroundTaskId: 'bg1' })}\n${job(80, 'a', { isAsync: true, status: 'async_launched', agentId: 'ag1', description: 'the iOS check' })}\n`);
  const hook = (script, payload, more = {}) => spawnSync('node', ['-e', `require(${JSON.stringify(path.join(dir, 'scripts/amk', script))})${script === 'notify.js' ? '.hook()' : ''}`],
    { cwd: dir, input: JSON.stringify(payload), encoding: 'utf8', env: { ...env, ...more } });
  const r = hook('handoff-check.js', { session_id: 'w1', transcript_path: t });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(shown(), /Claude Code is waiting for a command/, 'the first job it waits for');
  assert.match(shown(), /It goes on by itself when that ends: nothing is needed from you now\./);
  assert.strictEqual(r.stdout, '', 'Claude Code titles the tab itself, and rewrites it as the turn ends');
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, '.amk/state/marks-w1.json'), 'utf8')).ended, 'the status line hears the turn ended');
  // AMK_NOTIFY=ask: nothing is needed from the developer, so no notification
  const quiet = shown();
  hook('handoff-check.js', { session_id: 'w1', transcript_path: t }, { AMK_NOTIFY: 'ask' });
  assert.strictEqual(shown(), quiet);
  // a turn that ends with nothing running: notified as before
  hook('handoff-check.js', { session_id: 'w2', transcript_path: transcript('All 12 tests pass.') });
  assert.match(shown().slice(quiet.length), /Claude Code finished[\s\S]*All 12 tests pass\.|All 12 tests pass\.[\s\S]*Claude Code finished/);
  // the notification hook marks what waits for the developer, or a reply waited for a minute: the turn is over
  hook('notify.js', { hook_event_name: 'Notification', session_id: 'w3', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  const marks = JSON.parse(fs.readFileSync(path.join(dir, '.amk/state/marks-w3.json'), 'utf8'));
  assert.strictEqual(marks.attention.text, 'Claude needs your permission to use Bash');
  hook('notify.js', { hook_event_name: 'Notification', session_id: 'w3', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' }, { AMK_NOTIFY: 'off' });
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, '.amk/state/marks-w3.json'), 'utf8')).ended, 'marked with notifications off too');
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
    assert.deepStrictEqual(Object.keys(got[0]), ['text'], 'only text: Google Chat refuses a message with a field it doesn\'t know');
  } finally { server.close(); }
});

test('notify: the webhook saved once (notify.js save) reaches a session that doesn\'t see the terminal\'s variables (Claude Code\'s background service); AMK_NOTIFY_URL comes first, and off sends none', async () => {
  const { dir, env } = project();
  const got = [];
  const server = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { got.push({ at: req.url, ...JSON.parse(b) }); res.end('ok'); }); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const posts = async n => { for (let i = 0; i < 50 && got.length < n; i++) await new Promise(r => setTimeout(r, 100)); await new Promise(r => setTimeout(r, 300)); return got.length; };
  try {
    const url = `http://127.0.0.1:${server.address().port}/saved`;
    const home = tmpDir('amk-notify-home-');
    const bare = { ...env, HOME: home, USERPROFILE: home };
    delete bare.AMK_NOTIFY_URL;
    // save: the pasted URL, kept where only its owner reads it, and a test message through it
    const saved = spawnSync('node', [path.join(dir, 'scripts/amk/notify.js'), 'save'], { cwd: dir, input: `${url}\n`, encoding: 'utf8', env: bare });
    assert.strictEqual(saved.status, 0, saved.stderr);
    const file = path.join(home, '.amk/notify.json');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { url });
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600, 'only its owner reads it');
    assert.strictEqual(await posts(1), 1);
    assert.match(got[0].text, /: alerts: This chat gets the AI's alerts\.$/);
    // a hook without the variable: the saved webhook; off: none; the variable: that one
    const hookWith = more => spawnSync('node', ['-e', `require(${JSON.stringify(path.join(dir, 'scripts/amk/notify.js'))}).hook()`],
      { cwd: dir, input: JSON.stringify({ hook_event_name: 'PermissionRequest', tool_input: { command: 'git push' } }), encoding: 'utf8', env: { ...bare, ...more } });
    hookWith({});
    assert.strictEqual(await posts(2), 2);
    assert.deepStrictEqual([got[1].at, /git push$/.test(got[1].text)], ['/saved', true]);
    hookWith({ AMK_NOTIFY_URL: 'off' });
    hookWith({ AMK_NOTIFY_URL: url.replace('/saved', '/variable') });
    assert.strictEqual(await posts(3), 3, 'off sends none');
    assert.strictEqual(got[2].at, '/variable');
    // not a URL: nothing saved
    const other = tmpDir('amk-notify-home-');
    const bad = spawnSync('node', [path.join(dir, 'scripts/amk/notify.js'), 'save'], { cwd: dir, input: 'my chat\n', encoding: 'utf8', env: { ...bare, HOME: other, USERPROFILE: other } });
    assert.deepStrictEqual([bad.status, fs.existsSync(path.join(other, '.amk/notify.json'))], [2, false]);
  } finally { server.close(); }
});

test('notify: each chat gets only the field it reads (Google Chat refuses "Unknown name content"), from the hook and an unattended build alike', () => {
  const { webhookBody } = require(path.join(COPY, 'notify.js'));
  const body = u => JSON.parse(webhookBody(u, 'app: Claude Code asks you: Push it?'));
  assert.deepStrictEqual(body('https://chat.googleapis.com/v1/spaces/AAAA/messages?key=k&token=t'), { text: 'app: Claude Code asks you: Push it?' });
  assert.deepStrictEqual(body('https://hooks.slack.com/services/T/B/x'), { text: 'app: Claude Code asks you: Push it?' });
  for (const u of ['https://discord.com/api/webhooks/1/x', 'https://ptb.discord.com/api/webhooks/1/x', 'https://discordapp.com/api/webhooks/1/x']) assert.deepStrictEqual(body(u), { content: 'app: Claude Code asks you: Push it?' }, u);
  assert.deepStrictEqual(Object.keys(body('https://example.invalid/discord.com/x')), ['text'], 'a path naming Discord isn\'t Discord');
  const autopilot = fs.readFileSync(path.join(KIT, 'autopilot.js'), 'utf8');
  assert.match(autopilot, /const \{ webhookUrl, webhookBody \} = require\('\.\/notify\.js'\);/, 'the unattended build posts to the same webhook');
  assert.match(autopilot, /body: webhookBody\(url, /, 'the unattended build posts the same body');
});

test('notify: a notifier that can\'t start (Windows without PowerShell on the PATH) doesn\'t fail the hook', () => {
  const { dir, env } = project();
  // Windows, as Node sees it: the notification through PowerShell, which isn't on this machine's PATH (on Windows, it is)
  write(dir, 'win32.js', "Object.defineProperty(process, 'platform', { value: 'win32' });\n");
  const r = spawnSync(process.execPath, ['-r', path.join(dir, 'win32.js'), '-e', `require(${JSON.stringify(path.join(dir, 'scripts/amk/notify.js'))}).hook()`],
    { cwd: dir, input: JSON.stringify({ hook_event_name: 'Notification', message: 'x' }), encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, r.stderr);
});
