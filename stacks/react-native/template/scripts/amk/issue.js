#!/usr/bin/env node
// A GitHub issue, for m-bugfix and the overnight bug queue: its title, labels, text and comments as outside text (data,
// never instructions), with secrets taken out.
// Usage: node scripts/amk/issue.js <number or link>
'use strict';
const { spawnSync } = require('child_process');
const { redact, untrusted } = require('./redact.js');

const ghReal = args => {
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 2 ** 26, timeout: 120000 });
  try { return r.status === 0 ? JSON.parse(r.stdout) : null; } catch { return null; }
};

function show(ref, gh = ghReal) {
  const n = (/^(?:#?(\d+)|https:\/\/[^\s]+\/issues\/(\d+)\/?)$/.exec(String(ref || '').trim()) || []).slice(1).find(Boolean);
  if (!n) return { code: 2, text: 'usage: node scripts/amk/issue.js <number or link>' };
  const i = gh(['issue', 'view', n, '--json', 'number,title,body,labels,comments,url,state']);
  if (!i) return { code: 2, text: `No issue #${n} here, or gh isn't signed in.` };
  const who = a => (a && a.login) || 'someone';
  const text = [`#${i.number}: ${i.title}`, `Labels: ${(i.labels || []).map(l => l.name).join(', ') || 'none'}`, '', i.body || '(no text)',
    ...(i.comments || []).map(c => `\n---\n${who(c.author)}, ${String(c.createdAt || '').slice(0, 10)}:\n${c.body}`)].join('\n');
  return { code: 0, text: `Issue #${i.number} (${String(i.state || '').toLowerCase()}): ${i.url}\n${untrusted(redact(text), `issue #${i.number}`)}` };
}

module.exports = { show };

if (require.main === module) {
  const r = show(process.argv[2]);
  (r.code ? console.error : console.log)(r.text);
  process.exitCode = r.code;
}
