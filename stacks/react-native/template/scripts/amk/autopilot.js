#!/usr/bin/env node
// Builds the planned features while nobody watches: a fresh session of the AI tool for each feature, started with only
// the variables a build needs and under the build's permission profile, until no feature is ready, everything left is
// blocked, or a reason every feature would hit (disk full, signed out, the folder not trusted, a usage limit, the budget
// cap) ends the build. For each feature, specs.js start makes its branch from the plan, then a session runs
// /m-continue <id> through m-feature's build steps to its pull request. A feature an earlier run left unfinished goes on
// first. A session that stalls (no activity for --stall minutes, or stopping again with nothing changed) starts once
// more from the handoff; a second stall with nothing changed blocks the feature, as any other stop that stays does.
// Each session is logged, redacted, to .amk/build/<id>/build.log, and why a feature stopped to .amk/build/<id>/stop.md.
// .amk/build/notes.md reaches each new session; .amk/build/STOP ends the build once the current task is committed.
// It notifies on the Mac (notify-send on Linux) and through a chat webhook in AMK_NOTIFY_URL, when set.
// Settings in docs/amk/team-process.md: Open PRs before the build waits, First PR review, Blocked questions as issues,
// Variables for unattended runs.
// Usage: node scripts/amk/autopilot.js [--tool claude|codex|antigravity] [--wait <hours>] [--budget <usd>]
//                                      [--model <name>] [--stall <minutes>]
//   --wait <hours>   when no feature is ready, or pull requests wait for review, check every few minutes until then
//   --budget <usd>   Claude Code's cap for each session (an API-equivalent estimate on a subscription): 25
//   --stall <min>    minutes without activity before a session counts as stalled: 20
//        node scripts/amk/autopilot.js check [--tool …]   before the first night: sign-in, gh, disk, the tool's
//                    permissions, then verify.sh quick and the release builds, in the run's environment
//        node scripts/amk/autopilot.js question <id>       a blocked feature's question issue and its answers, as
//                    outside text (with Blocked questions as issues: on)
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { redact, untrusted } = require('./redact.js');
const specs = require('./specs.js');

const ROOT = fs.realpathSync(path.join(__dirname, '..', '..'));
const BUILD = path.join(ROOT, '.amk', 'build');
const STOP = path.join(BUILD, 'STOP');
const read = f => { try { return fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 2 ** 26, ...opts });
const git = (...a) => { const r = run('git', a); return r.status === 0 ? r.stdout.replace(/\n$/, '') : null; };
const oneLine = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
// this machine's local time, as the developer reads the logs in the morning
const local = (d = new Date()) => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const stamp = () => local().slice(0, 16);
const branchNow = () => git('symbolic-ref', '--quiet', '--short', 'HEAD');

