// Run: node --test tests/*.test.js
// The kit's scripts in an app: some apps lint every file with React Native's ESLint globals (a pretest script with
// --ignore-path .gitignore skips the .eslintignore that leaves scripts/amk/ out), and an undefined global fails their tests
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../stacks/react-native/template/scripts/amk');

test('scripts/amk uses no Node global that React Native\'s ESLint config leaves out (__filename, Buffer)', () => {
  const found = [];
  for (const f of fs.readdirSync(DIR).filter(n => n.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
    const lines = code.split('\n');
    lines.forEach((l, i) => {
      if (/\b__filename\b/.test(l)) found.push(`${f}:${i + 1} __filename (use process.argv[1])`);
      if (/(^|[^.\w])Buffer\b/.test(l) && !/\bBuffer\b\s*}\s*=\s*require\(['"]buffer['"]\)/.test(code)) found.push(`${f}:${i + 1} Buffer (require it from 'buffer')`);
    });
  }
  assert.deepStrictEqual(found, []);
});

test('scripts/amk parses as plain scripts: an app whose own ESLint lints the folder (a pretest of eslint .) can parse each', () => {
  // Node accepts a return at a CommonJS file's top level, but ESLint's parser doesn't: a 0.11.0 build's autopilot.js
  // had one, and an app's pretest (eslint over the whole project) then failed every test run
  const vm = require('vm');
  const bad = [];
  for (const f of fs.readdirSync(DIR).filter(n => n.endsWith('.js'))) {
    try { new vm.Script(fs.readFileSync(path.join(DIR, f), 'utf8').replace(/^#!.*/, ''), { filename: f }); } catch (e) { bad.push(`${f}: ${e.message}`); }
  }
  assert.deepStrictEqual(bad, []);
});
