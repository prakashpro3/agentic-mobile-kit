#!/usr/bin/env node
// Whether this checkout's copies of the kit's files that git ignores (a team keeps .rulesync/ or .githooks/ out of git,
// and with them the tool configs made from .rulesync/) are from another kit version than its AGENTS.md and scripts/amk/.
// Each checkout has its own copies: a sync in a git worktree updates only the files git carries to the others. sync
// writes the version they're at into .amk/kit-version.
// Usage: require('./stale-kit.js')(root) → a sentence saying what to do, or '' when nothing is to do
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

module.exports = function staleKit(root = process.cwd()) {
  const read = f => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return null; } };
  const kit = (/KIT:START agentic-mobile-kit (\d[^\s>]*)/.exec(read('AGENTS.md') || '') || [])[1];
  if (!kit) return '';
  try { execFileSync('git', ['check-ignore', '-q', '.rulesync/hooks.jsonc'], { cwd: root, stdio: 'ignore' }); } catch { return ''; }
  const here = (read('.amk/kit-version') || '').trim();
  if (here === kit) return '';
  return `this checkout's copies of the kit's files kept out of git (.rulesync/, .githooks/, the tool configs) aren't from kit ${kit}, `
    + `which AGENTS.md and scripts/amk/ have${here ? ` (they're from ${here})` : ''}, so its hooks, subagents and status line may be older: `
    + 'run npx agentic-mobile-kit@latest sync in this folder';
};
