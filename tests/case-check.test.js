// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const tmpDir = require('./tmp');

const SCRIPT = path.join(__dirname, '../stacks/react-native/template/scripts/amk/case-check.js');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const check = cwd => spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' });

test('finds a file and a folder renamed only in letter case, which git missed', () => {
  const dir = tmpDir('amk-case-');
  for (const f of ['src/utils/storage.ts', 'src/Components/Button.tsx', 'App.tsx']) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), 'export {};\n');
  }
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'app');
  assert.strictEqual(check(dir).status, 0);

  // renamed outside git, as an editor or Finder does
  fs.renameSync(path.join(dir, 'src/utils/storage.ts'), path.join(dir, 'src/utils/Storage.ts'));
  fs.renameSync(path.join(dir, 'src/Components'), path.join(dir, 'src/components'));
  const r = check(dir);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /src\/utils\/storage\.ts {2}\(on disk: src\/utils\/Storage\.ts\)/);
  assert.match(r.stderr, /src\/Components {2}\(on disk: src\/components\)/);
  assert.match(r.stderr, /git mv "src\/Components" "src\/Components\.tmp" && git mv "src\/Components\.tmp" "src\/components"/);

  // once git has the new names (this way works on case-sensitive disks too), nothing is reported
  git(dir, 'rm', '-rq', '--cached', 'src');
  git(dir, 'add', 'src');
  assert.strictEqual(check(dir).status, 0, check(dir).stderr);
});