// ---------- settings, and what a session gets from this shell ----------
// docs/amk/team-process.md's "Settings for the agents": "- Open PRs before the build waits: 5" -> { 'open prs …': '5' }
function settings(text = read(path.join(ROOT, 'docs/amk/team-process.md')) || '') {
  const body = (/^## Settings for the agents\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text.replace(/<!--[\s\S]*?-->/g, '')) || [])[1] || '';
  return Object.fromEntries([...body.matchAll(/^- ([^:\n]+?):\s*(.*?)\s*$/gm)].map(m => [m[1].toLowerCase(), m[2]]));
}
const on = v => /^(on|yes|true)$/i.test(v || '');
// Only what a build needs, so the shell's other keys and tokens stay out of reach: the system's own, the tool's sign-in
// (its stored login through HOME, or a token made for it), GitHub's token, Java, the Android SDK, Ruby for CocoaPods,
// pushes over SSH, a private package registry, proxies, the kit's AMK_ settings (the devices, …), and the names the team
// lists in "Variables for unattended runs". An API key in the shell isn't passed unless it's listed there
const PASS = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'TERM', 'LANG', 'LC_ALL', 'LC_CTYPE', 'DISPLAY',
  'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
  'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'PATHEXT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH',
  'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles',
  'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'GH_TOKEN', 'GH_HOST', 'GH_CONFIG_DIR',
  'JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'ANDROID_USER_HOME', 'GRADLE_USER_HOME', 'DEVELOPER_DIR',
  'GEM_HOME', 'GEM_PATH', 'RBENV_ROOT', 'RBENV_VERSION', 'MY_RUBY_HOME', 'RUBY_ROOT', 'RUBY_ENGINE', 'RUBY_VERSION',
  'SSH_AUTH_SOCK', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'YARN_NPM_AUTH_TOKEN', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'];
function cleanEnv(env, cfg) {
  const extra = (cfg['variables for unattended runs'] || '').split(/[,\s]+/).filter(n => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && !/^none$/i.test(n));
  // names compared without case: Windows writes PATH as Path
  const wanted = new Set([...PASS, ...extra].map(n => n.toLowerCase()));
  const out = Object.fromEntries(Object.entries(env).filter(([k]) => wanted.has(k.toLowerCase())
    || (k.startsWith('AMK_') && k !== 'AMK_NOTIFY_URL')));
  // CocoaPods stops without a UTF-8 locale
  for (const k of ['LANG', 'LC_ALL']) if ((k === 'LANG' || out[k]) && !/utf-?8/i.test(out[k] || '')) out[k] = 'en_US.UTF-8';
  out.AMK_AUTOPILOT = '1';
  return out;
}

// ---------- the build's permission profile, per tool ----------
const pmOf = () => (fs.existsSync(path.join(ROOT, 'yarn.lock')) ? 'yarn' : fs.existsSync(path.join(ROOT, 'pnpm-lock.yaml')) ? 'pnpm'
  : ['bun.lock', 'bun.lockb'].some(f => fs.existsSync(path.join(ROOT, f))) ? 'bun' : 'npm');
// the commands a build runs, as prefixes (a push names its feature/ or fix/ branch: below)
const COMMANDS = pm => ['sh scripts/amk/verify.sh', 'node scripts/amk/specs.js', 'node scripts/amk/rn-check.js', 'node scripts/amk/coverage.js check',
  'node scripts/amk/baseline.js base',
  'node scripts/amk/screens.js', 'node scripts/amk/redact.js', 'node scripts/amk/autopilot.js question', 'sh scripts/amk/install-deps.sh',
  'sh scripts/amk/pod-install.sh', 'git add', 'git commit', 'git switch', 'git fetch', 'git mv', 'git rm', 'git checkout --', 'git restore',
  'gh pr create', 'gh pr view', 'gh pr checks', 'gh pr comment', 'gh pr list', 'gh run view', 'gh issue create', 'gh issue comment',
  'gh issue view', 'gh issue list', `${pm} test`, `${pm} run test`, `${pm} run lint`, `${pm} run typecheck`,
  ...(pm === 'npm' ? [] : [`${pm} lint`, `${pm} typecheck`, `${pm} jest`]), 'npx jest', 'npx tsc', 'npx eslint'];
// what an unattended run never changes (guard.js and the pre-commit hook hold the same list): the kit's scripts, hooks
// and tool settings, the workflows, the agents' instructions, the coverage floors and size caps, and the code owners
const GUARDRAILS = ['scripts/amk/', '.rulesync/', '.githooks/', '.github/workflows/', '.agents/', '.claude/', '.codex/', 'AGENTS.md',
  'CLAUDE.md', 'rulesync.jsonc', '.amk-coverage', '.amk-size-caps', '.amk-secrets', 'CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'];
// a path as Claude Code's rules write an absolute one: //Users/…, or //c/Users/… on Windows
const rulePath = p => `/${process.platform === 'win32' ? p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`) : p}`;
// Claude Code: --permission-mode dontAsk refuses what isn't allowed rather than asking, and what the project's settings
// ask about first (editing package.json, installing packages, …), as nobody is there to answer. --setting-sources
// project leaves out the allow rules saved in your own and your local settings, and --strict-mcp-config every MCP server
function claudeProfile(pm = pmOf()) {
  const root = rulePath(ROOT);
  return {
    allow: [`Edit(${root}/**)`, ...COMMANDS(pm).map(c => `Bash(${c} *)`),
      ...['feature', 'fix'].flatMap(b => [`Bash(git push origin ${b}/*)`, `Bash(git push -u origin ${b}/*)`])],
    // and no tools that schedule more work after the session (a wake-up, a cron job, a remote trigger): one feature, then it ends
    deny: [...GUARDRAILS.map(p => `Edit(${root}/${p}${p.endsWith('/') ? '**' : ''})`), 'Bash(gh api *)', 'Bash(gh pr review *)', 'Bash(gh pr merge *)',
      'ScheduleWakeup', 'CronCreate', 'RemoteTrigger'],
  };
}
// Antigravity's allow rules for the same commands: only its own settings hold them (/permissions), so check lists them
const agyRules = (pm = pmOf()) => [...COMMANDS(pm).map(c => `command(${c})`), 'command(regex:git push (-u )?origin (feature|fix)/[A-Za-z0-9._/-]+)'];
// what every session is told: nobody is there
function unattended(id, notes) {
  return [
    `This session runs unattended (scripts/amk/autopilot.js): nobody is watching, and nobody will answer. Build ${id} as .agents/skills/m-feature/build.md says, from where it stopped, to its end: marked done in specs/${id}/progress.md, with its pull request.`,
    `Never wait for a confirmation or ask a question. Where you would ask or stop, record it under Blocked: in specs/${id}/progress.md (what happened, why, and what would unblock it), commit, push its branch, and end the session.`,
    'Only the build\'s own commands run here: the kit\'s scripts, git add, commit, switch and the push of its branch, gh pr, the app\'s test, lint and typecheck scripts, and reading files. Any other command is refused, that command only: the rest still run, so go on with the build\'s own. Run each alone, as the skills write it: a line that adds another command, `$VAR`, `${…}`, `$(…)` or a loop to it is refused whole, and a command\'s own output and exit code are all you need. Only a command the build can\'t do without, refused when run alone as written, is a stop that stays, recorded the same way. After a context compaction, read that handoff again.',
    'If .amk/build/STOP appears, finish the task you are on, update the handoff, commit, and end the session.',
    notes ? `Notes from the developer for this build (.amk/build/notes.md), to follow where they apply:\n${notes}` : '',
  ].filter(Boolean).join('\n');
}
// the command that runs one session, per tool
const TOOLS = {
  claude: (id, note, o) => {
    const p = claudeProfile();
    return { cmd: 'claude', args: ['-p', `/m-continue ${id}`, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'dontAsk',
      '--setting-sources', 'project', '--strict-mcp-config', '--max-budget-usd', String(o.budget), '--append-system-prompt', note,
      ...(o.model ? ['--model', o.model] : []), '--allowedTools', ...p.allow, '--disallowedTools', ...p.deny] };
  },
  // Codex: its sandbox is the profile (writes inside the project and its .git only, the network for pushes and gh), and it
  // never asks (approval_policy never), so a command outside it fails. Its macOS sandbox blocks the iOS simulator.
  // Without features.shell_snapshot=false, its commands get your interactive shell's variables back (.zshrc's keys)
  codex: (id, note, o) => ({ cmd: 'codex', args: ['exec', '--json', ...(codexHooksVetted() ? ['--dangerously-bypass-hook-trust'] : []),
    '--sandbox', 'workspace-write', '-c', 'approval_policy="never"', '-c', 'features.shell_snapshot=false',
    '-c', `sandbox_workspace_write.writable_roots=${JSON.stringify([path.resolve(ROOT, git('rev-parse', '--git-common-dir') || '.git')])}`,
    '-c', 'sandbox_workspace_write.network_access=true', ...(o.model ? ['--model', o.model] : []), `$m-continue ${id}\n\n${note}`] }),
  // Antigravity: its own allow rules decide, and a session in a mode that skips its prompts is stopped at once
  antigravity: (id, note, o) => ({ cmd: 'agy', args: ['-p', `/m-continue ${id}\n\n${note}`, '--output-format', 'stream-json',
    ...(o.model ? ['--model', o.model] : [])] }),
};
const BIN = { claude: 'claude', codex: 'codex', antigravity: 'agy' };
// Codex runs a project's hooks (the guard among them) only once someone approved them there, and asks again after a kit
// update changes one. autopilot.js vets them instead: only the kit's two commands, in a .codex/hooks.json that git tracks,
// with it and their scripts as committed. Then it runs them without that approval (--dangerously-bypass-hook-trust)
const KIT_HOOK = /^node -e "require\(require\('child_process'\)\.execSync\('git rev-parse --show-toplevel'\)\.toString\(\)\.trim\(\) \+ '\/scripts\/amk\/(?:guard|handoff-check)\.js'\)"$/;
function codexHooksVetted() {
  let hooks;
  try { hooks = JSON.parse(read(path.join(ROOT, '.codex', 'hooks.json'))).hooks; } catch { return false; }
  const commands = Object.values(hooks || {}).flat().flatMap(e => (e && e.hooks) || [e]).map(h => (h && h.command) || '');
  const files = ['.codex/hooks.json', 'scripts/amk/guard.js', 'scripts/amk/handoff-check.js', 'scripts/amk/specs.js'];
  return commands.some(c => /guard\.js/.test(c)) && commands.every(c => KIT_HOOK.test(c))
    && git('ls-files', '--error-unmatch', '--', ...files) !== null && git('diff', '--quiet', 'HEAD', '--', ...files) !== null;
}

// ---------- a session's events ----------
const tokensOf = u => ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'thinking_tokens']
  .reduce((n, k) => n + ((u || {})[k] || 0), 0);
const step = (name, i) => `${name} ${oneLine(i.command || i.file_path || i.skill || [i.subagent_type, i.description].filter(Boolean).join(': ')
  || i.pattern || i.url || JSON.stringify(i), 300)}`;
// One event of the tool's stream (Claude Code's stream-json, Codex's --json, Antigravity's stream-json): its log lines,
// and whether it shows activity, a tool call starting or ending. Adds to the session's totals in s. errors: the tool's
// own (the API, the sign-in, the session); toolErrors: the commands and edits the agent's calls failed with
function describe(e, s) {
  const out = [];
  const fail = (text, call) => { (call ? s.toolErrors : s.errors).push(String(text).slice(0, 4000)); out.push({ text: `✗ ${oneLine(text, 600)}` }); };
  if (e.type === 'assistant') {
    for (const c of (e.message && e.message.content) || []) {
      if (c.type === 'tool_use') { s.calls++; s.last = step(c.name, c.input || {}); out.push({ alive: true, text: `▸ ${s.last}` }); }
      if (c.type === 'text' && c.text.trim()) {
        s.final = c.text;
        if (e.error || e.isApiErrorMessage || /^API Error/.test(c.text)) fail(c.text); else out.push({ text: `· ${oneLine(c.text, 400)}` });
      }
    }
  } else if (e.type === 'user') {
    for (const c of [].concat((e.message && e.message.content) || [])) {
      if (c.type !== 'tool_result') continue;
      out.push({ alive: true });
      if (c.is_error) fail(typeof c.content === 'string' ? c.content : [].concat(c.content || []).map(x => x.text || '').join('\n'), true);
    }
  } else if (e.type === 'system' && e.subtype === 'compact_boundary') {
    s.compactions++;
    out.push({ alive: true, text: '↻ the context was compacted' });
  } else if (e.type === 'result') {
    s.result = e;
    s.tokens += tokensOf(e.usage);
    s.costUsd = e.total_cost_usd || s.costUsd;
    if (e.result) s.final = e.result;
    if (e.is_error || (e.subtype && e.subtype !== 'success')) fail(`${e.subtype}: ${e.result || (e.errors || []).join('; ')}`);
    else out.push({ text: `■ ${oneLine(e.result, 400)}` });
  } else if (/^item\.(started|completed)$/.test(e.type) && e.item) {
    const it = e.item;
    if (it.type === 'agent_message') { s.final = it.text || ''; out.push({ text: `· ${oneLine(it.text, 400)}` }); }
    else if (it.type !== 'reasoning') {
      // a call is logged once: when it starts, or, for an edit Codex reports only when it's done, then
      if (!(s.seen || (s.seen = new Set())).has(it.id) && (e.type === 'item.started' || it.type === 'file_change')) {
        s.seen.add(it.id);
        s.calls++;
        s.last = it.type === 'command_execution' ? `shell ${oneLine(it.command, 300)}` : `${it.type} ${oneLine((it.changes || []).map(c => c.path).join(', '), 300)}`;
        out.push({ alive: true, text: `▸ ${s.last}` });
      } else out.push({ alive: true });
      if (e.type === 'item.completed' && it.exit_code) fail(`exit ${it.exit_code}: ${it.aggregated_output || ''}`, true);
    }
  } else if (e.type === 'turn.completed') {
    s.tokens += tokensOf(e.usage);
  } else if (e.type === 'turn.failed' || e.type === 'error') {
    fail((e.error && e.error.message) || e.message || 'error');
  } else if (e.event === 'init') {
    s.mode = e.init && e.init.permission_mode;
  } else if (e.event === 'step_update' && e.step_update) {
    const u = e.step_update;
    if (!/^(user_input|planner_response|error_message)$/.test(u.step_type || '')) {
      if (u.state !== 'DONE') { s.calls++; s.last = u.step_type; out.push({ alive: true, text: `▸ ${u.step_type}` }); } else out.push({ alive: true });
    }
  } else if (e.event === 'result' && e.result) {
    s.tokens += tokensOf(e.result.usage);
    if (e.result.response) s.final = e.result.response;
    if (e.result.error) fail(e.result.error); else out.push({ text: `■ ${oneLine(e.result.response, 400)}` });
  }
  return out;
}

// the newest change to a file under .amk/, the build's own logs aside: a long verify.sh run writes its evidence there
function newest(dir = path.join(ROOT, '.amk'), skip = BUILD) {
  let t = 0;
  const walk = d => {
    let es;
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (p === skip) continue;
      if (e.isDirectory()) walk(p);
      else { try { t = Math.max(t, fs.statSync(p).mtimeMs); } catch {} }
    }
  };
  walk(dir);
  return t;
}
let current = null; // the session running now, stopped on Ctrl-C
function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  if (process.platform === 'win32') { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); return; }
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 10000).unref();
}
// One session of the tool, logged as it goes. With no activity for stallMs (no tool call starting or ending, and no
// change under .amk/), it's stopped as a stall; Antigravity in a mode that skips its permission prompts, at once
function runSession({ cmd, args, env, log, stallMs }) {
  return new Promise(resolve => {
    fs.mkdirSync(path.dirname(log), { recursive: true });
    const fd = fs.openSync(log, 'a');
    const line = text => fs.writeSync(fd, `${local().slice(11)} ${redact(text)}\n`);
    const s = { calls: 0, compactions: 0, tokens: 0, costUsd: 0, result: null, final: '', errors: [], toolErrors: [], stderr: '', last: '',
      stalled: false, interrupted: false, started: Date.now(), code: null };
    let child;
    let timer;
    let ended = false;
    const finish = code => {
      if (ended) return;
      ended = true;
      clearInterval(timer);
      s.code = code;
      s.interrupted = Boolean(child && child.interrupted);
      s.ms = Date.now() - s.started;
      if (s.stderr.trim()) line(`stderr: ${oneLine(s.stderr, 2000)}`);
      line(`■ session: ${Math.round(s.ms / 60000)} min, ${s.tokens} tokens${s.costUsd ? `, $${s.costUsd.toFixed(2)} (API-equivalent on a subscription)` : ''}, ${s.calls} tool calls, ${s.compactions} compaction(s)`);
      fs.closeSync(fd);
      current = null;
      resolve(s);
    };
    try {
      child = spawn(cmd, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    } catch (e) { s.errors.push(`couldn't start ${cmd}: ${e.message}`); finish(null); return; }
    current = child;
    let alive = Date.now();
    let seen = newest();
    let buf = '';
    const event = l => {
      let e;
      try { e = JSON.parse(l); } catch { if (l.trim()) line(`  ${oneLine(l, 300)}`); return; }
      for (const x of describe(e, s)) { if (x.alive) alive = Date.now(); if (x.text) line(x.text); }
      if (s.mode && /^(always-proceed|auto)$/.test(s.mode) && !s.refused) {
        s.refused = true;
        s.errors.push(`Antigravity runs in permission mode ${s.mode}, which skips its permission prompts: an unattended build runs only under an allow list`);
        stopChild(child);
      }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { event(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', d => { s.stderr = (s.stderr + d).slice(-50000); });
    timer = setInterval(() => {
      const n = newest();
      if (n > seen) { seen = n; alive = Date.now(); }
      if (Date.now() - alive > stallMs && !s.stalled) {
        s.stalled = true;
        line(`stalled: no activity for ${Math.round(stallMs / 60000)} minutes, so the session is stopped`);
        stopChild(child);
      }
    }, Math.max(1000, Math.min(30000, stallMs / 4)));
    child.on('error', e => { s.errors.push(`couldn't start ${cmd}: ${e.message}`); if (child.pid === undefined) finish(null); });
    child.on('close', code => { if (buf.trim()) event(buf); finish(code); });
  });
}

// ---------- why a session ended without its feature done or blocked ----------
// In this order: the first that matches wins (a full disk wins over the build failure it caused). ends: every feature
// would hit it, so the build ends; person: someone must act before it goes on. own: matched only in the tool's own
// errors (its stderr, a failed result or turn), not in what the commands the agent ran printed
const REASONS = [
  { reason: 'disk full', re: /no space left on device|\bENOSPC\b|GB of disk is free here/i, ends: true, person: true,
    act: 'free some disk (Xcode\'s DerivedData, simulators and emulators you don\'t use, Gradle\'s caches), then run autopilot again' },
  { reason: 'tool missing', own: true, re: /couldn't start (?:claude|codex|agy)/, ends: true, person: true,
    act: 'install the tool, or put it on the PATH, then run autopilot again' },
  { reason: 'signed out', own: true, re: /not logged in|log ?in again|please (?:run \/login|log ?in|sign in)|invalid (?:api key|x-api-key)|authentication_error|token (?:has )?(?:expired|been revoked)|credit balance is too low|\bunauthenticated\b/i,
    ends: true, person: true, act: 'sign the tool in again (claude auth login, codex login, or agy), then run autopilot again' },
  { reason: 'folder not trusted', own: true, re: /hooks? (?:are |is )?(?:disabled|off) until|trust (?:this|the) (?:folder|workspace|project) (?:first|before)/i,
    ends: true, person: true, act: 'open the project in the tool once and trust it (in Codex, its hooks too), then run autopilot again' },
  { reason: 'usage limit', own: true, re: /usage limit|rate[ _-]?limit|hit your (?:usage )?limit|quota (?:reached|exceeded)|RESOURCE_EXHAUSTED|too many requests|limit reached/i,
    ends: true, person: false, act: 'run the same command again once the limit resets' },
  { reason: 'budget cap', own: true, re: /error_max_budget_usd|budget limit reached/i, ends: true, person: true,
    act: 'raise --budget, or first look at why the feature cost that much (its build.log), then run autopilot again' },
  { reason: 'skips permissions', own: true, re: /which skips its permission prompts/, ends: true, person: true,
    act: 'set the tool to ask before commands (Antigravity: agy, /config) and allow the build\'s commands (node scripts/amk/autopilot.js check --tool antigravity lists them), then run autopilot again' },
  { reason: 'provider overloaded', own: true, re: /overloaded|\b529\b|service unavailable|\b503\b|\bUNAVAILABLE\b/i, ends: false, person: false,
    act: 'it starts again once, after a pause' },
  { reason: 'stall', when: s => s.stalled, ends: false, person: false,
    act: 'it starts again once from the handoff; a second stall with nothing changed blocks the feature' },
  { reason: 'lost device', re: /device (?:is )?(?:offline|not found|disconnected)|device server died|no (?:devices?|emulators?|simulators?) (?:found|attached|connected|available)/i,
    ends: false, person: true, act: 'check the simulator or emulator, then go on with m-continue <id>' },
  { reason: 'failed build or flow', re: /BUILD FAILED|FAILURE: Build failed|xcodebuild: error|\bflows? \d+\/\d+ passed|Flow failed/i, ends: false, person: true,
    act: 'read stop.md and build.log, fix it or settle what blocks it, then go on with m-continue <id>' },
  // it stopped with nothing changed after the stop hook asked it to go on: going in circles, so a stall too
  { reason: 'stall', when: s => s.code === 0 && !s.errors.length, ends: false, person: false,
    act: 'it starts again once from the handoff; a second stall with nothing changed blocks the feature' },
  { reason: 'the session ended early', when: () => true, ends: false, person: true, act: 'read stop.md and build.log, then go on with m-continue <id>' },
];
// when a usage limit resets, only where the message says so plainly ("resets 3pm (America/Los_Angeles)", "in 2 hours")
function resetTime(text) {
  const m = /resets?\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*[ap]m(?:\s*\([^)]+\))?)/i.exec(text)
    || /(?:resets?|try again|available again)\s+in\s+((?:\d+\s*(?:hours?|minutes?|mins?|seconds?|secs?|h|m|s)\s*)+)/i.exec(text);
  return m ? m[1].trim() : 'unknown';
}
function classify(s) {
  const own = [s.stderr, ...s.errors].join('\n');
  const all = [own, ...s.toolErrors].join('\n');
  const hit = REASONS.find(r => (r.when ? r.when(s) : r.re.test(r.own ? own : all)));
  const text = hit.own ? own : all;
  const lines = hit.re ? text.split('\n').filter(l => hit.re.test(l)).slice(0, 5).map(l => oneLine(l, 400)) : [];
  return { ...hit, lines, reset: hit.reason === 'usage limit' ? resetTime(text) : null };
}

// ---------- a feature's state ----------
const onIt = id => branchNow() === `feature/${id}`;
const fileOf = (id, f) => (onIt(id) ? read(path.join(ROOT, 'specs', id, f)) : git('show', `feature/${id}:specs/${id}/${f}`));
const blockedIn = p => { const b = (/^Blocked:\s*(.*?)\s*$/m.exec(p || '') || [])[1] || ''; return specs.NONE.test(b) ? '' : b; };
const isDone = p => /^done/i.test(specs.stateOf(p || ''));
// what counts as progress: its last commit, its ticked tasks, its handoff's next step
const stateNow = id => JSON.stringify([git('rev-parse', `feature/${id}`), ((fileOf(id, 'tasks.md') || '').match(/^\s*- \[[xX]\]/gm) || []).length,
  (/^Next step:\s*(.*)$/m.exec(fileOf(id, 'progress.md') || '') || [])[1] || '']);
// a feature of the plan that an earlier session left unfinished on its branch here, built in plan-all mode
function unfinished(skip) {
  const ref = specs.planRef();
  const plan = ref && specs.show(ref, 'specs/plan.md');
  if (!plan) return null;
  const main = specs.mainRef();
  const built = main ? specs.builtOn(main) : new Set();
  for (const r of specs.planFeatures(plan).rows) {
    if (skip.has(r.id) || built.has(r.id) || git('rev-parse', '--verify', '--quiet', `refs/heads/feature/${r.id}`) === null) continue;
    const p = git('show', `feature/${r.id}:specs/${r.id}/progress.md`);
    if (p === null || isDone(p) || blockedIn(p)) continue;
    if (/^Mode:\s*plan-all/m.test(git('show', `feature/${r.id}:specs/${r.id}/requirements.md`) || '')) return r.id;
  }
  return null;
}
// a session's uncommitted work, kept in a stash named for its feature when the build moves on from it
function keepLeftovers(id) {
  if (!git('status', '--porcelain')) return null;
  const name = `amk autopilot: ${id}, left unfinished ${stamp()}`;
  return git('stash', 'push', '--include-untracked', '-m', name) === null ? null : name;
}
function onBranch(id) {
  if (onIt(id)) return true;
  keepLeftovers((/^feature\/(.+)$/.exec(branchNow() || '') || [])[1] || branchNow() || 'no branch');
  return git('switch', '--quiet', `feature/${id}`) !== null;
}
// the handoff as the session left it, committed when it didn't (done, or blocked, is read from the branch)
function commitHandoff(id) {
  const f = `specs/${id}/progress.md`;
  if (!onIt(id) || git('diff', '--quiet', 'HEAD', '--', f) !== null) return;
  git('add', '--', f);
  git('commit', '--quiet', '-m', `docs(spec): ${id} handoff, as its session left it\n\nSpec: specs/${id}`);
}
// the feature waits for a person from now on: its handoff says why, committed on its branch (Status keeps its words)
function blockFeature(id, why) {
  if (!onBranch(id)) return false;
  const f = path.join(ROOT, 'specs', id, 'progress.md');
  const p = read(f);
  if (p === null) return false;
  const line = `Blocked:       ${oneLine(why, 500)} (autopilot.js, ${stamp()}; details in .amk/build/${id}/stop.md)`;
  fs.writeFileSync(f, /^Blocked:.*$/m.test(p) ? p.replace(/^Blocked:.*$/m, () => line) : `${p.replace(/\n*$/, '\n')}${line}\n`);
  git('add', '--', `specs/${id}/progress.md`);
  return git('commit', '--quiet', '-m', `docs(spec): ${id} blocked\n\n${oneLine(why, 300)}\n\nSpec: specs/${id}`) !== null;
}
function writeStop(id, why, s) {
  const log = (read(path.join(BUILD, id, 'build.log')) || '').split('\n');
  let tail = log.slice(-41).join('\n');
  const cut = log.length > 41 || tail.length > 6000;
  if (tail.length > 6000) tail = tail.slice(-6000);
  const text = [`# ${id}: stopped (${why.reason})`, '', `- When: ${stamp()}`,
    `- Why: ${why.reason}${why.reason === 'usage limit' ? `; it resets: ${why.reset}` : ''}`, `- A person must act: ${why.person ? 'yes' : 'no'}`,
    `- What to do: ${why.act.replace('<id>', id)}`, `- Last step: ${s.last || 'none'}`,
    `- Uncommitted work: ${git('status', '--porcelain') ? 'in the folder, for the next session (a stash named for it, if the build moved on)' : 'none'}`,
    '', '## What showed it', '', ...(why.lines.length ? why.lines.map(l => `    ${l}`) : ['    (no line names it: see the log)']),
    '', `## The log's last lines${cut ? ' (cut: build.log has all of it)' : ''}`, '', '```', tail, '```', ''].join('\n');
  fs.mkdirSync(path.join(BUILD, id), { recursive: true });
  fs.writeFileSync(path.join(BUILD, id, 'stop.md'), redact(text));
}

// ---------- GitHub: pull requests waiting, and blocked questions as issues ----------
const gh = args => { const r = run('gh', args, { timeout: 60000 }); try { return r.status === 0 ? JSON.parse(r.stdout || 'null') : null; } catch { return null; } };
// the repository's pull requests, or null without gh
const prs = () => gh(['pr', 'list', '--state', 'all', '--limit', '200', '--json', 'headRefName,state,reviewDecision']);
// why no new feature starts yet: too many of the plan's pull requests wait for review, or its first one does
function holdReason(cfg, list, ids) {
  if (!list) return null;
  const ours = list.filter(p => /^feature\//.test(p.headRefName) && ids.has(p.headRefName.slice(8)));
  const waiting = ours.filter(p => p.state === 'OPEN' && p.reviewDecision !== 'APPROVED');
  const limit = parseInt(cfg['open prs before the build waits'], 10) || 5;
  if (waiting.length >= limit) return `${waiting.length} of the plan's pull requests wait for review (Open PRs before the build waits: ${limit})`;
  if (on(cfg['first pr review']) && ours.length && !ours.some(p => p.state === 'MERGED' || p.reviewDecision === 'APPROVED')) {
    return 'the plan\'s first pull request waits for a person\'s review (First PR review: on)';
  }
  return null;
}
// what goes on GitHub: redacted, without paths on this machine
const publicText = t => redact(t).replace(/(?:\/(?:Users|home|private|var|tmp|opt|Volumes)\/|[A-Za-z]:\\)[^\s'"`)]*/g, '<path>');
function questionIssue(id, why) {
  const title = `Blocked: ${id}`;
  const found = (gh(['issue', 'list', '--state', 'open', '--search', `"${title}" in:title`, '--json', 'number,title,url']) || []).find(i => i.title === title);
  if (found) return found.url;
  const body = `The unattended build stopped ${id}:\n\n${publicText(why)}\n\nAnswer in a comment here: the next session on this feature reads it (m-continue ${id}).`;
  const r = run('gh', ['issue', 'create', '--title', title, '--body', body], { timeout: 60000 });
  return r.status === 0 ? r.stdout.trim().split('\n').pop() : null;
}
function question(id) {
  const list = gh(['issue', 'list', '--state', 'all', '--search', `"Blocked: ${id}" in:title`, '--json', 'number,title']);
  const issue = (list || []).find(i => i.title === `Blocked: ${id}`);
  if (!issue) { console.log(list ? `No issue "Blocked: ${id}" here.` : 'gh couldn\'t list the issues (is it installed and signed in?).'); return 1; }
  const v = gh(['issue', 'view', String(issue.number), '--json', 'body,comments']) || { body: '', comments: [] };
  const text = [v.body, ...(v.comments || []).map(c => `${(c.author || {}).login || 'someone'} (${String(c.createdAt || '').slice(0, 10)}):\n${c.body}`)].join('\n\n---\n\n');
  console.log(untrusted(text, `GitHub issue #${issue.number}`));
  return 0;
}

