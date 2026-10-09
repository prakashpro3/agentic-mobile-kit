#!/usr/bin/env node
// Agent guard hook (preToolUse). Blocks destructive shell commands and access to secret files.
// Each AI tool sends a differently shaped JSON payload, so look for command and path fields anywhere in it.
const fs = require('fs');

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

const destructive = /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-r\s+-f|-f\s+-r)\b|git\s+reset\s+--hard|git\s+push\s+(.*\s)?(--force|-f)\b|git\s+clean\s+-[a-z]*f|--no-verify|xcrun\s+simctl\s+erase/;
// example files (.env.example, .env.local.example, .env.sample, .env.template) aren't secrets
const secretFile = /(^|[\s/'"=])\.env(?![\w.-]*\.(?:example|sample|template)(?=$|[\s'";|&)]))(\.[\w.-]+)?(?=$|[\s'";|&)])|\.(keystore|jks|p8|p12|mobileprovision)\b/;

const block = reason => { process.stderr.write(`Blocked by scripts/ai/guard.js: ${reason}\n`); process.exit(2); };
for (const c of commands) {
  if (destructive.test(c)) block(`destructive command: ${c}`);
  if (secretFile.test(c)) block(`shell access to a secret file: ${c}`);
}
for (const p of paths) {
  if (secretFile.test(p)) block(`access to a secret file: ${p}`);
}
process.exit(0);
