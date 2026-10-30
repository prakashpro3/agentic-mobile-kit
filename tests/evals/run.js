#!/usr/bin/env node
// The kit's eval suite: checks that ran by hand in live sessions, as scripted cases (cases.js). Each case runs Claude Code
// without a chat window (claude -p, stream-json) in its own copy of a scratch app this script made and set up with the
// kit, with a clean environment, the project's settings only and exactly the tools the case allows, then checks the files
// written and the tool calls made. It reports each case's result, time and tokens, and the pass rate by skill, next to
// the previous kit version's (tests/evals/results/<version>.json, which a full run writes), and checks each skill's
// length against its budget (budgets.json). It never runs anywhere but in the apps it made: each holds a token this run
// wrote, checked before every run. The logs, redacted, stay in the temporary folder it prints.
// Run it before a release, and after a model or Claude Code update. It signs in with your Claude Code login (the shell's
// API key and other variables are left out), and a run with Haiku costs well under a dollar.
// Usage: node tests/evals/run.js [--case <name>[,<name>…]] [--model <model>] [--keep] [--budgets] [--list]
//   --budgets  only the skills' length (npm test checks that too)    --keep  leave the apps, to look at them
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const KIT = path.join(__dirname, '..', '..');
const TEMPLATE = path.join(KIT, 'stacks/react-native/template');
const RESULTS = path.join(__dirname, 'results');
const VERSION = require(path.join(KIT, 'package.json')).version;
const { redact } = require(path.join(TEMPLATE, 'scripts/amk/redact.js'));

// ---------- the skills' length ----------
const words = text => text.split(/\s+/).filter(Boolean).length;
const skillSizes = (dir = path.join(TEMPLATE, '.agents/skills')) => Object.fromEntries(fs.readdirSync(dir).filter(n => /^m-/.test(n)).sort()
  .map(n => [n, words(fs.readFileSync(path.join(dir, n, 'SKILL.md'), 'utf8'))]));
const budgets = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'budgets.json'), 'utf8'));
const budgetProblems = (sizes, limits) => [
  ...Object.entries(sizes).map(([n, w]) => (!(n in limits) ? `${n}: no budget in tests/evals/budgets.json`
    : w > limits[n] ? `${n}: ${w} words, over its budget of ${limits[n]}: shorten it, or move steps into a script` : null)).filter(Boolean),
  ...Object.keys(limits).filter(n => !(n in sizes)).map(n => `${n}: a budget for a skill that isn't there`),
];

// ---------- a run's events ----------
// stream-json lines: the tool calls (name, input, result, error), the final text, and the run's totals
function parseStream(text) {
  const calls = [];
  const byId = new Map();
  let end = null;
  for (const line of text.split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'assistant') {
      for (const c of (e.message && e.message.content) || []) {
        if (c.type !== 'tool_use') continue;
        const call = { name: c.name, input: c.input || {}, result: '', error: false };
        calls.push(call);
        byId.set(c.id, call);
      }
    } else if (e.type === 'user') {
      for (const c of [].concat((e.message && e.message.content) || [])) {
        const call = c.type === 'tool_result' && byId.get(c.tool_use_id);
        if (!call) continue;
        call.error = Boolean(c.is_error);
        call.result = typeof c.content === 'string' ? c.content : [].concat(c.content || []).map(x => x.text || '').join('\n');
      }
    } else if (e.type === 'result') end = e;
  }
  const u = (end && end.usage) || {};
  return { calls, final: (end && end.result) || '', sessionId: end && end.session_id, turns: (end && end.num_turns) || 0, ms: (end && end.duration_ms) || 0,
    costUsd: (end && end.total_cost_usd) || 0, tokens: ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].reduce((n, k) => n + (u[k] || 0), 0) };
}

