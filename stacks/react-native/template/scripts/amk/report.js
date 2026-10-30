#!/usr/bin/env node
// A device check's report, from its evidence folder (.amk/evidence/<label>/): report.md for people (each screen, its
// flows, passed or failed and why, and their screenshots) and junit.xml for CI. --summary prints a short Markdown
// table instead, for a CI job's summary. verify.sh runs it after each device check, and builds it from what's on disk,
// so devices and parts checked at the same time all end up in it: each screen's flows are in <screen>/.flows (or
// <screen>/part-<k>/.flows), a line each: name, passed, failed or flaky (it passed when run again), why it failed, its
// screenshots, the screen when it failed, and a flaky one's first log.
// Usage: node scripts/amk/report.js <evidence folder> [--summary]
'use strict';
const fs = require('fs');
const path = require('path');

const [dir, mode] = process.argv.slice(2);
if (!dir || !fs.existsSync(dir)) {
  console.error('usage: node scripts/amk/report.js <evidence folder> [--summary]');
  process.exit(2);
}
const label = path.basename(path.resolve(dir));
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

// the screens: <screen>/.flows, and <screen>/part-<k>/.flows for a device's flows split in parts
const screens = [];
for (const s of fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort()) {
  for (const sub of ['', ...(fs.readdirSync(path.join(dir, s)).filter(p => /^part-\d+$/.test(p)).sort())]) {
    const text = read(path.join(dir, s, sub, '.flows'));
    if (text === null) continue;
    // what the view trees showed on Android: flow, screenshot, problem, element (a11y.js)
    const a11y = (read(path.join(dir, s, sub, '.a11y')) || '').split('\n').filter(Boolean).map(l => l.split('\t'));
    const flows = text.split('\n').filter(Boolean).map(l => {
      const [name, result, why, shots, shot, log] = l.split('\t');
      return { name, passed: result !== 'failed', flaky: result === 'flaky', why: why || '', shots: (shots || '').split(',').filter(Boolean), shot: shot || '', log: log || '',
        a11y: a11y.filter(x => x[0] === name).map(([, at, problem, element]) => ({ at, problem, element })) };
    });
    screens.push({ name: sub ? `${s} (${sub.replace('-', ' ')})` : s, dir: sub ? `${s}/${sub}` : s, flows });
  }
}
const all = screens.flatMap(s => s.flows);
const failed = all.filter(f => !f.passed);
const flaky = all.filter(f => f.flaky);
const counts = s => `${s.flows.filter(f => f.passed).length}/${s.flows.length}`;
const table = ['| Screen | Flows passed | Screenshots |', '|---|---|---|',
  ...screens.map(s => `| ${s.name} | ${counts(s)}${s.flows.every(f => f.passed) ? '' : ' ✗'}${s.flows.some(f => f.flaky) ? ` (${s.flows.filter(f => f.flaky).length} flaky)` : ''} | ${s.flows.reduce((n, f) => n + f.shots.length, 0)} |`)];
const warned = all.reduce((n, f) => n + f.a11y.length, 0);
const headline = `${all.length - failed.length} of ${all.length} flows passed on ${screens.length} screen${screens.length === 1 ? '' : 's'}${flaky.length ? `, ${flaky.length} flaky` : ''}${warned ? `, ${warned} accessibility warning${warned === 1 ? '' : 's'}` : ''}`;
const screenOf = f => screens.find(s => s.flows.includes(f));
const flakyLine = f => `it failed${f.why ? ` ${f.why}` : ''} the first time, then passed`;

if (mode === '--summary') {
  console.log([`### Device checks: ${label}`, '', headline, '', ...table, '',
    ...failed.map(f => `- ✗ ${screenOf(f).name}: ${f.name}${f.why ? `, failed ${f.why}` : ''}`),
    ...flaky.map(f => `- ⚠ ${screenOf(f).name}: ${f.name} is flaky: ${flakyLine(f)}`)].join('\n'));
  process.exit(0);
}

// a path inside the evidence folder, for a link from report.md, which sits in it
const link = p => p.split('/').map(encodeURIComponent).join('/');
// the screenshots that differ from the approved ones (shots.js compare): screen, name, changed or new, how, path
const looks = (read(path.join(dir, '.shots')) || '').split('\n').filter(Boolean).map(l => l.split('\t')).filter(r => r[2] !== 'same');
const lookLine = looks.length ? [`Screenshots to look at, as they differ from the approved ones: ${looks.map(r => `${r[4]} (${r[2]}${r[3] ? `, ${r[3]}` : ''})`).join(', ')}`, ''] : [];
const md = [`# Device checks: ${label}`, '', `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${headline}`, '', ...lookLine, ...table];
for (const s of screens) {
  md.push('', `## ${s.name}`);
  for (const f of s.flows) {
    md.push('', `### ${f.flaky ? '⚠' : f.passed ? '✓' : '✗'} ${f.name}${f.flaky ? ' (flaky)' : ''}`);
    if (f.flaky) {
      md.push('', `Flaky: ${flakyLine(f)}. Not a failure, but fix it (a race, or a wait too short). The first try's log: [${f.log}](${link(f.log)})${f.shot ? ` · [the screen when it failed](${link(f.shot)})` : ''}`);
    }
    if (!f.passed) {
      md.push('', `Failed${f.why ? ` ${f.why}` : ''}. Log: [${s.dir}/${f.name}.log](${link(`${s.dir}/${f.name}.log`)})${f.shot ? ` · [the screen when it failed](${link(f.shot)})` : ''}`);
    }
    if (f.shots.length) md.push('', f.shots.map(p => `<img src="${link(p)}" width="180" alt="${path.basename(p, '.png')}" title="${path.basename(p, '.png')}">`).join(' '));
    if (f.a11y.length) md.push('', 'Accessibility, from the screen\'s view tree:', '', ...f.a11y.map(x => `- ${x.at}: ${x.element}: ${x.problem}`));
  }
}
fs.writeFileSync(path.join(dir, 'report.md'), `${md.join('\n')}\n`);

const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
fs.writeFileSync(path.join(dir, 'junit.xml'), [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<testsuites name="${xml(label)}" tests="${all.length}" failures="${failed.length}">`,
  ...screens.flatMap(s => [
    `  <testsuite name="${xml(s.name)}" tests="${s.flows.length}" failures="${s.flows.filter(f => !f.passed).length}">`,
    ...s.flows.map(f => (f.flaky ? `    <testcase classname="${xml(s.name)}" name="${xml(f.name)}"><system-out>${xml(`flaky: ${flakyLine(f)}`)}</system-out></testcase>`
      : f.passed ? `    <testcase classname="${xml(s.name)}" name="${xml(f.name)}"/>`
      : `    <testcase classname="${xml(s.name)}" name="${xml(f.name)}"><failure message="${xml(f.why || 'failed')}"/></testcase>`)),
    '  </testsuite>',
  ]),
  '</testsuites>', '',
].join('\n'));
console.log(`${headline}: ${path.join(dir, 'report.md')}`);
