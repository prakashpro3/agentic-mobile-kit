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
//   node scripts/amk/specs.js status           each spec's status and task progress, and the living spec's size
// A requirement is "### Requirement: <name>", a sentence with SHALL or MUST, and at least one
// "#### Scenario: <case>" with WHEN and THEN. Changes are "## ADDED Requirements: <area>" (and MODIFIED, REMOVED),
// where <area> names the file specs/current/<area>.md. User stories and use cases, when a spec has them, name its
// requirements and scenarios. Format: specs/current/README.md and specs/_templates/requirements.md.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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
  return s.split(/[,;]/).map(x => bare(x.replace(/\0(\d+)\0/g, (_, i) => long[i]))).filter(Boolean);
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
      if (n && !names.includes(norm(n))) p.push(`line ${c.line}: ${c.id} names the scenario "${n}", which isn't in this spec`);
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

function status() {
  const rows = specDirs().map(name => {
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

// a feature spec still being drafted: its work hasn't started (progress.md says "not started")
const isDraft = f => /^specs\/[^/]+\/requirements\.md$/.test(f) && !f.startsWith('specs/current/')
  && !/^Status:\s*(in progress|done)/im.test(read(f.replace(/requirements\.md$/, 'progress.md')) || '');

module.exports = { norm, same, stripYamlComments, scenarios, flowBlocks, blockFor, allFlows, flowsOf, tagsOf };

if (require.main === module) {
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
  } else if (cmd === 'tests') {
    process.exitCode = tests(args[0]);
  } else if (cmd === 'flow' && args[0]) {
    process.exitCode = flow(args[0]);
  } else if (cmd === 'status') {
    process.exitCode = status();
  } else {
    const head = fs.readFileSync(__filename, 'utf8').split('\n').slice(1);
    console.log(head.slice(0, head.findIndex(l => !l.startsWith('//'))).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exitCode = 1;
  }
}
