#!/usr/bin/env node
// Accessibility on the device: from the view trees verify.sh has Maestro save after each screenshot on Android (which
// marks what's tappable; iOS' tree doesn't), the tappable elements without a label, which a screen reader can't name,
// and the ones smaller than 48×48 dp, Android's minimum (and more than iOS' 44 points: React Native lays out both
// alike). An element a scrolling list cuts off at its edge isn't measured. Prints a line each, once per element and
// kind of problem in a flow: flow, screenshot, problem, element.
// Usage: node scripts/amk/a11y.js <Maestro debug folder> <screen density in dpi> <flow>
'use strict';
const fs = require('fs');
const path = require('path');

const [dir, dpi, flow] = process.argv.slice(2);
const scale = Number(dpi) / 160;
if (!dir || !scale || !fs.existsSync(dir)) process.exit(0);

// the trees and the screenshot each follows, in the order the flow saved them. Maestro's commands.json has each step:
// the view-tree step's id (amk-view-tree-<screenshot>) and the tree it saved; the file's own name is cut short
const trees = [];
const files = [];
(function find(d, depth) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory() && depth < 4) find(p, depth + 1);
    else files.push(p);
  }
})(dir, 0);
for (const f of files.filter(p => path.basename(p) === 'commands.json')) {
  let steps;
  try { steps = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  for (const s of Array.isArray(steps) ? steps : []) {
    const id = ((((s.command || {}).assertConditionCommand || {}).condition || {}).visible || {}).idRegex || '';
    const tree = ((s.metadata || {}).artifacts || []).find(a => a.type === 'SCREEN_HIERARCHY');
    if (id.startsWith('amk-view-tree-') && tree) trees.push([path.join(path.dirname(f), tree.path), id.slice(14)]);
  }
}
// without commands.json: the names of the trees' files
if (!trees.length) {
  for (const p of files.filter(p => /amk-view-tree-.+\.json$/.test(p)).sort((a, b) => path.basename(a).localeCompare(path.basename(b)))) {
    trees.push([p, /amk-view-tree-(.+)\.json$/.exec(path.basename(p))[1]]);
  }
}

// the system's own windows, with everything inside them (the status bar, a keyboard and its suggestions); Android's
// own ids (android:id/…) only for that element, as the app's views sit inside android:id/content
const SYSTEM = /^(com\.android\.systemui|com\.google\.android\.inputmethod|com\.android\.inputmethod|com\.samsung\.android\.honeyboard|com\.touchtype\.swiftkey)/;
const box = a => { const b = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(a.bounds || ''); return b && b.slice(1).map(Number); };
const seen = new Set();
for (const [file, shot] of trees) {
  let tree;
  try { tree = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
  // each node with the bounds of the nearest scrolling container around it
  (function walk(n, clip) {
    if (!n) return;
    const a = n.attributes || {};
    if (SYSTEM.test(a['resource-id'] || '')) return;
    const b = box(a);
    if (a.clickable === 'true' && b && !/^android:id\//.test(a['resource-id'] || '')) {
      const [x1, y1, x2, y2] = b;
      const w = (x2 - x1) / scale;
      const h = (y2 - y1) / scale;
      const label = (a.accessibilityText || a.text || a.hintText || '').trim();
      const id = a['resource-id'] || '';
      const name = id ? `testID ${id}` : label ? `"${label}"` : `${a.class || 'an element'} at ${a.bounds}`;
      // once per element and kind of problem in a flow, where it first shows (its size can differ a little later)
      const say = problem => {
        const key = `${id || label}|${problem.startsWith('no label') ? 'label' : 'size'}`; // a testID names it, whatever it shows
        if (!seen.has(key)) { seen.add(key); console.log([flow, shot, problem, name].join('\t')); }
      };
      if (w > 0 && h > 0) {
        if (!label) say('no label: a screen reader can\'t say what it does');
        const cut = clip && (y1 <= clip[1] || y2 >= clip[3] || x1 <= clip[0] || x2 >= clip[2]);
        if (!cut && (w < 47.5 || h < 47.5)) say(`${Math.round(w)}×${Math.round(h)} dp: under 48×48`);
      }
    }
    const inner = a.scrollable === 'true' && b ? b : clip;
    for (const c of n.children || []) walk(c, inner);
  })(tree.root || tree, null);
}
