// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const tmpDir = require('./tmp');

const SCRIPT = path.join(__dirname, '../stacks/react-native/template/scripts/amk/report.js');
const write = (dir, f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); };
const report = (dir, ...args) => spawnSync(process.execPath, [SCRIPT, dir, ...args], { encoding: 'utf8' });

test('report.js: every screen and part of a run, each flow\'s result and why, its screenshots, JUnit for CI, and a summary', () => {
  const dir = path.join(tmpDir('amk-report-'), 'x1');
  write(dir, 'ios/.flows', 'x1-login\tpassed\t\tios/screenshots/x1-1-home.png,ios/screenshots/x1-2-done.png\t\n');
  // a device's flows in two parts, checked at the same time
  write(dir, 'android/part-1/.flows', 'x1-login\tpassed\t\tandroid/part-1/screenshots/x1-1-home.png\t\n');
  write(dir, 'android/part-2/.flows', 'x1-offline\tfailed\tat "Assert that id: banner & <list> is visible": Assertion is false\t\tmaestro-logs/android-x1-offline/x1-offline/screenshots/step-004 a.png\n');
  write(dir, 'maestro-logs/android-x1-offline/maestro.log', 'not a screen');
  const r = report(dir);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /^2 of 3 flows passed on 3 screens: /);
  const md = fs.readFileSync(path.join(dir, 'report.md'), 'utf8');
  assert.match(md, /^# Device checks: x1$/m);
  assert.match(md, /^\| Screen \| Flows passed \| Screenshots \|\n\|---\|---\|---\|\n\| android \(part 1\) \| 1\/1 \| 1 \|\n\| android \(part 2\) \| 0\/1 ✗ \| 0 \|\n\| ios \| 1\/1 \| 2 \|$/m);
  assert.match(md, /^### ✓ x1-login\n\n<img src="ios\/screenshots\/x1-1-home\.png" width="180" alt="x1-1-home" title="x1-1-home"> <img src="ios\/screenshots\/x1-2-done\.png"/m);
  assert.match(md, /^### ✗ x1-offline\n\nFailed at "Assert that id: banner & <list> is visible": Assertion is false\. Log: \[android\/part-2\/x1-offline\.log\]\(android\/part-2\/x1-offline\.log\) · \[the screen when it failed\]\(maestro-logs\/android-x1-offline\/x1-offline\/screenshots\/step-004%20a\.png\)$/m);
  assert.doesNotMatch(md, /maestro-logs \|/, 'a folder without .flows isn\'t a screen');
  const junit = fs.readFileSync(path.join(dir, 'junit.xml'), 'utf8');
  assert.match(junit, /^<testsuites name="x1" tests="3" failures="1">$/m);
  assert.match(junit, /<testcase classname="android \(part 2\)" name="x1-offline"><failure message="at &quot;Assert that id: banner &amp; &lt;list&gt; is visible&quot;: Assertion is false"\/><\/testcase>/);
  // CI's job summary: the table and the failures, without pictures
  const summary = report(dir, '--summary').stdout;
  assert.match(summary, /^### Device checks: x1\n\n2 of 3 flows passed on 3 screens\n\n\| Screen \|/);
  assert.match(summary, /^- ✗ android \(part 2\): x1-offline, failed at "Assert that id: banner & <list> is visible": Assertion is false$/m);
  assert.doesNotMatch(summary, /<img/);
});

test('a11y.js: tappable elements without a label or under 48 dp, from the view trees, once per flow; not the system\'s, nor a row a list cuts off', () => {
  const A11Y = path.join(__dirname, '../stacks/react-native/template/scripts/amk/a11y.js');
  const dir = tmpDir('amk-a11y-');
  const node = (bounds, attrs = {}, children = []) => ({ attributes: { bounds, ...attrs }, children });
  const tree = node('[0,0][1080,2400]', {}, [
    node('[0,500][1080,640]', { clickable: 'true', 'resource-id': 'save', accessibilityText: 'Save' }),
    node('[900,100][963,163]', { clickable: 'true', 'resource-id': 'close' }),
    node('[45,906][539,1010]', { clickable: 'true', 'resource-id': 'type-car', accessibilityText: 'Car' }),
    node('[0,0][120,60]', { clickable: 'true', 'resource-id': 'com.android.systemui:id/back' }),
    node('[0,1200][1080,2000]', { scrollable: 'true' }, [node('[0,1950][1080,2000]', { clickable: 'true', accessibilityText: 'Row 9' })]),
    // the keyboard's suggestions: words without an id, inside the keyboard's view
    node('[0,1500][1080,2400]', { 'resource-id': 'com.google.android.inputmethod.latin:id/keyboard_holder' }, [node('[0,1500][300,1600]', { clickable: 'true', text: 'Van' })]),
    // inside the app's root (android:id/content), which isn't skipped with what's in it
    node('[0,0][1080,2400]', { 'resource-id': 'android:id/content' }, [node('[100,2200][150,2250]', { clickable: 'true', 'resource-id': 'tiny', accessibilityText: 'Tiny' })]),
  ]);
  // the same screen later, with the chip a pixel shorter: not reported again
  // (and the chip showing another word: the same testID is the same element)
  const later = JSON.parse(JSON.stringify(tree).replace('[45,906][539,1010]', '[45,906][539,1008]').replace('"accessibilityText":"Car"', '"accessibilityText":"Truck"'));
  // Maestro cuts the files' names short; its commands.json has the whole id and the tree each step saved
  write(dir, 'x1-home/screen-hierarchy/step-005-assertCondition-amk-view-tree-20261014-v.json', JSON.stringify(tree));
  write(dir, 'x1-home/screen-hierarchy/step-009-assertCondition-amk-view-tree-20261014-v.json', JSON.stringify(later));
  // a tree Maestro saved for another reason (a failed step) isn't read
  write(dir, 'x1-home/screen-hierarchy/step-003-assertCondition.json', JSON.stringify(node('[0,0][10,10]', { clickable: 'true' })));
  const step = (id, file) => ({ command: { assertConditionCommand: { condition: { visible: { idRegex: id } }, optional: true } },
    metadata: { status: 'WARNED', artifacts: [{ type: 'SCREEN_HIERARCHY', path: `screen-hierarchy/${file}` }] } });
  write(dir, 'x1-home/commands.json', JSON.stringify([
    { command: { launchAppCommand: {} }, metadata: {} },
    step('flow: waiting for the app to draw', 'step-003-assertCondition.json'),
    step('amk-view-tree-20261014-vehicle-setup-01-first-launch', 'step-005-assertCondition-amk-view-tree-20261014-v.json'),
    step('amk-view-tree-20261014-vehicle-setup-02-again', 'step-009-assertCondition-amk-view-tree-20261014-v.json'),
  ]));
  const r = spawnSync(process.execPath, [A11Y, dir, '420', 'x1-home'], { encoding: 'utf8' });
  assert.strictEqual(r.stdout, [
    'x1-home\t20261014-vehicle-setup-01-first-launch\tno label: a screen reader can\'t say what it does\ttestID close',
    'x1-home\t20261014-vehicle-setup-01-first-launch\t24×24 dp: under 48×48\ttestID close',
    'x1-home\t20261014-vehicle-setup-01-first-launch\t188×40 dp: under 48×48\ttestID type-car',
    'x1-home\t20261014-vehicle-setup-01-first-launch\t19×19 dp: under 48×48\ttestID tiny',
    '',
  ].join('\n'));
  // without commands.json (an older Maestro): the trees' file names
  fs.unlinkSync(path.join(dir, 'x1-home/commands.json'));
  assert.match(spawnSync(process.execPath, [A11Y, dir, '420', 'x1-home'], { encoding: 'utf8' }).stdout, /^x1-home\t20261014-v\tno label/);
});
