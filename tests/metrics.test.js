// Run: node --test tests/*.test.js
// The team's numbers for the monthly review (scripts/amk/metrics.js), from git, gh and the build's logs, and the
// review comments and kept findings m-learn reads
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const metrics = require(path.join(__dirname, '../stacks/react-native/template/scripts/amk/metrics.js'));
const T = h => `2026-11-${h}Z`;

function io({ gh = true } = {}) {
  const prs = [
    // merged, agent-built, reviewed after 4 h, a commit after the review: rework
    { number: 1, headRefName: 'feature/a', author: { login: 'dev' }, createdAt: T('02T08:00:00'), mergedAt: T('03T10:00:00'), state: 'MERGED', additions: 150, deletions: 50,
      reviews: [{ author: { login: 'ana' }, state: 'COMMENTED', submittedAt: T('02T12:00:00'), body: 'Use the shared Button here.' }],
      commits: [{ message: 'feat: a\n\nSpec: specs/a\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>', committedDate: T('02T07:00:00') },
        { message: 'fix: review', committedDate: T('02T14:00:00') }] },
    // merged, a person's, 700 lines, never reviewed
    { number: 2, headRefName: 'chore/deps', author: { login: 'bo' }, createdAt: T('04T08:00:00'), mergedAt: T('04T09:00:00'), state: 'MERGED', additions: 650, deletions: 50, reviews: [], commits: [{ message: 'chore: deps', committedDate: T('04T07:00:00') }] },
    // agent-built, closed without merging, changes requested
    { number: 3, headRefName: 'fix/12', author: { login: 'dev' }, createdAt: T('05T08:00:00'), mergedAt: null, state: 'CLOSED', additions: 10, deletions: 2,
      reviews: [{ author: { login: 'ana' }, state: 'CHANGES_REQUESTED', submittedAt: T('05T10:00:00'), body: 'Don\'t swallow the error.' }],
      commits: [{ message: 'fix: crash\n\nFixes #12\n\nAMK-Agent-Fix: deps (CI run 9)', committedDate: T('05T07:00:00') }] },
  ];
  const answers = {
    'repo view': { nameWithOwner: 'o/r' },
    // GitHub's answer to the query: reviews and commits as connections
    'api graphql': { data: { search: { nodes: prs.map(p => ({ ...p, reviews: { nodes: p.reviews }, commits: { nodes: p.commits.map(commit => ({ commit })) } })) } } },
    'run list': [...Array(8)].map(() => ({ conclusion: 'success' })).concat([{ conclusion: 'failure' }, { conclusion: 'failure' }, { conclusion: 'cancelled' }]),
    'api repos/o/r/issues/events': [{ event: 'reopened', created_at: T('03T00:00:00'), issue: { number: 7 } }, { event: 'reopened', created_at: T('03T05:00:00'), issue: { number: 7 } },
      { event: 'reopened', created_at: '2026-09-01T00:00:00Z', issue: { number: 8 } }, { event: 'closed', created_at: T('03T00:00:00'), issue: { number: 9 } }],
    'api repos/o/r/pulls/1/comments': [{ path: 'src/a.tsx', line: 12, user: { login: 'review-app[bot]' }, body: 'This list re-renders on every keystroke.' }],
  };
  const files = {
    'specs/a/progress.md': 'Status:        done\nBlocked:       none\n', 'specs/b/progress.md': 'Status:        in progress\nBlocked:       the backend has no endpoint yet\n',
    'specs/c/progress.md': 'Status:        in progress\nBlocked:       none\n', 'specs/_templates/progress.md': 'Status:        in progress\n',
    '.amk/build/a/build.log': '\n=== 2026-11-02 08:00: session 1 of a (claude)\n08:10:00 ■ session: 10 min, 2000000 tokens, $0.06 (API-equivalent on a subscription), 80 tool calls\n=== 2026-10-01 08:00: session 1 of a (claude)\n08:10:00 ■ session: 5 min, 900 tokens, $0.01 (API-equivalent)\n',
  };
  return {
    gh: args => { if (!gh) return null; const line = args.join(' '); const k = Object.keys(answers).find(p => line.startsWith(p)); return k ? answers[k] : null; },
    git: args => (args[0] === 'log' ? `${T('02T00:00:00').replace('Z', '+00:00')}\tdocs(spec): a, b approved\n` : args[0] === 'grep'
      ? 'src/a.tsx:40:  // amk-ok 2026-11-03: the API sends this as a string\nsrc/b.tsx:9:  // amk-ok 2026-09-01: an old one\n' : ''),
    read: f => (f in files ? files[f] : null),
    list: d => (d === 'specs' ? ['_templates', 'current', 'a', 'b', 'c'] : d === '.amk/build' ? ['a'] : []),
    now: () => Date.parse(T('10T00:00:00')),
  };
}

