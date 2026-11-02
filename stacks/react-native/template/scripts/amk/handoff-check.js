#!/usr/bin/env node
// Agent hooks on the handoff in specs/<id>/progress.md.
// Stop: if code changed but the active spec's handoff block wasn't updated, ask the agent to update it. In an unattended
// build (scripts/amk/autopilot.js sets AMK_AUTOPILOT), it also keeps the feature of the branch going: a stop while it
// isn't done or blocked goes back to the agent, unless .amk/build/STOP is there, or the agent stops again with nothing
// changed since its last stop (no commit, no task ticked, the same next step), which autopilot.js treats as a stall.
// SessionStart, after a compaction: the active spec's handoff, its next task and the definition of done, read fresh from
// the files, so nothing the summary lost is missing.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
// the project this script is in (scripts/amk/): the agent may have moved into a subfolder
const root = path.join(__dirname, '..', '..');
const read = f => { try { return fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };
// (only the end trimmed: git status's lines start with a space)
const sh = cmd => { try { return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\s+$/, ''); } catch { return ''; } };

let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}
const unattended = Boolean(process.env.AMK_AUTOPILOT);

// a spec counts only when its handoff says "Status: in progress" (not done, not an untouched template copy)
const inProgress = d => {
  const f = path.join(root, 'specs', d, 'progress.md');
  return d !== '_templates' && fs.existsSync(f) && /^Status:\s*in progress/im.test(fs.readFileSync(f, 'utf8'));
};
const working = fs.existsSync(path.join(root, 'specs')) ? fs.readdirSync(path.join(root, 'specs')).filter(inProgress) : [];
// the feature of this branch (feature/<id>), where an unattended build works
const feature = (/^feature\/(.+)$/.exec(sh('git symbolic-ref --quiet --short HEAD')) || [])[1];
const own = feature && read(`specs/${feature}/progress.md`) !== null ? feature : null;

if (payload.hook_event_name === 'SessionStart') {
  const id = own || working[0];
  if (!id) process.exit(0);
  const p = read(`specs/${id}/progress.md`) || '';
  const handoff = (/^## Handoff[\s\S]*?(?=^## |(?![\s\S]))/m.exec(p) || [''])[0].trim();
  const next = ((read(`specs/${id}/tasks.md`) || '').split('\n').find(l => /^\s*- \[ \]/.test(l)) || 'none left').trim();
  const done = (/^## Definition of done\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(read('AGENTS.md') || '') || [])[1] || '';
  console.log([`After the compaction, from the files as they are now. The work in progress: specs/${id}.`, '', handoff, '',
    `Its next task (specs/${id}/tasks.md): ${next}`, ...(done.trim() ? ['', `Definition of done (AGENTS.md):${done.replace(/\s+$/, '')}`] : []),
    ...(unattended ? ['', 'Nobody is watching this build: record a blocked question under Blocked: in its progress.md instead of asking one.'] : [])].join('\n'));
  process.exit(0);
}

if (payload.stop_hook_active && !unattended) process.exit(0); // already reminded once; don't loop

// unattended: the feature's state at this stop (its last commit, ticked tasks and next step)
const progress = unattended && own ? read(`specs/${own}/progress.md`) || '' : null;
const state = progress === null ? null : JSON.stringify([sh('git rev-parse HEAD'),
  ((read(`specs/${own}/tasks.md`) || '').match(/^\s*- \[[xX]\]/gm) || []).length, (/^Next step:\s*(.*)$/m.exec(progress) || [])[1] || '']);

// code changed without the handoff: asked once (stop_hook_active: the agent goes on because of an earlier ask)
if ((working.length || progress !== null) && !payload.stop_hook_active) {
  const changed = sh('git status --porcelain --untracked-files=all') // every new file, not just its new folder
    .split('\n').filter(Boolean).map(l => l.slice(3));
  const codeChanged = changed.some(f => !f.startsWith('specs/') && !f.startsWith('.amk/'));
  const handoffUpdated = changed.some(f => /^specs\/[^/]+\/progress\.md$/.test(f));
  if (codeChanged && !handoffUpdated) {
    process.stderr.write('There are uncommitted code changes, but no specs/<id>/progress.md was updated. ' +
      'Update its handoff block (status, next step, decisions, last checks) before stopping.\n');
    process.exit(2);
  }
}

if (progress !== null) {
  // kept for the next stop, written whole (this never fails the agent): stopping again with nothing changed is going
  // in circles, and autopilot.js starts it again from the handoff
  const file = path.join(root, '.amk', 'build', own, 'stop-state.json');
  let before = null;
  try { before = JSON.parse(fs.readFileSync(file, 'utf8')).state; } catch {}
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ time: new Date().toISOString(), state }));
    fs.renameSync(`${file}.tmp`, file);
  } catch {}
  if (before === state) process.exit(0);
}

if (progress !== null && !fs.existsSync(path.join(root, '.amk', 'build', 'STOP'))) {
  const { NONE } = require('./specs.js');
  const done = /^Status:\s*done/im.test(progress);
  const blocked = !NONE.test((/^Blocked:\s*(.*?)\s*$/m.exec(progress) || [])[1] || '');
  if (!done && !blocked) {
    process.stderr.write(`Nobody is watching this build, so it doesn't stop here: specs/${own} isn't done or blocked. Go on with the next step in its handoff. ` +
      'If you can\'t, record why under Blocked: in its progress.md (what happened, why, and what would unblock it), commit, push, and stop.\n');
    process.exit(2);
  }
}
process.exit(0);
