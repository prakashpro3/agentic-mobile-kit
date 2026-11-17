#!/usr/bin/env node
// Tells you when the AI waits for you, so a session in another window doesn't sit there unanswered: a desktop
// notification (macOS, Linux with notify-send, Windows) and, with AMK_NOTIFY_URL set, a chat or phone webhook (Slack,
// Google Chat, Discord). Hooks of the AI tool start it:
//   Notification (Claude Code)  a permission prompt, or a reply it has waited a minute for
//   PermissionRequest (Codex)   an approval (Claude Code says those through Notification)
//   Stop (every tool)           every finished turn, from handoff-check.js once the turn really ends: what it asks, or
//                               (Claude Code) what it waits for, when it ends the turn while something it started runs
// AMK_NOTIFY=off turns it off; AMK_NOTIFY=ask keeps the approvals, the waiting and the turns that end with a question.
// The hook also tells the status line (status.js) that the agent waits for you, whether or not it notifies.
// An unattended build (autopilot.js) notifies by itself, so nothing comes from here then.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { redact } = require('./redact.js');

const root = path.join(__dirname, '..', '..');

// what the AI said last: the payload's, or the last assistant text in its transcript (one JSON event a line)
function lastWords(p) {
  if (typeof p.last_assistant_message === 'string') return p.last_assistant_message;
  try {
    for (const line of fs.readFileSync(p.transcript_path, 'utf8').trim().split('\n').reverse()) {
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      const c = e.type === 'assistant' && e.message && e.message.content;
      const text = Array.isArray(c) ? c.filter(x => x && x.type === 'text').map(x => x.text).join('\n') : typeof c === 'string' ? c : '';
      if (text.trim()) return text;
    }
  } catch {}
  return '';
}
const waiting = (p, words) => { try { const a = require('./status.js').stateOf(p, words); return a && a.state === 'waiting' ? a : null; } catch { return null; } };
const toolOf = (p, env) => (/[\\/]\.claude[\\/]/.test(p.transcript_path || '') || env.CLAUDECODE ? 'Claude Code'
  : /[\\/]\.codex[\\/]/.test(p.transcript_path || '') ? 'Codex' : 'The AI');

// the notification for a hook's payload: { title, text }, or null
function message(p, env = process.env) {
  const mode = String(env.AMK_NOTIFY || 'on').toLowerCase();
  if (env.AMK_AUTOPILOT || ['off', '0', 'no', 'false'].includes(mode)) return null;
  const project = path.basename(root);
  const tool = toolOf(p, env);
  const event = p.hook_event_name || '';
  if (event === 'Notification') return { title: `${project}: ${tool} is waiting for you`, text: p.message || 'It needs your answer or approval.' };
  if (event === 'PermissionRequest') {
    if (tool === 'Claude Code') return null;
    const input = p.tool_input || {};
    return { title: `${project}: ${tool} needs your approval`, text: String(input.command || input.file_path || p.tool_name || 'a command') };
  }
  if (event !== 'Stop') return null;
  const words = lastWords(p);
  // a turn that ends while what it started still runs (a command in the background, a subagent): Claude Code goes on
  // by itself when that ends, as its log says
  const a = tool === 'Claude Code' ? waiting(p, words) : null;
  if (a) return mode === 'ask' ? null : { title: `${project}: ${tool} is waiting for ${a.pending[0].what}`, text: 'It goes on by itself when that ends: nothing is needed from you now.' };
  const lines = words.split('\n').map(l => l.replace(/[*_`#>]/g, '').trim()).filter(Boolean);
  const question = lines.filter(l => /\?$/.test(l)).pop() || lines.find(l => /\bapprov/i.test(l));
  if (mode === 'ask' && !question) return null;
  return { title: `${project}: ${tool} ${question ? 'asks you' : 'finished'}`, text: question || lines[0] || 'Its turn is over.' };
}

// the desktop notification now, the webhook in a process of its own: a hook returns at once. Those processes start in
// the temp folder: on Windows a process holds the folder it runs in, and the project's would be locked meanwhile
function send(n, env = process.env) {
  const text = redact(n.text).replace(/[\u0000-\u001f\u2028\u2029]+/g, ' ').slice(0, 300);
  const title = n.title.slice(0, 120);
  try {
    if (process.platform === 'darwin') spawnSync('osascript', ['-e', `display notification ${JSON.stringify(text)} with title ${JSON.stringify(title)}`], { stdio: 'ignore', timeout: 10000 });
    else if (process.platform === 'linux') spawnSync('notify-send', [title, text], { stdio: 'ignore', timeout: 10000 });
    else if (process.platform === 'win32') {
      const q = s => `'${s.replace(/'/g, "''")}'`;
      spawn('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(10000, ${q(title)}, ${q(text)}, 'Info'); Start-Sleep 10; $n.Dispose()`],
        { detached: true, stdio: 'ignore', windowsHide: true, cwd: os.tmpdir() }).on('error', () => {}).unref();
    }
  } catch {}
  if (!env.AMK_NOTIFY_URL) return;
  const body = webhookBody(env.AMK_NOTIFY_URL, `${title}: ${text}`);
  spawn(process.execPath, ['-e', 'fetch(process.argv[1], { method: "POST", headers: { "content-type": "application/json" }, body: process.argv[2], signal: AbortSignal.timeout(10000) }).catch(() => {})',
    env.AMK_NOTIFY_URL, body], { detached: true, stdio: 'ignore', env, cwd: os.tmpdir() }).on('error', () => {}).unref();
}

// what a chat's webhook reads: Discord content, the others (Slack, Google Chat, Teams) text. Only that field: Google Chat
// refuses a message with any field it doesn't know
const webhookBody = (url, text) => JSON.stringify(/^https:\/\/([\w-]+\.)*discord(app)?\.com\//i.test(String(url)) ? { content: text } : { text });

const notify = (p, env = process.env) => { const n = message(p, env); if (n) send(n, env); return n; };
// a hook's own start: its payload on stdin. The status line hears of it too: a reply Claude Code has waited a minute
// for means the turn is over; anything else (a permission prompt, Codex's approvals) waits for you until the next step
function hook() {
  let p = {};
  try { p = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}
  try {
    const idle = p.notification_type === 'idle_prompt' || /waiting for your input/i.test(p.message || '');
    require('./status.js').mark(p, idle ? { ended: Date.now() } : { attention: { at: Date.now(), text: String(p.message || (p.tool_input || {}).command || 'your approval').slice(0, 200) } });
  } catch {}
  notify(p);
}

module.exports = { message, send, notify, hook, lastWords, webhookBody };