test('metrics: PR size, the wait for a first review, CI\'s failure rate, reopened issues, approval to PR, features, the agents\' PRs, sessions, kept findings', () => {
  const m = metrics.collect('2026-11-01', io());
  const r = metrics.report(m, '2026-11-10');
  assert.match(r, /^# Metrics: 2026-11-01 to 2026-11-10/);
  assert.match(r, /\| Pull requests merged \| 2, median 450 changed lines, 1 over 600 \|/);
  assert.match(r, /\| Wait for a first review \| median 3 h \(2 reviewed; 1 merged without a review\) \|/);
  assert.match(r, /\| CI failure rate \| 20% of 10 runs of ci\.yml \|/, 'cancelled runs don\'t count');
  assert.match(r, /\| Reopened issues \| 1 \|/, 'one issue reopened twice, in the period');
  assert.match(r, /\| Approval to pull request \| median 8 h \|/, 'a approved at 00:00, its PR opened at 08:00; b has no PR yet');
  assert.match(r, /\| The agents' pull requests \| 1 of 2 merged \(50% of those decided\), 1 closed without merging; 2 needed rework first/);
  assert.match(r, /\| Features, as they stand \| 1 done, 1 blocked, 1 in progress \|/);
  assert.match(r, /\| Unattended sessions \(this machine\) \| 1, 2 M tokens, \$0\.06 API-equivalent \|/, 'only the period\'s sessions');
  assert.match(r, /\| Findings kept with amk-ok \| 1 \|/);
  const c = metrics.comments(m, io());
  assert.match(c, /<untrusted-text source="the review comments since 2026-11-01">\n#1, ana \(review, commented\): Use the shared Button here\.[\s\S]*#1 src\/a\.tsx:12, review-app\[bot\]: This list re-renders on every keystroke\.[\s\S]*#3, ana \(review, changes_requested\): Don't swallow the error\./);
  assert.match(c, /<untrusted-text source="the reasons kept with amk-ok">\nsrc\/a\.tsx:40 \(2026-11-03\): the API sends this as a string\n<\/untrusted-text>/);
});

test('metrics: without gh, what git and the build\'s logs can tell; the period from a span or a date', () => {
  const r = metrics.report(metrics.collect('2026-11-01', io({ gh: false })), '2026-11-10');
  assert.match(r, /\| Pull requests, reviews, CI, reopened issues, approval to pull request \| gh isn't signed in here/);
  assert.match(r, /\| Features, as they stand \| 1 done, 1 blocked, 1 in progress \|/);
  assert.strictEqual(metrics.sinceDate('30d', Date.parse('2026-11-10T12:00:00Z')), '2026-10-11');
  assert.strictEqual(metrics.sinceDate('2026-10-01', 0), '2026-10-01');
  assert.strictEqual(metrics.sinceDate('last month', 0), null);
  assert.strictEqual(metrics.median([5, 1, 3, 2]), 2.5);
});
