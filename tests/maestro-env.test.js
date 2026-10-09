// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const tmpDir = require('./tmp');

const SCRIPT = path.join(__dirname, '../stacks/react-native/template/scripts/ai/maestro-env.sh');

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
