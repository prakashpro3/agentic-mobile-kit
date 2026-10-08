#!/usr/bin/env node
const { version } = require('../package.json');
const { init, printSummary, InitError, TOOLS } = require('../lib/init');
const { doctor, printDoctor } = require('../lib/doctor');

const [cmd, ...rest] = process.argv.slice(2);
const flag = name => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

const help = `agentic-mobile-kit ${version}

Usage:
  npx agentic-mobile-kit init [--tools claude,codex,antigravity] [--pm yarn|npm|pnpm|bun]
  npx agentic-mobile-kit doctor

Commands:
  init     Install the kit into a bare React Native project (run in the app's root).
  doctor   Check the project and this machine, with a fix for each problem.

Options:
  --tools  AI tools your team uses: ${Object.keys(TOOLS).join(', ')} (default: claude,codex,antigravity)
  --pm     Package manager, if it can't be detected from the lockfile`;

if (cmd === '--version' || cmd === '-v') {
  console.log(version);
} else if (cmd === 'init') {
  try {
    const tools = flag('tools') ? flag('tools').split(',').map(s => s.trim()).filter(Boolean) : undefined;
    printSummary(init(process.cwd(), { tools, pm: flag('pm') }));
  } catch (e) {
    if (!(e instanceof InitError)) throw e;
    console.error(`init stopped: ${e.message}`);
    process.exitCode = 1;
  }
} else if (cmd === 'doctor') {
  if (printDoctor(doctor(process.cwd())) > 0) process.exitCode = 1;
} else {
  console.log(help);
  if (cmd && cmd !== 'help' && cmd !== '--help' && cmd !== '-h') process.exitCode = 1;
}
