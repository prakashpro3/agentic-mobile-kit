#!/usr/bin/env node
// The team's numbers for the monthly review (docs/amk/team-process.md), from git, GitHub (through gh, when it's signed
// in) and the unattended build's logs: pull request size, the wait for a first review, CI's failure rate, reopened
// issues, the time from a spec's approval to its pull request, where the features stand, how many of the agents' pull
// requests merged and how many needed rework first, and the unattended sessions. Markdown, for the review.
//   node scripts/amk/metrics.js [--since <date, or a span such as 30d>]   (default: the last 30 days)
//   node scripts/amk/metrics.js --comments [--since …]   the period's review comments and the reasons kept with amk-ok,
//        as outside text: m-learn reads them for the ones that keep coming back
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { untrusted } = require('./redact.js');

const ROOT = path.join(__dirname, '..', '..');
const sh = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 2 ** 27, timeout: 180000 });
const IO = {
  gh: args => { const r = sh('gh', args); try { return r.status === 0 ? JSON.parse(r.stdout) : null; } catch { return null; } },
  git: args => { const r = sh('git', args); return r.status === 0 ? r.stdout : ''; },
  read: f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return null; } },
  list: d => { try { return fs.readdirSync(path.join(ROOT, d)); } catch { return []; } },
  now: () => Date.now(),
};

