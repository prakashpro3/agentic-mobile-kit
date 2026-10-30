#!/usr/bin/env node
// Coverage floors: a check that tests weren't deleted or weakened. .amk-coverage, which the project commits, holds the
// lowest each coverage measure of the Jest tests may go (statements, branches, functions and lines, in percent), and the
// slack: how many points under its floor a measure may drop and still pass. Without the file there's no check.
//   node scripts/amk/coverage.js write                    a coverage run of the tests as they are writes .amk-coverage
//   node scripts/amk/coverage.js check                    runs them with Jest's --coverageThreshold set from it
//   node scripts/amk/coverage.js raise                    raises the floors to the coverage now, where it's higher
//   node scripts/amk/coverage.js lower --reason "<why>"   lowers them to the coverage now, and records why
// Floors are the coverage rounded up, and come down only with a reason, which the file keeps. The verdict is the coverage
// alone: failing tests are verify.sh quick's to judge, against the base branch.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const FILE = '.amk-coverage';
const MEASURES = ['statements', 'branches', 'functions', 'lines'];
const [cmd, ...args] = process.argv.slice(2);
const root = process.cwd();
const read = f => { try { return fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };
const up = n => Math.min(100, Math.ceil(n));

// the floors file: its values ({ statements: 73, …, slack: 2 }) and its text
function floors() {
  const text = read(path.join(root, FILE));
  if (text === null) return null;
  const values = {};
  for (const l of text.split('\n')) {
    const m = /^\s*([a-z]+)\s+(\d+(?:\.\d+)?)\s*$/.exec(l);
    if (m) values[m[1]] = Number(m[2]);
  }
  return { values, text };
}

// a coverage run of the app's test script, with these extra arguments: each measure's percentage, or why there's none
function coverage(extra = []) {
  let pkg = {};
  try { pkg = JSON.parse(read(path.join(root, 'package.json'))); } catch {}
  if (!/\bjest\b/.test((pkg.scripts || {}).test || '')) return { why: 'the test script isn\'t Jest' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amk-coverage-'));
  try {
    const r = spawnSync('sh', [path.join(root, 'scripts/amk/pm-run.sh'), 'test', '--coverage', '--coverageReporters=json-summary',
      '--coverageReporters=text-summary', `--coverageDirectory=${dir}`, ...extra], { cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'true' }, maxBuffer: 2 ** 28 });
    let total;
    try { total = JSON.parse(fs.readFileSync(path.join(dir, 'coverage-summary.json'), 'utf8')).total; } catch {
      return { why: `Jest wrote no coverage report: ${`${r.stderr || ''}${r.stdout || ''}`.trim().split('\n').pop()}` };
    }
    // "Unknown" for a measure with nothing to count (no branches at all)
    return { pct: Object.fromEntries(MEASURES.map(m => [m, Number((total[m] || {}).pct) || 0])) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// the floors file with these values, and a line about the change
function save(f, values, note) {
  let text = f.text;
  for (const [k, v] of Object.entries(values)) text = text.replace(new RegExp(`^(\\s*${k}\\s+)\\d+(?:\\.\\d+)?(\\s*)$`, 'm'), `$1${v}$2`);
  fs.writeFileSync(path.join(root, FILE), note ? `${text.replace(/\n*$/, '\n')}${note}\n` : text);
}

function main() {
  if (!['write', 'check', 'raise', 'lower'].includes(cmd)) {
    const head = fs.readFileSync(process.argv[1], 'utf8').split('\n').slice(1);
    console.log(head.slice(0, head.findIndex(l => !l.startsWith('//'))).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 2;
  }
  const f = floors();
  if (cmd === 'write') {
    if (f) { console.error(`coverage: ${FILE} is there already: raise or lower its floors instead`); return 1; }
    const run = coverage();
    if (run.why) { console.error(`coverage: ${run.why}`); return 1; }
    fs.writeFileSync(path.join(root, FILE), [
      '# Coverage floors: node scripts/amk/coverage.js check fails when a measure of the Jest tests drops more than the slack',
      '# below its floor, in percent. Floors only rise (coverage.js raise), or come down with a reason (coverage.js lower',
      '# --reason "<why>"), which is kept here.',
      ...MEASURES.map(m => `${m} ${up(run.pct[m])}`), 'slack 2', '',
    ].join('\n'));
    console.log(`${FILE}: ${MEASURES.map(m => `${m} ${up(run.pct[m])}`).join(', ')}, slack 2. Commit it.`);
    return 0;
  }
  if (!f) {
    console.log(`coverage: no ${FILE}, so nothing to check (node scripts/amk/coverage.js write makes one)`);
    return cmd === 'check' ? 0 : 1;
  }
  const missing = MEASURES.filter(m => !(m in f.values));
  if (missing.length) { console.error(`coverage: ${FILE} has no floor for ${missing.join(', ')}: add it, or write the file again`); return 1; }
  const slack = f.values.slack || 0;
  if (cmd === 'check') {
    const min = Object.fromEntries(MEASURES.map(m => [m, Math.max(0, f.values[m] - slack)]));
    const run = coverage([`--coverageThreshold=${JSON.stringify({ global: min })}`]);
    if (run.why) { console.error(`coverage: ${run.why}`); return 1; }
    const low = MEASURES.filter(m => run.pct[m] < min[m]);
    console.log(`coverage: ${MEASURES.map(m => `${m} ${run.pct[m]}% (floor ${f.values[m]})`).join(', ')}, slack ${slack}`);
    for (const m of low) console.log(`  ✗ ${m} ${run.pct[m]}% is more than ${slack} points under its floor of ${f.values[m]}: tests were deleted or weakened, or new code has none`);
    return low.length ? 1 : 0;
  }
  const reason = args.includes('--reason') ? (args[args.indexOf('--reason') + 1] || '').trim() : '';
  if (cmd === 'lower' && !reason) { console.error('coverage: lower needs --reason "<why>", which the floors file keeps'); return 2; }
  const run = coverage();
  if (run.why) { console.error(`coverage: ${run.why}`); return 1; }
  const next = Object.fromEntries(MEASURES.map(m => [m, cmd === 'raise' ? Math.max(f.values[m], up(run.pct[m])) : Math.min(f.values[m], up(run.pct[m]))]));
  const changes = MEASURES.filter(m => next[m] !== f.values[m]).map(m => `${m} ${f.values[m]} → ${next[m]}`);
  if (!changes.length) { console.log(`coverage: nothing to ${cmd}: ${MEASURES.map(m => `${m} ${run.pct[m]}%`).join(', ')}`); return 0; }
  save(f, next, cmd === 'lower' && `# lowered ${new Date().toISOString().slice(0, 10)}, ${changes.join(', ')}: ${reason}`);
  console.log(`${FILE}: ${cmd === 'raise' ? 'raised' : 'lowered'} ${changes.join(', ')}`);
  return 0;
}

process.exitCode = main();
