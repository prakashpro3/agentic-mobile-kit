#!/usr/bin/env node
// Specs: check their format, fold a finished feature into the living spec, and show progress.
//   node scripts/ai/specs.js check [--skip-drafts] [files…]   format of specs/<id>/requirements.md and specs/current/*.md
//                                             (default: all; --skip-drafts leaves out specs whose work hasn't started)
//   node scripts/ai/specs.js merge <id>       apply specs/<id>/requirements.md's ADDED/MODIFIED/REMOVED sections to specs/current/
//   node scripts/ai/specs.js status           each spec's status and task progress, and the living spec's size
// A requirement is "### Requirement: <name>", a sentence with SHALL or MUST, and at least one
// "#### Scenario: <case>" with WHEN and THEN. Changes are "## ADDED Requirements: <area>" (and MODIFIED, REMOVED),
// where <area> names the file specs/current/<area>.md. Format: specs/current/README.md.
'use strict';
const fs = require('fs');
const path = require('path');

const [cmd, ...args] = process.argv.slice(2);
const read = f => { try { return fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };
const key = name => name.trim().toLowerCase();

// "### Requirement:" blocks between lines [from, to): each runs to the next heading of level 1-3
function blocks(lines, from = 0, to = lines.length) {
  const out = [];
  for (let i = from; i < to; i++) {
    const m = /^### Requirement:\s*(.*?)\s*#*\s*$/.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < to && !/^#{1,3} /.test(lines[j])) j++;
    out.push({ name: m[1], line: i + 1, start: i, end: j, lines: lines.slice(i, j) });
    i = j - 1;
  }
  return out;
}

// a requirement that's in force: one SHALL/MUST statement and scenarios with WHEN and THEN
function blockProblems(b) {
  const p = [];
  if (!b.name) p.push('needs a name after "Requirement:"');
  const body = b.lines.slice(1);
  const firstScenario = body.findIndex(l => /^#### Scenario:/.test(l));
  const statement = firstScenario < 0 ? body : body.slice(0, firstScenario);
  if (!statement.some(l => /\b(SHALL|MUST)\b/.test(l))) p.push('needs a sentence with SHALL or MUST before its scenarios');
  if (firstScenario < 0) p.push('needs at least one "#### Scenario:"');
  for (let i = 0; i < body.length; i++) {
    const m = /^#### Scenario:\s*(.*)$/.exec(body[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < body.length && !/^#### /.test(body[j])) j++;
    const text = body.slice(i + 1, j).join('\n');
    if (!/\bWHEN\b/.test(text) || !/\bTHEN\b/.test(text)) p.push(`scenario "${m[1] || '?'}" needs WHEN and THEN`);
  }
  return p;
}

// the ADDED/MODIFIED/REMOVED sections of a feature's requirements.md
function deltas(text) {
  const lines = text.split('\n');
  const sections = [];
  const problems = [];
  const inSection = new Set();
  for (let i = 0; i < lines.length; i++) {
    const h = /^## (ADDED|MODIFIED|REMOVED) Requirements\b(.*)$/.exec(lines[i]);
    if (!h) continue;
    const area = (/^:\s*([a-z0-9][a-z0-9-]*)\s*$/.exec(h[2]) || [])[1];
    if (!area) problems.push(`line ${i + 1}: name the area, e.g. "## ${h[1]} Requirements: login" (the file specs/current/login.md)`);
    let j = i + 1;
    while (j < lines.length && !/^#{1,2} /.test(lines[j])) j++;
    const bs = blocks(lines, i + 1, j);
    bs.forEach(b => inSection.add(b.start));
    sections.push({ op: h[1], area, blocks: bs });
    i = j - 1;
  }
  for (const b of blocks(lines)) {
    if (!inSection.has(b.start)) problems.push(`line ${b.line}: "${b.name}" isn't under an "## ADDED/MODIFIED/REMOVED Requirements: <area>" heading`);
  }
  return { lines, sections, problems };
}

function checkFile(file) {
  const text = read(file);
  if (text === null) return [`${file}: not found`];
  const problems = [];
  const where = (b, p) => `${file}:${b.line} "${b.name}": ${p}`;
  if (file.startsWith(`specs${path.sep}current${path.sep}`) || file.startsWith('specs/current/')) {
    const seen = new Set();
    for (const b of blocks(text.split('\n'))) {
      blockProblems(b).forEach(p => problems.push(where(b, p)));
      if (seen.has(key(b.name))) problems.push(where(b, 'appears twice'));
      seen.add(key(b.name));
    }
    return problems;
  }
  const d = deltas(text);
  d.problems.forEach(p => problems.push(`${file}: ${p}`));
  for (const s of d.sections) {
    const seen = new Set();
    for (const b of s.blocks) {
      if (s.op !== 'REMOVED') blockProblems(b).forEach(p => problems.push(where(b, p)));
      if (seen.has(key(b.name))) problems.push(where(b, `appears twice under ${s.op}`));
      seen.add(key(b.name));
    }
  }
  return problems;
}

function allSpecFiles() {
  if (!fs.existsSync('specs')) return [];
  const features = fs.readdirSync('specs', { withFileTypes: true })
    .filter(e => e.isDirectory() && !['_templates', 'current'].includes(e.name))
    .map(e => `specs/${e.name}/requirements.md`).filter(f => fs.existsSync(f));
  const current = fs.existsSync('specs/current')
    ? fs.readdirSync('specs/current').filter(f => f.endsWith('.md') && f !== 'README.md').map(f => `specs/current/${f}`) : [];
  return [...features, ...current];
}

// text for comparing two versions of a requirement: no Source line, no trailing blanks
const normalize = ls => ls.filter(l => !/^Source: /.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');

// the block as it goes into the living spec: its source noted just before the first scenario
function withSource(b, id) {
  const ls = b.lines.filter(l => !/^Source: /.test(l));
  while (ls.length && ls[ls.length - 1].trim() === '') ls.pop();
  const at = ls.findIndex(l => /^#### Scenario:/.test(l));
  ls.splice(at < 0 ? ls.length : at, 0, `Source: specs/${id}`, '');
  return [...ls, ''];
}

function merge(id) {
  const file = `specs/${id}/requirements.md`;
  const problems = checkFile(file);
  if (problems.length) { problems.forEach(p => console.error(`✗ ${p}`)); console.error('\nFix the format first.'); return 1; }
  const { sections } = deltas(read(file));
  if (!sections.length) { console.log(`${file} has no ADDED/MODIFIED/REMOVED sections; nothing to merge.`); return 0; }

  const areas = {};
  const errors = [];
  const notes = [];
  for (const s of sections) {
    const target = `specs/current/${s.area}.md`;
    const title = s.area.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
    const a = areas[s.area] || (areas[s.area] = { target, lines: (read(target) || `# ${title}\n\n## Requirements\n`).split('\n'), counts: { added: 0, changed: 0, removed: 0 } });
    for (const b of s.blocks) {
      const found = blocks(a.lines).find(x => key(x.name) === key(b.name));
      if (s.op === 'ADDED') {
        if (found && normalize(found.lines) === normalize(b.lines)) { notes.push(`"${b.name}" is already in ${target}`); continue; }
        if (found) { errors.push(`"${b.name}" already exists in ${target}: list it under MODIFIED instead`); continue; }
        while (a.lines.length && a.lines[a.lines.length - 1].trim() === '') a.lines.pop();
        a.lines.push('', ...withSource(b, id));
        a.counts.added++;
      } else if (s.op === 'MODIFIED') {
        if (!found) { errors.push(`no requirement "${b.name}" in ${target} to modify: list it under ADDED instead`); continue; }
        if (normalize(found.lines) === normalize(b.lines)) continue;
        a.lines.splice(found.start, found.end - found.start, ...withSource(b, id));
        a.counts.changed++;
      } else if (!found) {
        notes.push(`"${b.name}" isn't in ${target} (already removed, or a typo in its name)`);
      } else {
        a.lines.splice(found.start, found.end - found.start);
        a.counts.removed++;
      }
    }
  }
  if (errors.length) { errors.forEach(e => console.error(`✗ ${e}`)); console.error('\nNothing was changed.'); return 1; }

  fs.mkdirSync('specs/current', { recursive: true });
  for (const a of Object.values(areas)) {
    const c = a.counts;
    if (!c.added && !c.changed && !c.removed) continue;
    if (!blocks(a.lines).length) {
      fs.rmSync(a.target, { force: true });
      console.log(`${a.target}: its last requirement was removed, so the file was deleted`);
      continue;
    }
    fs.writeFileSync(a.target, `${a.lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '')}\n`);
    console.log(`${a.target}: ${c.added} added, ${c.changed} changed, ${c.removed} removed`);
  }
  notes.forEach(n => console.log(`  note: ${n}`));
  return 0;
}

function status() {
  const dirs = fs.existsSync('specs') ? fs.readdirSync('specs', { withFileTypes: true })
    .filter(e => e.isDirectory() && !['_templates', 'current'].includes(e.name)).map(e => e.name) : [];
  const rows = dirs.map(name => {
    const dir = `specs/${name}`;
    const state = ((read(`${dir}/progress.md`) || '').match(/^Status:\s*(.*?)\s*$/m) || [])[1] || 'no progress.md';
    const tasks = read(`${dir}/tasks.md`) || '';
    const done = (tasks.match(/^\s*- \[[xX]\]/gm) || []).length;
    const total = done + (tasks.match(/^\s*- \[ \]/gm) || []).length;
    const updated = Math.max(0, ...fs.readdirSync(dir).map(f => fs.statSync(path.join(dir, f)).mtimeMs));
    return { name, state, tasks: total ? `tasks ${done}/${total}` : 'no tasks yet', updated };
  }).sort((a, b) => b.updated - a.updated);
  if (!rows.length) console.log('No specs yet.');
  const w = Math.max(0, ...rows.map(r => r.name.length));
  for (const r of rows) console.log(`${r.name.padEnd(w)}  ${r.state.padEnd(32)}  ${r.tasks}  (updated ${new Date(r.updated).toISOString().slice(0, 10)})`);
  const current = allSpecFiles().filter(f => f.startsWith('specs/current/'));
  const count = current.reduce((n, f) => n + blocks(read(f).split('\n')).length, 0);
  console.log(`\nLiving spec: ${current.length} area(s), ${count} requirement(s) in specs/current/`);
  return 0;
}

// a feature spec still being drafted: its work hasn't started (progress.md says "not started")
const isDraft = f => /^specs\/[^/]+\/requirements\.md$/.test(f) && !f.startsWith('specs/current/')
  && !/^Status:\s*(in progress|done)/im.test(read(f.replace(/requirements\.md$/, 'progress.md')) || '');

if (cmd === 'check') {
  const skipDrafts = args.includes('--skip-drafts');
  const named = args.filter(a => a !== '--skip-drafts');
  const files = (named.length ? named : allSpecFiles()).filter(f => !(skipDrafts && isDraft(f)));
  const problems = files.flatMap(checkFile);
  problems.forEach(p => console.error(`✗ ${p}`));
  if (!problems.length) console.log(`✓ ${files.length} spec file(s) checked`);
  process.exitCode = problems.length ? 1 : 0;
} else if (cmd === 'merge' && args[0]) {
  process.exitCode = merge(args[0]);
} else if (cmd === 'status') {
  process.exitCode = status();
} else {
  console.log(fs.readFileSync(process.argv[1], 'utf8').split('\n').slice(1, 9).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exitCode = 1;
}
