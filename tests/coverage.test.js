// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const tmpDir = require('./tmp');

const KIT = path.join(__dirname, '../stacks/react-native/template/scripts/amk');
const write = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');

// an app whose test script is a stand-in for Jest: it reports the coverage cov.json says, notes its arguments in
// args.txt, and fails as Jest does when a --coverageThreshold isn't met
function app(cov, script = 'node fake-jest.js') {
  const dir = tmpDir('amk-coverage-');
  write(dir, 'package.json', JSON.stringify({ scripts: { test: script } }));
  write(dir, 'cov.json', JSON.stringify(cov));
  write(dir, 'fake-jest.js', `const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync('args.txt', args.join(' ') + '\\n');
const cov = JSON.parse(fs.readFileSync('cov.json', 'utf8'));
const dir = args.find(a => a.startsWith('--coverageDirectory=')).slice(20);
fs.writeFileSync(path.join(dir, 'coverage-summary.json'), JSON.stringify({ total: Object.fromEntries(Object.entries(cov).map(([k, v]) => [k, { pct: v }])) }));
const t = args.find(a => a.startsWith('--coverageThreshold='));
const min = t ? JSON.parse(t.slice(20)).global : {};
process.exit(Object.keys(min).some(k => cov[k] < min[k]) ? 1 : 0);
`);
  fs.mkdirSync(path.join(dir, 'scripts/amk'), { recursive: true });
  for (const f of ['coverage.js', 'pm-run.sh']) fs.copyFileSync(path.join(KIT, f), path.join(dir, 'scripts/amk', f));
  return dir;
}
const run = (dir, ...a) => { const r = spawnSync(process.execPath, ['scripts/amk/coverage.js', ...a], { cwd: dir, encoding: 'utf8' }); return { out: r.stdout + r.stderr, code: r.status }; };
const COV = { statements: 72.3, branches: 60.1, functions: 68, lines: 73.9 };

test('coverage.js: no floors file, no check; write makes one from the coverage, rounded up, once', { skip: process.platform === 'win32' && 'pm-run.sh needs sh' }, () => {
  const dir = app(COV);
  assert.match(run(dir, 'check').out, /no \.amk-coverage, so nothing to check/);
  assert.strictEqual(run(dir, 'check').code, 0);
  const w = run(dir, 'write');
  assert.strictEqual(w.code, 0, w.out);
  assert.match(read(dir, '.amk-coverage'), /\nstatements 73\nbranches 61\nfunctions 68\nlines 74\nslack 2\n$/);
  assert.match(run(dir, 'write').out, /is there already: raise or lower its floors instead/);
  assert.match(run(app(COV, 'mocha'), 'write').out, /the test script isn't Jest/);
});

test('coverage.js check: Jest\'s own threshold from the floors less the slack; a drop beyond it, or a missing floor, fails', { skip: process.platform === 'win32' && 'pm-run.sh needs sh' }, () => {
  const dir = app(COV);
  run(dir, 'write');
  write(dir, 'cov.json', JSON.stringify({ ...COV, statements: 71.1 }));
  const ok = run(dir, 'check');
  assert.strictEqual(ok.code, 0, ok.out);
  assert.match(read(dir, 'args.txt').trim().split('\n').pop(), /--coverageThreshold=\{"global":\{"statements":71,"branches":59,"functions":66,"lines":72\}\}/);
  write(dir, 'cov.json', JSON.stringify({ ...COV, lines: 71.9 }));
  const low = run(dir, 'check');
  assert.strictEqual(low.code, 1);
  assert.match(low.out, /✗ lines 71\.9% is more than 2 points under its floor of 74/);
  fs.writeFileSync(path.join(dir, '.amk-coverage'), read(dir, '.amk-coverage').replace('branches 61\n', ''));
  assert.match(run(dir, 'check').out, /has no floor for branches/);
});

test('coverage.js raise only raises; lower needs a reason, lowers to the coverage now and keeps the reason', { skip: process.platform === 'win32' && 'pm-run.sh needs sh' }, () => {
  const dir = app(COV);
  run(dir, 'write');
  write(dir, 'cov.json', JSON.stringify({ ...COV, statements: 80.2, branches: 50 }));
  assert.match(run(dir, 'raise').out, /raised statements 73 → 81$/m);
  assert.match(read(dir, '.amk-coverage'), /\nstatements 81\nbranches 61\n/, 'branches fell, and raise left it');
  assert.strictEqual(run(dir, 'lower').code, 2);
  const lowered = run(dir, 'lower', '--reason', 'moved the API layer into its own package');
  assert.match(lowered.out, /lowered branches 61 → 50/);
  assert.match(read(dir, '.amk-coverage'), /\nbranches 50\n[\s\S]*# lowered \d{4}-\d\d-\d\d, branches 61 → 50: moved the API layer into its own package\n$/);
  assert.match(run(dir, 'raise').out, /nothing to raise/);
});
