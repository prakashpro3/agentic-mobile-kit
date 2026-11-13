#!/usr/bin/env node
// Tells you when the AI waits for you, so a session in another window doesn't sit there unanswered: a desktop
// notification (macOS, Linux with notify-send, Windows) and, with AMK_NOTIFY_URL set, a chat or phone webhook (Slack,
// Google Chat, Discord). Hooks of the AI tool start it:
//   Notification (Claude Code)  a permission prompt, or a reply it has waited a minute for
//   PermissionRequest (Codex)   an approval (Claude Code says those through Notification)
//   Stop (every tool)           every finished turn, from handoff-check.js once the turn really ends: what it asks
// AMK_NOTIFY=off turns it off; AMK_NOTIFY=ask keeps the approvals, the waiting and the turns that end with a question.
// An unattended build (autopilot.js) notifies by itself, so nothing comes from here then.
'use strict';
const fs = require('fs');
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
  const lines = lastWords(p).split('\n').map(l => l.replace(/[*_`#>]/g, '').trim()).filter(Boolean);
  const question = lines.filter(l => /\?$/.test(l)).pop() || lines.find(l => /\bapprov/i.test(l));
  if (mode === 'ask' && !question) return null;
  return { title: `${project}: ${tool} ${question ? 'asks you' : 'finished'}`, text: question || lines[0] || 'Its turn is over.' };
}

// the desktop notification now, the webhook in a process of its own: a hook returns at once
function send(n, env = process.env) {
  const text = redact(n.text).replace(/[\u0000-\u001f\u2028\u2029]+/g, ' ').slice(0, 300);
  const title = n.title.slice(0, 120);
  try {
    if (process.platform === 'darwin') spawnSync('osascript', ['-e', `display notification ${JSON.stringify(text)} with title ${JSON.stringify(title)}`], { stdio: 'ignore', timeout: 10000 });
    else if (process.platform === 'linux') spawnSync('notify-send', [title, text], { stdio: 'ignore', timeout: 10000 });
    else if (process.platform === 'win32') {
      const q = s => `'${s.replace(/'/g, "''")}'`;
      spawn('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(10000, ${q(title)}, ${q(text)}, 'Info'); Start-Sleep 10; $n.Dispose()`],
        { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }
  } catch {}
  if (!env.AMK_NOTIFY_URL) return;
  // Slack and Google Chat read text, Discord content
  const body = JSON.stringify({ text: `${title}: ${text}`, content: `${title}: ${text}` });
  spawn(process.execPath, ['-e', 'fetch(process.argv[1], { method: "POST", headers: { "content-type": "application/json" }, body: process.argv[2], signal: AbortSignal.timeout(10000) }).catch(() => {})',
    env.AMK_NOTIFY_URL, body], { detached: true, stdio: 'ignore', env }).unref();
}

const notify = (p, env = process.env) => { const n = message(p, env); if (n) send(n, env); return n; };
// a hook's own start: its payload on stdin
function hook() {
  let p = {};
  try { p = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}
  notify(p);
}

module.exports = { message, send, notify, hook, lastWords };