// ---------- the scratch apps ----------
const PREFIX = 'amk-eval-';
const MARK = path.join('.git', 'amk-eval');
// a scratch app of this run: in the temporary folder, under a folder this script named, holding this run's token
function assertScratch(dir, token) {
  let mark = null;
  try { mark = fs.readFileSync(path.join(dir, MARK), 'utf8'); } catch {}
  if (!fs.realpathSync(dir).startsWith(path.join(fs.realpathSync(os.tmpdir()), PREFIX)) || mark !== token) {
    throw new Error(`refusing to run in ${dir}: it isn't a scratch app this run made`);
  }
}
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=amk-eval', '-c', 'user.email=amk-eval@example.invalid', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
// a bare React Native app with the kit for Claude Code (its hooks, permission rules and skills as generated), committed
function scratchApp(token) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), PREFIX));
  const app = path.join(root, 'app');
  const files = {
    'package.json': `${JSON.stringify({ name: 'EvalApp', version: '1.0.0', private: true, scripts: { lint: 'node -e ""', typecheck: 'node -e ""', test: 'node -e ""' },
      dependencies: { react: '19.2.3', 'react-native': '0.87.1' }, devDependencies: { typescript: '^6.0.3' } }, null, 2)}\n`,
    'yarn.lock': '', 'ios/.keep': '', 'android/.keep': '', '.gitignore': 'node_modules/\n',
    'index.js': "import { AppRegistry } from 'react-native';\nimport App from './App';\n\nAppRegistry.registerComponent('EvalApp', () => App);\n",
    'App.tsx': "import React from 'react';\nimport { Text, View } from 'react-native';\n\nexport default function App() {\n  return (\n    <View>\n      <Text>Settings</Text>\n    </View>\n  );\n}\n",
  };
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(app, f)), { recursive: true }); fs.writeFileSync(path.join(app, f), text); }
  git(app, 'init', '-q', '-b', 'main');
  git(app, 'add', '-A');
  git(app, 'commit', '-qm', 'app');
  require(path.join(KIT, 'lib/init')).init(app, { tools: ['claude'] });
  if (!fs.existsSync(path.join(app, '.claude/settings.json'))) throw new Error('the kit\'s Claude Code settings weren\'t generated (rulesync needs the network)');
  git(app, 'add', '-A');
  git(app, 'commit', '-qm', 'agentic-mobile-kit');
  fs.writeFileSync(path.join(app, MARK), token);
  return { root, app };
}

// ---------- the runs ----------
// only what Claude Code and git need: no API key from the shell, no tokens of other tools
const cleanEnv = () => ({
  ...Object.fromEntries(['HOME', 'PATH', 'USER', 'SHELL', 'TMPDIR', 'SystemRoot', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP']
    .filter(k => process.env[k]).map(k => [k, process.env[k]])),
  TERM: 'dumb', LANG: 'en_US.UTF-8',
});
function claude(dir, token, run, model, resume) {
  assertScratch(dir, token);
  const args = ['-p', run.prompt, '--model', model, '--output-format', 'stream-json', '--verbose', '--max-turns', String(run.maxTurns || 10),
    '--setting-sources', 'project', '--strict-mcp-config', '--max-budget-usd', String(run.budget || 1), ...(resume ? ['--resume', resume] : []),
    '--allowedTools', ...run.tools];
  const r = spawnSync('claude', args, { cwd: dir, env: cleanEnv(), encoding: 'utf8', timeout: 20 * 60e3, maxBuffer: 2 ** 28 });
  return { ...parseStream(r.stdout || ''), raw: r.stdout || '', stderr: r.stderr || '' };
}
function runCase(c, app, token, model, logs) {
  const dir = path.join(path.dirname(app), c.name);
  fs.cpSync(app, dir, { recursive: true, verbatimSymlinks: true });
  assertScratch(dir, token);
  if (c.setup) c.setup(dir);
  const base = git(dir, 'rev-parse', 'HEAD').trim();
  // the runs it lists, then, for a case that answers as a person would, each one its next() asks for
  const runs = [];
  const go = r => runs.push({ ...claude(dir, token, r, model, runs.length ? runs[runs.length - 1].sessionId : null), prompt: r.prompt });
  c.runs.forEach(go);
  for (let next; c.next && (next = c.next(runs, dir));) go(next);
  fs.writeFileSync(path.join(logs, `${c.name}.jsonl`), redact(runs.map(r => r.raw + r.stderr).join('')));
  let failures;
  try { failures = c.check(dir, runs, base); } catch (e) { failures = [`its check failed: ${e.message}`]; }
  const sum = k => runs.reduce((n, r) => n + r[k], 0);
  return { name: c.name, skill: c.skill, passed: !failures.length, failures, ms: sum('ms'), tokens: sum('tokens'), costUsd: Math.round(sum('costUsd') * 1e4) / 1e4, turns: sum('turns') };
}

// ---------- the report ----------
const byVersion = (a, b) => { const [x, y] = [a, b].map(v => v.split('.').map(n => parseInt(n, 10))); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
// the newest results of another version, to compare with
function previous(dir = RESULTS, version = VERSION) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^\d+\.\d+\.\d+\.json$/.test(f) && f !== `${version}.json`).sort(byVersion) : [];
  return files.length ? JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8')) : null;
}
function report(results, before) {
  const change = (now, was) => (was ? `${now >= was ? '+' : ''}${Math.round(((now - was) / was) * 100)}%` : '');
  const rows = results.map(r => {
    const b = before && before.cases.find(x => x.name === r.name);
    return `| ${r.name} | ${r.skill} | ${r.passed ? 'passed' : `failed: ${r.failures.join('; ')}`} | ${Math.round(r.ms / 1000)} s | ${r.tokens} | $${r.costUsd} | ${
      b ? `${b.passed ? 'passed' : 'failed'}; time ${change(r.ms, b.ms)}, tokens ${change(r.tokens, b.tokens)}` : 'new'} |`;
  });
  const skills = [...new Set(results.map(r => r.skill))].map(s => {
    const of = results.filter(r => r.skill === s);
    return `${s}: ${of.filter(r => r.passed).length}/${of.length}`;
  });
  return [`| Case | Skill | Result | Time | Tokens | Cost | ${before ? `Before (${before.version})` : 'Before'} |`, '|---|---|---|---|---|---|---|', ...rows, '',
    `Passed ${results.filter(r => r.passed).length} of ${results.length}. By skill: ${skills.join(', ')}`].join('\n');
}

