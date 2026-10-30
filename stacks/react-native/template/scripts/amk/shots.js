#!/usr/bin/env node
// Compares a device check's screenshots with the approved ones, so only the screens that changed need a look, and makes
// new ones the approved ones. Approved screenshots stay on this machine, in .amk/approved/<screen>/<name>.png (.amk/ is
// out of git), by screen (ios, android-landscape, …) and screenshot name, which is unique in an app (<id>-<n>-<name>).
// The status bar (the top 6% of a screenshot, with its clock) isn't compared; a screenshot changed when over 1% of the
// rest differs. verify.sh runs `compare` after each device check, and `approve` for `verify.sh approve`.
//   node scripts/amk/shots.js compare <evidence folder>   writes <evidence folder>/.shots and says what changed
//   node scripts/amk/shots.js approve <evidence folder>   copies its screenshots into .amk/approved/
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
// required, not the global: an app's lint may check these scripts with React Native's globals, which leave Buffer out
const { Buffer } = require('buffer');

const APPROVED = '.amk/approved';
const [cmd, dir] = process.argv.slice(2);

// the screenshots of an evidence folder, [screen, name, path]: each screen's folder, its parts', not Maestro's own logs
function shots(evidence) {
  const out = [];
  const walk = (screen, d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(screen, path.join(d, e.name));
      else if (e.name.endsWith('.png')) out.push([screen, e.name, path.join(d, e.name)]);
    }
  };
  for (const e of fs.readdirSync(evidence, { withFileTypes: true })) if (e.isDirectory() && e.name !== 'maestro-logs') walk(e.name, path.join(evidence, e.name));
  return out.sort((a, b) => a[2].localeCompare(b[2]));
}

// a PNG's pixels: 8-bit RGB or RGBA, not interlaced, as simulators, emulators and Maestro save them; null for any other
function decode(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const data = [];
  for (let i = 8; i + 8 <= buf.length;) {
    const len = buf.readUInt32BE(i);
    const kind = buf.toString('ascii', i + 4, i + 8);
    const body = buf.subarray(i + 8, i + 8 + len);
    if (kind === 'IHDR') [w, h, depth, type, interlace] = [body.readUInt32BE(0), body.readUInt32BE(4), body[8], body[9], body[12]];
    else if (kind === 'IDAT') data.push(body);
    else if (kind === 'IEND') break;
    i += 12 + len;
  }
  const bpp = { 2: 3, 6: 4 }[type];
  if (depth !== 8 || !bpp || interlace) return null;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(data)); } catch { return null; }
  const stride = w * bpp;
  if (raw.length < h * (stride + 1)) return null;
  const px = Buffer.alloc(h * stride);
  // each row's filter (none, sub, up, average, Paeth) undone against the row before
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = raw[row + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, px };
}

// the share of two screenshots' pixels that differ, in percent, below the status bar; -1 when their sizes differ
function differs(a, b) {
  if (a.w !== b.w || a.h !== b.h) return -1;
  const top = Math.round(a.h * 0.06);
  let changed = 0;
  for (let y = top; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const i = (y * a.w + x) * a.bpp;
      const j = (y * b.w + x) * b.bpp;
      if (Math.abs(a.px[i] - b.px[j]) > 24 || Math.abs(a.px[i + 1] - b.px[j + 1]) > 24 || Math.abs(a.px[i + 2] - b.px[j + 2]) > 24) changed++;
    }
  }
  return Math.round((10000 * changed) / ((a.h - top) * a.w)) / 100;
}

function compare(evidence) {
  const label = path.basename(path.resolve(evidence));
  const all = shots(evidence);
  if (!all.length) return 0;
  if (!fs.existsSync(APPROVED)) {
    console.log(`screenshots: none approved yet. Once these look right: sh scripts/amk/verify.sh approve --label ${label}`);
    return 0;
  }
  const rows = all.map(([screen, name, file]) => {
    const was = path.join(APPROVED, screen, name);
    if (!fs.existsSync(was)) return [screen, name, 'new', '', file];
    const [now, then] = [decode(fs.readFileSync(file)), decode(fs.readFileSync(was))];
    if (!now || !then) return [screen, name, 'changed', 'not compared', file]; // a kind of PNG this can't read: look at it
    const pct = differs(now, then);
    return [screen, name, pct > 1 || pct < 0 ? 'changed' : 'same', pct < 0 ? 'another size' : `${pct}% differs`, file];
  });
  fs.writeFileSync(path.join(evidence, '.shots'), rows.map(r => [...r.slice(0, 4), path.relative(evidence, r[4]).split(path.sep).join('/')].join('\t')).join('\n') + '\n');
  const of = s => rows.filter(r => r[2] === s);
  console.log(`screenshots: ${of('changed').length} changed since the approved ones, ${of('new').length} new, ${of('same').length} the same`);
  for (const r of [...of('changed'), ...of('new')].slice(0, 12)) console.log(`  ${r[2]}: ${path.relative(process.cwd(), r[4]).split(path.sep).join('/')}${r[3] ? ` (${r[3]})` : ''}`);
  if (of('changed').length + of('new').length > 12) console.log(`  … all of them in ${path.join(evidence, '.shots')}`);
  if (of('changed').length || of('new').length) console.log(`  Once these look right: sh scripts/amk/verify.sh approve --label ${label}`);
  return 0;
}

function approve(evidence) {
  const all = shots(evidence);
  if (!all.length) { console.log(`verify: no screenshots in ${path.relative(process.cwd(), evidence) || evidence} to approve: run a device check first`); return 1; }
  for (const [screen, name, file] of all) {
    fs.mkdirSync(path.join(APPROVED, screen), { recursive: true });
    fs.copyFileSync(file, path.join(APPROVED, screen, name));
  }
  fs.rmSync(path.join(evidence, '.shots'), { force: true });
  console.log(`approved: ${all.length} screenshots of ${path.basename(path.resolve(evidence))} are the approved ones now (${APPROVED}/)`);
  return 0;
}

module.exports = { decode, differs };

if (require.main === module) {
  if (!['compare', 'approve'].includes(cmd) || !dir || !fs.existsSync(dir)) {
    console.error('usage: node scripts/amk/shots.js compare|approve <evidence folder>');
    process.exitCode = 2;
  } else process.exitCode = cmd === 'compare' ? compare(dir) : approve(dir);
}
