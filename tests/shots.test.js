// Run: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const tmpDir = require('./tmp');
const png = require('./png');

const SCRIPT = path.join(__dirname, '../stacks/react-native/template/scripts/amk/shots.js');
const { decode, differs } = require(SCRIPT);

test('shots.js decode: 8-bit RGB and RGBA PNGs, every row filter; other kinds are left alone', () => {
  for (const bpp of [3, 4]) {
    const px = Buffer.from(Array.from({ length: 7 * 5 * bpp }, (_, i) => (i * 37 + (i % 11) * 13) & 255));
    const back = decode(png(7, 5, bpp, px, [0, 1, 2, 3, 4]));
    assert.deepStrictEqual([back.w, back.h, back.bpp], [7, 5, bpp]);
    assert.ok(back.px.equals(px), `bpp ${bpp}`);
  }
  const grey = png(2, 2, 3, Buffer.alloc(12));
  grey[8 + 8 + 9] = 0; // colour type 0, greyscale
  assert.strictEqual(decode(grey), null);
  assert.strictEqual(decode(Buffer.from('not a png')), null);
});

test('shots.js differs: the share of pixels that changed, the status bar left out; another size is -1', () => {
  const W = 50, H = 100, white = [255, 255, 255];
  const base = decode(png(W, H, 3, png.solid(W, H, 3, white)));
  assert.strictEqual(differs(base, base), 0);
  assert.strictEqual(differs(base, decode(png(W, H, 3, png.solid(W, H, 3, white, [0, 0, 0], 0.2)))), 21.28, '20 of the 94 rows below the status bar');
  // a new clock in the status bar (the top 6%) isn't a change
  const clock = png.solid(W, H, 3, white);
  clock.fill(0, 0, 3 * W * 5);
  assert.strictEqual(differs(base, decode(png(W, H, 3, clock))), 0);
  assert.strictEqual(differs(base, decode(png(W, H + 1, 3, png.solid(W, H + 1, 3, white)))), -1);
  // small differences (anti-aliasing, a blinking caret) stay under the threshold
  assert.strictEqual(differs(base, decode(png(W, H, 3, png.solid(W, H, 3, [240, 240, 240])))), 0);
});

test('shots.js compare and approve: none approved yet, then the same, changed and new screenshots', () => {
  const dir = tmpDir('amk-shots-');
  const ev = path.join(dir, '.amk/evidence/x1');
  const W = 40, H = 80;
  const put = (f, buf) => { fs.mkdirSync(path.dirname(path.join(ev, f)), { recursive: true }); fs.writeFileSync(path.join(ev, f), buf); };
  const blue = png(W, H, 4, png.solid(W, H, 4, [0, 0, 255, 255]));
  put('ios/screenshots/x1-1-home.png', blue);
  put('ios-landscape/part-2/screenshots/x1-2-list.png', blue);
  put('maestro-logs/ios-x1/screenshots/step-1.png', blue);
  const run = (...a) => { const r = spawnSync(process.execPath, [SCRIPT, ...a], { cwd: dir, encoding: 'utf8' }); return r.stdout + r.stderr; };
  assert.match(run('compare', '.amk/evidence/x1'), /^screenshots: none approved yet\. Once these look right: sh scripts\/amk\/verify\.sh approve --label x1$/m);
  assert.match(run('approve', '.amk/evidence/x1'), /^approved: 2 screenshots of x1 are the approved ones now/m, 'not Maestro\'s own');
  assert.ok(fs.existsSync(path.join(dir, '.amk/approved/ios-landscape/x1-2-list.png')));
  assert.match(run('compare', '.amk/evidence/x1'), /^screenshots: 0 changed since the approved ones, 0 new, 2 the same$/m);
  put('ios/screenshots/x1-1-home.png', png(W, H, 4, png.solid(W, H, 4, [0, 0, 255, 255], [255, 0, 0, 255], 0.5)));
  put('ios/screenshots/x1-3-new.png', blue);
  const out = run('compare', '.amk/evidence/x1');
  assert.match(out, /^screenshots: 1 changed since the approved ones, 1 new, 1 the same\n {2}changed: \.amk\/evidence\/x1\/ios\/screenshots\/x1-1-home\.png \(53\.33% differs\)\n {2}new: \.amk\/evidence\/x1\/ios\/screenshots\/x1-3-new\.png\n {2}Once these look right/m);
  assert.match(fs.readFileSync(path.join(ev, '.shots'), 'utf8'), /^ios\tx1-1-home\.png\tchanged\t53\.33% differs\tios\/screenshots\/x1-1-home\.png$/m);
});
