// Run: node --test tests/*.test.js
// scripts/amk/status.js and progress.js: what Claude Code's status line and status.js --watch show. The agent working,
// waiting for what it started (it goes on by itself), or waiting for the developer; the feature's tasks; the kit's runs,
// how far each is and how long the last one took
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const tmpDir = require('./tmp');

const KIT = path.join(__dirname, '../stacks/react-native/template/scripts/amk');
const write = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
const plain = s => s.replace(/\x1b\[[0-9;]*m/g, '');
// a project with the kit's scripts, so what they keep (.amk/) stays in it
function project() {
  const dir = tmpDir('amk-status-');
  fs.cpSync(KIT, path.join(dir, 'scripts/amk'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return { dir, status: require(path.join(dir, 'scripts/amk/status.js')), progress: require(path.join(dir, 'scripts/amk/progress.js')) };
}
// Claude Code's session log, as it writes it: one record a line
const T0 = Date.parse('2026-11-16T10:00:00Z');
const at = s => new Date(T0 + s * 1000).toISOString();
const notice = (id, state) => `<task-notification>\n<task-id>${id}</task-id>\n${state ? `<status>${state}</status>\n` : ''}<summary>x</summary>\n</task-notification>`;
const rec = {
  prompt: (s, text = 'Build EV-7') => ({ type: 'user', timestamp: at(s), message: { role: 'user', content: text } }),
  text: (s, text) => ({ type: 'assistant', timestamp: at(s), message: { content: [{ type: 'text', text }] } }),
  tool: (s, id, name, input) => ({ type: 'assistant', timestamp: at(s), message: { content: [{ type: 'tool_use', id, name, input }] } }),
  result: (s, id, toolUseResult = {}) => ({ type: 'user', timestamp: at(s), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] }, toolUseResult }),
  // a background job's news: a turn of its own, or added to the turn under way
  note: (s, id, state) => ({ type: 'user', timestamp: at(s), message: { role: 'user', content: notice(id, state) } }),
  queued: (s, id, state) => ({ type: 'attachment', timestamp: at(s), attachment: { type: 'queued_command', prompt: notice(id, state) } }),
  interrupt: s => ({ type: 'user', timestamp: at(s), message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
  subagent: s => ({ type: 'assistant', isSidechain: true, timestamp: at(s), message: { content: [{ type: 'text', text: 'A subagent asks: done?' }] } }),
};
const log = (file, ...records) => fs.appendFileSync(file, records.map(r => `${JSON.stringify(r)}\n`).join(''));

test('status: the agent waits for what it started until each one ends; a watcher\'s news doesn\'t end it, nor a subagent\'s words', () => {
  const { dir, status } = project();
  const t = path.join(dir, '.claude/projects/p/s1.jsonl');
  write(dir, '.claude/projects/p/s1.jsonl', '');
  log(t, rec.prompt(0),
    rec.tool(1, 'b1', 'Bash', { command: 'sh scripts/amk/verify.sh android --spec EV-7', description: 'Android check', run_in_background: true }),
    rec.result(2, 'b1', { backgroundTaskId: 'bg1' }),
    rec.tool(3, 'a1', 'Agent', { description: 'the iOS check', prompt: 'Run sh scripts/amk/verify.sh ios' }),
    rec.result(4, 'a1', { isAsync: true, status: 'async_launched', agentId: 'ag1', description: 'iOS check' }),
    rec.tool(5, 'm1', 'Monitor', { description: 'CI on the PR', command: 'gh pr checks --watch' }),
    rec.result(6, 'm1', { taskId: 'mon1', timeoutMs: 1800000, persistent: false }),
    rec.subagent(6.5),
    rec.text(7, 'All three run in the background; I go on when they end.'));
  const state = (m = {}, s = 60) => status.agentState(status.session(t, 's1'), m, T0 + s * 1000);
  assert.strictEqual(state().state, 'working', 'the turn isn\'t over until the stop hook says so');
  let a = state({ ended: T0 + 8e3 });
  assert.strictEqual(a.state, 'waiting');
  assert.deepStrictEqual(a.pending.map(p => p.what), ['Android check', 'iOS check', 'CI on the PR']);
  // the watcher's news (no status) leaves it going; the Android check's end is a turn of its own
  log(t, rec.queued(9, 'mon1'), rec.note(10, 'bg1', 'completed'));
  assert.strictEqual(state({ ended: T0 + 8e3 }).state, 'working', 'a new turn');
  log(t, rec.text(11, 'Android passed. The iOS check still runs.'));
  a = state({ ended: T0 + 12e3 });
  assert.deepStrictEqual([a.state, a.pending.map(p => p.what)], ['waiting', ['iOS check', 'CI on the PR']]);
  // ends added to a turn under way count too; failed and stopped jobs end as well
  log(t, rec.queued(13, 'ag1', 'failed'));
  assert.deepStrictEqual(state({ ended: T0 + 12e3 }).pending.map(p => p.what), ['CI on the PR']);
  log(t, rec.note(14, 'mon1', 'stopped'), rec.text(15, 'The iOS check failed on the tablet.\n\n**Shall I fix it now?**'));
  a = state({ ended: T0 + 16e3 });
  assert.deepStrictEqual([a.state, a.text, a.pending], ['asks', 'Shall I fix it now?', []]);
  log(t, rec.prompt(17, 'yes'), rec.text(18, 'Fixed, and the check passed.'));
  assert.strictEqual(state({ ended: T0 + 19e3 }).state, 'done');
  // a line still being written is read once it's whole
  fs.appendFileSync(t, JSON.stringify(rec.prompt(20, 'next')).slice(0, 30));
  assert.strictEqual(state({ ended: T0 + 19e3 }).state, 'done');
  fs.appendFileSync(t, `${JSON.stringify(rec.prompt(20, 'next')).slice(30)}\n`);
  assert.strictEqual(state({ ended: T0 + 19e3 }).state, 'working');
});

test('status: a question it asks, a permission prompt, and the developer stopping it; with a job still running, it waits for that', () => {
  const { dir, status } = project();
  const t = path.join(dir, 's2.jsonl');
  log(t, rec.prompt(0), rec.tool(1, 'q', 'AskUserQuestion', { questions: [{ question: 'Which screens should it check?', header: 'Screens', options: [] }] }));
  const state = m => status.agentState(status.session(t), m, T0 + 60e3);
  assert.deepStrictEqual([state({}).state, state({}).text], ['asks', 'Which screens should it check?'], 'a question tool asks while the turn goes on');
  log(t, rec.result(2, 'q'), rec.tool(3, 'b', 'Bash', { command: 'git push' }));
  assert.strictEqual(state({}).state, 'working');
  // the permission prompt, which the log doesn't show: the notification hook marks it, until the next step
  const attention = { attention: { at: T0 + 9e3, text: 'Claude needs your permission to use Bash' } };
  assert.deepStrictEqual([state(attention).state, state(attention).text], ['asks', 'Claude needs your permission to use Bash']);
  log(t, rec.result(10, 'b'));
  assert.strictEqual(state(attention).state, 'working', 'approved: on it goes');
  log(t, rec.interrupt(11));
  assert.strictEqual(state({}).state, 'stopped');
  log(t, rec.prompt(12), rec.tool(13, 'c', 'Bash', { command: 'sleep 600', run_in_background: true }), rec.result(14, 'c', { backgroundTaskId: 'bgc' }), rec.interrupt(15));
  assert.strictEqual(state({}).state, 'waiting', 'stopped, but the job goes on, and its end starts the next turn');
  // the hooks' marks go in .amk/state/, by session
  status.mark({ session_id: 's2', transcript_path: t }, { ended: 5 });
  status.mark({ session_id: 's2', transcript_path: t }, { attention: { at: 6, text: 'x' } });
  assert.deepStrictEqual(status.marks(t, 's2'), { ended: 5, attention: { at: 6, text: 'x' } });
  status.mark({}, { ended: 1 }); // no session: nothing
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, '.amk/state')).sort(), ['marks-s2.json', 'session-s2.json']);
});

