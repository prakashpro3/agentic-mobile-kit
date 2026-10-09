// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');
const { execFileSync } = require('child_process');
const { init, KIT_VERSION } = require('../lib/init');
const { menu } = require('../lib/menu');
const tmpDir = require('./tmp');

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const commit = dir => { git(dir, 'add', '-A'); git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'x'); };

function app() {
  const dir = tmpDir('amk-menu-');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'DemoApp', dependencies: { 'react-native': '0.87.1', react: '19.2.3' } }));
  for (const d of ['ios', 'android']) { fs.mkdirSync(path.join(dir, d)); fs.writeFileSync(path.join(dir, d, '.keep'), ''); }
  git(dir, 'init', '-q');
  commit(dir);
  return dir;
}

// the command the menu chose for these answers, and what it showed
async function answer(dir, answers, latest = () => null) {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', d => { text += d; });
  input.end(answers.map(a => `${a}\n`).join(''));
  const args = await menu(dir, { input, output, latest });
  return { args, text };
}

test('menu without the kit: install with the defaults, or choose the AI tools and CI', async () => {
  const dir = app();
  let r = await answer(dir, ['']);
  assert.match(r.text, /The kit isn't installed here/);
  assert.match(r.text, /Install it for Claude Code, Codex and Antigravity, without CI/);
  assert.deepStrictEqual(r.args, ['init']);
  assert.match(r.text, /Running: npx agentic-mobile-kit init\n/);

  r = await answer(dir, ['2', '1, 4', '2']);
  assert.match(r.text, /4\. Cursor \(not tested yet\)/);
  assert.deepStrictEqual(r.args, ['init', '--tools', 'claude,cursor', '--ci', 'github']);
  r = await answer(dir, ['2', '', '4']);
  assert.deepStrictEqual(r.args, ['init', '--ci', 'github,codemagic'], 'the default tools need no flag');

  r = await answer(dir, ['9', 'x', '3']);
  assert.deepStrictEqual(r.args, ['doctor'], 'a wrong answer is asked again');
  assert.strictEqual((await answer(dir, ['4'])).args, null, 'quit');
  assert.strictEqual((await answer(dir, [])).args, null, 'Ctrl-D');
});

test('menu with the kit: update, add CI, doctor and uninstall', async () => {
  const dir = app();
  init(dir, { skipGenerate: true, ci: ['github'] });
  commit(dir);
  let r = await answer(dir, ['']);
  assert.match(r.text, new RegExp(`Kit ${KIT_VERSION.replace(/\./g, '\\.')} is installed here\\. CI: GitHub Actions\\.`));
  assert.match(r.text, /Sync the kit again; it's up to date/);
  assert.deepStrictEqual(r.args, ['doctor'], 'up to date: Enter runs the check');
  assert.deepStrictEqual((await answer(dir, ['2'])).args, ['sync', '--ci', 'codemagic']);
  assert.strictEqual((await answer(dir, ['4', ''])).args, null, 'uninstall asks first');
  assert.deepStrictEqual((await answer(dir, ['4', 'y'])).args, ['uninstall']);

  const agents = path.join(dir, 'AGENTS.md');
  fs.writeFileSync(agents, fs.readFileSync(agents, 'utf8').replace(`agentic-mobile-kit ${KIT_VERSION}`, 'agentic-mobile-kit 0.5.0'));
  commit(dir);
  r = await answer(dir, ['']);
  assert.match(r.text, new RegExp(`Update the kit from 0\\.5\\.0 to ${KIT_VERSION.replace(/\./g, '\\.')}`));
  assert.deepStrictEqual(r.args, ['sync'], 'an older kit: Enter updates it');

  fs.writeFileSync(agents, fs.readFileSync(agents, 'utf8').replace('agentic-mobile-kit 0.5.0', 'agentic-mobile-kit 99.0.0'));
  commit(dir);
  r = await answer(dir, ['']);
  assert.match(r.text, /newer than this copy/);
  assert.doesNotMatch(r.text, /\(sync\)|uninstall/, 'an older copy changes nothing');
  assert.deepStrictEqual(r.args, ['doctor']);
});

test('menu: says why it can\'t install, and offers a newer version', async () => {
  const dir = app();
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'wip');
  let r = await answer(dir, ['']);
  assert.match(r.text, /! You have uncommitted changes/);
  assert.doesNotMatch(r.text, /Install it/);
  assert.deepStrictEqual(r.args, ['doctor']);

  fs.rmSync(path.join(dir, 'notes.txt'));
  r = await answer(dir, ['n', ''], () => '99.0.0');
  assert.match(r.text, /Version 99\.0\.0 is out\. Use it\? \[Y\/n\]/);
  assert.deepStrictEqual(r.args, ['init'], 'declined: this copy carries on');
});

test('without a terminal (CI, AI agents) the bare command prints the help, never a question', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '../bin/cli.js')], { encoding: 'utf8', input: '' });
  assert.match(out, /^Usage:/m);
});