const DAY = 864e5;
const median = xs => { const s = xs.filter(x => x != null && !Number.isNaN(x)).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const at = s => Date.parse(s);
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const hours = ms => (ms < 2 * DAY ? `${round(ms / 36e5)} h` : `${round(ms / DAY)} days`);
// "30d" or "2026-10-01": the period's first day, as YYYY-MM-DD
function sinceDate(arg, now) {
  const n = /^(\d+)d$/.exec(arg || '30d');
  if (n) return new Date(now - Number(n[1]) * DAY).toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : null;
}
// the period's pull requests, through a query of its own: gh pr list --json reviews,commits asks GitHub for every commit's
// authors too, past what one query may ask (500,000 nodes). ponytail: the first 100 pull requests of the period
const QUERY = `query($q: String!) { search(query: $q, type: ISSUE, first: 100) { nodes { ... on PullRequest {
  number headRefName author { login } createdAt mergedAt state additions deletions
  reviews(first: 30) { nodes { author { login } state submittedAt body } }
  commits(first: 50) { nodes { commit { message committedDate } } } } } } }`;
function pullRequests(repo, from, io) {
  const r = io.gh(['api', 'graphql', '-f', `query=${QUERY}`, '-f', `q=repo:${repo} is:pr created:>=${from}`]);
  const nodes = r && r.data && r.data.search && r.data.search.nodes;
  return Array.isArray(nodes) ? nodes.filter(p => p.number).map(p => ({ ...p, reviews: (p.reviews || {}).nodes || [],
    commits: ((p.commits || {}).nodes || []).map(c => c.commit || {}) })) : null;
}
// an agent's commit: a trailer naming an AI tool as co-author, or an AI job's fix
const AGENT = /^(?:Co-Authored-By:.*\b(?:Claude|Codex|OpenAI|GPT|Gemini|Antigravity|Cursor|Copilot)\b|AMK-Agent-Fix:)/mi;

function collect(from, io = IO) {
  const t0 = at(`${from}T00:00:00Z`);
  const out = { from };
  const repo = (io.gh(['repo', 'view', '--json', 'nameWithOwner']) || {}).nameWithOwner;
  const prs = repo && pullRequests(repo, from, io);
  out.gh = Array.isArray(prs);
  if (out.gh) {
    const merged = prs.filter(p => p.mergedAt && at(p.mergedAt) >= t0);
    const sizes = merged.map(p => (p.additions || 0) + (p.deletions || 0));
    out.merged = { count: merged.length, median: median(sizes), over: sizes.filter(n => n > 600).length };
    const firstReview = p => (p.reviews || []).filter(r => (r.author || {}).login !== (p.author || {}).login && r.submittedAt).map(r => at(r.submittedAt)).sort((a, b) => a - b)[0];
    const waits = prs.map(p => firstReview(p) && firstReview(p) - at(p.createdAt)).filter(Boolean);
    out.review = { median: median(waits), reviewed: waits.length, unreviewed: merged.filter(p => !firstReview(p)).length };
    const runs = io.gh(['run', 'list', '--workflow', 'ci.yml', '--created', `>=${from}`, '--status', 'completed', '--limit', '500', '--json', 'conclusion']);
    const decided = (runs || []).filter(r => ['success', 'failure'].includes(r.conclusion));
    out.ci = runs ? { runs: decided.length, failed: decided.filter(r => r.conclusion === 'failure').length } : null;
    // ponytail: the repository's newest 100 issue events; a busier month needs paging
    const events = io.gh(['api', `repos/${repo}/issues/events?per_page=100`]) || [];
    out.reopened = new Set(events.filter(e => e.event === 'reopened' && at(e.created_at) >= t0).map(e => (e.issue || {}).number)).size;
    // the agents' pull requests: merged or closed without merging, and rework (changes requested, or commits after the first review)
    const agents = prs.filter(p => (p.commits || []).some(c => AGENT.test(c.message || '')));
    const rework = agents.filter(p => (p.reviews || []).some(r => r.state === 'CHANGES_REQUESTED')
      || (firstReview(p) && (p.commits || []).some(c => at(c.committedDate) > firstReview(p))));
    out.agents = { total: agents.length, merged: agents.filter(p => p.mergedAt).length, closed: agents.filter(p => p.state === 'CLOSED').length, rework: rework.length };
    // from a spec's approval commit to its feature's pull request
    out.approvalToPr = median(io.git(['log', '--all', `--since=${from}`, '--format=%cI%x09%s', '--grep=^docs(spec): .* approved']).split('\n').filter(Boolean)
      .flatMap(l => { const [when, subject] = l.split('\t'); const ids = (/^docs\(spec\): (.+?) approved/.exec(subject) || [])[1] || ''; return ids.split(/,\s*|\s+and\s+/).map(id => [id.trim(), at(when)]); })
      .map(([id, t]) => { const p = prs.find(x => x.headRefName === `feature/${id}`); return p ? at(p.createdAt) - t : null; })
      .filter(ms => ms != null && ms >= 0));
    out.repo = repo;
    out.prs = prs;
  }
  // where the features stand now, from their handoffs
  const states = { done: 0, blocked: 0, 'in progress': 0 };
  for (const d of io.list('specs')) {
    if (['_templates', 'current'].includes(d)) continue;
    const p = io.read(`specs/${d}/progress.md`);
    if (!p) continue;
    const blocked = (/^Blocked:\s*(.*?)\s*$/m.exec(p) || [])[1] || '';
    if (/^Status:\s*done/im.test(p)) states.done++;
    else if (blocked && !/^(none|nothing|n\/a|-+|<.*>)?$/i.test(blocked)) states.blocked++;
    else if (/^Status:\s*in progress/im.test(p)) states['in progress']++;
  }
  out.features = states;
  // the unattended build's sessions, from its logs (on this machine)
  const sessions = { count: 0, tokens: 0, cost: 0 };
  for (const d of io.list('.amk/build')) {
    let day = null;
    for (const l of (io.read(`.amk/build/${d}/build.log`) || '').split('\n')) {
      const h = /^=== (\d{4}-\d{2}-\d{2}) /.exec(l);
      if (h) day = h[1];
      const m = /■ session: \d+ min, (\d+) tokens(?:, \$([\d.]+))?/.exec(l);
      if (m && day && day >= from) { sessions.count++; sessions.tokens += Number(m[1]); sessions.cost += Number(m[2] || 0); }
    }
  }
  out.sessions = sessions;
  // findings kept with amk-ok in the period, and why
  out.kept = io.git(['grep', '-n', '-I', '-E', 'amk-ok [0-9]{4}-[0-9]{2}-[0-9]{2}']).split('\n').filter(Boolean)
    .map(l => { const m = /^([^:]+):(\d+):.*amk-ok (\d{4}-\d{2}-\d{2})\s*:\s*(.*?)\s*(?:\*\/\s*\}?)?$/.exec(l); return m && { file: m[1], line: m[2], date: m[3], why: m[4] }; })
    .filter(k => k && k.date >= from);
  return out;
}

