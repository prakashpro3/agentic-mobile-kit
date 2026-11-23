#!/usr/bin/env node
// Agent hooks on the handoff in specs/<id>/progress.md.
// Stop: if code changed but the active spec's handoff block wasn't updated, ask the agent to update it. In an unattended
// build (scripts/amk/autopilot.js sets AMK_AUTOPILOT), it also keeps the feature of the branch going: a stop while it
// isn't done or blocked goes back to the agent, unless .amk/build/STOP is there, or the agent stops again with nothing
// changed since its last stop (no commit, no task ticked, the same next step), which autopilot.js treats as a stall.
// Both: a feature marked done whose requirements never reached the living spec is asked to merge them first.
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
// by the folder's own spelling: on macOS and Windows a branch spelled in another case opens it too (feature/orders-mobile,
// specs/ORDERS-MOBILE/), and specs.js writes the folder's name (Source: specs/ORDERS-MOBILE) (issues #16, #17)
const own = feature ? ((() => { try { return fs.readdirSync(path.join(root, 'specs')); } catch { return []; } })()
  .find(d => d.toLowerCase() === feature.toLowerCase() && read(`specs/${d}/progress.md`) !== null) || null) : null;

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

// the turn really ends here (nothing below asks to go on): the status line hears of it, and the developer, who may be in
// another window, is told
const ends = () => {
  try { require('./status.js').mark(payload, { ended: Date.now() }); } catch {}
  try { require('./notify.js').notify({ ...payload, hook_event_name: 'Stop' }); } catch {}
  process.exit(0);
};

if (payload.stop_hook_active && !unattended) ends(); // already reminded once; don't loop

// unattended: the feature's state at this stop (its last commit, ticked tasks and next step)
const progress = unattended && own ? read(`specs/${own}/progress.md`) || '' : null;
const state = progress === null ? null : JSON.stringify([sh('git rev-parse HEAD'),
  ((read(`specs/${own}/tasks.md`) || '').match(/^\s*- \[[xX]\]/gm) || []).length, (/^Next step:\s*(.*)$/m.exec(progress) || [])[1] || '']);

// code changed without the handoff: asked once (stop_hook_active: the agent goes on because of an earlier ask). Not
// while something the agent started still runs (Claude Code's background_tasks: a device run, a subagent): it comes
// back when that ends, and is asked at the stop that really ends its work
const running = Array.isArray(payload.background_tasks) && payload.background_tasks.length > 0;
if ((working.length || progress !== null) && !payload.stop_hook_active && !running) {
  // every new file, not just its new folder; but not a new link, such as the project's node_modules linked into a git
  // worktree: no session writes code that way, and it would ask at every stop
  const link = f => { try { return fs.lstatSync(path.join(root, f)).isSymbolicLink(); } catch { return false; } };
  const changed = sh('git status --porcelain --untracked-files=all')
    .split('\n').filter(Boolean).filter(l => !(l.startsWith('?? ') && link(l.slice(3)))).map(l => l.slice(3));
  // not the AI tool's worktrees inside the project (Claude Code's .claude/worktrees/): another session's work
  // nor a screenshot Maestro left in .maestro/ (a device run stopped halfway): never the app's code
  const code = changed.filter(f => !f.startsWith('specs/') && !f.startsWith('.amk/') && !f.startsWith('.claude/worktrees/') && !/^\.maestro\/.*\.png$/i.test(f));
  // a handoff written after the last code change is current, committed or not: an older change (the developer's own
  // local setting, never meant for a commit) doesn't ask again at every stop once the handoff is committed. A deleted
  // file has no time
  const mtime = f => { try { return fs.statSync(path.join(root, f)).mtimeMs; } catch { return 0; } };
  const handoffAt = Math.max(0, ...[...working, ...(own ? [own] : [])].map(id => mtime(`specs/${id}/progress.md`)));
  const handoffUpdated = changed.some(f => /^specs\/[^/]+\/progress\.md$/.test(f)) || handoffAt > Math.max(0, ...code.map(mtime));
  if (code.length && !handoffUpdated) {
    process.stderr.write('There are uncommitted code changes, but no specs/<id>/progress.md was updated. ' +
      'Update its handoff block (status, next step, decisions, last checks) before stopping.\n');
    process.exit(2);
  }
}

// a feature marked done whose requirements never reached the living spec (specs.js merge writes "Source: specs/<id>"
// beside each one it adds or changes): asked once, as the living spec must say what ships
if (own && !payload.stop_hook_active) {
  const req = read(`specs/${own}/requirements.md`) || '';
  const changes = /^## (?:ADDED|MODIFIED) Requirements/m.test(req) && /^### Requirement:/m.test(req);
  let merged = false;
  // in any case: a merge run with the branch's spelling, before specs.js used the folder's, wrote that
  try { merged = fs.readdirSync(path.join(root, 'specs', 'current')).some(f => f.endsWith('.md') && (read(`specs/current/${f}`) || '').toLowerCase().includes(`source: specs/${own.toLowerCase()}\n`)); } catch {}
  if (changes && !merged && /^Status:\s*done/im.test(read(`specs/${own}/progress.md`) || '')) {
    process.stderr.write(`specs/${own} says done, but its requirements aren't in the living spec (no "Source: specs/${own}" in specs/current/): ` +
      `run node scripts/amk/specs.js merge ${own} and commit specs/current/ with the feature. Then finish what's left of it (its review and pull request) before you stop.\n`);
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

// a turn ends at a reply: one that says the agent goes on ("I'm continuing with task 15"), asks nothing, and leaves
// nothing running that would bring it back (Claude Code says what runs in background_tasks) leaves the work idle
// until the developer comes back. Sent back once
if (!unattended && Array.isArray(payload.background_tasks) && !payload.background_tasks.length) {
  let said = typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message : '';
  try { said = said || require('./notify.js').lastWords(payload); } catch {}
  said = String(said || '').replace(/[\u2018\u2019]/g, "'");
  // only when it's known that the reply asks nothing
  let asks = null;
  try { asks = require('./status.js').asks(said); } catch {}
  const GOES_ON = /\b(?:I'm|I am|I'll|I will)\s+(?:now\s+)?(?:continu\w*|go(?:ing)? (?:on|ahead)|mov(?:e|ing) on|carry(?:ing)? on|keep(?:ing)? going|proceed\w*|start(?:ing)? (?:on |with )?(?:task|the next|step))\b|\bnext,? I(?:'ll| will|'m| am)\b|^\s*(?:Moving on|Continuing|Going on) (?:to|with)\b/im;
  const promise = GOES_ON.exec(said);
  if (promise && asks === '') {
    process.stderr.write(`You said you go on ("${said.slice(promise.index, promise.index + 80).split('\n')[0].trim()}…"), but this reply ends your turn, and nothing you started is running to bring you back: the work waits until the user returns. Go on now, with the next step's tools. If you need the user, ask them instead.\n`);
    process.exit(2);
  }
}
ends();