test('progress: a run\'s stage and how far it is; its length when it passed, as a guide; a run whose process is gone drops out', () => {
  const { dir, progress } = project();
  const live = { pid: process.pid, title: 'Android check', kind: 'android' };
  progress.set('verify-android-1', { ...live, stage: 'build' }, 1000);
  progress.set('verify-android-1', { stage: 'phone', done: 2, total: 8, label: 'login' }, 5000);
  let [r] = progress.runs();
  assert.deepStrictEqual([r.title, r.stage, r.done, r.total, r.label, r.started, r.stageStarted, r.last], ['Android check', 'phone', 2, 8, 'login', 1000, 5000, null]);
  progress.set('verify-android-1', { stage: 'tablet' }, 6000);
  [r] = progress.runs();
  assert.deepStrictEqual([r.stage, r.done, r.total, r.label], ['tablet', undefined, undefined, undefined], 'a new stage starts its own count');
  progress.end('verify-android-1', 'passed', 61000);
  assert.deepStrictEqual(progress.runs(), []);
  progress.set('verify-android-2', live, 70000);
  assert.strictEqual(progress.runs()[0].last.ms, 60000, 'the last one of its kind took a minute');
  progress.end('verify-android-2', 'failed', 80000);
  progress.set('verify-android-3', live, 90000);
  assert.strictEqual(progress.runs()[0].last.ms, 60000, 'one that failed isn\'t a guide');
  // a run killed on its way: its process is gone, so it isn't shown, and its record goes
  const gone = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim();
  progress.set('verify-ios-9', { pid: Number(gone), title: 'iOS check' });
  assert.deepStrictEqual(progress.runs().map(x => x.key), ['verify-android-3']);
  assert.ok(!fs.existsSync(path.join(dir, '.amk/progress/verify-ios-9.json')));
  // from a shell script: set, then end, or every run of a process at its exit
  const cli = (...a) => spawnSync(process.execPath, [path.join(dir, 'scripts/amk/progress.js'), ...a], { encoding: 'utf8' });
  assert.strictEqual(cli('set', 'quick-7', '--pid', String(process.pid), '--title', 'Quick check', '--stage', 'lint').status, 0);
  assert.strictEqual(cli('set', 'quick-7', '--done', '1', '--total', '3').status, 0);
  r = progress.runs().find(x => x.key === 'quick-7');
  assert.deepStrictEqual([r.title, r.stage, r.done, r.total], ['Quick check', 'lint', 1, 3]);
  cli('end-pid', String(process.pid));
  assert.deepStrictEqual(progress.runs(), []);
  assert.strictEqual(cli('nonsense').status, 2);
});