module.exports = { skillSizes, budgets, budgetProblems, parseStream, assertScratch, previous, report, PREFIX, MARK };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const cases = require('./cases');
  if (args.includes('--list')) {
    for (const c of cases) console.log(`${c.name} (${c.skill}): ${c.about}`);
    process.exit(0);
  }
  const sizes = skillSizes();
  const problems = budgetProblems(sizes, budgets());
  console.log(problems.length ? `Skill budgets:\n${problems.map(p => `  ✗ ${p}`).join('\n')}` : 'Skill budgets: every skill is within its budget');
  if (args.includes('--budgets')) process.exit(problems.length ? 1 : 0);
  const wanted = opt('--case') ? opt('--case').split(',') : null;
  const chosen = cases.filter(c => !wanted || wanted.includes(c.name));
  if (wanted && chosen.length !== wanted.length) { console.error(`no such case: ${wanted.filter(w => !cases.some(c => c.name === w)).join(', ')} (see --list)`); process.exit(2); }
  const version = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  if (version.status !== 0) { console.error('Claude Code (claude) isn\'t installed here'); process.exit(2); }
  const model = opt('--model') || 'haiku';
  const token = crypto.randomBytes(16).toString('hex');
  const { root, app } = scratchApp(token);
  const logs = path.join(root, 'logs');
  fs.mkdirSync(logs);
  const results = [];
  try {
    for (const c of chosen) {
      process.stdout.write(`${c.name}: `);
      const r = runCase(c, app, token, model, logs);
      results.push(r);
      console.log(r.passed ? 'passed' : `failed: ${r.failures.join('; ')}`);
    }
  } finally {
    // the sessions these runs left in Claude Code's projects folder, and the apps
    for (const c of chosen) fs.rmSync(path.join(os.homedir(), '.claude', 'projects', path.join(root, c.name).replace(/[^a-zA-Z0-9]/g, '-')), { recursive: true, force: true });
    if (!args.includes('--keep')) for (const d of [app, ...chosen.map(c => path.join(root, c.name))]) fs.rmSync(d, { recursive: true, force: true });
  }
  const before = previous();
  console.log(`\n${report(results, before)}\nLogs: ${logs}${args.includes('--keep') ? `\nApps: ${root}` : ''}`);
  if (!wanted) {
    fs.mkdirSync(RESULTS, { recursive: true });
    fs.writeFileSync(path.join(RESULTS, `${VERSION}.json`), `${JSON.stringify({ version: VERSION, date: new Date().toISOString().slice(0, 10), model,
      claude: version.stdout.trim(), skills: sizes, cases: results }, null, 2)}\n`);
    console.log(`Results: tests/evals/results/${VERSION}.json`);
  }
  process.exit(results.every(r => r.passed) && !problems.length ? 0 : 1);
}
