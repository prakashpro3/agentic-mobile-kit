# agentic-mobile-kit

One setup for AI-assisted development of bare React Native apps. Every AI tool on the team reads the same rules, project knowledge and workflows. Git hooks and CI check the work, whichever person or tool wrote it. A task started in one tool, or on one machine, carries on in another.

Tested with Claude Code, Codex and Antigravity. `--tools` also sets up Cursor, OpenCode and Kiro.

## Install

In the root of a bare React Native app (one with `ios/` and `android/` folders), on a clean git working tree:

```sh
npx agentic-mobile-kit init
```

| Option | What it does |
|---|---|
| `--tools claude,codex,antigravity` | The AI tools your team uses (this is the default) |
| `--ci github,codemagic` | Adds GitHub Actions checks, Codemagic signed builds, or both. Leave it out if the app has no CI. |
| `--pm yarn` | The package manager, if the lockfile doesn't show it |

`init` never overwrites a file. Besides adding the kit's files, it:
- adds its section to an existing `AGENTS.md` between `KIT` markers, and an `@AGENTS.md` line to an existing `CLAUDE.md`;
- records the kit version and CI choice in that section, so `sync` knows what's installed;
- adds `.env`, `.env.*` and `.ai/` to `.gitignore`;
- adds a `typecheck` script for TypeScript apps;
- adds a `postinstall` script that turns on the git hooks for every clone;
- turns on the git hooks for this clone too;
- generates each chosen tool's permissions, hooks and reviewer agent, and links the skills folder for Claude Code and Kiro.

It's safe to run again. Undo it with git.

Then check the project and your machine:

```sh
npx agentic-mobile-kit doctor
```

`doctor` gives a fix for each problem it finds, in three groups:
- **The project:** the kit is installed, `AGENTS.md` is within its size limit, the git hooks are active, no `.env` file is in git, the tool configs are current, and `docs/ai/` is filled in.
- **This Mac:** Node, installed dependencies, Xcode, CocoaPods and pods, an iPhone simulator, the Android SDK and an emulator, Java, Maestro (the same version as CI) and gitleaks.
- **The AI tools:** whether Codex and Antigravity trust the project, the Antigravity version, and an `ANTHROPIC_API_KEY` in the shell that would override a Claude subscription.

## How work flows

| You want to | Run | What happens |
|---|---|---|
| Think a problem through | `m-explore` | The agent reads the code, explains how it works today and lays out options with trade-offs. It never edits code. |
| Build a feature | `m-feature` | Requirements → you approve → design and tasks → you approve → one task at a time with tests → device checks with screenshots → living spec updated → review → PR |
| Fix a bug | `m-bugfix` | Reproduces the bug, proves it with a failing test, finds the root cause, then makes the smallest fix |
| Stop, or switch tool or machine | `m-pause` | Writes a handoff in the spec, commits and pushes |
| Carry on anywhere | `m-continue` | Reads the spec and handoff, then picks up at the next step |
| Review a branch | `m-review` | Checks the work against the spec (complete, correct, coherent) and covers both platforms, error states, security and native changes |
| Ship a release | `m-release` | Changelog from real commits, store and client notes, versions, release check, release PR, tag, signed builds |
| Stop a mistake repeating | `m-learn` | Turns a correction into a lasting check, a known-issues entry or a rule |

Invoke a skill with `/m-feature` in Claude Code and Antigravity, or `$m-feature` in Codex. The skills are set to run only when you invoke them.

## What it adds to the app

| Area | What you get |
|---|---|
| Project knowledge | `AGENTS.md` (with a one-line `CLAUDE.md`): commands, the definition of done and the rules. `docs/ai/`: product, tech stack, structure, conventions, decisions, known issues, React Native rules and team process. Callstack's React Native skills. |
| Specs | `specs/<id>/` for each feature: requirements, design, tasks, a Maestro flow and a handoff file. A living spec of what the app does now, in `specs/current/`. `spec.js`: `check`, `merge`, `status`. |
| Device checks | `verify.sh`: lint and tests, release builds on an iPhone simulator and an Android emulator, the feature's Maestro flow, and screenshots in `.ai/evidence/<id>/` |
| Releases | `release-check.js` catches what store review would reject. Changelog and store notes come from commits (git-cliff). `set-version.sh` sets versions. Signed builds come from `release-build.sh` or Codemagic (`--ci codemagic`). |
| Guardrails in AI tools | Hooks that block destructive commands and secret files and remind the agent about the handoff, permission rules, and a read-only reviewer, generated with rulesync |
| Git hooks | Before a commit: secrets, signing files, Xcode project files, ESLint, spec format. Before a push: typecheck and tests. |
| CI (`--ci github`) | Lint, typecheck, tests, a secret scan, a tool-config check, a 600-line PR limit (`large-pr` label), Android and iOS builds, nightly end-to-end tests (`e2e` label), and a PR template |
| Everyday scripts | `install-deps.sh`, `pm-run.sh`, `ios-build.sh` |

All scripts are in `scripts/ai/`. The [team guide](docs/team-guide.md) has the details.

## Alongside other AI workflows

Apps that already use Superpowers, BMAD, proAgents or similar keep them as they are. The kit adds its section next to theirs and links its skills into an existing `.claude/skills` folder. A task started with an `m-` skill follows the kit's steps, and everything else keeps working as before.

## Update or remove

```sh
npx agentic-mobile-kit@latest sync   # update the kit's files, merging in your own changes
npx agentic-mobile-kit uninstall     # remove the kit; files you changed are kept and listed
```

Both need a clean working tree and leave the result for you to review with `git diff`.
- **Report:** `sync` lists what it updated, added, removed and merged.
- **Conflicts:** if you and the kit changed the same lines, the file gets `<<<<<<<` conflict markers to resolve.
- **Your docs:** the product, tech, structure and conventions files your team filled in are never changed.
- **Adding CI later:** `sync --ci github` or `--ci codemagic` does it.
- **Older installs:** installs from before 0.4.0 pass the kit version they started from, for example `--from 0.3.0`.
- **What `uninstall` leaves:** the `.gitignore` lines and the `typecheck` script.

## Requirements

- macOS, git and Node.js 20 or later. `doctor` checks everything else.

## More

- [Team guide](docs/team-guide.md): day-to-day use, what's enforced, troubleshooting and a 1-hour training plan.
- [Branch protection](docs/branch-protection.md): the GitHub settings that make the CI checks required.
- [Tool matrix](docs/tool-matrix.md): how the kit was tested in each AI tool and on a real app.
- Published from GitHub Actions with npm provenance.

## License

MIT