// ---------- notifications ----------
async function notify(title, text) {
  const t = redact(text).replace(/[\u0000-\u001f\u2028\u2029]+/g, ' ').slice(0, 300);
  try {
    if (process.platform === 'darwin') spawnSync('osascript', ['-e', `display notification ${JSON.stringify(t)} with title ${JSON.stringify(title)}`], { stdio: 'ignore', timeout: 10000 });
    else if (process.platform === 'linux') spawnSync('notify-send', [title, t], { stdio: 'ignore', timeout: 10000 });
  } catch {}
  if (!process.env.AMK_NOTIFY_URL) return;
  // Slack and Google Chat read text, Discord content; at most 10 seconds
  const post = fetch(process.env.AMK_NOTIFY_URL, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: `${title}: ${t}`, content: `${title}: ${t}` }) }).catch(() => {});
  await Promise.race([post, new Promise(r => setTimeout(r, 10000).unref())]);
}

// ---------- the build ----------
const freeGb = () => {
  const n = parseInt(process.env.AMK_DISK_GB, 10);
  if (!Number.isNaN(n)) return n;
  try { const s = fs.statfsSync(ROOT); return Math.floor((s.bavail * s.bsize) / 2 ** 30); } catch { return Infinity; }
};
async function build(o, d = {}) {
  const io = { session: runSession, sleep: ms => new Promise(r => setTimeout(r, ms)), now: Date.now, notify, prs, issue: questionIssue, log: console.log, ...d };
  const cfg = settings();
  const env = cleanEnv(process.env, cfg);
  const built = [];
  const blocked = [];
  const tries = new Map();
  const skip = new Set();
  const deadline = o.wait ? io.now() + o.wait * 3600e3 : 0;
  let end = null;
  let retry = null;
  const wait = async why => {
    if (!deadline || io.now() >= deadline) return false;
    io.log(`${stamp()} waiting: ${why}`);
    await io.sleep(Math.min(o.poll, deadline - io.now()));
    return true;
  };
  const isBlocked = async (id, why, stopped) => {
    if (stopped) blockFeature(id, why);
    skip.add(id);
    const kept = keepLeftovers(id);
    blocked.push({ id, why: oneLine(why, 200) });
    const issue = on(cfg['blocked questions as issues']) ? io.issue(id, why) : null;
    io.log(`${stamp()} ${id} blocked: ${oneLine(why, 300)}${issue ? ` (question: ${issue})` : ''}${kept ? ` (its uncommitted work: git stash list, "${kept}")` : ''}`);
    await io.notify('Build: a feature is blocked', `${id}: ${why}`);
  };
  for (;;) {
    if (fs.existsSync(STOP)) { end = { reason: 'stopped', text: '.amk/build/STOP is there (delete it before the next run)' }; break; }
    if (freeGb() < 5) { end = { ...REASONS[0], text: `only ${freeGb()} GB of disk is free: ${REASONS[0].act}` }; break; }
    let id = retry || unfinished(skip);
    retry = null;
    if (id && !onBranch(id)) { skip.add(id); io.log(`${stamp()} ${id}: couldn't switch to feature/${id} (checked out in another folder?), so it waits`); continue; }
    if (!id) {
      const ref = specs.planRef();
      const plan = ref && specs.show(ref, 'specs/plan.md');
      const hold = holdReason(cfg, io.prs(), new Set(plan ? specs.planFeatures(plan).rows.map(r => r.id) : []));
      if (hold) { if (await wait(hold)) continue; end = { reason: 'waiting for review', text: hold }; break; }
      const r = run(process.execPath, [path.join(__dirname, 'specs.js'), 'start']);
      const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
      const started = /^Started (\S+) on feature\//m.exec(out);
      if (r.status === 3) { if (await wait('no feature is ready')) continue; end = { reason: 'waiting for the plan', text: out }; break; }
      if (!started) { end = { reason: 'no feature could start', text: out }; break; }
      id = started[1];
      io.log(`${stamp()} ${out.split('\n')[0]}`);
      if (r.status === 4) { await isBlocked(id, `the living spec changed under it since the plan approved it, so it needs approving again: ${oneLine(out.split('\n').slice(2).join('; '), 400)}`, true); continue; }
    }
    const t = tries.get(id) || { sessions: 0, stall: null };
    tries.set(id, t);
    t.sessions++;
    const notes = (read(path.join(BUILD, 'notes.md')) || '').trim();
    const log = path.join(BUILD, id, 'build.log');
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.appendFileSync(log, `\n=== ${stamp()}: session ${t.sessions} of ${id} (${o.tool}${notes ? ', with notes.md' : ''})\n`);
    io.log(`${stamp()} ${id}: session ${t.sessions} (${o.tool}), logged in .amk/build/${id}/build.log`);
    const { cmd, args } = TOOLS[o.tool](id, unattended(id, notes), o);
    const s = await io.session({ id, cmd, args, env, log, stallMs: o.stall * 60e3 });
    commitHandoff(id);
    const p = fileOf(id, 'progress.md');
    if (isDone(p)) {
      // anything it left uncommitted would stop the next feature's start: kept in a stash named for it
      const kept = keepLeftovers(id);
      built.push(id);
      io.log(`${stamp()} ${id}: done${kept ? ` (it left changes uncommitted: git stash list, "${kept}")` : ''}`);
      continue;
    }
    if (blockedIn(p)) { await isBlocked(id, blockedIn(p), false); continue; }
    if (s.interrupted || fs.existsSync(STOP)) {
      writeStop(id, { reason: s.interrupted ? 'interrupted' : 'stopped', person: false, lines: [], act: 'run autopilot again: it goes on with this feature first' }, s);
      end = s.interrupted ? { reason: 'interrupted', text: 'stopped with Ctrl-C' } : { reason: 'stopped', text: '.amk/build/STOP is there (delete it before the next run)' };
      break;
    }
    const why = classify(s);
    writeStop(id, why, s);
    if (why.ends) { end = { ...why, text: `${why.act}${why.reason === 'usage limit' ? ` (it resets: ${why.reset})` : ''}` }; break; }
    const state = stateNow(id);
    if (['stall', 'provider overloaded'].includes(why.reason) && t.sessions < 3 && !(why.reason === 'stall' && t.stall === state)) {
      t.stall = state;
      retry = id;
      io.log(`${stamp()} ${id}: ${why.reason}, so it starts again from its handoff`);
      if (why.reason === 'provider overloaded') await io.sleep(120e3);
      continue;
    }
    await isBlocked(id, why.reason === 'stall' ? (t.stall === state ? 'stalled twice with nothing changed in between' : `stalled, and ${t.sessions} sessions didn't finish it`)
      : `${why.reason}: ${why.act.replace('<id>', id)}`, true);
  }
  const resume = `node scripts/amk/autopilot.js ${process.argv.slice(2).map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`.trim();
  const report = [`Build ended: ${end.reason}${end.text ? `\n${end.text.split('\n').map(l => `  ${l}`).join('\n')}` : ''}`,
    `Built: ${built.length ? built.join(', ') : 'none'}`,
    `Blocked: ${blocked.length ? blocked.map(b => `${b.id} (${b.why}; .amk/build/${b.id}/stop.md)`).join(', ') : 'none'}`,
    ...(end.reason !== 'no feature could start' ? [`To go on: ${resume}`] : [])].join('\n');
  fs.mkdirSync(BUILD, { recursive: true });
  fs.writeFileSync(path.join(BUILD, 'report.md'), `# Build of ${stamp()}\n\n${redact(report)}\n`);
  io.log(`\n${report}`);
  await io.notify('Build ended', `${end.reason}. Built: ${built.length}, blocked: ${blocked.length}`);
  return { end, built, blocked };
}

