#!/usr/bin/env node
// Finishes the tool configs rulesync generates from .rulesync/, as the kit needs them. Run it after
// `npx -y rulesync@27.0.0 generate`: init and sync do, and so do CI's and doctor's checks that the configs match .rulesync/.
//   - Antigravity's Stop hooks become a plain list of handlers: rulesync before 40 writes them in the matcher shape, which
//     Antigravity rejects, dropping the whole hook set, the guard included
//   - Codex asks with options to pick from (request_user_input) in every mode, not only in plan mode: rulesync writes no
//     [features] table, and Codex reads it from the project's config once the folder is trusted
//   - Codex shows its plan as a checklist while it works (update_plan, off since Codex 0.152), in step with the spec's tasks
//   - Claude Code shows what's going on under the prompt (scripts/amk/status.js, every 2 seconds), the spec's tasks
//     included. rulesync has no statusLine, and keeps it once it's there. A team's own status line in the project's
//     settings stays
// Usage: node scripts/amk/tool-configs.js (in the project's folder)
'use strict';
const fs = require('fs');
const path = require('path');

const read = f => { try { return fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };

function flattenAntigravityStop(dir) {
  const file = path.join(dir, '.agents/hooks.json');
  let hooks;
  try { hooks = JSON.parse(read(file)); } catch { return; }
  let changed = false;
  for (const set of Object.values(hooks || {})) {
    if (!set || !Array.isArray(set.Stop) || !set.Stop.some(e => e && Array.isArray(e.hooks) && !e.command)) continue;
    set.Stop = set.Stop.flatMap(e => (e && Array.isArray(e.hooks) && !e.command ? e.hooks : [e]));
    changed = true;
  }
  if (changed) fs.writeFileSync(file, `${JSON.stringify(hooks, null, 2)}\n`);
}

function codexQuestions(dir) {
  const file = path.join(dir, '.codex/config.toml');
  const text = read(file);
  if (text === null || /^\s*default_mode_request_user_input\s*=/m.test(text)) return;
  const on = 'default_mode_request_user_input = true';
  fs.writeFileSync(file, /^\[features\][ \t]*$/m.test(text) ? text.replace(/^\[features\][ \t]*$/m, `[features]\n${on}`)
    : `${text.replace(/\n*$/, '\n')}\n# agentic-mobile-kit: questions as options to pick from, in every mode\n[features]\n${on}\n`);
}

function codexPlan(dir) {
  const file = path.join(dir, '.codex/config.toml');
  const text = read(file);
  if (text === null || /^[^#\n]*\bupdate_plan\b/m.test(text)) return;
  fs.writeFileSync(file, `${text.replace(/\n*$/, '\n')}\n# agentic-mobile-kit: the plan as a checklist while it works, in step with the spec's tasks\n[tools.update_plan]\nenabled = true\n`);
}

// found from wherever Claude Code runs it, as the hooks are (.rulesync/hooks.jsonc)
const STATUS_LINE = { type: 'command', command: "node -e \"const f = require('child_process').execSync('git rev-parse --show-toplevel').toString().trim() + '/scripts/amk/status.js'; if (require('fs').existsSync(f)) require(f).statusLine()\"", refreshInterval: 2 };
function claudeStatus(dir) {
  const file = path.join(dir, '.claude/settings.json');
  let settings;
  try { settings = JSON.parse(read(file)); } catch { return; }
  if (!settings || typeof settings !== 'object') return;
  const before = JSON.stringify(settings);
  if (!settings.statusLine || /scripts\/amk\/status\.js/.test(settings.statusLine.command || '')) settings.statusLine = STATUS_LINE;
  if (JSON.stringify(settings) !== before) fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

const afterGenerate = dir => { flattenAntigravityStop(dir); codexQuestions(dir); codexPlan(dir); claudeStatus(dir); };

module.exports = { afterGenerate, flattenAntigravityStop, codexQuestions, codexPlan, claudeStatus, STATUS_LINE };

if (require.main === module) afterGenerate(process.cwd());
