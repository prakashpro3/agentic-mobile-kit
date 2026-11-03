#!/usr/bin/env node
// The AI jobs in CI (.github/workflows/amk-ai-review.yml and amk-ai-deps.yml, added with --ci github,ai): who may start
// one, and when it stops. GitHub's own variables (GITHUB_EVENT_PATH, GITHUB_REPOSITORY, GITHUB_WORKFLOW_REF, …) and gh
// (GH_TOKEN) tell it the rest.
//   node scripts/amk/ai-job.js gate <job>   go=true or go=false, as a GitHub Actions output, and why:
//     - only a person with write access to the repository starts one; for the dependency job (deps), Dependabot or
//       Renovate too. Never the AI jobs' own app or another bot, and never a commit an AI job's fix made (its
//       "AMK-Agent-Fix: <job>" trailer)
//     - not while the job is paused: an open issue "AI job paused: <job>" (close it to resume the job)
//     - the loop guard: not after 3 of its fix commits in a row on the branch, nor after 6 runs in the last hour; the
//       dependency job once per failed CI run
//     - nothing when docs/amk/team-process.md, where its settings are, can't be read
//   node scripts/amk/ai-job.js after <job> <result>   after a run that went: a third failure in a row (a timeout or a
//     cancel counts; a run that didn't go doesn't) pauses the job, opening that issue
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const BOTS = { deps: ['dependabot[bot]', 'renovate[bot]'] };
const IN_A_ROW = 3;
const PER_HOUR = 6;
const trailer = job => new RegExp(`^AMK-Agent-Fix: ${job}\\b`, 'm');
const paused = job => `AI job paused: ${job}`;

// gh, as JSON or text; a test passes its own
const ghReal = args => {
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 2 ** 26, timeout: 60000 });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return r.stdout.trim(); }
};
function context(env = process.env, gh = ghReal) {
  let event = {};
  try { event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8')); } catch {}
  return { event, gh, env, repo: env.GITHUB_REPOSITORY, workflow: path.basename(String(env.GITHUB_WORKFLOW_REF || '').split('@')[0]), now: Date.now(),
    settings: fs.existsSync(path.join(ROOT, 'docs/amk/team-process.md')) };
}

function gate(job, c) {
  const no = why => ({ go: false, why });
  if (!c.settings) return no('docs/amk/team-process.md can\'t be read, so the job does nothing');
  const open = c.gh(['issue', 'list', '--repo', c.repo, '--state', 'open', '--search', `"${paused(job)}" in:title`, '--json', 'title']);
  if (!Array.isArray(open)) return no('its state can\'t be read (gh), so the job does nothing');
  if (open.some(i => i.title === paused(job))) return no(`paused: close the issue "${paused(job)}" to resume it`);
  // who started it, and on which branch and commit
  const run = c.event.workflow_run;
  const pr = c.event.pull_request || {};
  const who = run ? (run.triggering_actor || run.actor || {}).login : (c.event.sender || {}).login;
  const branch = run ? run.head_branch : (pr.head || {}).ref;
  const sha = run ? run.head_sha : (pr.head || {}).sha;
  if (!who) return no('nobody started it');
  if (run && (run.head_repository || {}).full_name !== c.repo) return no('a change from another repository');
  if (/\[bot\]$/.test(who) && !(BOTS[job] || []).includes(who)) return no(`started by ${who}, a bot`);
  if (!/\[bot\]$/.test(who)) {
    const p = c.gh(['api', `repos/${c.repo}/collaborators/${encodeURIComponent(who)}/permission`, '--jq', '.permission']);
    if (!['admin', 'maintain', 'write'].includes(p)) return no(`${who} doesn't have write access to the repository`);
  }
  if (job === 'deps' && !(BOTS.deps || []).includes(who)) return no(`not a dependency update (started by ${who})`);
  // the branch's latest commits: an AI fix's own commit doesn't start a job, and 3 in a row stop it
  const commits = (sha && c.gh(['api', `repos/${c.repo}/commits?sha=${sha}&per_page=${IN_A_ROW + 1}`, '--jq', '[.[].commit.message]'])) || [];
  if (commits.length && trailer('[a-z-]+').test(commits[0]) && job !== 'deps') return no('the latest commit is an AI job\'s fix');
  let row = 0;
  while (row < commits.length && trailer(job).test(commits[row])) row++;
  if (row >= IN_A_ROW) return no(`${row} of its fix commits in a row on ${branch}: a person takes it from here`);
  if (job === 'deps' && commits.some(m => m.includes(`(CI run ${run.id})`))) return no(`CI run ${run.id} was fixed once already`);
  const since = new Date(c.now - 3600e3).toISOString();
  const recent = c.gh(['run', 'list', '--repo', c.repo, '--workflow', c.workflow, '--created', `>=${since}`, '--json', 'databaseId', '--limit', '50']) || [];
  if (recent.length > PER_HOUR) return no(`${recent.length} runs in the last hour: it waits`);
  return { go: true, why: `started by ${who} on ${branch}` };
}

// after a run that went: a third failure in a row (runs that didn't go left out) pauses the job
function after(job, result, c) {
  if (result === 'success') return { paused: false };
  const runs = c.gh(['run', 'list', '--repo', c.repo, '--workflow', c.workflow, '--status', 'completed', '--json', 'databaseId', '--limit', '10']) || [];
  const results = [];
  for (const r of runs) {
    if (String(r.databaseId) === String(c.env.GITHUB_RUN_ID)) continue;
    const jobs = (c.gh(['run', 'view', String(r.databaseId), '--repo', c.repo, '--json', 'jobs']) || {}).jobs || [];
    const j = jobs.find(x => x.name === job);
    if (!j || j.conclusion === 'skipped') continue;
    results.push(j.conclusion);
    if (results.length >= IN_A_ROW - 1) break;
  }
  if (results.length < IN_A_ROW - 1 || results.some(r => r === 'success')) return { paused: false };
  const body = `The AI job "${job}" failed ${IN_A_ROW} times in a row (the last one: ${result}), so it paused itself: it starts no run until this issue is closed. Look at its runs (the Actions tab, workflow ${c.workflow}), fix what fails, then close this issue to resume it.`;
  c.gh(['issue', 'create', '--repo', c.repo, '--title', paused(job), '--body', body]);
  return { paused: true };
}

module.exports = { gate, after, context, IN_A_ROW, PER_HOUR };

if (require.main === module) {
  const [cmd, job, result] = process.argv.slice(2);
  if (!['gate', 'after'].includes(cmd) || !job) { console.error('usage: node scripts/amk/ai-job.js gate <job> | after <job> <result>'); process.exit(2); }
  const c = context();
  if (cmd === 'gate') {
    const g = gate(job, c);
    console.error(`${job}: ${g.go ? 'goes' : 'does nothing'}: ${g.why}`);
    console.log(`go=${g.go}`);
  } else {
    const a = after(job, result || 'failure', c);
    console.log(a.paused ? `${job} paused itself after ${IN_A_ROW} failures in a row: an issue says so` : `${job}: ${result}`);
  }
}
