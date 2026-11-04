#!/usr/bin/env node
// A stand-in for npx in the eval cases, so m-release's changelog needs no download: only git-cliff, which writes the
// commits since the last v* tag, by kind (feat, fix, the rest), to -o, --prepend or the output, as git-cliff does.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
if (!args.some(a => /^git-cliff@/.test(a))) { process.stderr.write(`fake npx: only git-cliff here, not "${args.join(' ')}"\n`); process.exit(1); }
const opt = n => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const git = (...a) => { try { return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const last = git('describe', '--tags', '--abbrev=0', '--match', 'v*');
const subjects = git('log', '--format=%s', last ? `${last}..HEAD` : 'HEAD').split('\n').filter(s => s && !/^chore\(release\)/.test(s));
const kinds = [['Features', /^feat\b/], ['Bug Fixes', /^fix\b/], ['Other', /./]];
const left = new Set(subjects);
const sections = kinds.map(([title, re]) => {
  const of = [...left].filter(s => re.test(s));
  of.forEach(s => left.delete(s));
  return of.length ? `### ${title}\n\n${of.map(s => `- ${s.replace(/^\w+(\([^)]*\))?!?:\s*/, '')}`).join('\n')}\n` : '';
}).filter(Boolean);
const text = `## [${(opt('--tag') || 'unreleased').replace(/^v/, '')}] - ${new Date().toISOString().slice(0, 10)}\n\n${sections.join('\n')}`;
const o = opt('-o') || opt('--output');
const prepend = opt('--prepend');
if (o) { fs.mkdirSync(path.dirname(o), { recursive: true }); fs.writeFileSync(o, text); }
if (prepend) fs.writeFileSync(prepend, `${text}\n${fs.existsSync(prepend) ? fs.readFileSync(prepend, 'utf8') : ''}`);
if (!o && !prepend) process.stdout.write(text);