// ---------- before a build: the tool runs and is signed in ----------
function ready(tool, env) {
  const v = run(BIN[tool], ['--version'], { env });
  if (v.status !== 0) return `${BIN[tool]} isn't installed, or isn't on the PATH the run gets`;
  if (tool === 'claude') {
    let inn = false;
    try { inn = JSON.parse(run('claude', ['auth', 'status', '--json'], { env }).stdout).loggedIn === true; } catch {}
    if (!inn) return 'Claude Code isn\'t signed in for the run: claude auth login (or set CLAUDE_CODE_OAUTH_TOKEN, from claude setup-token)';
  }
  if (tool === 'codex') {
    if (run('codex', ['login', 'status'], { env }).status !== 0) return 'Codex isn\'t signed in for the run: codex login';
    const conf = read(path.join(env.CODEX_HOME || path.join(env.HOME || env.USERPROFILE || '', '.codex'), 'config.toml')) || '';
    // the folder trusted (or one it's in), and the guard's hook approved here: Codex runs a project's hooks only then.
    // The folder as Codex was opened with it: its real path, or through a link (/tmp)
    const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const trusted = d => new RegExp(`^\\[projects\\."${esc(d)}"\\]\\s*\\n\\s*trust_level\\s*=\\s*"trusted"`, 'm').test(conf);
    const roots = [...new Set([ROOT, path.resolve(__dirname, '..', '..')])];
    const up = d => [d, ...(path.dirname(d) === d ? [] : up(path.dirname(d)))];
    if (!roots.some(r => up(r).some(trusted))) return 'Codex doesn\'t trust this folder, so its hooks (the guard) wouldn\'t run: open the project in Codex once and trust it';
    if (!codexHooksVetted() && !roots.some(r => conf.includes(`[hooks.state."${path.join(r, '.codex', 'hooks.json')}:pre_tool_use:`))) {
      return 'Codex hasn\'t approved this project\'s hooks, and they aren\'t only the kit\'s as committed (git status .codex scripts/amk), so the guard might not run: approve them in Codex, or commit the kit\'s';
    }
  }
  return null;
}
async function check(tool) {
  const env = cleanEnv(process.env, settings());
  let bad = 0;
  const say = (ok, text) => { if (ok === false) bad++; console.log(`${ok === true ? '✓' : ok === false ? '✗' : '!'} ${text}`); };
  const notReady = ready(tool, env);
  say(!notReady, notReady || `${BIN[tool]} runs and is signed in, in the run's environment`);
  if (tool === 'codex') say(null, 'Codex\'s macOS sandbox blocks the iOS simulator: features are checked on Android, and iOS is left for a person (blocked, not failed)');
  if (tool === 'antigravity') {
    const r = run('agy', ['-p', '/permissions', '--output-format', 'json'], { env, timeout: 60000 });
    let rules = [];
    try { rules = JSON.parse(r.stdout).command.data.permissions.flatMap(x => x.allow || []); } catch {}
    const missing = agyRules().filter(x => !rules.includes(x));
    say(!missing.length, missing.length ? `Antigravity's allow rules lack ${missing.length} of the build's commands. Add them in agy (/permissions, this project's scope):\n${missing.map(x => `    ${x}`).join('\n')}`
      : 'Antigravity allows the build\'s commands');
    say(null, 'Antigravity reads allow rules from its own settings only, so the ones there that allow more apply to the build too. Its permission mode must ask (not always-proceed or auto): the build stops a session that skips prompts. Its hooks (the guard) run only in a folder it trusts');
  }
  const ghOk = run('gh', ['auth', 'status'], { env }).status === 0;
  say(ghOk || null, ghOk ? 'gh is signed in, so the build opens pull requests' : 'gh isn\'t signed in for the run: features are pushed, but no pull request is opened (gh auth login, or GH_TOKEN)');
  say(env.GH_TOKEN ? true : null, env.GH_TOKEN ? 'GH_TOKEN is set: the run works as that token' : 'GH_TOKEN isn\'t set, so the build works as your own GitHub login, with all its rights. Make a fine-grained token for this repository only (contents, pull requests and issues: read and write; actions: read), and set GH_TOKEN when you start autopilot');
  const origin = git('remote', 'get-url', 'origin') !== null;
  say(origin || null, origin ? 'the origin remote is there, for pushes' : 'no origin remote: features are built and committed, but not pushed');
  say(Boolean(specs.planRef()), specs.planRef() ? `the plan is on ${specs.planRef()}` : 'no plan branch here yet: /m-feature plan makes one');
  say(freeGb() >= 8 || (freeGb() >= 5 ? null : false), `${freeGb()} GB of disk free (a build stops under 5, a first iOS build under 8)`);
  console.log(`  the run passes these variables: ${Object.keys(env).sort().join(', ')}`);
  for (const mode of ['quick', 'build']) {
    console.log(`\nsh scripts/amk/verify.sh ${mode}, in the run's environment${mode === 'build' ? ' (the release builds: some minutes)' : ''}:`);
    const r = run('sh', ['scripts/amk/verify.sh', mode], { env });
    console.log(`${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-12).map(l => `  ${l}`).join('\n'));
    say(r.status === 0, `verify.sh ${mode} ${r.status === 0 ? 'passes' : 'fails'} in the run's environment${r.status === 0 ? '' : ': if it passes in your own shell, a variable it needs is missing: add its name to Variables for unattended runs in docs/amk/team-process.md'}`);
  }
  return bad ? 1 : 0;
}

module.exports = { settings, cleanEnv, claudeProfile, agyRules, unattended, TOOLS, describe, classify, resetTime, holdReason, build, runSession, REASONS, PASS, GUARDRAILS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
  const head = fs.readFileSync(process.argv[1], 'utf8').split('\n').slice(1);
  const usage = () => { console.error(head.slice(0, head.findIndex(l => !l.startsWith('//'))).map(l => l.slice(3)).filter((_, i, a) => i >= a.findIndex(x => x.startsWith('Usage'))).join('\n')); process.exit(2); };
  process.chdir(ROOT);
  const tool = opt('--tool', 'claude');
  if (!TOOLS[tool] || args.some(a => /^--?(dangerously|yolo|skip-perm|bypass)/i.test(a))) usage();
  if (args[0] === 'question') process.exit(args[1] ? question(args[1]) : usage());
  // no return at the top level: the app's own ESLint, which may lint this folder, can't parse one
  if (args[0] === 'check') check(tool).then(c => process.exit(c));
  else {
    // only the options above, each with its value: anything else (--help too) shows the usage and starts nothing
    const known = ['--tool', '--wait', '--budget', '--model', '--stall'];
    if (args.some((a, i) => (i % 2 ? false : !known.includes(a))) || args.length % 2) usage();
    const o = { tool, wait: parseFloat(opt('--wait', '0')) || 0, budget: parseFloat(opt('--budget', '25')) || 25, model: opt('--model', null),
      stall: parseFloat(opt('--stall', '20')) || 20, poll: 5 * 60e3 };
    const notReady = ready(tool, cleanEnv(process.env, settings()));
    if (notReady) { console.error(notReady); process.exit(1); }
    // one build at a time in this folder
    fs.mkdirSync(BUILD, { recursive: true });
    const lock = path.join(BUILD, 'lock');
    const pid = parseInt(read(lock), 10);
    if (pid && pid !== process.pid) { try { process.kill(pid, 0); console.error(`A build already runs here (process ${pid}).`); process.exit(1); } catch {} }
    fs.writeFileSync(lock, String(process.pid));
    process.on('exit', () => { try { if (parseInt(read(lock), 10) === process.pid) fs.unlinkSync(lock); } catch {} });
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (current) { current.interrupted = true; stopChild(current); } else process.exit(130); });
    if (fs.existsSync(STOP)) { fs.unlinkSync(STOP); console.log('(removed the STOP file an earlier build left)'); }
    // the Mac stays awake while it works (a closed lid still needs power, and the system's lid setting)
    if (process.platform === 'darwin') { try { spawn('caffeinate', ['-is', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref(); } catch {} }
    build(o).then(r => process.exit(['waiting for the plan', 'waiting for review', 'stopped'].includes(r.end.reason) ? 0 : 1));
  }
}
