#!/usr/bin/env node
// Agent stop hook. If code changed but the active spec's handoff block wasn't updated, ask the agent to update it.
const fs = require('fs');
const { execSync } = require('child_process');

let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}
if (payload.stop_hook_active) process.exit(0); // already reminded once; don't loop

// a spec counts only when its handoff says "Status: in progress" (not done, not an untouched template copy)
const inProgress = d => {
  const f = `specs/${d}/progress.md`;
  return d !== '_templates' && fs.existsSync(f) && /^Status:\s*in progress/im.test(fs.readFileSync(f, 'utf8'));
};
const specs = fs.existsSync('specs') ? fs.readdirSync('specs').filter(inProgress) : [];
if (specs.length === 0) process.exit(0); // no spec in progress (quick change, bug fix, or finished work)

const changed = execSync('git status --porcelain', { encoding: 'utf8' })
  .split('\n').filter(Boolean).map(l => l.slice(3));
const codeChanged = changed.some(f => !f.startsWith('specs/') && !f.startsWith('.amk/'));
const handoffUpdated = changed.some(f => /^specs\/[^/]+\/progress\.md$/.test(f));

if (codeChanged && !handoffUpdated) {
  process.stderr.write('There are uncommitted code changes, but no specs/<id>/progress.md was updated. ' +
    'Update its handoff block (status, next step, decisions, last checks) before stopping.\n');
  process.exit(2);
}
process.exit(0);
