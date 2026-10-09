#!/usr/bin/env node
const { version } = require('../package.json');
const { init, sync, uninstall, printSummary, printSync, printUninstall, InitError, TOOLS, CI } = require('../lib/init');
const { doctor, printDoctor } = require('../lib/doctor');

const [cmd, ...rest] = process.argv.slice(2);
const flag = name => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const list = name => (flag(name) ? flag(name).split(',').map(s => s.trim()).filter(Boolean) : undefined);

const help = `agentic-mobile-kit ${version}

Usage:
  npx agentic-mobile-kit init [--tools claude,codex,antigravity] [--ci github,codemagic] [--pm yarn|npm|pnpm|bun]
  npx agentic-mobile-kit sync [--ci github,codemagic] [--from <version>]
  npx agentic-mobile-kit uninstall [--from <version>]
  npx agentic-mobile-kit doctor

Commands:
  init       Install the kit into a React Native or Expo app (run in the app's root).
  sync       Update the kit's files to this version. Your own changes to them are merged in, not lost.
  uninstall  Remove the kit's files and sections. Files you changed are kept and listed.
  doctor     Check the project and this machine, with a fix for each problem.

Options:
  --tools  AI tools your team uses: ${Object.keys(TOOLS).join(', ')} (default: claude,codex,antigravity)
  --ci     CI to set up, only if the app uses it: ${Object.keys(CI).join(', ')} (GitHub Actions checks, Codemagic signed builds; default: none)
  --pm     Package manager, if it can't be detected from the lockfile
  --from   The kit version that installed the project; needed only for installs made before 0.4.0`;

// init, sync and uninstall stop with a plain message when the project isn't ready for them
function run(name, fn) {
  try { fn(); } catch (e) {
    if (!(e instanceof InitError)) throw e;
    console.error(`${name} stopped: ${e.message}`);
    process.exitCode = 1;
  }
}

if (cmd === '--version' || cmd === '-v') {
  console.log(version);
} else if (cmd === 'init') {
  run('init', () => {
    printSummary(init(process.cwd(), { tools: list('tools'), ci: list('ci'), pm: flag('pm') }));
  });
} else if (cmd === 'sync') {
  run('sync', () => printSync(sync(process.cwd(), { from: flag('from'), ci: list('ci'), pm: flag('pm') })));
} else if (cmd === 'uninstall') {
  run('uninstall', () => printUninstall(uninstall(process.cwd(), { from: flag('from'), pm: flag('pm') })));
} else if (cmd === 'doctor') {
  if (printDoctor(doctor(process.cwd())) > 0) process.exitCode = 1;
} else {
  console.log(help);
  if (cmd && cmd !== 'help' && cmd !== '--help' && cmd !== '-h') process.exitCode = 1;
}
