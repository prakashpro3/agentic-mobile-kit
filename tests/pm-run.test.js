// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const tmpDir = require('./tmp');

const SCRIPT = path.join(__dirname, '../stacks/react-native/template/scripts/amk/pm-run.sh');
const run = (dir, script) => spawnSync('sh', [SCRIPT, script], { cwd: dir, encoding: 'utf8' });

test('Expo apps: lint waits until ESLint is set up, and typecheck gets the expo-env.d.ts that expo start writes', () => {
  const dir = tmpDir('amk-pmrun-');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { lint: 'expo lint', typecheck: 'node -e "process.exit(require(\'fs\').existsSync(\'expo-env.d.ts\') ? 0 : 3)"' } }));
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{ "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"] }\n');

  const lint = run(dir, 'lint');
  assert.strictEqual(lint.status, 0);
  assert.match(lint.stdout, /^skip: lint: ESLint isn't set up yet/);

  const typecheck = run(dir, 'typecheck');
  assert.strictEqual(typecheck.status, 0, typecheck.stderr);
  assert.match(fs.readFileSync(path.join(dir, 'expo-env.d.ts'), 'utf8'), /^\/\/\/ <reference types="expo\/types" \/>/);

  assert.match(run(dir, 'test').stdout, /^skip: no "test" script in package\.json/);
});
