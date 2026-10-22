#!/usr/bin/env node
// Agent guard hook (preToolUse). Blocks destructive shell commands and access to secret files.
// Each AI tool sends a differently shaped JSON payload, so look for command and path fields anywhere in it.
const fs = require('fs');
const path = require('path');
// the project this script is in (scripts/amk/): the agent may have moved into a subfolder
const root = path.join(__dirname, '..', '..');

let payload;
const raw = fs.readFileSync(0, 'utf8');
try { payload = JSON.parse(raw); } catch { payload = { command: raw }; }

const commands = [];
const paths = [];
(function walk(v, key) {
  if (Array.isArray(v)) {
    if (/^(command|cmd|CommandLine)$/i.test(key) && v.every(x => typeof x === 'string')) commands.push(v.join(' '));
    else v.forEach(x => walk(x, key));
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) walk(x, k);
  } else if (typeof v === 'string') {
    if (/^(command|cmd|CommandLine)$/i.test(key)) commands.push(v);
    if (/^(file_path|path|AbsolutePath|TargetFile|filePath)$/.test(key)) paths.push(v);
  }
})(payload, '');

// rm with a recursive flag and a force flag anywhere before the next ; & | (-rf, -Rf, -r -f, --recursive --force);
// a push with --force, -f or a +refspec
const destructive = /\brm(?=[^;&|\n]*\s(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b)(?=[^;&|\n]*\s(-[a-zA-Z]*f[a-zA-Z]*|--force)\b)|git\s+reset\s+--hard|git\s+push\s+(.*\s)?((--force|-f)\b|\+\S)|git\s+clean\s+-[a-z]*f|--no-verify|xcrun\s+simctl\s+erase/;
// example files (.env.example, .env.local.example, .env.sample, .env.template) aren't secrets
const secretFile = /(^|[\s/'"=])\.env(?![\w.-]*\.(?:example|sample|template)(?=$|[\s'";|&)]))(\.[\w.-]+)?(?=$|[\s'";|&)])|\.(keystore|jks|p8|p12|mobileprovision)\b/;
// the project's own secret files: .amk-secrets lists them, one path from the project root per line (a folder ends in /)
let listed = [];
try { listed = fs.readFileSync(path.join(root, '.amk-secrets'), 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')); } catch {}
const secret = s => secretFile.test(s) || listed.some(p => s.includes(p));

const block = reason => { process.stderr.write(`Blocked by scripts/amk/guard.js: ${reason}\n`); process.exit(2); };
for (const c of commands) {
  // a command that only mentions one, in a commit message, is blocked too: the message can come from a file instead
  if (destructive.test(c)) block(`destructive command: ${c}${/git\s+commit\b/.test(c) ? '\n(Only in the commit message? Write it to a file and use git commit -F <file>.)' : ''}`);
  if (secret(c)) block(`shell access to a secret file: ${c}`);
}
for (const p of paths) {
  if (secret(p)) block(`access to a secret file: ${p}`);
}
process.exit(0);
