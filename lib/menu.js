'use strict';
// `npx agentic-mobile-kit` with no command, in a terminal: what the kit can do in this app, asked one step at a time.
// It returns the command to run and prints it, so people learn the commands that scripts, CI and agents use.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { checkProject, recorded, installedCi, InitError, TOOLS, TESTED, CI, KIT_VERSION, tool, cleanEnv } = require('./init');

const NAMES = { claude: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity', cursor: 'Cursor', opencode: 'OpenCode', kiro: 'Kiro' };
const CI_NAMES = { github: 'GitHub Actions', codemagic: 'Codemagic' };
const CI_LABELS = { github: 'GitHub Actions: checks on every pull request', codemagic: 'Codemagic: signed store builds' };
const and = a => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0]);
const newer = (a, b) => a.localeCompare(b, 'en', { numeric: true }) > 0;
class Closed extends Error {}

// the version npm installs now; null when that can't be checked (offline, no npm)
function latestVersion(cwd) {
  const r = tool('npm', ['view', 'agentic-mobile-kit', 'version'], { cwd, env: cleanEnv(), encoding: 'utf8', timeout: 8000 });
  const v = (r.stdout || '').trim();
  return r.status === 0 && /^\d+\.\d+\.\d+$/.test(v) ? v : null;
}

async function menu(cwd, { input = process.stdin, output = process.stdout, latest = latestVersion } = {}) {
  const rl = readline.createInterface({ input, output });
  // Ctrl-C ends the menu, like Ctrl-D (readline alone would only pause)
  rl.on('SIGINT', () => rl.close());
  let closed = false;
  rl.on('close', () => { closed = true; });
  const lines = rl[Symbol.asyncIterator]();
  const say = s => output.write(`${s}\n`);
  const ask = async q => {
    // piped answers can outlast the input, which closes readline
    if (closed) output.write(q);
    else {
      rl.setPrompt(q);
      rl.prompt();
    }
    const { value, done } = await lines.next();
    if (done) throw new Closed();
    return value.trim();
  };
  const show = (question, items) => {
    say(`\n${question}`);
    items.forEach((it, i) => say(`  ${i + 1}. ${it.label}`));
  };
  // one item: Enter takes the default, anything else is asked again
  const pick = async (question, items, def = 0) => {
    show(question, items);
    for (;;) {
      const item = items[Number((await ask(`Choose 1-${items.length} [${def + 1}]: `)) || def + 1) - 1];
      if (item) return item;
    }
  };
  const pickSome = async (question, items, defaults) => {
    show(question, items);
    const def = items.flatMap((it, i) => (defaults.includes(it.value) ? [i + 1] : [])).join(',');
    for (;;) {
      const chosen = ((await ask(`Numbers, separated by commas [${def}]: `)) || def).split(/[\s,]+/).filter(Boolean).map(n => items[Number(n) - 1]);
      if (chosen.length && chosen.every(Boolean)) return items.filter(it => chosen.includes(it)).map(it => it.value);
    }
  };
  const yes = async (question, def) => {
    const a = (await ask(`${question} [${def ? 'Y/n' : 'y/N'}]: `)).toLowerCase();
    return a ? a.startsWith('y') : def;
  };
  const ciItems = groups => [...groups.map(g => ({ label: CI_LABELS[g], value: [g] })), ...(groups.length > 1 ? [{ label: 'Both', value: groups }] : [])];

  try {
    say(`agentic-mobile-kit ${KIT_VERSION}`);
    // npx can run an older copy it keeps in its cache
    const next = latest(cwd);
    if (next && newer(next, KIT_VERSION) && await yes(`Version ${next} is out. Use it?`, true)) {
      rl.close();
      process.exitCode = tool('npx', ['-y', `agentic-mobile-kit@${next}`], { cwd, stdio: 'inherit', env: cleanEnv() }).status ?? 1;
      return null;
    }

    let problem = '';
    try { checkProject(cwd); } catch (e) {
      if (!(e instanceof InitError)) throw e;
      problem = e.message;
    }
    let agents = '';
    try { agents = fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8'); } catch {}
    const doctor = { label: 'Check this project and machine (doctor)', args: ['doctor'] };
    const quit = { label: 'Quit', args: null };
    let items;
    let def = 0;
    if (!/<!-- KIT:START/.test(agents)) {
      say('The kit isn\'t installed here.');
      items = [
        { label: `Install it for ${and(TESTED.map(t => NAMES[t]))}, without CI (init)`, args: ['init'], changes: true },
        {
          label: 'Install it and choose the AI tools and CI',
          changes: true,
          steps: async () => {
            const tools = await pickSome('Which AI tools does your team use?',
              Object.keys(TOOLS).map(t => ({ value: t, label: `${NAMES[t]}${TESTED.includes(t) ? '' : ' (not tested yet)'}` })), TESTED);
            const ci = (await pick('Set up CI? Only if the app uses it.', [{ label: 'No CI', value: [] }, ...ciItems(Object.keys(CI))])).value;
            return ['init', ...(String(tools) === String(TESTED) ? [] : ['--tools', tools.join(',')]), ...(ci.length ? ['--ci', ci.join(',')] : [])];
          },
        },
        doctor, quit,
      ];
    } else {
      const from = recorded(agents).version;
      const ci = installedCi(cwd, agents);
      const missing = Object.keys(CI).filter(g => !ci.includes(g));
      const update = !from || newer(KIT_VERSION, from);
      say(`Kit ${from || '(an early version)'} is installed here. CI: ${ci.length ? and(ci.map(g => CI_NAMES[g])) : 'none'}.`);
      if (from && newer(from, KIT_VERSION)) problem ||= `This app has kit ${from}, newer than this copy (${KIT_VERSION}). Run: npx agentic-mobile-kit@latest`;
      items = [
        { label: update ? `Update the kit${from ? ` from ${from}` : ''} to ${KIT_VERSION} (sync)` : 'Sync the kit again; it\'s up to date (sync)', args: ['sync'], changes: true },
        missing.length && {
          label: `Add CI: ${missing.map(g => CI_NAMES[g]).join(' or ')}${update ? ', and update the kit' : ''} (sync --ci)`,
          changes: true,
          steps: async () => ['sync', '--ci', (missing.length > 1 ? (await pick('Which CI?', ciItems(missing))).value : missing).join(',')],
        },
        doctor,
        { label: 'Remove the kit (uninstall)', args: ['uninstall'], changes: true, confirm: 'Remove the kit from this app? Files you changed are kept, and git can undo it.' },
        quit,
      ].filter(Boolean);
      def = update ? 0 : items.indexOf(doctor);
    }
    // installing, updating and removing need a clean git repository: say why they aren't offered
    if (problem) {
      say(`! ${problem}`);
      items = items.filter(it => !it.changes);
      def = 0;
    }

    const choice = await pick('What would you like to do?', items, def);
    if (choice.confirm && !(await yes(choice.confirm, false))) {
      say('Nothing changed.');
      return null;
    }
    const args = choice.steps ? await choice.steps() : choice.args;
    if (args) say(`\nRunning: npx agentic-mobile-kit ${args.join(' ')}\n`);
    return args;
  } catch (e) {
    if (!(e instanceof Closed)) throw e;
    say('');
    return null;
  } finally {
    rl.close();
  }
}

module.exports = { menu };
