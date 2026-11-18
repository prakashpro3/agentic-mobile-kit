// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const tmpDir = require('./tmp');

const SCRIPT = path.join(__dirname, '../stacks/react-native/template/scripts/amk/maestro-env.sh');

test('maestro-env.sh exports only MAESTRO_ values from .maestro/.env.local, and the shell\'s own values win', () => {
  const dir = tmpDir('amk-maestro-env-');
  fs.mkdirSync(path.join(dir, '.maestro'));
  fs.writeFileSync(path.join(dir, '.maestro/.env.local'), [
    '# test login', 'MAESTRO_EMAIL="qa@example.com"', "MAESTRO_PASSWORD='p a$s'", 'MAESTRO_URL=https://staging.example.com/a=b\r',
    'API_SECRET=not-for-flows', 'MAESTRO_FROM_SHELL=file', 'MAESTRO_BAD-KEY=x', 'MAESTRO_LAST=no-newline',
  ].join('\n'));
  const script = `set -eu; . "${SCRIPT}"; for k in MAESTRO_EMAIL MAESTRO_PASSWORD MAESTRO_URL MAESTRO_FROM_SHELL MAESTRO_LAST API_SECRET; do printf '%s=[%s]\\n' "$k" "$(printenv "$k" || true)"; done`;
  const r = spawnSync('sh', ['-c', script], { cwd: dir, encoding: 'utf8', env: { ...process.env, MAESTRO_FROM_SHELL: 'shell' } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /^MAESTRO_EMAIL=\[qa@example\.com\]$/m);
  assert.match(r.stdout, /^MAESTRO_PASSWORD=\[p a\$s\]$/m, 'quotes stripped, nothing evaluated');
  assert.match(r.stdout, /^MAESTRO_URL=\[https:\/\/staging\.example\.com\/a=b\]$/m, 'CRLF and = in values');
  assert.match(r.stdout, /^MAESTRO_FROM_SHELL=\[shell\]$/m, 'the shell wins');
  assert.match(r.stdout, /^MAESTRO_LAST=\[no-newline\]$/m);
  assert.match(r.stdout, /^API_SECRET=\[\]$/m, 'only MAESTRO_ keys');
});

test('maestro-env.sh in a git worktree: the main checkout\'s .maestro/.env.local after its own; flows needing values with none say so', () => {
  const dir = tmpDir('amk-maestro-env-wt-');
  const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
  fs.mkdirSync(path.join(dir, '.maestro'));
  fs.writeFileSync(path.join(dir, '.maestro/login.yaml'), 'appId: x\n---\n- inputText: ${MAESTRO_EMAIL}\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.maestro/.env.local\n');
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'flows');
  git(dir, 'worktree', 'add', '-q', '.claude/worktrees/wt', '-b', 'wt');
  const wt = path.join(dir, '.claude/worktrees/wt');
  const run = cwd => spawnSync('sh', ['-c', `. "${SCRIPT}"; printf '[%s][%s]' "$(printenv MAESTRO_EMAIL || true)" "$(printenv MAESTRO_PIN || true)"`], { cwd, encoding: 'utf8', env: { ...process.env, MAESTRO_EMAIL: '', MAESTRO_PIN: '' } });
  const none = run(wt);
  assert.strictEqual(none.stdout, '[][]');
  assert.match(none.stderr, /the flows use MAESTRO_EMAIL, which nothing sets: no \.maestro\/\.env\.local here or in the main checkout \(.+\), and not in the shell\. Steps that need them will fail/);
  // the values from the shell (CI's secrets): nothing to say
  const fromShell = spawnSync('sh', ['-c', `. "${SCRIPT}"`], { cwd: wt, encoding: 'utf8', env: { ...process.env, MAESTRO_EMAIL: 'ci@example.com' } });
  assert.strictEqual(fromShell.stderr, '');
  fs.writeFileSync(path.join(dir, '.maestro/.env.local'), 'MAESTRO_EMAIL=main@example.com\nMAESTRO_PIN=1234\n');
  const found = run(wt);
  assert.strictEqual(found.stdout, '[main@example.com][1234]', found.stderr);
  assert.strictEqual(found.stderr, '');
  fs.writeFileSync(path.join(wt, '.maestro/.env.local'), 'MAESTRO_EMAIL=wt@example.com\n');
  assert.strictEqual(run(wt).stdout, '[wt@example.com][1234]', 'its own first, then the main checkout\'s');
  assert.strictEqual(run(dir).stdout, '[main@example.com][1234]', 'the main checkout reads its own once');
  // not in git: only its own folder, never the one above
  const loose = path.join(tmpDir('amk-maestro-env-loose-'), 'app');
  fs.mkdirSync(path.join(loose, '.maestro'), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(loose), '.maestro-not-read'), '');
  fs.mkdirSync(path.join(path.dirname(loose), '.maestro'));
  fs.writeFileSync(path.join(path.dirname(loose), '.maestro/.env.local'), 'MAESTRO_EMAIL=parent@example.com\n');
  assert.strictEqual(run(loose).stdout, '[][]');
});
