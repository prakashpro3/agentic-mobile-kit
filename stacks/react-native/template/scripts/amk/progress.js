#!/usr/bin/env node
// Where the kit's long runs stand, for the status line and `node scripts/amk/status.js --watch`: a small JSON file per
// run in .amk/progress/ (what it is, its stage, how far: done of total, what it's on, since when), written as it goes,
// and the length of the last run of each kind that passed, as a guide to how long the next one takes.
//   node scripts/amk/progress.js set <key> --pid <pid> --title <title> [--kind <k>] [--stage <s>] [--done <n>] [--total <n>] [--label <l>]
//   node scripts/amk/progress.js end <key> [--result passed|failed]      or, for every run of a process, end-pid <pid>
// A run whose process is gone (killed, crashed) is left out when it's read, and its file removed.
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', '.amk', 'progress');
const HISTORY = path.join(DIR, 'history.json');
const file = key => path.join(DIR, `${String(key).replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
// written whole: a reader never sees half a file
function writeJson(f, value) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value)}\n`);
  fs.renameSync(tmp, f);
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// a run's record: kept from the last call, so a stage can change without repeating the title
function set(key, fields, now = Date.now()) {
  const was = readJson(file(key)) || {};
  // a new stage starts its own count
  const fresh = fields.stage !== undefined && fields.stage !== was.stage;
  const kept = fresh ? (({ done, total, label, ...rest }) => rest)(was) : was;
  const next = { ...kept, ...fields, key, started: was.started || now, updated: now };
  if (fresh) next.stageStarted = now;
  if (!next.pid) next.pid = process.pid;
  try { writeJson(file(key), next); } catch {}
  return next;
}
// done: the record goes, and how long it took, when it passed, stays as the guide for its kind (one that failed or
// stopped part of the way says little about the next)
function end(key, result, now = Date.now()) {
  const r = readJson(file(key));
  try { fs.rmSync(file(key), { force: true }); } catch {}
  if (!r || result !== 'passed') return r;
  const history = readJson(HISTORY) || {};
  history[r.kind || r.title] = { ms: now - r.started, at: now };
  try { writeJson(HISTORY, history); } catch {}
  return r;
}
const endPid = pid => runs({ all: true }).filter(r => String(r.pid) === String(pid)).map(r => end(r.key));

// the runs going on now, oldest first, each with its kind's last length; those whose process is gone are cleared away
function runs({ all = false } = {}) {
  let names = [];
  try { names = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'history.json'); } catch { return []; }
  const history = readJson(HISTORY) || {};
  return names.map(f => readJson(path.join(DIR, f))).filter(Boolean).filter(r => {
    if (all || alive(r.pid)) return true;
    try { fs.rmSync(file(r.key), { force: true }); } catch {}
    return false;
  }).map(r => ({ ...r, last: history[r.kind || r.title] || null })).sort((a, b) => a.started - b.started);
}

module.exports = { set, end, endPid, runs, writeJson, DIR };

if (require.main === module) {
  const [cmd, key, ...rest] = process.argv.slice(2);
  const opt = n => (rest.includes(`--${n}`) ? rest[rest.indexOf(`--${n}`) + 1] : undefined);
  const num = n => (opt(n) === undefined ? undefined : Number(opt(n)));
  if (cmd === 'set' && key) {
    const fields = { title: opt('title'), kind: opt('kind'), stage: opt('stage'), label: opt('label'), done: num('done'), total: num('total'), pid: num('pid') };
    set(key, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && !Number.isNaN(v))));
  } else if (cmd === 'end' && key) end(key, opt('result'));
  else if (cmd === 'end-pid' && key) endPid(key);
  else { console.error('usage: progress.js set <key> --pid <pid> --title <title> [--kind k] [--stage s] [--done n] [--total n] [--label l] | end <key> [--result passed] | end-pid <pid>'); process.exitCode = 2; }
}
