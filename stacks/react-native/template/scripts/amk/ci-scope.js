#!/usr/bin/env node
// CI by what a change touches (.github/workflows/ci.yml), so every check it needs runs and none it doesn't:
//   node scripts/amk/ci-scope.js <base>   the jobs the change since <base> calls for, as GitHub Actions outputs:
//        code (the tests and the Android build) and native (the iOS build). Only specs or docs: neither. Native files
//        (ios/, android/, package.json and lockfiles, an Expo app's config, config plugins and patches, the CI workflow
//        itself): both. Anything else: code. A change it can't read (a first push, a base it can't find): both
//   node scripts/amk/ci-scope.js verdict  ci.yml's summary job ("checks", the one branch protection requires): the jobs'
//        results, from NEEDS (toJSON(needs)), fail it when one failed or was cancelled, or was skipped though the change
//        called for it
'use strict';
const { execFileSync } = require('child_process');

const DOCS = /^(docs|specs)\/|\.md$|^\.github\/(ISSUE_TEMPLATE\/|pull_request_template\.md$)|^(LICENSE|CODEOWNERS|\.github\/CODEOWNERS)$/i;
const NATIVE = /^(ios|android|plugins|patches)\/|^(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|app\.json|app\.config\.(js|ts|json)|eas\.json|react-native\.config\.js|Gemfile(\.lock)?|\.github\/workflows\/ci\.yml)$/;

function scope(files) {
  if (!files) return { code: true, native: true, why: 'the change couldn\'t be read, so everything runs' };
  if (!files.length || files.every(f => DOCS.test(f))) return { code: false, native: false, why: `only specs or docs (${files.length} file(s))` };
  const native = files.filter(f => NATIVE.test(f));
  return { code: true, native: native.length > 0, why: native.length ? `native files: ${native.slice(0, 5).join(', ')}${native.length > 5 ? ', …' : ''}` : 'code, no native files' };
}

// the jobs' results: a failure, a cancel, or a skip the change didn't allow
function verdict(needs) {
  const out = (needs.scope && needs.scope.outputs) || {};
  const wanted = { tests: out.code === 'true', android: out.code === 'true', ios: out.native === 'true' };
  const problems = [];
  const lines = [];
  for (const [job, r] of Object.entries(needs)) {
    const result = r.result;
    lines.push(`${job}: ${result}`);
    if (['failure', 'cancelled'].includes(result)) problems.push(`${job} ${result === 'failure' ? 'failed' : 'was cancelled'}`);
    else if (result === 'skipped' && (job === 'scope' || job === 'basics' || wanted[job])) problems.push(`${job} was skipped, though this change calls for it`);
  }
  return { ok: !problems.length, problems, lines };
}

module.exports = { scope, verdict, DOCS, NATIVE };

if (require.main === module) {
  const [arg] = process.argv.slice(2);
  if (arg === 'verdict') {
    let needs = {};
    try { needs = JSON.parse(process.env.NEEDS || '{}'); } catch {}
    const v = verdict(needs);
    console.log(v.lines.join('\n'));
    if (!v.ok) { console.log(`✗ ${v.problems.join('; ')}`); process.exit(1); }
    console.log('✓ every job this change calls for passed');
  } else {
    let files = null;
    // a branch's first push has no "before" (all zeros): everything runs
    if (arg && !/^0+$/.test(arg)) {
      try { files = execFileSync('git', ['diff', '--name-only', `${arg}...HEAD`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean); } catch {}
    }
    const s = scope(files);
    console.error(`scope: ${s.why}`);
    console.log(`code=${s.code}\nnative=${s.native}`);
  }
}
