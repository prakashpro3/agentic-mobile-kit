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
