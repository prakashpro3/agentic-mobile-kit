#!/usr/bin/env node
// Agent guard hook (preToolUse). Blocks destructive shell commands and access to secret files.
// Each AI tool sends a differently shaped JSON payload, so look for command and path fields anywhere in it.
const fs = require('fs');
const path = require('path');
// the project this script is in (scripts/amk/): the agent may have moved into a subfolder
const root = path.join(__dirname, '..', '..');

let payload;
const raw = fs.readFileSync(0, 'utf8');
try { payload = JSON.parse(raw); } catch { payload = { command: raw }; }

const commands = [];
const paths = [];
(function walk(v, key) {
  if (Array.isArray(v)) {
    if (/^(command|cmd|CommandLine)$/i.test(key) && v.every(x => typeof x === 'string')) commands.push(v.join(' '));
    else v.forEach(x => walk(x, key));
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) walk(x, k);
  } else if (typeof v === 'string') {
    if (/^(command|cmd|CommandLine)$/i.test(key)) commands.push(v);
    if (/^(file_path|path|AbsolutePath|TargetFile|filePath)$/.test(key)) paths.push(v);
  }
})(payload, '');

// rm with a recursive flag and a force flag anywhere before the next ; & | (-rf, -Rf, -r -f, --recursive --force);
// a push with --force, -f or a +refspec. The ones the rules say to ask about first (ask) can be approved in Claude Code
const DESTRUCTIVE = [
  /\brm(?=[^;&|\n]*\s(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b)(?=[^;&|\n]*\s(-[a-zA-Z]*f[a-zA-Z]*|--force)\b)/,
  { re: /git\s+reset\s+--hard/, ask: 'throws away every uncommitted change' },
  /git\s+push\s+(.*\s)?((--force|-f)\b|\+\S)/, /git\s+clean\s+-[a-z]*f/,
  { re: /--no-verify/, ask: 'skips the checks of the git hooks' },
  /xcrun\s+simctl\s+erase/,
].map(r => (r instanceof RegExp ? { re: r } : r));

// heredoc bodies out of a command, each replaced by a mark on the line that starts it ("<<<" is no heredoc)
function heredocs(c) {
  const bodies = [];
  const lines = c.split('\n');
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    kept.push(lines[i]);
    for (const m of [...lines[i].matchAll(/(?<!<)<<(-?)\s*(['"]?)([A-Za-z_][\w.-]*)\2/g)]) {
      const body = [];
      while (++i < lines.length && (m[1] ? lines[i].replace(/^\t+/, '') : lines[i]) !== m[3]) body.push(lines[i]);
      kept[kept.length - 1] += ` \u0000${bodies.push(body.join('\n')) - 1}\u0000`;
    }
  }
  return { text: kept.join('\n'), bodies };
}
// a command's parts between ; & | && || and line ends outside quotes ("a\|b" in a grep pattern stays whole), each
// with its first word and the heredoc bodies it feeds
function parts(c) {
  const { text, bodies } = heredocs(c.replace(/\d*>&\d*-?/g, ' '));
  const out = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { cur += ch; if (ch === '\\' && q === '"') cur += text[++i] || ''; else if (ch === q) q = null; continue; }
    if (ch === '\\') { cur += ch + (text[++i] || ''); continue; }
    if (ch === "'" || ch === '"') q = ch;
    if (!q && ';&|\n'.includes(ch)) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean).map(s => {
    const words = s.replace(/\u0000\d+\u0000/g, '').split(/\s+/).filter(w => !/^\w+=/.test(w)).map(w => w.replace(/^['"]|['"]$/g, ''));
    const fed = [...s.matchAll(/\u0000(\d+)\u0000/g)].map(m => bodies[m[1]]);
    return { text: s.replace(/\u0000\d+\u0000/g, ''), first: path.basename(words[0] || ''), second: words[1] || '', fed };
  });
}
// what only searches or prints: its quoted text isn't run, unless the command also hands text to a shell, or runs
// commands inside it ($( ), backticks, <( ))
const TEXT = /^(grep|egrep|fgrep|rg|ag|ack|echo|printf)$/;
const RUNS = /(^|[\s|;&(])(sh|bash|zsh|dash|ksh|fish|eval|xargs|source|parallel|ssh)(?=$|[\s;&|)])|(^|[;&|]\s*)\.\s/;
const NESTED = /\$\(|`|<\(|>\(/;
// what only looks whether a file is there, without reading it
const EXISTS = /^(ls|test|\[|\[\[|stat)$/;
// what writes a heredoc's text as it is: its body is data, not code
const DATA = /^(cat|tee)$/;
// a part's text where the rules apply: without a search's patterns (or, for secret files, a look whether one is there),
// a commit's message or a data heredoc
function checked(c, p, reading = false) {
  const plain = !RUNS.test(c) && !NESTED.test(p.text);
  if (plain && !reading && (TEXT.test(p.first) || (p.first === 'git' && p.second === 'grep'))) return '';
  if (plain && reading && EXISTS.test(p.first)) return '';
  const runs = !plain;
  let t = p.text;
  if (!runs && p.first === 'git' && p.second === 'commit') t = t.replace(/(\s(?:-m|--message)(?:=|\s+))("(?:[^"\\$`]|\\.)*"|'[^']*')/g, '$1MSG');
  return DATA.test(p.first) ? t : [t, ...p.fed].join('\n');
}

// git commands that throw away work for good: every uncommitted change (a checkout or restore of the whole tree, a forced
// checkout or switch), saved stashes, a branch with commits merged nowhere. Undoing one file's edit stays allowed
const discards = c => parts(c).map(p => checked(c, p)).some(s => {
  const m = /\bgit\s+(checkout|restore|switch|stash|branch)\b(.*)/.exec(s);
  if (!m) return false;
  const args = m[2].trim().split(/\s+/).filter(Boolean);
  const short = args.filter(a => /^-[a-zA-Z]+$/.test(a)).join('');
  const has = (letter, long) => short.includes(letter) || args.includes(long);
  const everything = args.some(a => /^['"]?(\.|\.\/|:\/|\*)['"]?$/.test(a));
  if (m[1] === 'checkout') return everything || has('f', '--force');
  // --staged alone only unstages: the changes stay
  if (m[1] === 'restore') return everything && (!has('S', '--staged') || has('W', '--worktree'));
  if (m[1] === 'switch') return has('f', '--force') || args.includes('--discard-changes');
  if (m[1] === 'stash') return args[0] === 'drop' || args[0] === 'clear';
  return short.includes('D') || (has('d', '--delete') && has('f', '--force'));
});
// example files (.env.example, .env.local.example, .env.sample, .env.template) aren't secrets
const secretFile = /(^|[\s/'"=])\.env(?![\w.-]*\.(?:example|sample|template)(?=$|[\s'";|&)]))(\.[\w.-]+)?(?=$|[\s'";|&)])|\.(keystore|jks|p8|p12|mobileprovision)\b/;
// the project's own secret files: .amk-secrets lists them, one path from the project root per line (a folder ends in /)
let listed = [];
try { listed = fs.readFileSync(path.join(root, '.amk-secrets'), 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')); } catch {}
const secret = s => secretFile.test(s) || listed.some(p => s.includes(p));

const block = reason => { process.stderr.write(`Blocked by scripts/amk/guard.js: ${reason}\n`); process.exit(2); };
// what the rules say to ask about first: Claude Code asks the developer (an unattended build, or another tool, blocks it)
const asks = [];
for (const c of commands) {
  // a message that runs commands ($( ), backticks) is checked too: it can come from a file instead
  const inMessage = /git\s+commit\b/.test(c) ? '\n(Only in the commit message? Write it to a file and use git commit -F <file>.)' : '';
  for (const p of parts(c)) {
    for (const r of DESTRUCTIVE.filter(d => d.re.test(checked(c, p)))) {
      if (r.ask) asks.push(`${c.trim()}\nIt ${r.ask}. The project's rules (AGENTS.md) say to ask first: approve it only if you meant to.`);
      else block(`destructive command: ${c}${inMessage}`);
    }
  }
  if (discards(c)) {
    block(`this throws away work that can't be brought back (uncommitted changes, stashes or unmerged commits): ${c}\n`
      + `Ask the user first, or keep the work: git stash, or a commit. To undo your own edit to a file: git checkout -- <that file>.${inMessage}`);
  }
  if (parts(c).some(p => secret(checked(c, p, true)))) block(`shell access to a secret file: ${c}`);
}
for (const p of paths) {
  if (secret(p)) block(`access to a secret file: ${p}`);
}

if (asks.length) {
  if (process.env.AMK_AUTOPILOT || !(/[\\/]\.claude[\\/]/.test(String(payload.transcript_path || '')) || process.env.CLAUDECODE)) block(`destructive command: ${asks[0]}`);
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: `scripts/amk/guard.js: ${asks.join('\n')}` } })}\n`);
  process.exit(0);
}

// An unattended build (scripts/amk/autopilot.js sets AMK_AUTOPILOT) works under your GitHub login, so it never does what
// only a person should: call GitHub's API directly, approve a pull request or request changes, merge without
// auto-merge, touch the trigger labels, push anything but a feature/ or fix/ branch by name, or change the guardrails
// (autopilot.js and the pre-commit hook hold the same list)
if (process.env.AMK_AUTOPILOT) {
  const GUARDRAILS = /^(?:scripts\/amk\/|\.rulesync\/|\.githooks\/|\.github\/workflows\/|\.agents\/|\.claude\/|\.codex\/|(?:\.github\/|docs\/)?CODEOWNERS$|AGENTS\.md$|CLAUDE\.md$|rulesync\.jsonc$|\.amk-(?:coverage|size-caps|secrets|screens)$)/;
  const roots = [root, fs.realpathSync(root)];
  const rel = p => roots.map(r => path.relative(r, path.resolve(r, p)).replace(/\\/g, '/')).find(x => !x.startsWith('..')) || '';
  // relative to the project, or as written without leading ../ (after a cd the guard doesn't follow)
  const kept = p => { const f = String(p).replace(/^['"]|['"]$/g, ''); return GUARDRAILS.test(rel(f)) || GUARDRAILS.test(f.replace(/^(?:\.{1,2}\/)+/, '')); };
  const refuse = (what, c) => block(`an unattended build ${what}: ${c.trim()}`);
  const writes = /^\s*(?:cp|mv|rm|rmdir|ln|chmod|chown|truncate|touch|mkdir|install|tee|dd|patch|sed\s+(?:-[a-zA-Z]*i|--in-place)|perl\s+-[a-zA-Z]*i|git\s+(?:apply|checkout|restore|rm|mv))\b/;
  const edits = /^(Edit|Write|MultiEdit|NotebookEdit|apply_patch|write_to_file|replace_file_content|multi_replace_file_content|sed_file|notebook_edit)$/;
  if (edits.test(payload.tool_name || '') && paths.some(kept)) refuse('doesn\'t change the kit\'s guardrails (its scripts, hooks and tool settings, the workflows, the agents\' instructions)', paths.join(' '));
  for (const c of commands) {
    for (const f of c.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)) {
      if (kept((f[1] || f[2]).trim())) refuse('doesn\'t change the kit\'s guardrails (its scripts, hooks and tool settings, the workflows, the agents\' instructions)', f[0]);
    }
    // a redirection such as 2>&1 isn't a command separator
    for (const s of c.replace(/\d*>&\d*-?/g, ' ').split(/&&|\|\||[;&|\n]/)) {
      if (/\bgh\s+api\b/.test(s)) refuse('doesn\'t call GitHub\'s API directly', s);
      if (/\bgh\s+pr\s+review\b/.test(s)) refuse('doesn\'t approve pull requests or request changes: a person does', s);
      if (/\bgh\s+pr\s+merge\b/.test(s) && !/\s--auto\b/.test(s)) refuse('merges only through auto-merge, after a person approves', s);
      if (/\bgh\b/.test(s) && /\bamk-(?:ready|fix)\b/.test(s)) refuse('doesn\'t add or remove the amk-ready or amk-fix labels: a person does', s);
      const push = /\bgit\s+push\b(.*)/.exec(s);
      if (push) {
        // its words, without redirections (2>/dev/null, > out.txt)
        const words = push[1].replace(/\d*>{1,2}\s*\S+|<\s*\S+/g, ' ').trim().split(/\s+/).filter(Boolean);
        const refs = words.filter(w => !w.startsWith('-')).slice(1);
        if (words.some(w => w.startsWith('-') && !/^(-u|--set-upstream|-q|--quiet|-v|--verbose|--progress|--no-progress|--porcelain)$/.test(w))
          || !refs.length || refs.some(r => !/^(?:feature|fix)\/[A-Za-z0-9._/-]+$/.test(r))) {
          refuse('pushes only its own feature/ or fix/ branch, named (git push -u origin feature/<id>)', s);
        }
      }
      const targets = [...s.matchAll(/>{1,2}\s*([^\s;&|<>]+)/g)].map(m => m[1]);
      if (targets.some(kept) || (writes.test(s) && s.trim().split(/\s+/).slice(1).some(kept))) {
        refuse('doesn\'t change the kit\'s guardrails (its scripts, hooks and tool settings, the workflows, the agents\' instructions)', s);
      }
    }
  }
}
process.exit(0);
