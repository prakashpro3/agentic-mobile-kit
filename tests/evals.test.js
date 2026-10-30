// Run: node --test tests/*.test.js
// The eval suite's own logic (tests/evals/run.js); its cases run live, before a release.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const tmpDir = require('./tmp');
const evals = require('./evals/run');

test('evals: every kit skill is within its length budget, and has one', () => {
  assert.deepStrictEqual(evals.budgetProblems(evals.skillSizes(), evals.budgets()), []);
  assert.deepStrictEqual(evals.budgetProblems({ 'm-a': 120, 'm-b': 50 }, { 'm-a': 100, 'm-c': 10 }), [
    'm-a: 120 words, over its budget of 100: shorten it, or move steps into a script',
    'm-b: no budget in tests/evals/budgets.json',
    'm-c: a budget for a skill that isn\'t there',
  ]);
});

test('evals: a run\'s stream gives its tool calls, its final text and its totals', () => {
  const stream = [
    { type: 'system', subtype: 'init', tools: ['Bash'] },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'running it' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'rm -r -f build' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'blocked by the hook' }] }] } },
    { type: 'result', subtype: 'success', result: 'It was blocked.', session_id: 's1', num_turns: 2, duration_ms: 4200, total_cost_usd: 0.002,
      usage: { input_tokens: 4, output_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 2000 } },
  ].map(e => JSON.stringify(e)).join('\n');
  const { calls, ...totals } = evals.parseStream(`${stream}\nnot a JSON line\n`);
  assert.deepStrictEqual(calls, [{ name: 'Bash', input: { command: 'rm -r -f build' }, result: 'blocked by the hook', error: true }]);
  assert.deepStrictEqual(totals, { final: 'It was blocked.', sessionId: 's1', turns: 2, ms: 4200, costUsd: 0.002, tokens: 3104 });
});

test('evals: it runs only in a scratch app this run made', () => {
  const mine = tmpDir(evals.PREFIX);
  fs.mkdirSync(path.join(mine, '.git'));
  fs.writeFileSync(path.join(mine, evals.MARK), 'token-1');
  assert.doesNotThrow(() => evals.assertScratch(mine, 'token-1'));
  assert.throws(() => evals.assertScratch(mine, 'token-2'), /refusing to run in \S+: it isn't a scratch app this run made/, 'another run\'s');
  const named = tmpDir('some-app-');
  fs.mkdirSync(path.join(named, '.git'));
  fs.writeFileSync(path.join(named, evals.MARK), 'token-1');
  assert.throws(() => evals.assertScratch(named, 'token-1'), /refusing/, 'a folder it didn\'t make, even with the token');
  assert.throws(() => evals.assertScratch(path.join(__dirname, '..'), 'token-1'), /refusing/, 'the kit itself');
});

test('evals: the report compares each case with the newest earlier version\'s results', () => {
  const dir = tmpDir('amk-evals-results-');
  for (const [v, ms] of [['0.7.9', 1000], ['0.7.10', 2000], ['0.8.0', 9]]) {
    fs.writeFileSync(path.join(dir, `${v}.json`), JSON.stringify({ version: v, cases: [{ name: 'a', passed: true, ms, tokens: 100 }] }));
  }
  const before = evals.previous(dir, '0.8.0');
  assert.strictEqual(before.version, '0.7.10', 'by version number, never the current one');
  const out = evals.report([{ name: 'a', skill: 's', passed: false, failures: ['x'], ms: 3000, tokens: 50, costUsd: 0.01 },
    { name: 'b', skill: 's', passed: true, failures: [], ms: 1000, tokens: 10, costUsd: 0 }], before);
  assert.match(out, /^\| a \| s \| failed: x \| 3 s \| 50 \| \$0\.01 \| passed; time \+50%, tokens -50% \|$/m);
  assert.match(out, /^\| b \| s \| passed \| 1 s \| 10 \| \$0 \| new \|$/m);
  assert.match(out, /Passed 1 of 2\. By skill: s: 1\/2$/m);
});