function report(m, today) {
  const row = (a, b) => `| ${a} | ${b} |`;
  const needsGh = 'gh isn\'t signed in here, or this isn\'t a GitHub repository';
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : 'n/a');
  const lines = [`# Metrics: ${m.from} to ${today}`, '', '| Measure | This period |', '|---|---|'];
  if (m.gh) {
    lines.push(row('Pull requests merged', `${m.merged.count}${m.merged.count ? `, median ${m.merged.median} changed lines, ${m.merged.over} over 600` : ''}`));
    lines.push(row('Wait for a first review', m.review.median != null ? `median ${hours(m.review.median)} (${m.review.reviewed} reviewed; ${m.review.unreviewed} merged without a review)` : `none reviewed (${m.review.unreviewed} merged without a review)`));
    lines.push(row('CI failure rate', m.ci ? `${pct(m.ci.failed, m.ci.runs)} of ${m.ci.runs} runs of ci.yml` : 'no ci.yml runs'));
    lines.push(row('Reopened issues', String(m.reopened)));
    lines.push(row('Approval to pull request', m.approvalToPr != null ? `median ${hours(m.approvalToPr)}` : 'no approved spec got its pull request yet'));
    const a = m.agents;
    lines.push(row('The agents\' pull requests', a.total ? `${a.merged} of ${a.total} merged (${pct(a.merged, a.merged + a.closed)} of those decided), ${a.closed} closed without merging; ${a.rework} needed rework first (changes requested, or commits after the first review)` : 'none in this period'));
  } else lines.push(row('Pull requests, reviews, CI, reopened issues, approval to pull request', needsGh));
  const f = m.features;
  lines.push(row('Features, as they stand', `${f.done} done, ${f.blocked} blocked, ${f['in progress']} in progress`));
  const s = m.sessions;
  lines.push(row('Unattended sessions (this machine)', s.count ? `${s.count}, ${round(s.tokens / 1e6)} M tokens${s.cost ? `, $${s.cost.toFixed(2)} API-equivalent` : ''}` : 'none'));
  lines.push(row('Findings kept with amk-ok', String(m.kept.length)));
  lines.push('', `Review comments and kept findings for \`m-learn\`: \`node scripts/amk/metrics.js --comments --since ${m.from}\`.`);
  return lines.join('\n');
}

// the period's review comments (review texts and line comments) and amk-ok reasons, for m-learn
function comments(m, io = IO) {
  if (!m.gh) return `${'gh isn\'t signed in here, or this isn\'t a GitHub repository'}: only the kept findings.\n${untrusted(m.kept.map(k => `${k.file}:${k.line} (${k.date}): ${k.why}`).join('\n') || 'none', 'the reasons kept with amk-ok')}`;
  const items = [];
  for (const p of m.prs) {
    for (const r of p.reviews || []) if ((r.body || '').trim()) items.push(`#${p.number}, ${(r.author || {}).login || 'someone'} (review, ${String(r.state || '').toLowerCase()}): ${r.body.trim()}`);
    for (const c of io.gh(['api', `repos/${m.repo}/pulls/${p.number}/comments?per_page=100`]) || []) {
      items.push(`#${p.number} ${c.path}${c.line ? `:${c.line}` : ''}, ${(c.user || {}).login || 'someone'}: ${String(c.body || '').trim()}`);
    }
  }
  return [untrusted(items.join('\n\n---\n\n') || 'none', `the review comments since ${m.from}`),
    untrusted(m.kept.map(k => `${k.file}:${k.line} (${k.date}): ${k.why}`).join('\n') || 'none', 'the reasons kept with amk-ok')].join('\n');
}

module.exports = { collect, report, comments, sinceDate, median, IO };

if (require.main === module) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--since');
  const from = sinceDate(i >= 0 ? args[i + 1] : '30d', IO.now());
  if (!from || args.some((a, k) => !['--since', '--comments'].includes(a) && args[k - 1] !== '--since')) {
    console.error('usage: node scripts/amk/metrics.js [--comments] [--since <YYYY-MM-DD, or a span such as 30d>]');
    process.exitCode = 2;
  } else {
    const m = collect(from);
    console.log(args.includes('--comments') ? comments(m) : report(m, new Date(IO.now()).toISOString().slice(0, 10)));
  }
}
