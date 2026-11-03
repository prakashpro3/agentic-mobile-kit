#!/usr/bin/env node
// A feature's pull request once it's open, for the build (m-feature build, and autopilot.js between features):
//   node scripts/amk/pr.js checks [<branch>] [--wait <minutes>]   wait for its checks (30 minutes at most): exit 0 when
//        they pass, 1 when one failed, the failed jobs' last log lines after it as outside text, 2 without gh or a pull
//        request, 3 when they're still running at the time limit
//   node scripts/amk/pr.js automerge [<branch>]   turn on auto-merge, so GitHub merges once a person approves and the
//        checks pass: only with Reviewers: team, only where main requires an approval, and only for a pull request into
//        main (a stacked one waits until pr.js forward moves it there). With Reviewers: solo, your amk-ready label turns
//        it on, after your review
//   node scripts/amk/pr.js comments [<branch>]   its reviews and comments, as outside text
//   node scripts/amk/pr.js method   the merge method auto-merge uses (Merge method, or the first the repository allows)
//   node scripts/amk/pr.js forward   merge main into each of the build's branches whose parent pull request has merged:
//        a lockfile, Podfile.lock and the living spec take main's version, then are installed or merged again;
//        verify.sh quick checks the result; then it's pushed, and its pull request moved onto main. Exit 5 when a branch
//        has other conflicts or fails the check: that merge is undone, and the branch waits for a person
// <branch> is the one checked out unless named. Settings in docs/amk/team-process.md: Reviewers, Merge method.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { untrusted } = require('./redact.js');
const specs = require('./specs.js');

