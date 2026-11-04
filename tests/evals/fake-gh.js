#!/usr/bin/env node
// A stand-in for gh in the eval cases, so the bug queue, the review queue, metrics.js and m-report run without GitHub:
// it answers from state.json beside it (the repository, issues with their labels and events, pull requests with their
// reviews and comments) and appends what it's asked to do (a pull request opened, a comment, a label) to state.json's
// log, for the case's check. The pull requests' commits come from git, in the folder it runs in.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const STATE = path.join(__dirname, 'state.json');
const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
const args = process.argv.slice(2);
const line = args.join(' ');
const opt = n => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const out = v => { process.stdout.write(`${typeof v === 'string' ? v : JSON.stringify(v)}\n`); process.exit(0); };
const fail = (m = 'not found') => { process.stderr.write(`${m}\n`); process.exit(1); };
const git = (...a) => { try { return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const log = (what, extra = {}) => { state.log.push({ what, at: now(), ...extra }); save(); };
const repo = state.repo;
const prOf = ref => state.prs.find(p => String(p.number) === String(ref) || p.head === ref || p.url === ref);
const body = () => (opt('--body-file') ? fs.readFileSync(opt('--body-file'), 'utf8') : opt('--body') || '');
const user = login => ({ login, type: /\[bot\]$/.test(login) ? 'Bot' : 'User' });
// a pull request's commits, from git: the branch's own, since main
const commits = p => git('log', '--format=%H%x09%cI%x09%B%x00', `${state.main}..${p.head}`).split('\0').map(s => s.trim()).filter(Boolean)
  .map(s => { const [oid, date, ...m] = s.split('\t'); return { oid, committedDate: new Date(date).toISOString().replace(/\.\d+Z$/, 'Z'), message: m.join('\t') }; });

if (line === 'auth status' || line.startsWith('auth status')) out('Logged in to github.com account dev');
if (line.startsWith('repo view')) out({ nameWithOwner: repo, mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true });
if (line.startsWith('api user')) out({ login: 'dev', type: 'User' });

// issues
if (line.startsWith('issue list')) {
  const label = opt('--label');
  out(state.issues.filter(i => i.state === 'OPEN' && (!label || i.labels.includes(label))).map(i => ({ number: i.number, title: i.title, labels: i.labels.map(name => ({ name })) })));
}
if (line.startsWith('issue view')) {
  const i = state.issues.find(x => String(x.number) === args[2]) || fail();
  out({ number: i.number, title: i.title, body: i.body, url: `https://github.com/${repo}/issues/${i.number}`, state: i.state, labels: i.labels.map(name => ({ name })), comments: i.comments || [] });
}
if (line.startsWith('issue comment')) { log('issue comment', { number: Number(args[2]), body: body() }); out(`https://github.com/${repo}/issues/${args[2]}#comment`); }
if (line.startsWith('issue edit')) {
  const i = state.issues.find(x => String(x.number) === args[2]) || fail();
  if (opt('--add-label')) i.labels.push(opt('--add-label'));
  log('issue edit', { number: i.number, label: opt('--add-label') });
  out(`https://github.com/${repo}/issues/${i.number}`);
}
if (line.startsWith('label create')) { log('label create', { name: args[2] }); out(''); }
let m = /^api repos\/[^/]+\/[^/]+\/issues\/(\d+)\/events/.exec(line);
if (m) out((state.issues.find(x => String(x.number) === m[1]) || { events: [] }).events || []);
m = /^api repos\/[^/]+\/[^/]+\/collaborators\/([^/]+)\/permission/.exec(line);
if (m) out({ permission: (state.permissions || {})[m[1]] || 'none' });
if (line.startsWith(`api repos/${repo}/issues/events`)) out([]);

// pull requests
if (line.startsWith('pr create')) {
  const head = opt('--head') || git('symbolic-ref', '--short', 'HEAD');
  const p = { number: 100 + state.prs.length, head, base: opt('--base') || state.main.replace(/^origin\//, ''), title: opt('--title') || '', body: body(), state: 'OPEN', author: 'dev', reviews: [], comments: [], inline: [] };
  p.url = `https://github.com/${repo}/pull/${p.number}`;
  state.prs.push(p);
  log('pr create', { number: p.number, head, base: p.base, body: p.body });
  out(p.url);
}
if (line.startsWith('pr list')) {
  const s = opt('--state') || 'open';
  out(state.prs.filter(p => s === 'all' || p.state.toLowerCase() === s).map(p => ({ number: p.number, headRefName: p.head, state: p.state, title: p.title, url: p.url, mergedAt: p.mergedAt || null, createdAt: p.createdAt || now(), reviewDecision: p.reviewDecision || '' })));
}
if (line.startsWith('pr view')) {
  const p = prOf(args[2] && !args[2].startsWith('-') ? args[2] : git('symbolic-ref', '--short', 'HEAD')) || fail('no pull requests found');
  out({ number: p.number, url: p.url, state: p.state, baseRefName: p.base, headRefName: p.head, title: p.title, body: p.body, reviewDecision: p.reviewDecision || '', autoMergeRequest: null,
    reviews: p.reviews.map(r => ({ author: { login: r.user }, state: r.state, body: r.body, submittedAt: r.at })),
    comments: p.comments.map(c => ({ author: { login: c.user }, body: c.body, createdAt: c.at })) });
}
if (line.startsWith('pr comment')) {
  const p = prOf(args[2]) || fail();
  p.comments.push({ user: 'dev', body: body(), at: now() });
  log('pr comment', { number: p.number, body: body() });
  out(`${p.url}#comment`);
}
// a pull request's checks: each fails while the branch on origin is at the commit it failed on, and passes once a
// newer one is pushed; a failed run's log is the state's runs[<id>]
if (line.startsWith('pr checks')) {
  const p = prOf(args[2] && !args[2].startsWith('-') ? args[2] : git('symbolic-ref', '--short', 'HEAD')) || fail('no pull requests found');
  const at = git('ls-remote', 'origin', `refs/heads/${p.head}`).split('\t')[0];
  out((p.checks || []).map(c => ({ name: c.name, workflow: c.workflow || 'ci', link: c.link, bucket: c.failsAt === at ? 'fail' : 'pass' })));
}
m = /^run view (\d+)/.exec(line);
if (m) out((state.runs || {})[m[1]] || '');
m = /^api repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/(reviews|comments|commits)/.exec(line);
if (m) {
  const p = prOf(m[1]) || fail();
  if (m[2] === 'reviews') out(p.reviews.map(r => ({ user: user(r.user), state: r.state, body: r.body, submitted_at: r.at })));
  if (m[2] === 'comments') out(p.inline.map(c => ({ user: user(c.user), path: c.path, line: c.line, body: c.body, created_at: c.at })));
  out(commits(p).map(c => ({ sha: c.oid, commit: { message: c.message, committer: { date: c.committedDate } } })));
}
m = /^api repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments/.exec(line);
if (m) out(((prOf(m[1]) || {}).comments || []).map(c => ({ user: user(c.user), body: c.body, created_at: c.at })));
// metrics.js's query: the pull requests with their reviews and commits
if (line.startsWith('api graphql')) {
  out({ data: { search: { nodes: state.prs.map(p => ({ number: p.number, headRefName: p.head, author: { login: p.author || 'dev' }, createdAt: p.createdAt || now(), mergedAt: p.mergedAt || null,
    state: p.state, additions: p.additions || 10, deletions: p.deletions || 2,
    reviews: { nodes: p.reviews.map(r => ({ author: { login: r.user }, state: r.state, submittedAt: r.at, body: r.body })) },
    commits: { nodes: (p.commitMessages || []).map(message => ({ commit: { message, committedDate: p.createdAt || now() } })) } })) } } });
}
if (line.startsWith('run list')) out([]);
fail(`fake gh: no answer for "${line}"`);
