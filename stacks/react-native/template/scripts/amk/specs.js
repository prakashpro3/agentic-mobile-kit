#!/usr/bin/env node
// Specs: check their format, fold a finished feature into the living spec, find a change's tests, and show progress.
//   node scripts/amk/specs.js check [--skip-drafts] [files…]   format of specs/<id>/requirements.md and specs/current/*.md
//                                             (default: all; --skip-drafts leaves out specs whose work hasn't started)
//   node scripts/amk/specs.js merge <id>       apply specs/<id>/requirements.md's ADDED/MODIFIED/REMOVED sections to specs/current/
//   node scripts/amk/specs.js tests [<id>]     the tests of the areas <id> changes (every area, for a release): the specs and
//                                             flows behind them, what to change or retire, scenarios with no check, flows
//                                             no spec links to, and the verify.sh command that runs them
//   node scripts/amk/specs.js flow <id>        write .maestro/<id>.yaml with a "# Scenario" block for each scenario; with a
//                                             flow already there, list the blocks it's missing instead
//   node scripts/amk/specs.js status           each spec's status and task progress, the living spec's size, and the plan's
//                                             features (specs/plan.md on the plan branch): where each stands, and sizes
//   node scripts/amk/specs.js check --plan     the plan: its features table, each planned spec, and what they get wrong
//                                             together (a requirement added twice, a missing dependency, a loop, …)
//   node scripts/amk/specs.js plan-folder      a second folder of this repository on the plan branch, to plan in while a
//                                             build runs here, with the kit's files git doesn't track copied in
//   node scripts/amk/specs.js start [<id>]     build a planned feature: the next ready one (approved, not taken, its
//                                             dependencies built or on the build's stack), or <id>. Makes feature/<id>
//                                             from main or the top of the stack, with the spec as of its approval commit.
//                                             Exits 3 when none is ready, 4 when the living spec changed under it
//   node scripts/amk/specs.js import <file>    a CSV export (a spreadsheet saved as CSV) or a Trello board's JSON export,
//                                             a line per row or open card, as outside text to plan from
// A requirement is "### Requirement: <name>", a sentence with SHALL or MUST, and at least one
// "#### Scenario: <case>" with WHEN and THEN. Changes are "## ADDED Requirements: <area>" (and MODIFIED, REMOVED),
// where <area> names the file specs/current/<area>.md. User stories and use cases, when a spec has them, name its
// requirements and scenarios. Format: specs/current/README.md and specs/_templates/requirements.md.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const [cmd, ...args] = process.argv.slice(2);
const read = f => { try { return fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };
const key = name => name.trim().toLowerCase();
const bare = s => s.trim().replace(/^["'`*_]+|["'`*_.]+$/g, '').trim();

// ---------- scenarios, and the flow blocks that check them (rn-check.js uses these too) ----------
const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// two names of the same scenario: one holds the other, whatever the case and punctuation
const same = (a, b) => { a = norm(a || ''); b = norm(b || ''); return Boolean(a && b) && (a.includes(b) || b.includes(a)); };
// a flow without its comments (each comment character a space, so positions stay): # outside quotes starts one
function stripYamlComments(text) {
  return text.split('\n').map(l => {
    let quote = null;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (quote) { if (c === quote) quote = null; } else if (c === '"' || c === "'") quote = c;
      else if (c === '#' && (i === 0 || /\s/.test(l[i - 1]))) return l.slice(0, i) + ' '.repeat(l.length - i);
    }
    return l;
  }).join('\n');
}
// a spec's "#### Scenario: <name>" headings in order: number, name, line, and its steps (GIVEN, WHEN, THEN)
function scenarios(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^#### Scenario:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const steps = [];
    for (let j = i + 1; j < lines.length && !/^#{1,4} /.test(lines[j]); j++) if (lines[j].trim()) steps.push(lines[j].trim().replace(/^[-*]\s*/, ''));
    out.push({ n: out.length + 1, name: m[1].trim(), line: i + 1, steps });
  }
  return out;
}
// a flow's "# Scenario <n>: <name>" blocks: number (0 without one), name, line, and its steps without comments
function flowBlocks(text) {
  text = text.replace(/\r\n/g, '\n');
  const code = stripYamlComments(text).split('\n');
  const out = [];
  text.split('\n').forEach((l, i) => {
    const m = /^\s*#\s*Scenario\b\s*(\d+)?\s*[:.)-]?\s*(.*)$/i.exec(l);
    if (m) out.push({ n: Number(m[1]) || 0, name: m[2].trim(), line: i + 1, code: '' });
    else if (out.length) out[out.length - 1].code += `${code[i]}\n`;
  });
  return out;
}
// the block that checks scenario n (its number in its own spec) named name: by number, else by name
const blockFor = (bs, n, name) => (n && bs.find(b => b.n === n)) || bs.find(b => same(b.name, name));
// the flows verify.sh runs (not the copies it makes for a moment, .amk-*), and a spec's: those named <id>…
const allFlows = (dir = '.maestro') => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f) && !f.startsWith('.amk-')).sort() : []);
const flowsOf = (id, flows) => flows.filter(f => f.toLowerCase().startsWith(id.toLowerCase()));
// a flow's tags, from its header: tags: [smoke, login], or one a line below tags:
function tagsOf(text) {
  const head = text.replace(/\r\n/g, '\n').split(/^---\s*$/m)[0].split('\n');
  const at = head.findIndex(l => /^tags\s*:/.test(l));
  if (at < 0) return [];
  const inline = head[at].replace(/^tags\s*:/, '').trim();
  const below = [];
  for (let i = at + 1; i < head.length && /^\s+-\s*\S/.test(head[i]); i++) below.push(head[i].replace(/^\s+-\s*/, ''));
  return (inline ? inline.replace(/^\[|\]$/g, '').split(',') : below).map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

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

// the template's own placeholders, left as they are until the requirements are written: "<area>", "<name>"
const placeholder = t => /^<[^>]*>$/.test(t.trim());
// the ADDED/MODIFIED/REMOVED sections of a feature's requirements.md (a section the template left untouched is none yet)
function deltas(text) {
  const lines = text.split('\n');
  const sections = [];
  const problems = [];
  const inSection = new Set();
  for (let i = 0; i < lines.length; i++) {
    const h = /^## (ADDED|MODIFIED|REMOVED) Requirements\b(.*)$/.exec(lines[i]);
    if (!h) continue;
    const named = (/^:\s*(.*?)\s*$/.exec(h[2]) || [])[1] || '';
    const area = (/^([a-z0-9][a-z0-9-]*)$/.exec(named) || [])[1];
    let j = i + 1;
    while (j < lines.length && !/^#{1,2} /.test(lines[j])) j++;
    const all = blocks(lines, i + 1, j);
    all.forEach(b => inSection.add(b.start));
    const bs = all.filter(b => !placeholder(b.name));
    if (!(placeholder(named) && !bs.length)) {
      if (!area) problems.push(`line ${i + 1}: name the area, e.g. "## ${h[1]} Requirements: login" (the file specs/current/login.md)`);
      sections.push({ op: h[1], area, blocks: bs });
    }
    i = j - 1;
  }
  for (const b of blocks(lines)) {
    if (!inSection.has(b.start) && !placeholder(b.name)) problems.push(`line ${b.line}: "${b.name}" isn't under an "## ADDED/MODIFIED/REMOVED Requirements: <area>" heading`);
  }
  return { lines, sections, problems };
}

function checkFile(file, text = read(file)) {
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
  storyProblems(text, d).forEach(p => problems.push(`${file}: ${p}`));
  return problems;
}

// the "### US-<n>" (or UC-<n>) entries under "## <heading>", each with its text; null without the section
function entries(lines, heading, prefix) {
  const at = lines.findIndex(l => l.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (at < 0) return null;
  const out = [];
  for (let i = at + 1; i < lines.length && !/^#{1,2} /.test(lines[i]); i++) {
    const m = new RegExp(`^### (${prefix}-\\d+)\\b`, 'i').exec(lines[i]);
    if (m) out.push({ id: m[1].toUpperCase(), line: i + 1, text: '' });
    else if (out.length) out[out.length - 1].text += `${lines[i]}\n`;
  }
  return out;
}

// the names after "- <label>:" in an entry ("- Requirements: a, b; c"), where a known name may hold a comma itself
function listed(text, label, known) {
  let s = (new RegExp(`^\\s*-?\\s*${label}:(.*)$`, 'im').exec(text) || ['', ''])[1];
  const long = [...known.values()].filter(n => /[,;]/.test(n));
  long.forEach((n, i) => { s = s.split(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).join(`\0${i}\0`); });
  // the template's placeholder, or a note in brackets ("(written with the requirements)"), names none
  return s.split(/[,;]/).map(x => bare(x.replace(/\0(\d+)\0/g, (_, i) => long[i]))).filter(n => n && !/^[<(].*[>)]$/.test(n));
}

// user stories and use cases, when a spec has them: each story is its sentence and names requirements of this spec,
// each ADDED or MODIFIED requirement is in a story, and a use case's stories and scenarios exist. An empty list is fine:
// a plan approves stories before their requirements are written
function storyProblems(text, d) {
  // the template's guidance is in HTML comments: left out, keeping the line numbers
  const lines = text.replace(/<!--[\s\S]*?-->/g, c => c.replace(/[^\n]/g, '')).split('\n');
  const stories = entries(lines, 'User stories', 'US');
  const cases = entries(lines, 'Use cases', 'UC');
  const p = [];
  const known = new Map(d.sections.flatMap(s => s.blocks).map(b => [key(b.name), b.name]));
  const linked = new Set();
  for (const s of stories || []) {
    if (!/\bAs an?\b/i.test(s.text) || !/\bI want\b/i.test(s.text) || !/\bso that\b/i.test(s.text)) p.push(`line ${s.line}: ${s.id} needs its sentence: "As a <user>, I want <capability>, so that <benefit>."`);
    for (const n of listed(s.text, 'Requirements', known)) {
      if (known.has(key(n))) linked.add(key(n));
      else p.push(`line ${s.line}: ${s.id} names "${n}", which isn't a requirement in this spec`);
    }
  }
  for (const b of stories ? d.sections.filter(s => s.op !== 'REMOVED').flatMap(s => s.blocks) : []) {
    if (!linked.has(key(b.name))) p.push(`line ${b.line}: "${b.name}" is in no user story: name it in a story's Requirements line`);
  }
  const ids = new Set((stories || []).map(s => s.id));
  const names = scenarios(text).map(s => norm(s.name));
  for (const c of cases || []) {
    for (const id of (/^\s*-?\s*Stories:(.*)$/im.exec(c.text) || ['', ''])[1].match(/\bUS-\d+\b/gi) || []) {
      if (!ids.has(id.toUpperCase())) p.push(`line ${c.line}: ${c.id} names ${id}, which isn't a story in this spec`);
    }
    // one a line, or several: "3a. … → Scenario: <name>; 4a. …" or "… → Scenario: <name>. 4a. …"
    for (const m of c.text.matchAll(/\bScenario:\s*(.+?)(?=\s*(?:;|$|\.?\s+\d+[a-z]\.\s))/gm)) {
      const n = bare(m[1]);
      if (n && !/^[<(].*[>)]$/.test(n) && !names.includes(norm(n))) p.push(`line ${c.line}: ${c.id} names the scenario "${n}", which isn't in this spec`);
    }
  }
  return p;
}

// the feature specs' folders: specs/<id>/
const specDirs = () => (fs.existsSync('specs') ? fs.readdirSync('specs', { withFileTypes: true })
  .filter(e => e.isDirectory() && !['_templates', 'current'].includes(e.name)).map(e => e.name) : []);

function allSpecFiles() {
  if (!fs.existsSync('specs')) return [];
  const features = specDirs().map(id => `specs/${id}/requirements.md`).filter(f => fs.existsSync(f));
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

// a handoff's status: the template's placeholder until work starts
const stateOf = p => { const s = (/^Status:\s*(.*?)\s*$/m.exec(p) || [])[1] || ''; return !s || s.startsWith('<') ? 'not started' : s; };

function status() {
  if (branch() === 'plan') { planStatus(); return 0; }
  const rows = specDirs().map(name => {
    const dir = `specs/${name}`;
    const progress = read(`${dir}/progress.md`);
    const state = progress === null ? 'no progress.md' : stateOf(progress);
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
  planStatus();
  return 0;
}

// ---------- a change's tests, or a release's ----------
const areasNow = () => (fs.existsSync('specs/current') ? fs.readdirSync('specs/current')
  .filter(f => f.endsWith('.md') && f !== 'README.md').map(f => f.slice(0, -3)).sort() : []);
// the living spec's requirements in these areas: the spec that last changed each one (its Source: line), and its scenarios
const livingReqs = areas => areas.flatMap(area => blocks((read(`specs/current/${area}.md`) || '').split('\n')).map(b => ({
  area, name: b.name, source: (/^Source:\s*specs\/([^\s/]+)/m.exec(b.lines.join('\n')) || [])[1] || null, scenarios: scenarios(b.lines.join('\n')),
})));
// the app's Jest tests, it() and test(), whose titles name the scenario they check
function jestTests() {
  let files = [];
  try { files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 2 ** 28 }).split('\n'); } catch {}
  return files.filter(f => /(^|\/)__tests__\/.+\.[jt]sx?$|\.(test|spec)\.[jt]sx?$/.test(f) && !/(^|\/)node_modules\//.test(f))
    .flatMap(f => [...(read(f) || '').matchAll(/\b(?:it|test)(?:\.(?:only|skip|concurrent|failing))?\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map(m => ({ file: f, title: m[2] })));
}

function tests(id) {
  let own = null;
  if (id) {
    const text = read(`specs/${id}/requirements.md`);
    if (text === null) { console.error(`specs/${id}/requirements.md: not found`); return 1; }
    own = deltas(text);
  }
  const areas = own ? [...new Set(own.sections.map(s => s.area).filter(Boolean))] : areasNow();
  const everywhere = livingReqs(areasNow());
  const reqs = everywhere.filter(r => areas.includes(r.area));
  // the requirements this change modifies or removes: what tests them now tests the old behavior
  const replaced = own ? own.sections.filter(s => s.op !== 'ADDED').flatMap(s => s.blocks.map(b => ({ op: s.op, area: s.area, name: b.name }))) : [];
  const isReplaced = r => replaced.some(x => x.area === r.area && key(x.name) === key(r.name));
  const flows = allFlows();
  const jest = jestTests();
  const memo = (fn, m = new Map()) => k => (m.has(k) ? m.get(k) : m.set(k, fn(k)).get(k));
  const specScenarios = memo(s => scenarios(read(`specs/${s}/requirements.md`) || ''));
  const blocksOf = memo(s => (s ? flowsOf(s, flows) : flows).flatMap(f => flowBlocks(read(`.maestro/${f}`) || '').map(b => ({ ...b, flow: `.maestro/${f}` }))));
  // what checks scenario name of spec s (any spec, without one): its flow block, and Jest tests named after it
  const checks = (s, name) => {
    const b = blockFor(blocksOf(s), s && (specScenarios(s).find(x => norm(x.name) === norm(name)) || {}).n, name);
    return [...(b ? [`${b.flow}:${b.line}`] : []), ...jest.filter(t => norm(t.title).includes(norm(name))).map(t => `${t.file} "${t.title}"`)];
  };
  const say = (title, rows) => { if (rows.length) console.log(`\n${title}\n${rows.map(r => `  ${r}`).join('\n')}`); };

  console.log(id ? `Tests for ${id}: ${areas.length ? `the area${areas.length === 1 ? '' : 's'} ${areas.join(', ')}` : 'it names no area yet'}`
    : `Tests for a release: every area of the living spec (${areas.length})`);
  const sources = [...new Set(reqs.map(r => r.source).filter(s => s && s !== id))].sort();
  const run = [...(id ? [id] : []), ...sources];
  say('Specs, and their flows:', run.map(s => `${s}${s === id ? ' (this change)' : ''}: ${flowsOf(s, flows).map(f => `.maestro/${f}`).join(', ') || 'no flow'}`));
  say('To change or retire: this change modifies or removes these requirements, so what checks them checks the old behavior:', replaced.map(x => {
    const r = everywhere.find(y => y.area === x.area && key(y.name) === key(x.name));
    const found = r ? r.scenarios.flatMap(sc => checks(r.source, sc.name).map(c => `${c} (scenario "${sc.name}")`)) : [];
    return `${x.op} "${x.name}" (${x.area}${r && r.source ? `, from specs/${r.source}` : ''}): ${found.join('; ') || 'nothing checks it'}`;
  }));
  say('No check: no flow block, and no Jest test named after the scenario:', [
    ...reqs.filter(r => !isReplaced(r)).flatMap(r => r.scenarios.filter(sc => !checks(r.source, sc.name).length)
      .map(sc => `${r.area}: "${r.name}", scenario "${sc.name}"${r.source ? ` (specs/${r.source})` : ''}`)),
    ...(own ? own.sections.filter(s => s.op !== 'REMOVED').flatMap(s => s.blocks.flatMap(b => scenarios(b.lines.join('\n'))
      .filter(sc => !checks(id, sc.name).length).map(sc => `${s.area}: "${b.name}", scenario "${sc.name}" (this change)`))) : []),
  ]);
  // scenarios there are now: the living spec's, and those of specs not merged yet (their work isn't done)
  const ids = [...new Set([...specDirs(), ...everywhere.map(r => r.source).filter(Boolean)])];
  const now = [...everywhere.flatMap(r => r.scenarios.map(sc => sc.name)),
    ...specDirs().filter(s => !/^Status:\s*done/im.test(read(`specs/${s}/progress.md`) || '')).flatMap(s => specScenarios(s).map(sc => sc.name))];
  // (a spec whose id starts another's, as LOGIN-1 and LOGIN-12, shares that one's flows: each block once)
  say('To retire: flow blocks whose scenario isn\'t in the living spec any more:', [...new Set((id ? run : ids).flatMap(s => blocksOf(s).filter(b => {
    const name = /[a-z0-9]/i.test(b.name) ? b.name : (specScenarios(s).find(x => x.n === b.n) || {}).name;
    return name && !now.some(n => same(n, name));
  }).map(b => `${b.flow}:${b.line} # Scenario${b.n ? ` ${b.n}` : ''}: ${b.name}`)))]);
  say(`Flows no spec links to${id ? ' (add the names of those this change touches to --spec)' : ''}:`, flows.filter(f => !ids.some(s => f.toLowerCase().startsWith(s.toLowerCase())))
    .map(f => { const t = tagsOf(read(`.maestro/${f}`) || ''); return `.maestro/${f}${t.length ? ` (tags: ${t.join(', ')})` : ''}`; }));
  const list = run.filter(s => s === id || flowsOf(s, flows).length);
  console.log(`\nRun them: sh scripts/amk/verify.sh all ${id ? `--spec ${list.join(',')}${list.length > 1 ? ` --label ${id}` : ''}` : '--label release'}`);
  return 0;
}

// a flow to start from: a block for each scenario with its steps as comments and a screenshot, its assertion left to write
function flow(id) {
  const text = read(`specs/${id}/requirements.md`);
  if (text === null) { console.error(`specs/${id}/requirements.md: not found`); return 1; }
  const list = scenarios(text);
  if (!list.length) { console.error(`specs/${id}/requirements.md has no scenarios yet`); return 1; }
  const mine = flowsOf(id, allFlows());
  if (mine.length) {
    const missing = list.filter(s => !blockFor(mine.flatMap(f => flowBlocks(read(`.maestro/${f}`) || '')), s.n, s.name));
    console.log(`${mine.map(f => `.maestro/${f}`).join(', ')} already there, so nothing was written. ${missing.length
      ? `Blocks missing, each with an assertion for its THEN and a screenshot:\n${missing.map(s => `  # Scenario ${s.n}: ${s.name}`).join('\n')}`
      : `Each of the ${list.length} scenarios has a block.`}`);
    return 0;
  }
  const tpl = (read('specs/_templates/flow.yaml') || '').split('\n');
  const from = tpl.findIndex(l => /^appId:/.test(l));
  const to = tpl.findIndex(l => /^# Scenario\b/.test(l));
  const slug = s => norm(s).replace(/ /g, '-').slice(0, 40).replace(/-+$/, '');
  const body = list.flatMap(s => [`# Scenario ${s.n}: ${s.name}`, ...s.steps.map(l => `#   ${l}`),
    '# - tapOn:', '#     id: "<testID>"', '# - assertVisible:', '#     id: "<testID of what THEN expects>"', `- takeScreenshot: ${id}-${s.n}-${slug(s.name)}`]);
  fs.mkdirSync('.maestro', { recursive: true });
  fs.writeFileSync(`.maestro/${id}.yaml`, `${[`# specs/${id}: a block per scenario. Write its steps and its assertion (left as comments here): until then`,
    '# rn-check warns that the scenario has no assertion. How to write them: specs/_templates/flow.yaml',
    ...(from >= 0 && to > from ? tpl.slice(from, to) : ['appId: ${APP_ID}', '---', '- launchApp']), ...body].join('\n')}\n`);
  console.log(`.maestro/${id}.yaml: a block for each of the ${list.length} scenarios, with its screenshot. Write each one's steps and the assertion for its THEN.`);
  return 0;
}

// ---------- the plan: plan all, then build ----------
// specs/plan.md and the planned specs live on the plan branch, which is never merged: each spec reaches main with its
// feature's PR. Built means on main: the living spec names it (Source:), or its progress.md there says done.
const git = (...a) => {
  try { return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 2 ** 28 }).replace(/\r\n/g, '\n').replace(/\n$/, ''); } catch { return null; }
};
const show = (ref, f) => git('show', `${ref}:${f}`);
const branch = () => git('symbolic-ref', '--quiet', '--short', 'HEAD');
const exists = ref => git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`) !== null;
const isAncestor = (a, b) => git('merge-base', '--is-ancestor', a, b) !== null;
// main, as the kit's other checks see it (the remote's when there is one)
const mainRef = () => {
  try { return execFileSync(process.execPath, [path.join(__dirname, 'baseline.js'), 'base'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
};
// the plan branch, or the remote's when it's further on (planning in another place pushes it)
function planRef() {
  const [local, remote] = ['plan', 'origin/plan'].map(r => (exists(r) ? r : null));
  return local && remote && git('rev-parse', local) !== git('rev-parse', remote) && isAncestor(local, remote) ? remote : local || remote;
}
// where the plan is read from: this folder when it's on the plan branch, else the plan branch
const planSource = () => (branch() === 'plan' ? { where: 'this folder', read } : (r => r && { where: r, ref: r, read: f => show(r, f) })(planRef()));

const STATUSES = ['drafting', 'questions open', 'ready for approval', 'approved', 'changes requested', 'held'];
// a handoff or summary line that says nothing is there: none, nothing, n/a, dashes, the template's placeholder, or empty
const NONE = /^(?:(?:none|nobody|nothing|n\/a)\b|-+(?:\s|$)|<.*>|$)/i;
// the features whose summary (### <id> under ## Summaries) still waits on someone: "- Waiting on: the client, …"
function waitingOn(text) {
  const out = new Map();
  const body = (/^## Summaries\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text.replace(/<!--[\s\S]*?-->/g, '')) || [])[1] || '';
  let id = null;
  for (const l of body.split('\n')) {
    const h = /^###\s+(.+?)\s*$/.exec(l);
    if (h) { id = cell(h[1]); continue; }
    const w = /^\s*-\s*Waiting on:\s*(.*?)\s*$/i.exec(l);
    if (id && w && !NONE.test(w[1])) out.set(id, w[1]);
  }
  return out;
}
const cell = c => bare(c.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'));
// the "## Features" table: a row per feature, by its columns' names
function planFeatures(text) {
  const lines = text.replace(/<!--[\s\S]*?-->/g, c => c.replace(/[^\n]/g, '')).split('\n');
  const at = lines.findIndex(l => /^## Features\s*$/i.test(l));
  if (at < 0) return { rows: [], problems: ['specs/plan.md has no "## Features" table'] };
  const rows = [];
  let head = null;
  for (let i = at + 1; i < lines.length && !/^#{1,2} /.test(lines[i]); i++) {
    if (!/^\s*\|/.test(lines[i])) continue;
    const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    if (!head) { head = cells.map(c => c.toLowerCase()); continue; }
    if (cells.every(c => /^:?-+:?$/.test(c))) continue;
    const get = name => cells[head.indexOf(name)] || '';
    const id = cell(get('feature'));
    if (!id || /^<.*>$/.test(id)) continue;
    const status = get('status');
    rows.push({ line: i + 1, id, goal: get('goal'), batch: Number(get('batch')) || null, size: get('size'), status,
      word: STATUSES.find(w => status.toLowerCase().startsWith(w)) || null,
      deps: get('depends on').split(/[,;]/).map(cell).filter(d => d && !/^(none|n\/a|[-—–]+)$/i.test(d)) });
  }
  const missing = ['feature', 'depends on', 'batch', 'status'].filter(c => !(head || []).includes(c));
  return { rows, problems: missing.length ? [`specs/plan.md: the Features table needs the columns ${missing.join(', ')}`] : [] };
}
// the features built on ref (main)
function builtOn(ref) {
  const ids = new Set();
  for (const l of (git('grep', '-h', '-E', '^Source: specs/', ref, '--', 'specs/current/') || '').split('\n')) {
    const m = /^Source:\s*specs\/([^\s/]+)/.exec(l);
    if (m) ids.add(m[1]);
  }
  for (const l of (git('grep', '-l', '-E', '^Status:[[:space:]]*done', ref, '--', 'specs/*/progress.md') || '').split('\n')) {
    const m = /specs\/([^/]+)\/progress\.md$/.exec(l);
    if (m) ids.add(m[1]);
  }
  return ids;
}
// a feature's dependencies in the plan, theirs too
function depsOf(rows, id, seen = new Set()) {
  for (const d of (rows.find(r => r.id === id) || { deps: [] }).deps) if (!seen.has(d)) { seen.add(d); depsOf(rows, d, seen); }
  return seen;
}
// a feature's progress where it's being built: its branch, the status in its handoff, and what blocks it
function building(id) {
  const b = [`feature/${id}`, `origin/feature/${id}`].find(exists);
  if (!b) return null;
  const p = show(b, `specs/${id}/progress.md`);
  const blocked = (/^Blocked:\s*(.*?)\s*$/m.exec(p || '') || [])[1] || '';
  return { branch: b, status: p === null ? 'no handoff yet' : stateOf(p), blocked: NONE.test(blocked) ? '' : blocked };
}
// stories, requirements, scenarios and tasks of a spec on the plan
function counts(src, id) {
  const req = src.read(`specs/${id}/requirements.md`);
  if (req === null) return null;
  const lines = req.replace(/<!--[\s\S]*?-->/g, c => c.replace(/[^\n]/g, '')).split('\n');
  const tasks = src.read(`specs/${id}/tasks.md`) || '';
  return { stories: (entries(lines, 'User stories', 'US') || []).length, reqs: deltas(req).sections.reduce((n, x) => n + x.blocks.length, 0),
    scenarios: scenarios(req).length, tasks: (tasks.match(/^\s*- \[[ xX]\] \d/gm) || []).length };
}
// the commit that approved a feature: the first of the commits since which specs/plan.md has said "approved" for it
function approvalCommit(ref, id) {
  let found = null;
  for (const c of (git('log', '--format=%H', ref, '--', 'specs/plan.md') || '').split('\n').filter(Boolean)) {
    const row = planFeatures(show(c, 'specs/plan.md') || '').rows.find(r => r.id === id);
    if (!row || row.word !== 'approved') break;
    found = c;
  }
  return found;
}

// the words the glossary, or the plan's new words, say not to use: "**Visit**: … _Not:_ appointment, call."
function avoidedWords(text) {
  const out = [];
  let term = null;
  for (const l of (text || '').replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    const t = /\*\*([^*]+)\*\*\s*:/.exec(l);
    if (t) term = t[1].trim();
    const m = /_Not:_\s*(.*)$/.exec(l);
    if (m && term) for (const w of m[1].split(/[,;]/).map(x => bare(x).replace(/\.$/, '')).filter(Boolean)) out.push({ word: w, use: term });
  }
  return out;
}

function checkPlan() {
  const src = planSource();
  const text = src && src.read('specs/plan.md');
  if (!text) { console.error('No plan: specs/plan.md isn\'t on a plan branch here (/m-feature plan makes one).'); return 1; }
  const { rows, problems } = planFeatures(text);
  const main = mainRef();
  const built = main ? builtOn(main) : new Set();
  const at = new Map(rows.map((r, i) => [r.id, i]));
  const p = [...problems];
  const waits = waitingOn(text);
  rows.forEach((r, i) => {
    if (r.word === 'approved' && waits.has(r.id)) p.push(`specs/plan.md:${r.line} ${r.id} is approved, but its summary waits on ${waits.get(r.id)}: hold it (held: <who>) until the answer comes, or set its Waiting on: to none to build on the working assumptions`);
    if (rows.findIndex(x => x.id === r.id) !== i) p.push(`specs/plan.md:${r.line} ${r.id} is listed twice`);
    if (!r.word) p.push(`specs/plan.md:${r.line} ${r.id}: status "${r.status}" isn't one of: ${STATUSES.join(', ')}`);
    if (!r.batch) p.push(`specs/plan.md:${r.line} ${r.id}: give it a batch number`);
    for (const d of r.deps) {
      if (!at.has(d)) { if (!built.has(d)) p.push(`specs/plan.md:${r.line} ${r.id} depends on ${d}, which is neither in the plan nor built on ${main || 'main'}`); continue; }
      const dep = rows[at.get(d)];
      if (at.get(d) > i) p.push(`specs/plan.md:${r.line} ${r.id} depends on ${d}, which comes after it`);
      else if (dep.batch && r.batch && dep.batch > r.batch) p.push(`specs/plan.md:${r.line} ${r.id} depends on ${d}, which is in a later batch`);
    }
    if (depsOf(rows, r.id).has(r.id)) p.push(`specs/plan.md:${r.line} ${r.id} is in a dependency loop`);
  });
  // each planned spec on its own, then what the specs get wrong together
  const specs = rows.map(r => ({ r, text: src.read(`specs/${r.id}/requirements.md`) })).filter(x => x.text !== null);
  for (const r of rows) {
    if (['ready for approval', 'approved'].includes(r.word) && !(specs.find(x => x.r === r) && counts(src, r.id).reqs && counts(src, r.id).tasks)) {
      p.push(`specs/${r.id}: ${r.word}, but its requirements or tasks aren't written yet`);
    }
  }
  const added = new Map();
  const living = new Map();
  const inMain = (area, name) => {
    if (!living.has(area)) living.set(area, blocks(((main && show(main, `specs/current/${area}.md`)) || '').split('\n')).map(b => key(b.name)));
    return living.get(area).includes(key(name));
  };
  for (const { r, text: t } of specs) {
    checkFile(`specs/${r.id}/requirements.md`, t).forEach(x => p.push(x));
    const d = deltas(t);
    const lines = t.replace(/<!--[\s\S]*?-->/g, c => c.replace(/[^\n]/g, '')).split('\n');
    const known = new Map(d.sections.flatMap(x => x.blocks).map(b => [key(b.name), b.name]));
    if (known.size) {
      for (const st of entries(lines, 'User stories', 'US') || []) {
        if (!listed(st.text, 'Requirements', known).length) p.push(`specs/${r.id}/requirements.md:${st.line} ${st.id} names no requirement`);
      }
    }
    for (const x of d.sections.filter(y => y.op === 'ADDED' && y.area)) {
      for (const b of x.blocks) {
        const k = `${x.area}\0${key(b.name)}`;
        added.set(k, [...(added.get(k) || []), r.id]);
        if (inMain(x.area, b.name)) p.push(`specs/${r.id} adds "${b.name}" (${x.area}), which the living spec on ${main} already has: list it under MODIFIED`);
      }
    }
  }
  for (const [k, ids] of added) if (ids.length > 1) p.push(`"${k.split('\0')[1]}" (${k.split('\0')[0]}) is added by both ${ids.join(' and ')}`);
  for (const { r, text: t } of specs) {
    for (const x of deltas(t).sections.filter(y => y.op !== 'ADDED' && y.area)) {
      for (const b of x.blocks) {
        const by = (added.get(`${x.area}\0${key(b.name)}`) || []).filter(id => id !== r.id);
        if (inMain(x.area, b.name)) continue;
        if (!by.length) p.push(`specs/${r.id} ${x.op === 'MODIFIED' ? 'modifies' : 'removes'} "${b.name}" (${x.area}), which neither the living spec on ${main || 'main'} nor another planned feature has`);
        for (const g of by) if (!depsOf(rows, r.id).has(g)) p.push(`specs/${r.id} ${x.op === 'MODIFIED' ? 'modifies' : 'removes'} "${b.name}", which ${g} adds: add ${g} to its Depends on`);
      }
    }
  }
  const shared = (/^## Shared design\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text) || [])[1];
  // a warning only: a word to avoid can be right in another sense (an API "call" in an app whose Visits aren't calls)
  const avoid = [...avoidedWords(main && show(main, 'docs/amk/glossary.md')), ...avoidedWords(shared)];
  // the spec's own words: not the template's comments, or its section headings ("## User stories")
  const own = t => t.replace(/<!--[\s\S]*?-->/g, '').replace(/^## .*$/gm, '').replace(/<[^<>\n]*>/g, '');
  const words = specs.flatMap(({ r, text: t }) => avoid.filter(a => new RegExp(`\\b${a.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i')
    .test(own(t))).map(a => `specs/${r.id} says "${a.word}": the glossary's word is ${a.use}, unless it means something else here`));
  // the plan branch never takes main's changes, so a kit update there doesn't reach it
  const kit = branch() === 'plan' && main && show(main, 'scripts/amk/specs.js') !== null;
  if (kit && git('diff', '--quiet', main, '--', 'scripts/amk/specs.js') === null) words.push(`the kit's scripts here aren't ${main}'s (a kit update there?): git checkout ${main} -- scripts/amk .agents/skills .rulesync, then commit`);
  p.forEach(x => console.error(`✗ ${x}`));
  words.forEach(x => console.error(`! ${x}`));
  if (!p.length) console.log(`✓ plan: ${rows.length} feature(s), ${specs.length} with a spec, checked together${main ? ` against ${main}` : ''}`);
  return p.length ? 1 : 0;
}

// the plan's features, where each stands, and the sizes added up per batch
function planStatus() {
  const src = planSource();
  const text = src && src.read('specs/plan.md');
  if (!text) return;
  const { rows } = planFeatures(text);
  const waits = waitingOn(text);
  const main = mainRef();
  const built = main ? builtOn(main) : new Set();
  const out = rows.map(r => {
    const b = building(r.id);
    const c = (b && b.branch && counts({ read: f => show(b.branch, f) }, r.id)) || counts(src, r.id);
    const state = built.has(r.id) ? 'built' : b ? `being built on ${b.branch}: ${b.status}${b.blocked ? `; blocked: ${b.blocked}` : ''}`
      : `${r.status || 'no status'}${r.word === 'approved' && waits.has(r.id) ? `, but waits on ${waits.get(r.id)}` : ''}`;
    const hours = c && c.tasks ? c.tasks : Number((r.size.match(/\d+(?:\.\d+)?/) || [])[0]) || 0;
    return { r, state, c, hours, rough: !(c && c.tasks) };
  });
  console.log(`\nPlan (specs/plan.md on ${src.where}): ${rows.length} feature(s)`);
  const w = Math.max(7, ...rows.map(r => r.id.length));
  for (const x of out) {
    const what = x.c ? `${x.c.stories} stories, ${x.c.reqs} requirements, ${x.c.scenarios} scenarios, ${x.c.tasks ? `${x.c.tasks} tasks` : `~${x.hours} h`}` : `no spec yet, ~${x.hours} h`;
    console.log(`  ${x.r.id.padEnd(w)}  batch ${String(x.r.batch || '?').padEnd(2)}  ${x.state}  (${what})`);
  }
  const batches = [...new Set(rows.map(r => r.batch || 0))].sort((a, b) => a - b);
  console.log(`  Size: ${batches.map(n => { const xs = out.filter(x => (x.r.batch || 0) === n); return `batch ${n || '?'} ${xs.some(x => x.rough) ? '~' : ''}${xs.reduce((t, x) => t + x.hours, 0)} h`; }).join(', ')} (a task is about an hour)`);
}

// requirements a feature modifies or removes that changed on main after the plan approved it, other than through the
// features it depends on: building it as approved would undo that change
function changedSince(id, approved, from, main, deps) {
  const when = git('log', '-1', '--format=%cI', approved);
  const then = when && git('rev-list', '-1', '--first-parent', `--before=${when}`, main);
  if (!then) return [];
  const out = [];
  for (const x of deltas(show(approved, `specs/${id}/requirements.md`) || '').sections.filter(y => y.op !== 'ADDED' && y.area)) {
    const at = ref => blocks((show(ref, `specs/current/${x.area}.md`) || '').split('\n'));
    const [before, now] = [at(then), at(from)];
    for (const b of x.blocks) {
      const was = before.find(y => key(y.name) === key(b.name));
      const is = now.find(y => key(y.name) === key(b.name));
      if (normalize(was ? was.lines : []) === normalize(is ? is.lines : [])) continue;
      const by = is && (/^Source:\s*specs\/([^\s/]+)/m.exec(is.lines.join('\n')) || [])[1];
      if (by && deps.has(by)) continue;
      out.push(`"${b.name}" (${x.area}) ${is ? `changed after the plan approved ${id}${by ? `, in specs/${by}` : ''}` : 'isn\'t in the living spec any more'}`);
    }
  }
  return out;
}

// on the plan branch, which never takes main's changes, a planned spec's tests are found in main as it is now: in a
// temporary worktree of main, with the spec copied in
function testsOnMain(id) {
  const main = mainRef();
  const text = read(`specs/${id}/requirements.md`);
  if (!main || text === null) return tests(id);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amk-plan-'));
  try {
    execFileSync('git', ['worktree', 'add', '--detach', '--force', dir, main], { stdio: 'ignore' });
    fs.mkdirSync(path.join(dir, 'specs', id), { recursive: true });
    fs.writeFileSync(path.join(dir, 'specs', id, 'requirements.md'), text);
    console.log(`(the living spec, flows and tests as they are on ${main}: this branch's copies are older)`);
    return spawnSync(process.execPath, [process.argv[1], 'tests', id], { cwd: dir, stdio: 'inherit' }).status;
  } finally {
    git('worktree', 'remove', '--force', dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// a second folder of this repository on the plan branch: a git worktree, which holds only what git tracks, so the kit's
// files an app keeps out of git (its skills, tool settings and hooks) are copied in from this folder
const KIT_FOLDERS = ['.agents', '.claude', '.codex', '.antigravity', '.githooks', '.rulesync', 'rulesync.jsonc', '.kiro', '.cursor', '.opencode'];
function planFolder() {
  const top = git('rev-parse', '--show-toplevel');
  if (!top) { console.error('Not in a git repository.'); return 1; }
  const dir = path.join(path.dirname(top), `${path.basename(top)}-plan`);
  if (fs.existsSync(dir)) { console.log(`${dir} is there already: open a session there, and run /m-feature plan.`); return 0; }
  const main = exists('plan') || exists('origin/plan') ? null : mainRef();
  const how = exists('plan') ? [dir, 'plan'] : exists('origin/plan') ? ['-b', 'plan', dir, 'origin/plan'] : main && ['--no-track', '-b', 'plan', dir, main];
  if (!how) { console.error('No main branch found: set AMK_BASE to the branch features start from.'); return 1; }
  try { execFileSync('git', ['worktree', 'add', ...how], { cwd: top, stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) { console.error(`git worktree add: ${String(e.stderr || e.message).trim()}`); return 1; }
  const files = (git('-C', top, 'ls-files', '--others', '--ignored', '--exclude-standard', '--', ...KIT_FOLDERS) || '').split('\n').filter(Boolean);
  const missed = [];
  for (const f of files) {
    const from = path.join(top, f);
    const to = path.join(dir, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
      if (fs.lstatSync(from).isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
      else fs.copyFileSync(from, to); // its mode too: a hook stays executable
    } catch { missed.push(f); }
  }
  console.log(`${dir}: on the plan branch${files.length ? `, with the ${files.length - missed.length} kit file(s) git doesn't track here` : ''}. It needs no installs or devices: open a session there and run /m-feature plan.`);
  if (missed.length) console.log(`  not copied (copy them by hand): ${missed.join(', ')}`);
  return 0;
}

function start(want) {
  if (branch() === 'plan') { console.error('This folder is on the plan branch: build in a folder on main or a feature branch.'); return 1; }
  if (git('status', '--porcelain', '--untracked-files=no')) { console.error('Commit the changes here first (git status): a feature starts from a clean folder.'); return 1; }
  if (git('remote')) {
    // never waiting on a password or passphrase prompt: offline, it goes on with what's here
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes' };
    try { execFileSync('git', ['fetch', '--quiet', 'origin'], { stdio: 'ignore', timeout: 60000, env }); } catch {}
  }
  const ref = planRef();
  const plan = ref && show(ref, 'specs/plan.md');
  if (!plan) { console.error('No plan branch with specs/plan.md here: /m-feature plan makes one.'); return 1; }
  const main = mainRef();
  if (!main) { console.error('No main branch found: set AMK_BASE to the branch features start from.'); return 1; }
  const { rows } = planFeatures(plan);
  const waits = waitingOn(plan);
  const built = builtOn(main);
  // the build's stack: planned features done on their own branch whose PR isn't merged yet, the highest first (holding
  // the most of the others, then the latest in the plan)
  const stack = rows.filter(r => !built.has(r.id) && exists(`feature/${r.id}`) && /^done/i.test((building(r.id) || {}).status || ''));
  const holds = (a, b) => isAncestor(`feature/${b}`, `feature/${a}`);
  const high = stack.map((r, i) => ({ r, i, n: stack.filter(o => o !== r && holds(r.id, o.id)).length })).sort((a, b) => b.n - a.n || b.i - a.i).map(x => x.r);
  // where a feature starts: the highest branch of the stack that holds the dependencies it has there, or main
  const baseFor = r => {
    const need = r.deps.filter(d => !built.has(d) && stack.some(o => o.id === d));
    const s = high.find(o => need.every(d => d === o.id || holds(o.id, d)));
    return s ? `feature/${s.id}` : need.length ? null : main;
  };
  const why = r => {
    if (built.has(r.id)) return 'built';
    const b = building(r.id);
    if (b) return `taken: ${b.branch}, ${b.status}${b.blocked ? `; blocked: ${b.blocked}` : ''}`;
    if (r.word !== 'approved') return r.status || 'no status';
    if (waits.has(r.id)) return `approved, but waits on ${waits.get(r.id)}`;
    const missing = r.deps.filter(d => !built.has(d) && !stack.some(o => o.id === d));
    if (missing.length) return `waits for ${missing.join(', ')}`;
    return baseFor(r) ? null : `waits for ${r.deps.join(', ')} to be merged: no one branch holds them all`;
  };
  const pick = want ? rows.find(r => r.id === want) : rows.find(r => !why(r));
  if (want && !pick) { console.error(`${want} isn't in specs/plan.md on ${ref}.`); return 1; }
  if (!pick || why(pick)) {
    console.log(`${want ? `${want} can't start` : 'Waiting for the plan: no feature is ready'} (specs/plan.md on ${ref}):`);
    for (const r of want ? [pick] : rows.filter(x => why(x) !== 'built')) console.log(`  ${r.id}: ${why(r)}`);
    return 3;
  }
  const approved = approvalCommit(ref, pick.id);
  if (!approved || !show(approved, `specs/${pick.id}/requirements.md`)) { console.error(`${pick.id}: no approved spec on ${ref} (specs/${pick.id}/ in the commit that approved it).`); return 1; }
  const short = approved.slice(0, 7);
  const name = `feature/${pick.id}`;
  const from = baseFor(pick);
  for (const a of [['switch', '--quiet', '--no-track', '-c', name, from], ['checkout', approved, '--', `specs/${pick.id}/`]]) {
    try { execFileSync('git', a, { stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) { console.error(`git ${a.join(' ')}: ${String(e.stderr || e.message).trim()}`); return 1; }
  }
  const progress = `specs/${pick.id}/progress.md`;
  const log = `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')}: started from ${from} (its PR goes to ${from.replace(/^origin\//, '')}), with the spec as approved in ${short} on ${ref}`;
  const p = read(progress) || read('specs/_templates/progress.md') || '## Log\n';
  fs.writeFileSync(progress, /^## Log\s*$/m.test(p) ? p.replace(/^## Log\s*\n(\s*<!--[\s\S]*?-->\s*\n)?/m, m => `${m.replace(/\n*$/, '\n')}\n${log}\n`) : `${p.replace(/\n*$/, '\n')}\n## Log\n\n${log}\n`);
  try {
    execFileSync('git', ['add', '--', `specs/${pick.id}/`], { stdio: 'ignore' });
    execFileSync('git', ['commit', '--quiet', '-m', `docs(spec): ${pick.id} from the plan, as approved in ${short}\n\nSpec: specs/${pick.id}`], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) { console.error(`git commit: ${String(e.stderr || e.message).trim()}`); return 1; }
  console.log(`Started ${pick.id} on ${name}, from ${from} (its PR's base), with the spec as approved in ${short}.`);
  const changed = changedSince(pick.id, approved, from, main, depsOf(rows, pick.id));
  if (changed.length) {
    console.log(`Stop: the living spec changed under it, so it needs approving again (a change after approval):\n${changed.map(c => `  ${c}`).join('\n')}`);
    return 4;
  }
  return 0;
}

// a feature spec still being drafted: its work hasn't started (progress.md says "not started")
const isDraft = f => /^specs\/[^/]+\/requirements\.md$/.test(f) && !f.startsWith('specs/current/')
  && !/^Status:\s*(in progress|done)/im.test(read(f.replace(/requirements\.md$/, 'progress.md')) || '');

// ---------- a feature list exported from a spreadsheet (CSV) or Trello (its JSON), for /m-feature plan ----------
// RFC 4180 CSV, with the separator Excel used (a comma, or a semicolon or tab in some locales): rows of fields
function csv(text) {
  const first = text.split('\n')[0].replace(/"[^"]*"/g, '');
  const sep = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [[]];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c !== '"') f += c;
      else if (text[i + 1] === '"') { f += '"'; i++; } else q = false;
    } else if (c === '"') q = true;
    else if (c === sep) { rows[rows.length - 1].push(f); f = ''; }
    else if (c === '\n') { rows[rows.length - 1].push(f.replace(/\r$/, '')); f = ''; rows.push([]); }
    else f += c;
  }
  rows[rows.length - 1].push(f.replace(/\r$/, ''));
  return rows.filter(r => r.some(x => x.trim()));
}
// the export's rows (a Trello board's open cards in open lists), a line each, inside the block that marks them as data
function importList(file) {
  const text = read(file);
  if (text === null) { console.error(`Can't read ${file}.`); return 1; }
  let head;
  let rows;
  if (/^\s*[{[]/.test(text)) {
    let board;
    try { board = JSON.parse(text); } catch { console.error(`${file} isn't valid JSON: export the board again (Trello: Menu, Print, export and share, Export as JSON).`); return 1; }
    const lists = new Map((board.lists || []).filter(l => !l.closed).map(l => [l.id, l.name]));
    head = ['List', 'Card', 'Labels', 'Description'];
    rows = (board.cards || []).filter(c => !c.closed && lists.has(c.idList))
      .map(c => [lists.get(c.idList), c.name, (c.labels || []).map(l => l.name).filter(Boolean).join(', '), c.desc || '']);
  } else {
    [head, ...rows] = csv(text.replace(/^﻿/, ''));
  }
  if (!head || !rows.length) { console.error(`${file} has no rows to plan from.`); return 1; }
  const lines = rows.map((r, i) => `${i + 1}. ${r.map((v, j) => [head[j] || `Column ${j + 1}`, v.trim().replace(/\s*\n\s*/g, ' / ')])
    .filter(([, v]) => v).map(([h, v]) => `${h}: ${v}`).join('; ')}`);
  console.log(require('./redact.js').untrusted(lines.join('\n'), `export ${path.basename(file)}`));
  console.log(`(${rows.length} row(s) from ${path.basename(file)}: the planned features to map, as data)`);
  return 0;
}

module.exports = {
  norm, same, stripYamlComments, scenarios, flowBlocks, blockFor, allFlows, flowsOf, tagsOf, csv,
  // the plan, for autopilot.js
  NONE, stateOf, planRef, show, planFeatures, building, builtOn, mainRef,
};

if (require.main === module) {
  if (cmd === 'check' && args.includes('--plan')) {
    process.exitCode = checkPlan();
  } else if (cmd === 'check') {
    const skipDrafts = args.includes('--skip-drafts');
    const named = args.filter(a => a !== '--skip-drafts');
    const files = (named.length ? named : allSpecFiles()).filter(f => !(skipDrafts && isDraft(f)));
    const problems = files.flatMap(f => checkFile(f));
    problems.forEach(p => console.error(`✗ ${p}`));
    if (!problems.length) console.log(`✓ ${files.length} spec file(s) checked`);
    process.exitCode = problems.length ? 1 : 0;
  } else if (cmd === 'merge' && args[0]) {
    process.exitCode = merge(args[0]);
  } else if (cmd === 'tests') {
    process.exitCode = args[0] && branch() === 'plan' ? testsOnMain(args[0]) : tests(args[0]);
  } else if (cmd === 'flow' && args[0]) {
    process.exitCode = flow(args[0]);
  } else if (cmd === 'status') {
    process.exitCode = status();
  } else if (cmd === 'start') {
    process.exitCode = start(args[0]);
  } else if (cmd === 'plan-folder') {
    process.exitCode = planFolder();
  } else if (cmd === 'import' && args[0]) {
    process.exitCode = importList(args[0]);
  } else {
    const head = fs.readFileSync(process.argv[1], 'utf8').split('\n').slice(1);
    console.log(head.slice(0, head.findIndex(l => !l.startsWith('//'))).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exitCode = 1;
  }
}
