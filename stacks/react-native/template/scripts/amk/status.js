#!/usr/bin/env node
// What's going on in this project, at a glance: whether the AI agent is working, is waiting for something it started
// (a command in the background, a subagent: it goes on by itself when that ends), or is waiting for you; the feature's
// tasks (specs/<id>/tasks.md); and where the kit's long runs stand (scripts/amk/progress.js: device and quick checks, CI,
// an unattended build), with how long the last one of each took.
//   Claude Code's status line runs it (statusLine in .claude/settings.json, every 2 seconds): a developer's own status
//   line first, when they have one, then the kit's lines. AMK_STATUS=off leaves the kit's lines out.
//   node scripts/amk/status.js            the status, once
//   node scripts/amk/status.js --watch    every 2 seconds, in a terminal of its own: with any AI tool
// The agent's state comes from Claude Code's session log (for --watch, the newest of this project) and its hooks: other
// tools show the tasks and the runs.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Buffer } = require('buffer');
const { execFileSync, spawnSync } = require('child_process');
const progress = require('./progress.js');

const root = path.join(__dirname, '..', '..');
const project = path.basename(root);
const STATE = path.join(root, '.amk', 'state');
const TAIL = 4 * 2 ** 20; // a session's first look reads at most this much of its end
const STALE = 6 * 3600e3; // something in the background not heard of for this long is taken as gone
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const save = (f, v) => { try { progress.writeJson(f, v); } catch {} };
const git = (...a) => { try { return execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const off = (env = process.env) => ['off', '0', 'no', 'false'].includes(String(env.AMK_STATUS || '').toLowerCase());
const idOf = (transcript, id) => String(id || path.basename(String(transcript || ''), '.jsonl')).replace(/[^A-Za-z0-9_-]/g, '_');

// ---------- the agent, from Claude Code's session log ----------
// the question a message ends with (its last line asking something), or an approval it asks for
function asks(text) {
  const lines = String(text || '').split('\n').map(l => l.replace(/[*_`#>]/g, '').trim()).filter(Boolean);
  return lines.filter(l => /\?$/.test(l)).pop() || lines.find(l => /\bapprov/i.test(l)) || '';
}
const what = p => { const i = p.input || {}; return String(i.description || i.command || i.prompt || p.name).split('\n')[0].slice(0, 80); };
// one record of the log: what the agent did last, and what it started in the background and hasn't heard back from
function take(s, line) {
  let e;
  try { e = JSON.parse(line); } catch { return; }
  if (e.isSidechain) return; // a subagent's own records
  const at = Date.parse(e.timestamp) || null;
  const content = e.message && e.message.content;
  // a background job's news: as a prompt of its own, or added to a turn under way. Its end has a status (completed,
  // failed, stopped); a watcher's (Monitor's) events have none, and it goes on
  const note = e.type === 'user' && typeof content === 'string' ? content
    : e.type === 'attachment' && e.attachment && typeof e.attachment.prompt === 'string' ? e.attachment.prompt : '';
  if (/^\s*<task-notification>/.test(note)) {
    const id = (/<task-id>([^<]+)<\/task-id>/.exec(note) || [])[1];
    if (id && /<status>(?!running)\w+<\/status>/.test(note)) delete s.pending[id];
  }
  if (e.type === 'assistant' && Array.isArray(content)) {
    for (const p of content) {
      if (p.type === 'tool_use') {
        s.uses[p.id] = what(p);
        const q = p.name === 'AskUserQuestion' && (((p.input || {}).questions || [])[0] || {}).question;
        s.last = { kind: 'tool', name: p.name, at, ...(q ? { ask: String(q).slice(0, 200) } : {}) };
      } else if (p.type === 'text' && String(p.text).trim()) s.last = { kind: 'text', text: String(p.text).slice(-2000), at };
    }
  } else if (e.type === 'user' && typeof content === 'string') s.last = { kind: 'prompt', at };
  else if (e.type === 'user' && Array.isArray(content)) {
    for (const p of content) {
      if (p.type === 'tool_result') {
        const r = e.toolUseResult || {};
        const job = r.backgroundTaskId || (r.status === 'async_launched' && r.agentId) || r.taskId;
        if (job) s.pending[job] = { what: String(r.description || s.uses[p.tool_use_id] || 'a command').slice(0, 80), at };
        delete s.uses[p.tool_use_id];
        // a permission the developer said no to: Claude Code stops there and waits for them, without its stop hook
        const said = typeof p.content === 'string' ? p.content : Array.isArray(p.content) ? p.content.map(c => (c && c.text) || '').join('') : '';
        s.last = { kind: /^The user doesn't want to proceed with this tool use/.test(said) ? 'stopped' : 'result', at };
      } else if (p.type === 'text') s.last = { kind: /^\[Request interrupted by user/.test(p.text || '') ? 'stopped' : 'prompt', at };
    }
  }
}
// the session as its log says now: read on from where the last look stopped (kept in .amk/state/), whole lines only
function session(transcript, id) {
  let size;
  try { size = fs.statSync(transcript).size; } catch { return null; }
  const cache = path.join(STATE, `session-${idOf(transcript, id)}.json`);
  let s = readJson(cache);
  if (!s || s.path !== transcript || s.offset > size) s = { path: transcript, offset: Math.max(0, size - TAIL), pending: {}, uses: {}, last: null, cut: true };
  if (size > s.offset) {
    const buf = Buffer.alloc(size - s.offset);
    const fd = fs.openSync(transcript, 'r');
    try { fs.readSync(fd, buf, 0, buf.length, s.offset); } finally { fs.closeSync(fd); }
    const end = buf.lastIndexOf(10);
    if (end >= 0) {
      let lines = buf.subarray(0, end + 1).toString('utf8').split('\n');
      if (s.cut && s.offset > 0) lines = lines.slice(1); // the first look starts inside a line
      for (const l of lines) if (l) take(s, l);
      s.offset += end + 1;
      s.cut = false;
      const uses = Object.entries(s.uses);
      if (uses.length > 50) s.uses = Object.fromEntries(uses.slice(-50));
      save(cache, s);
    }
  }
  return s;
}
// what the hooks saw that the log doesn't say: the turn ended (Stop), or Claude Code asks for a permission
const marksFile = (transcript, id) => path.join(STATE, `marks-${idOf(transcript, id)}.json`);
const marks = (transcript, id) => readJson(marksFile(transcript, id)) || {};
function mark(p, fields) {
  if (!p.transcript_path && !p.session_id) return;
  save(marksFile(p.transcript_path, p.session_id), { ...marks(p.transcript_path, p.session_id), ...fields });
}
// working, waiting (for what it started: it goes on by itself), asks (you), stopped (you stopped it), or done
function agentState(s, m = {}, now = Date.now(), lastWords = null) {
  if (!s || !s.last) return null;
  const pending = Object.values(s.pending || {}).filter(p => !p.at || now - p.at < STALE).sort((a, b) => (a.at || 0) - (b.at || 0));
  const l = s.last;
  const at = l.at || 0;
  if (l.kind === 'tool' && l.name === 'AskUserQuestion') return { state: 'asks', text: l.ask || 'a question', pending, at };
  if (m.attention && m.attention.at >= at) return { state: 'asks', text: m.attention.text, pending, at: m.attention.at };
  const over = l.kind === 'stopped' || (m.ended && m.ended >= at) || lastWords !== null;
  if (!over) return { state: 'working', pending, at };
  if (pending.length) return { state: 'waiting', pending, at };
  if (l.kind === 'stopped') return { state: 'stopped', pending, at };
  const q = asks(lastWords !== null ? lastWords : l.kind === 'text' ? l.text : '');
  return q ? { state: 'asks', text: q, pending, at } : { state: 'done', pending, at };
}
const stateOf = (p, lastWords = null) => agentState(session(p.transcript_path, p.session_id), marks(p.transcript_path, p.session_id), Date.now(), lastWords);
// the newest Claude Code session log of this project (Claude Code names its folder after the project's path)
function newestTranscript(dir = root, home = os.homedir()) {
  try {
    const base = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'projects', fs.realpathSync(dir).replace(/[^a-zA-Z0-9]/g, '-'));
    return fs.readdirSync(base).filter(f => f.endsWith('.jsonl')).map(f => path.join(base, f))
      .map(f => [f, fs.statSync(f).mtimeMs]).sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || null;
  } catch { return null; }
}

// ---------- the feature's tasks ----------
function readText(f) { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }
// the feature of this branch (feature/<id>, fix/<id>), else the spec in progress updated last
function tasks() {
  const specs = path.join(root, 'specs');
  const id0 = (/^(?:feature|fix)\/(.+)$/.exec(git('symbolic-ref', '--quiet', '--short', 'HEAD')) || [])[1];
  let id = id0 && fs.existsSync(path.join(specs, id0, 'tasks.md')) ? id0 : null;
  if (!id) {
    let dirs = [];
    try { dirs = fs.readdirSync(specs).filter(d => d !== '_templates' && d !== 'current'); } catch {}
    id = dirs.map(d => path.join(specs, d, 'progress.md')).filter(f => /^Status:\s*in progress/im.test(readText(f)))
      .map(f => [f, fs.statSync(f).mtimeMs]).sort((a, b) => b[1] - a[1]).map(([f]) => path.basename(path.dirname(f)))[0] || null;
  }
  if (!id) return null;
  const items = [...readText(path.join(specs, id, 'tasks.md')).matchAll(/^\s*- \[([ xX])\]\s*(.*)$/gm)]
    .map(m => ({ done: m[1] !== ' ', title: m[2].replace(/^\d+[.)]\s*/, '').split(/\s+—\s+/)[0].trim() }));
  if (!items.length) return null;
  const done = items.filter(t => t.done).length;
  return { id, done, total: items.length, current: (items.find(t => !t.done) || {}).title || '', items };
}

// ---------- the view ----------
const C = { dim: s => `\x1b[2m${s}\x1b[22m`, yellow: s => `\x1b[33m${s}\x1b[39m`, magenta: s => `\x1b[35m${s}\x1b[39m`, green: s => `\x1b[32m${s}\x1b[39m`, cyan: s => `\x1b[36m${s}\x1b[39m` };
const plain = s => s.replace(/\x1b\[[0-9;]*m/g, '');
// a line cut to the width, its colours kept
function fit(s, width) {
  if (!width || [...plain(s)].length <= width) return s;
  let out = '';
  let n = 0;
  for (const part of s.split(/(\x1b\[[0-9;]*m)/)) {
    if (/^\x1b\[/.test(part)) { out += part; continue; }
    const chars = [...part].slice(0, Math.max(0, width - 1 - n));
    out += chars.join('');
    n += chars.length;
  }
  return `${out}…\x1b[0m`;
}
const ago = (from, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - from) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
};
const bar = (done, total, w = 5) => { const n = Math.round((done / total) * w); return `${'▰'.repeat(n)}${'▱'.repeat(w - n)}`; };
// the agent's line; plain work isn't one under Claude Code's prompt, where its spinner says so
function agentLine(a, now = Date.now(), always = false) {
  if (!a) return '';
  const first = a.pending[0];
  const more = a.pending.length > 1 ? ` and ${a.pending.length - 1} more` : '';
  if (a.state === 'waiting') return `${C.yellow('⏳ Waiting')} for ${first.what}${first.at ? ` (${ago(first.at, now)})` : ''}${more} ${C.dim('· goes on by itself when that ends')}`;
  if (a.state === 'asks') return `${C.magenta('❓ Needs you:')} ${a.text}`;
  if (a.state === 'stopped') return `${C.cyan('⏸ Stopped')} ${C.dim('· your turn')}`;
  if (a.state === 'done') return `${C.green('✓ Done')} ${C.dim('· your turn')}`;
  if (first) return `${C.cyan('▶ Working')} ${C.dim(`· ${first.what} running in the background${more}`)}`;
  return always ? C.cyan('▶ Working') : '';
}
const runLine = (r, now = Date.now()) => `${r.title}${r.stage ? `: ${r.stage}` : ''}${r.total ? ` ${r.done || 0}/${r.total}` : ''}${r.label ? ` ${r.label}` : ''} ${C.dim(`${ago(r.started, now)}${r.last ? ` (last ${ago(0, r.last.ms)})` : ''}`)}`;
const taskLine = t => `${t.id} ${bar(t.done, t.total)} ${t.done}/${t.total} tasks${t.current ? ` ${C.dim(`· ${t.current}`)}` : ''}`;

// the kit's lines under the prompt: the agent, then the feature's tasks and the runs
function lines({ transcript = null, sessionId = null, now = Date.now(), width = 0 } = {}) {
  const a = transcript ? agentState(session(transcript, sessionId), marks(transcript, sessionId), now) : null;
  const t = tasks();
  const work = [t && taskLine(t), ...progress.runs().map(r => runLine(r, now))].filter(Boolean);
  return [agentLine(a, now), work.join(C.dim(' · '))].filter(Boolean).map(l => fit(l, width));
}

// Claude Code's status line: the developer's own first (the project's setting replaces theirs), then the kit's
function ownStatusLine(input, env = process.env) {
  const own = (readJson(path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json')) || {}).statusLine;
  if (!own || own.type !== 'command' || !own.command || /scripts\/amk\/status\.js/.test(own.command)) return '';
  // ponytail: through the system shell; a Windows status line written for Git Bash doesn't run here
  const r = spawnSync(own.command, { shell: true, input, encoding: 'utf8', timeout: 1500, env });
  return (r.stdout || '').replace(/\r\n/g, '\n').replace(/\n+$/, ''); // a Windows command's lines end in \r\n
}
function statusLine() {
  let input = '';
  try { input = fs.readFileSync(0, 'utf8'); } catch {}
  let p = {};
  try { p = JSON.parse(input); } catch {}
  const out = [ownStatusLine(input)];
  if (!off()) out.push(...lines({ transcript: p.transcript_path, sessionId: p.session_id, width: Number(process.env.COLUMNS) || 0 }));
  process.stdout.write(`${out.filter(Boolean).join('\n')}\n`);
}

// once, or every 2 seconds in a terminal of its own, with any AI tool
function full({ now = Date.now(), transcript = newestTranscript() } = {}) {
  const a = transcript ? agentState(session(transcript), marks(transcript), now) : null;
  const t = tasks();
  const out = [`${project} ${C.dim(`· ${new Date(now).toLocaleTimeString()}`)}`, ''];
  out.push(a ? `${agentLine(a, now, true)}${a.at ? C.dim(` · ${ago(a.at, now)} ago`) : ''}` : C.dim('The agent: shown for Claude Code sessions. Other tools: the tasks and the checks below.'));
  if (a && a.pending.length > 1) for (const p of a.pending) out.push(C.dim(`   ⏳ ${p.what}${p.at ? ` (${ago(p.at, now)})` : ''}`));
  if (t) {
    out.push('', `${t.id}: ${t.done} of ${t.total} tasks done ${bar(t.done, t.total, 10)}`);
    const next = t.items.findIndex(x => !x.done);
    t.items.forEach((x, i) => out.push(`  ${x.done ? C.green('✓') : i === next ? C.cyan('▶') : C.dim('○')} ${x.done ? C.dim(x.title) : x.title}`));
  }
  const runs = progress.runs();
  if (runs.length) out.push('', ...runs.map(r => `${runLine(r, now)}${r.total ? ` ${bar(r.done || 0, r.total, 10)}` : ''}`));
  if (!t && !runs.length && !a) out.push(C.dim('Nothing in progress.'));
  return out.join('\n');
}

module.exports = { asks, take, session, marks, mark, agentState, stateOf, newestTranscript, tasks, lines, statusLine, ownStatusLine, full, fit, ago };

if (require.main === module) {
  if (process.argv.includes('--watch')) {
    const draw = () => process.stdout.write(`\x1b[H\x1b[2J${full()}\n${C.dim('\nEvery 2 seconds. Ctrl+C to stop.')}\n`);
    draw();
    setInterval(draw, 2000);
  } else console.log(full());
}