const ROOT = path.join(__dirname, '..', '..');
const read = f => { try { return fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 2 ** 26, ...opts });
const git = (...a) => { const r = sh('git', a); return r.status === 0 ? r.stdout.replace(/\n$/, '') : null; };
// docs/amk/team-process.md's "Settings for the agents": "- Reviewers: team" -> { reviewers: 'team' }
function settings(text = read(path.join(ROOT, 'docs/amk/team-process.md')) || '') {
  const body = (/^## Settings for the agents\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text.replace(/<!--[\s\S]*?-->/g, '')) || [])[1] || '';
  return Object.fromEntries([...body.matchAll(/^- ([^:\n]+?):\s*(.*?)\s*$/gm)].map(m => [m[1].toLowerCase(), m[2]]));
}
// GitHub through gh: JSON, text, or the whole result. A test passes its own
const IO = {
  gh: args => { const r = sh('gh', args, { timeout: 120000 }); try { return r.status === 0 || args[1] === 'checks' ? JSON.parse(r.stdout) : null; } catch { return null; } },
  ghText: args => { const r = sh('gh', args, { timeout: 120000 }); return r.status === 0 ? r.stdout : null; },
  ghRun: args => sh('gh', args, { timeout: 120000 }),
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  // where a wait stands, under .amk/: autopilot.js's stall watchdog counts a change there as activity
  note: t => { try { fs.mkdirSync(path.join(ROOT, '.amk'), { recursive: true }); fs.writeFileSync(path.join(ROOT, '.amk/pr-checks.txt'), `${new Date().toISOString()} ${t}\n`); } catch {} },
  now: Date.now,
  log: t => console.log(t),
};
const branchNow = () => git('symbolic-ref', '--quiet', '--short', 'HEAD');
const mainName = main => (main || '').replace(/^origin\//, '');

// ---------- checks: wait for them, and hand over a failure's log ----------
// a fine-grained token can't read checks (GitHub has no such permission for it), so when gh lists none, the GitHub Actions
// runs on the pull request's last commit, which "actions: read" covers
const runList = (pr, io) => (pr.headRefOid && io.gh(['run', 'list', '--commit', pr.headRefOid, '--json', 'workflowName,status,conclusion,url', '--limit', '50']) || []).map(r => ({
  name: r.workflowName, link: r.url,
  bucket: r.status !== 'completed' ? 'pending' : ['success', 'skipped', 'neutral'].includes(r.conclusion) ? 'pass' : r.conclusion === 'cancelled' ? 'cancel' : 'fail',
}));
function checkList(pr, io) {
  const list = io.gh(['pr', 'checks', String(pr.number), '--json', 'name,bucket,link,workflow']) || [];
  if (!list.length) return runList(pr, io);
  // a run that a newer one replaced on the same commit (a label added) leaves its failed or cancelled jobs listed until
  // the newer run's jobs start: while a run on this commit still goes, a failure isn't the result yet
  const going = list.some(c => c.bucket === 'fail' || c.bucket === 'cancel') && !list.some(c => c.bucket === 'pending')
    ? runList(pr, io).filter(r => r.bucket === 'pending') : [];
  return [...list, ...going];
}
// gh run view --log-failed writes "job<TAB>step<TAB>time text" lines: kept, a heading per job and step and the text
// without times or colours. The summary job (checks) only repeats which jobs failed, so it goes when another one did
function tidyLog(log) {
  const rows = log.split('\n').map(l => /^([^\t]+)\t([^\t]+)\t\uFEFF?(?:\d{4}-\d\d-\d\dT[\d:.]+Z ?)?(.*)$/.exec(l)).filter(Boolean)
    .map(m => ({ head: `${m[1]} › ${m[2]}`, job: m[1], text: m[3].replace(/\x1b\[[0-9;]*[A-Za-z]/g, '') }));
  if (!rows.length) return log;
  const kept = rows.some(r => r.job !== 'checks') ? rows.filter(r => r.job !== 'checks') : rows;
  return kept.map((r, i) => (i && kept[i - 1].head === r.head ? r.text : `== ${r.head}\n${r.text}`)).join('\n');
}
async function checks(branch, { waitMs = 30 * 60e3, pollMs = 30e3, firstMs = 3 * 60e3 } = {}, io = IO) {
  const pr = io.gh(['pr', 'view', branch, '--json', 'number,url,state,headRefOid']);
  if (!pr) { io.log(`No pull request for ${branch} here, or gh isn't signed in: no checks to wait for.`); return 2; }
  const start = io.now();
  let list;
  for (;;) {
    list = checkList(pr, io);
    const pending = list.filter(c => c.bucket === 'pending');
    io.note(`${pr.url}: ${list.length ? `waiting for ${pending.map(c => c.name).join(', ')}` : 'no checks reported yet'}`);
    if (list.length && !pending.length) break;
    // a repository without CI never reports any: after a few minutes, there's nothing to wait for
    if (!list.length && io.now() - start >= firstMs) { io.log(`No checks reported on ${pr.url}: nothing to wait for.`); return 0; }
    if (io.now() - start >= waitMs) {
      io.log(`Still running after ${Math.round(waitMs / 60e3)} minutes on ${pr.url}: ${pending.map(c => c.name).join(', ')}. Run it again later.`);
      return 3;
    }
    await io.sleep(pollMs);
  }
  const bad = list.filter(c => c.bucket === 'fail' || c.bucket === 'cancel');
  if (!bad.length) { io.log(`✓ the checks passed on ${pr.url}: ${list.map(c => c.name).join(', ')}`); return 0; }
  io.log(`✗ failed on ${pr.url}: ${bad.map(c => `${c.name}${c.bucket === 'cancel' ? ' (cancelled)' : ''}`).join(', ')}`);
  // each failed GitHub Actions run's failed steps, the end of their log; another CI's check, its link
  const runs = [...new Set(bad.map(c => (/\/actions\/runs\/(\d+)/.exec(c.link || '') || [])[1]).filter(Boolean))];
  for (const id of runs) {
    const log = tidyLog(io.ghText(['run', 'view', id, '--log-failed']) || '').split('\n');
    io.log(untrusted(`${log.length > 150 ? '(the last 150 lines)\n' : ''}${log.slice(-150).join('\n') || '(no log)'}`, `the failed steps' log of CI run ${id}`));
  }
  for (const c of bad.filter(x => !/\/actions\/runs\/\d+/.test(x.link || ''))) io.log(`  ${c.name}: ${c.link || 'no link'} (not GitHub Actions: open it to see why)`);
  return 1;
}

// ---------- auto-merge, once a person approves ----------
function mergeMethod(cfg, io) {
  const set = (/^(merge|squash|rebase)$/i.exec(cfg['merge method'] || '') || [])[1];
  if (set) return set.toLowerCase();
  const repo = io.gh(['repo', 'view', '--json', 'mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed']) || {};
  return repo.mergeCommitAllowed === false ? (repo.squashMergeAllowed === false ? 'rebase' : 'squash') : 'merge';
}
function automerge(branch, main, cfg = settings(), io = IO) {
  if (/^solo$/i.test(cfg.reviewers || '')) {
    io.log('Reviewers: solo, so auto-merge waits for your amk-ready label, which you add once you\'ve reviewed the pull request.');
    return 0;
  }
  const pr = io.gh(['pr', 'view', branch, '--json', 'number,url,state,baseRefName,autoMergeRequest,reviewDecision']);
  if (!pr) { io.log(`No pull request for ${branch} here, or gh isn't signed in.`); return 2; }
  if (pr.state !== 'OPEN') { io.log(`${pr.url} is ${pr.state.toLowerCase()}.`); return 0; }
  if (pr.baseRefName !== mainName(main)) {
    io.log(`${pr.url} goes into ${pr.baseRefName}: auto-merge waits until it goes into ${mainName(main)}, once ${pr.baseRefName} has merged (pr.js forward moves it).`);
    return 0;
  }
  if (pr.autoMergeRequest) { io.log(`Auto-merge is on already for ${pr.url}.`); return 0; }
  // GitHub gives no review decision where main requires no approval: there, auto-merge would merge without a person
  if (!pr.reviewDecision) {
    io.log(`${pr.url}: ${mainName(main)} requires no approval here, so auto-merge would merge it without a person's. It's left for a person to merge (to have the build turn auto-merge on, require an approval: docs/branch-protection.md in the kit).`);
    return 0;
  }
  const method = mergeMethod(cfg, io);
  const r = io.ghRun(['pr', 'merge', String(pr.number), '--auto', `--${method}`]);
  if (r.status === 0) { io.log(`Auto-merge on for ${pr.url} (${method}): it merges once a person approves and the checks pass.`); return 0; }
  const why = `${r.stderr || ''}${r.stdout || ''}`.trim().split('\n').pop();
  io.log(`Auto-merge couldn't be turned on for ${pr.url}: ${why}${/not allowed|auto.?merge/i.test(why) ? ' (turn on "Allow auto-merge" in the repository\'s settings: docs/branch-protection.md in the kit)' : ''}`);
  return 1;
}

// ---------- reviews and comments, as outside text ----------
function comments(branch, io = IO) {
  const pr = io.gh(['pr', 'view', branch, '--json', 'number,url,reviews,comments']);
  if (!pr) { io.log(`No pull request for ${branch} here, or gh isn't signed in.`); return 2; }
  const repo = io.gh(['repo', 'view', '--json', 'nameWithOwner']) || {};
  const inline = (repo.nameWithOwner && io.gh(['api', `repos/${repo.nameWithOwner}/pulls/${pr.number}/comments`, '--paginate'])) || [];
  const items = [
    ...(pr.reviews || []).filter(r => (r.body || '').trim() || r.state === 'CHANGES_REQUESTED').map(r => ({ at: r.submittedAt, text: `${(r.author || {}).login || 'someone'}, review (${String(r.state || '').toLowerCase().replace(/_/g, ' ')}):\n${r.body || ''}` })),
    ...(pr.comments || []).map(c => ({ at: c.createdAt, text: `${(c.author || {}).login || 'someone'}:\n${c.body}` })),
    ...inline.map(c => ({ at: c.created_at, text: `${(c.user || {}).login || 'someone'} on ${c.path}${c.line ? `:${c.line}` : ''}:\n${c.body}` })),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  if (!items.length) { io.log(`No reviews or comments on ${pr.url} yet.`); return 0; }
  io.log(untrusted(items.map(i => i.text).join('\n\n---\n\n'), `the reviews and comments on pull request #${pr.number}`));
  return 0;
}

// ---------- merging main forward into stacked branches ----------
const LOCKS = /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/;
// a merge with main whose conflicts have a known answer: main's version, then the step that redoes this branch's part
function settle(id) {
  const conflicts = (git('diff', '--name-only', '--diff-filter=U') || '').split('\n').filter(Boolean);
  const known = conflicts.filter(f => LOCKS.test(f) || f === 'ios/Podfile.lock' || /^specs\/current\/[^/]+\.md$/.test(f));
  const rest = conflicts.filter(f => !known.includes(f));
  if (rest.length) return { rest };
  for (const f of known) { git('checkout', '--theirs', '--', f); git('add', '--', f); }
  return { rest: [], spec: known.some(f => f.startsWith('specs/current/')), lock: known.some(f => LOCKS.test(f)), pods: known.includes('ios/Podfile.lock'), id };
}
function forward(main, { check = true } = {}, cfg = settings(), io = IO) {
  if (!main) { io.log('No main branch found: set AMK_BASE to the branch features start from.'); return 1; }
  if (git('status', '--porcelain', '--untracked-files=no')) { io.log('Commit the changes here first: merging main forward needs a clean folder.'); return 1; }
  // a parent merged on GitHub since the last fetch counts
  specs.fetchOrigin();
  const ref = specs.planRef();
  const plan = ref && specs.show(ref, 'specs/plan.md');
  if (!plan) return 0;
  const built = specs.builtOn(main);
  const was = branchNow();
  let code = 0;
  for (const r of specs.planFeatures(plan).rows) {
    const b = `feature/${r.id}`;
    if (built.has(r.id) || git('rev-parse', '--verify', '--quiet', `refs/heads/${b}`) === null) continue;
    // its pull request's base, from the start line specs.js start wrote: a stacked branch's parent
    const parent = (/its PR goes to ([^)\s]+)\)/.exec(git('show', `${b}:specs/${r.id}/progress.md`) || '') || [])[1];
    const parentId = parent && (/^feature\/(.+)$/.exec(parent) || [])[1];
    if (!parentId || !built.has(parentId)) continue;
    if (git('merge-base', '--is-ancestor', main, b) === null) {
      git('switch', '--quiet', b);
      const before = git('rev-parse', 'HEAD');
      let s = { rest: [] };
      if (git('merge', '--no-edit', '--quiet', main) === null) {
        s = settle(r.id);
        if (s.rest.length || git('commit', '--no-edit', '--quiet') === null) {
          git('merge', '--abort');
          io.log(`${b}: main can't be merged in without a person: ${s.rest.length ? `conflicts in ${s.rest.join(', ')}` : 'the merge commit was refused (see the hook\'s message)'}. Merge main into it by hand, then push.`);
          code = 5;
          continue;
        }
      }
      const changed = (git('diff', '--name-only', before, 'HEAD') || '').split('\n');
      if (s.lock || changed.some(f => LOCKS.test(f))) sh('sh', ['scripts/amk/install-deps.sh'], { stdio: 'ignore' });
      if ((s.pods || changed.includes('ios/Podfile.lock')) && process.platform === 'darwin') sh('sh', ['scripts/amk/pod-install.sh'], { stdio: 'ignore' });
      if (s.spec) {
        sh(process.execPath, ['scripts/amk/specs.js', 'merge', r.id], { stdio: 'ignore' });
        git('add', '--', 'specs/current/');
        git('commit', '--quiet', '-m', `docs(spec): ${r.id} merged into the living spec again, after main\n\nSpec: specs/${r.id}`);
      }
      if (check && sh('sh', ['scripts/amk/verify.sh', 'quick'], { stdio: 'ignore' }).status !== 0) {
        git('reset', '--quiet', '--keep', before);
        if (s.lock || changed.some(f => LOCKS.test(f))) sh('sh', ['scripts/amk/install-deps.sh'], { stdio: 'ignore' });
        io.log(`${b}: with main merged in, verify.sh quick fails, so the merge is undone. Merge main into it by hand and fix what breaks.`);
        code = 5;
        continue;
      }
      io.log(`${b}: main merged in${s.lock ? ', the lockfile taken from main and installed again' : ''}${s.pods ? ', the pods installed again' : ''}${s.spec ? ', its living spec merged again' : ''}${check ? ', verify.sh quick passes' : ''}.`);
      if (git('remote')) sh('git', ['push', '--quiet', 'origin', b], { stdio: 'ignore', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    }
    // its pull request goes into main now that the parent has merged (GitHub moves it only when the parent's branch is deleted)
    const pr = io.gh(['pr', 'view', b, '--json', 'number,url,baseRefName,state']);
    if (pr && pr.state === 'OPEN' && pr.baseRefName !== mainName(main)) {
      io.ghRun(['pr', 'edit', String(pr.number), '--base', mainName(main)]);
      io.log(`${pr.url} goes into ${mainName(main)} now.`);
    }
    if (pr && pr.state === 'OPEN') automerge(b, main, cfg, io);
  }
  if (was && branchNow() !== was) git('switch', '--quiet', was);
  return code;
}

module.exports = { checks, automerge, comments, forward, settings, mergeMethod, IO };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = n => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
  const [cmd, named] = [args[0], args[1] && !args[1].startsWith('--') ? args[1] : null];
  process.chdir(ROOT);
  const branch = named || branchNow();
  const main = specs.mainRef();
  const done = c => { process.exitCode = c; };
  if (cmd === 'checks') checks(branch, { waitMs: (parseFloat(opt('--wait')) || 30) * 60e3 }).then(done);
  else if (cmd === 'automerge') done(automerge(branch, main));
  else if (cmd === 'comments') done(comments(branch));
  else if (cmd === 'forward') done(forward(main));
  else if (cmd === 'method') console.log(mergeMethod(settings(), IO));
  else {
    const head = fs.readFileSync(process.argv[1], 'utf8').split('\n').slice(1);
    console.error(head.slice(0, head.findIndex(l => !l.startsWith('//'))).map(l => l.slice(3)).join('\n'));
    done(2);
  }
}
