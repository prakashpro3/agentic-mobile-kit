'use strict';
// `agentic-mobile-kit doctor`: checks the project and this machine, and says how to fix each problem.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { tool, hookManager, hooksWired } = require('./init');

const RULESYNC = 'rulesync@27.0.0';

// run a command; return trimmed stdout, or null if it isn't installed or fails
function run(cmd, args, opts = {}) {
  const r = tool(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000, ...opts });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}
const WIN = process.platform === 'win32';
// where Android Studio puts the SDK by default on each OS
const defaultSdk = () => (WIN ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'Android', 'Sdk')
  : process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Android/sdk') : path.join(os.homedir(), 'Android/Sdk'));
const version = s => (String(s || '').match(/(\d+)\.(\d+)(?:\.(\d+))?/) || []).slice(1).map(n => Number(n || 0));
const atLeast = (v, min) => { for (let i = 0; i < 3; i++) { if ((v[i] || 0) !== min[i]) return (v[i] || 0) > min[i]; } return true; };
const read = (cwd, f) => { try { return fs.readFileSync(path.join(cwd, f), 'utf8'); } catch { return null; } };

const ok = (label, detail = '') => ({ level: 'ok', label, detail });
const warn = (label, fix) => ({ level: 'warn', label, fix });
const fail = (label, fix) => ({ level: 'fail', label, fix });

function projectChecks(cwd, opts) {
  const out = [];
  const agents = read(cwd, 'AGENTS.md');
  if (!agents || !/<!-- KIT:START/.test(agents) || !fs.existsSync(path.join(cwd, '.agents/skills/m-feature/SKILL.md'))) {
    out.push(fail('Kit installed', 'run: npx agentic-mobile-kit init'));
    return out; // the rest needs the kit
  }
  out.push(ok('Kit installed'));

  const lines = agents.split('\n').length;
  const bytes = Buffer.byteLength(agents);
  out.push(lines <= 150 && bytes <= 8192
    ? ok('AGENTS.md size', `${lines} lines`)
    : warn(`AGENTS.md is ${lines} lines / ${bytes} bytes`, 'keep it under 150 lines and 8 KB; tools truncate or ignore long files. Move details to docs/ai/'));

  let pkg = {};
  try { pkg = JSON.parse(read(cwd, 'package.json') || '{}'); } catch {}
  const manager = hookManager(cwd, pkg);
  if (!manager) {
    const hooksPath = run('git', ['config', 'core.hooksPath'], { cwd });
    out.push(hooksPath === '.githooks'
      ? ok('Git hooks active')
      : fail('Git hooks not active on this clone', 'run: git config core.hooksPath .githooks (your package manager\'s install does this too)'));
  } else if (manager.manual) {
    out.push(warn(`Git hooks run from ${manager.name}, without the kit's checks`, 'add "sh .githooks/pre-commit" and "sh .githooks/pre-push" to those hooks'));
  } else if (!hooksWired(cwd, manager)) {
    out.push(fail(`The kit's checks aren't in your ${manager.name} hooks`, 'run: npx agentic-mobile-kit sync'));
  } else {
    // what git runs: core.hooksPath, or .git/hooks
    const dir = run('git', ['rev-parse', '--git-path', 'hooks'], { cwd });
    out.push(dir && fs.existsSync(path.join(cwd, dir, 'pre-commit'))
      ? ok('Git hooks active', `the kit's checks run from ${manager.name}`)
      : fail(`${manager.name} isn't set up on this clone, so no git hooks run`, 'run your package manager\'s install'));
  }

  if (fs.existsSync(path.join(cwd, 'scripts/ai/case-check.js'))) {
    const r = spawnSync(process.execPath, ['scripts/ai/case-check.js'], { cwd, encoding: 'utf8' });
    const lines = (r.stderr || '').trim().split('\n');
    out.push(r.status === 0 ? ok('File names match git') : fail(`Renamed only in letter case, and git missed it:${lines.slice(1, -1).join(',')}`, lines.pop()));
  }

  const tracked = (run('git', ['ls-files'], { cwd }) || '').split('\n').filter(f => /(^|\/)\.env(\.[\w.-]+)?$/.test(f) && !/\.(example|sample|template)$/.test(f));
  out.push(tracked.length ? fail(`Secret files tracked by git: ${tracked.join(', ')}`, 'git rm --cached them, rotate the secrets, keep them out of the repo') : ok('No .env files in git'));

  const claudeLink = path.join(cwd, '.claude/skills');
  if (fs.existsSync(path.join(cwd, '.claude/settings.json'))) {
    out.push(fs.existsSync(path.join(claudeLink, 'm-feature/SKILL.md'))
      ? ok('Claude Code skills link')
      : fail('.claude/skills link missing or broken', WIN
        ? 'turn on Developer Mode (Settings > System > For developers), run "git config core.symlinks true", then "npx agentic-mobile-kit init" again'
        : 'run: ln -sfn ../.agents/skills .claude/skills'));
  }

  if (!opts.skipNetwork && fs.existsSync(path.join(cwd, 'rulesync.jsonc'))) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_(config|package|lifecycle)_/i.test(k)));
    const r = tool('npx', ['-y', RULESYNC, 'generate', '--check'], { cwd, env, encoding: 'utf8', timeout: 120000 });
    out.push(r.status === 0
      ? ok('Tool configs match .rulesync/')
      : warn('Tool configs out of date with .rulesync/', `run: npx -y ${RULESYNC} generate, then commit`));
  }

  const unfilled = ['product', 'tech', 'structure', 'conventions'].filter(n => {
    const t = read(cwd, `docs/ai/${n}.md`);
    return t !== null && t.replace(/<!--[\s\S]*?-->/g, '').replace(/^#.*$/gm, '').trim() === '';
  });
  out.push(unfilled.length
    ? warn(`docs/ai not filled in: ${unfilled.join(', ')}`, 'describe the app there; agents build better with it')
    : ok('docs/ai filled in'));
  return out;
}

