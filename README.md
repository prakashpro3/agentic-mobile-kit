# agentic-mobile-kit

One setup for AI-assisted development of bare React Native apps. Every AI tool on the team reads the same rules, project knowledge and workflows. Git hooks and CI check the work, whichever person or tool wrote it. A task started in one tool, or on one machine, carries on in another.

Tested with Claude Code, Codex and Antigravity. `--tools` also sets up Cursor, OpenCode and Kiro.

## Install

1. In your app's root folder, on a clean git branch, run:

   ```sh
   npx agentic-mobile-kit init
   ```

   If the app uses CI, add `--ci github`, `--ci codemagic` or both. To pick AI tools, add `--tools claude,codex,antigravity`, which is the default. `--help` lists every option.

2. Check the project and your machine. `doctor` lists each problem with its fix:

   ```sh
   npx agentic-mobile-kit doctor
   ```

3. Fill in `docs/ai/product.md`, `tech.md`, `structure.md` and `conventions.md`, then commit and open a PR.

`init` never overwrites your files, is safe to run again, and can be undone with git. The [team guide](docs/team-guide.md#setup) lists everything it changes.

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

## How it compares

Superpowers, BMAD Method and Spec Kit are general methods for working with AI coding agents, for any stack. This kit is narrower. It's built for bare React Native apps, and it adds the checks a mobile team needs around the AI.

| | agentic-mobile-kit | Superpowers | BMAD Method | Spec Kit |
|---|---|---|---|---|
| What it is | Workflows, checks and release tools for bare React Native apps | A development method built from composable skills | An agile method with product, architecture, UX, development and testing perspectives | GitHub's toolkit for spec-driven development |
| Stack | Bare React Native: iOS and Android | Any | Any | Any |
| How work flows | Explore → requirements and design you approve → tasks with tests → device checks → review → PR, plus release and learning workflows | Brainstorm a spec → write a plan → subagents build and review each task | Clarify → plan → build and verify → learn, with more planning for bigger work | Constitution → specify → plan → tasks → implement → converge |
| Where it lives | In the app's repo, committed, so the whole team and every AI tool share one copy | A plugin installed in each AI tool on each machine | Skills, or a Claude Code or Codex plugin | The `specify` CLI and files in the project |
| How it starts | You invoke an `m-` skill | Its skills trigger on their own | The `bmad` skill | `/speckit-*` commands |
| Git hooks and CI it adds to your project | Secrets, signing files, lint, typecheck, tests, spec format, builds | — | — | — |
| Mobile-specific | Device checks with screenshots, a store-review check, store notes, signed builds | — | — | — |
| License | MIT | MIT | MIT | MIT |

— means the project's README (October 2026) doesn't describe it.

You don't have to pick one. The kit runs alongside the others, as the next section explains. Its workflows adapt ideas from Superpowers and Spec Kit, and its spec format from OpenSpec, all MIT.

## Alongside other AI workflows

Apps that already use Superpowers, BMAD, proAgents or similar keep them as they are. The kit adds its section next to theirs and links its skills into an existing `.claude/skills` folder. A task started with an `m-` skill follows the kit's steps, and everything else keeps working as before.

## Update or remove

```sh
npx agentic-mobile-kit@latest sync   # update the kit's files, merging in your own changes
npx agentic-mobile-kit uninstall     # remove the kit; files you changed are kept and listed
```

Both need a clean working tree and leave the result for you to review with `git diff`.
- **Report:** `sync` lists what it updated, added, removed and merged.
- **Your docs:** the product, tech, structure and conventions files your team filled in are never changed.
- **Adding CI later:** `sync --ci github` or `--ci codemagic` does it.

## Requirements

- Git and Node.js 20 or later, on macOS, Windows or Linux. The kit's tests run on all three for every change.
- Android work needs the Android SDK and Java. iOS work needs a Mac with Xcode and CocoaPods. `doctor` checks the rest.
- On Windows, turn on Developer Mode (Settings > System > For developers) and run `git config --global core.symlinks true`. Then `init` can link the Claude Code skills folder, and clones keep the link.

## More

- [What the kit adds to an app](docs/what-it-adds.md): every file, script, hook and check it installs.
- [Team guide](docs/team-guide.md): day-to-day use, what's enforced, troubleshooting and a 1-hour training plan.
- [Branch protection](docs/branch-protection.md): the GitHub settings that make the CI checks required.
- [Tool matrix](docs/tool-matrix.md): how the kit was tested in each AI tool and on a real app.
- Published from GitHub Actions with npm provenance.

## License

MIT