test('status: the status line: the developer\'s own first, then the agent and the work; AMK_STATUS=off leaves the kit\'s out', () => {
  const { dir, progress } = project();
  execFileSync('git', ['checkout', '-q', '-b', 'feature/EV-7'], { cwd: dir });
  write(dir, 'specs/EV-7/tasks.md', '# EV-7: tasks\n\nWhile building, ...\n\n- [x] 1. The list screen — for: R1\n- [x] 2. Its API call — for: R1\n- [ ] 3. Pull to refresh — for: R2 — after: 1\n- [ ] 4. Empty state\n- [ ] 5. Offline banner\n');
  progress.set('verify-android-1', { pid: process.pid, title: 'Android check', stage: 'phone', done: 2, total: 8, label: 'login' });
  const t = path.join(dir, 's3.jsonl');
  // the status line runs on the clock: these happened a moment ago
  const recent = r => ({ ...r, timestamp: new Date(Date.now() - 5000).toISOString() });
  log(t, ...[rec.prompt(0), rec.tool(1, 'b', 'Bash', { description: 'Android check', command: 'x' }), rec.result(2, 'b', { backgroundTaskId: 'bg' }), rec.text(3, 'Waiting.')].map(recent));
  require(path.join(dir, 'scripts/amk/status.js')).mark({ session_id: 's3' }, { ended: Date.now() });
  const config = tmpDir('amk-status-config-');
  write(config, 'settings.json', JSON.stringify({ statusLine: { type: 'command', command: 'echo mine' } }));
  const line = (more = {}) => plain(spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(dir, 'scripts/amk/status.js'))}).statusLine()`],
    { cwd: dir, input: JSON.stringify({ session_id: 's3', transcript_path: t }), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: config, COLUMNS: '300', AMK_STATUS: '', ...more } }).stdout).split('\n');
  const [own, agent, work] = line();
  assert.strictEqual(own, 'mine');
  assert.match(agent, /^⏳ Waiting for Android check \(\ds\)/);
  assert.match(agent, /· goes on by itself when that ends$/);
  assert.match(work, /^EV-7 ▰▰▱▱▱ 2\/5 tasks · Pull to refresh · Android check: phone 2\/8 login \d+s$/);
  assert.deepStrictEqual(line({ AMK_STATUS: 'off' }), ['mine', ''], 'theirs only');
  // the kit's own line in their settings isn't run twice; a narrow terminal cuts the lines
  write(config, 'settings.json', JSON.stringify({ statusLine: { type: 'command', command: 'node scripts/amk/status.js' } }));
  const narrow = line({ COLUMNS: '24' });
  assert.match(narrow[0], /^⏳ Waiting for Android c…$/);
  assert.ok(narrow.every(l => [...l].length <= 24), narrow.join('\n'));
});

test('status: --watch\'s view, from the project\'s newest Claude Code session: the agent, each task, each run', () => {
  const { dir, status, progress } = project();
  const config = tmpDir('amk-status-home-');
  const sessions = path.join(config, 'projects', fs.realpathSync(dir).replace(/[^a-zA-Z0-9]/g, '-'));
  write(sessions, 'old.jsonl', `${JSON.stringify(rec.prompt(0))}\n`);
  write(sessions, 'new.jsonl', `${JSON.stringify(rec.prompt(0))}\n${JSON.stringify(rec.tool(1, 'q', 'AskUserQuestion', { questions: [{ question: 'Ship it?' }] }))}\n`);
  fs.utimesSync(path.join(sessions, 'old.jsonl'), new Date(T0), new Date(T0));
  const was = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config;
  try { assert.strictEqual(status.newestTranscript(dir), path.join(sessions, 'new.jsonl')); } finally { if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = was; }
  write(dir, 'specs/EV-7/progress.md', 'Status: in progress — task 2 of 3\n');
  write(dir, 'specs/EV-7/tasks.md', '- [x] 1. List\n- [ ] 2. Refresh — for: R2\n- [ ] 3. Empty state\n');
  progress.set('pr-checks', { pid: process.pid, title: 'CI', stage: 'PR #12', done: 3, total: 5, label: 'waiting for android' });
  const view = plain(status.full({ transcript: path.join(sessions, 'new.jsonl'), now: T0 + 90e3 }));
  assert.match(view, /^❓ Needs you: Ship it\? · 1m29s ago$/m);
  assert.match(view, /^EV-7: 1 of 3 tasks done ▰▰▰▱▱▱▱▱▱▱\n {2}✓ List\n {2}▶ Refresh\n {2}○ Empty state$/m, 'the spec in progress, off its branch too');
  assert.match(view, /^CI: PR #12 3\/5 waiting for android \S+ ▰▰▰▰▰▰▱▱▱▱$/m);
  progress.end('pr-checks');
  fs.rmSync(path.join(dir, 'specs'), { recursive: true });
  assert.match(plain(status.full({ transcript: null })), /The agent: shown for Claude Code sessions[\s\S]*Nothing in progress\./);
});

test('status: lines cut to the terminal\'s width, their colours kept; times as the status line says them', () => {
  const { status } = project();
  assert.strictEqual(status.fit('\x1b[33m⏳ Waiting\x1b[39m for a long thing', 12), '\x1b[33m⏳ Waiting\x1b[39m f…\x1b[0m');
  assert.strictEqual(status.fit('short', 12), 'short');
  assert.deepStrictEqual([status.ago(0, 59e3), status.ago(0, 61e3), status.ago(0, 3723e3)], ['59s', '1m01s', '1h02m']);
});