function machineChecks(cwd) {
  const out = [];
  const node = version(process.versions.node);
  out.push(node[0] >= 20 ? ok('Node', process.versions.node) : fail(`Node ${process.versions.node}`, 'install Node 20 or newer'));

  const pm = fs.existsSync(path.join(cwd, 'yarn.lock')) ? 'yarn' : fs.existsSync(path.join(cwd, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm';
  out.push(run(pm, ['--version'], { cwd }) ? ok(`Package manager (${pm})`) : fail(`${pm} not found`, pm === 'npm' ? 'install Node' : 'run: corepack enable'));
  out.push(fs.existsSync(path.join(cwd, 'node_modules')) ? ok('Dependencies installed') : fail('Dependencies not installed', 'run: sh scripts/ai/install-deps.sh'));

  // iOS (macOS only)
  if (process.platform === 'darwin') {
    const xcode = run('xcodebuild', ['-version']);
    out.push(xcode ? ok('Xcode', xcode.split('\n')[0]) : fail('Xcode not found', 'install Xcode from the App Store, then: sudo xcode-select -s /Applications/Xcode.app'));
    out.push(run('pod', ['--version']) ? ok('CocoaPods') : fail('CocoaPods not found', 'install it: brew install cocoapods'));
    if (fs.existsSync(path.join(cwd, 'ios'))) {
      out.push(fs.existsSync(path.join(cwd, 'ios/Pods')) ? ok('iOS pods installed') : warn('iOS pods not installed', 'run: cd ios && pod install'));
    }
    const sims = run('xcrun', ['simctl', 'list', 'devices', 'available']);
    out.push(sims && /iPhone/.test(sims) ? ok('iPhone simulator available') : warn('No iPhone simulator', 'add one in Xcode > Settings > Components / Window > Devices and Simulators'));
  }

  // Android
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || defaultSdk();
  const adb = path.join(sdk, 'platform-tools', WIN ? 'adb.exe' : 'adb');
  out.push(fs.existsSync(adb) ? ok('Android SDK', sdk) : fail('Android SDK not found', 'install Android Studio, or set ANDROID_HOME'));
  const avds = run(path.join(sdk, 'emulator/emulator'), ['-list-avds']);
  out.push(avds ? ok('Android emulator', avds.split('\n')[0]) : warn('No Android emulator', 'create one in Android Studio > Device Manager'));
  const java = spawnSync('java', ['-version'], { encoding: 'utf8' });
  const jv = version((java.stderr || '').match(/version "([^"]+)"/)?.[1]);
  out.push(jv[0] >= 17 ? ok('Java', jv.join('.')) : fail(java.error ? 'Java not found' : `Java ${jv.join('.')}`, 'install JDK 17 (e.g. the one bundled with Android Studio)'));

  // tools the checks use
  const maestro = run('maestro', ['--version']);
  const ciMaestro = (read(cwd, '.github/workflows/e2e.yml') || '').match(/MAESTRO_VERSION:\s*([\d.]+)/)?.[1];
  if (!maestro) out.push(warn('Maestro not installed (needed by verify.sh)', 'install: curl -fsSL https://get.maestro.mobile.dev | bash'));
  else {
    const mv = (maestro.split('\n').pop() || '').trim();
    out.push(ciMaestro && mv !== ciMaestro
      ? warn(`Maestro ${mv} here, ${ciMaestro} in CI`, `use the same version: MAESTRO_VERSION=${ciMaestro} curl -fsSL https://get.maestro.mobile.dev | bash`)
      : ok('Maestro', mv));
  }
  out.push(run('gitleaks', ['version']) ? ok('gitleaks') : warn('gitleaks not installed', 'pre-commit falls back to a basic secret check; install: brew install gitleaks'));
  return out;
}

function aiToolChecks(cwd) {
  const out = [];
  const home = os.homedir();
  const real = fs.realpathSync(cwd);

  if (process.env.ANTHROPIC_API_KEY) {
    out.push(warn('ANTHROPIC_API_KEY is set in this shell', 'Claude Code bills this API key instead of your Claude subscription; unset it if that isn\'t intended'));
  }

  const codexCfg = read(home, '.codex/config.toml');
  if (codexCfg !== null && fs.existsSync(path.join(cwd, '.codex'))) {
    const trusted = [cwd, real].some(p => codexCfg.includes(`[projects."${p}"]`) && new RegExp(`\\[projects\\."${p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"\\][^\\[]*trust_level\\s*=\\s*"trusted"`).test(codexCfg));
    out.push(trusted
      ? ok('Codex trusts this project', 'its hooks still need approving once in Codex')
      : warn('Codex doesn\'t trust this project yet', 'open the project in Codex once, trust it and approve its hooks; until then the guard hook is off in Codex'));
  }

  const agy = run('agy', ['--version']);
  if (agy) {
    out.push(atLeast(version(agy), [1, 3, 0]) ? ok('Antigravity CLI', agy) : warn(`Antigravity CLI ${agy}`, 'update: agy update (versions before 1.3 ignore AGENTS.md)'));
    let trusted = false;
    try { trusted = (JSON.parse(read(home, '.gemini/antigravity-cli/settings.json') || '{}').trustedWorkspaces || []).some(p => p === cwd || p === real); } catch {}
    out.push(trusted ? ok('Antigravity trusts this project') : warn('Antigravity doesn\'t trust this project yet', 'open it in Antigravity once and trust the folder'));
  }
  return out;
}

function doctor(cwd, opts = {}) {
  return [
    ['Project', projectChecks(cwd, opts)],
    ['This machine', machineChecks(cwd)],
    ['AI tools', aiToolChecks(cwd)],
  ];
}

function printDoctor(sections, log = console.log) {
  const icon = { ok: '✓', warn: '!', fail: '✗' };
  let failures = 0;
  let warnings = 0;
  for (const [title, checks] of sections) {
    log(`\n${title}`);
    for (const c of checks) {
      if (c.level === 'fail') failures++;
      if (c.level === 'warn') warnings++;
      log(`  ${icon[c.level]} ${c.label}${c.detail ? ` (${c.detail})` : ''}`);
      if (c.fix) log(`      → ${c.fix}`);
    }
  }
  log(`\n${failures} problem(s), ${warnings} warning(s).`);
  return failures;
}

module.exports = { doctor, printDoctor, projectChecks };
