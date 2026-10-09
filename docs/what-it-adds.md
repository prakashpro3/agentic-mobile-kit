# What the kit adds to an app

What `npx agentic-mobile-kit init` puts into a bare React Native app. CI files come only with `--ci github` or `--ci codemagic`.

| Area | What you get |
|---|---|
| Project knowledge | `AGENTS.md` (with a one-line `CLAUDE.md`): commands, the definition of done and the rules. `docs/ai/`: product, tech stack, structure, conventions, decisions, known issues, React Native rules and team process. Callstack's React Native skills. |
| Specs | `specs/<id>/` for each feature: requirements, design, tasks, a Maestro flow and a handoff file. A living spec of what the app does now, in `specs/current/`. `spec.js`: `check`, `merge`, `status`. |
| Device checks | `verify.sh`: lint and tests, release builds on an iPhone simulator and an Android emulator (any product flavor or iOS scheme), the feature's Maestro flow, and screenshots in `.ai/evidence/<id>/` |
| Releases | `release-check.js` catches what store review would reject, and signing keys left in git. Changelog and store notes come from commits (git-cliff). `set-version.sh` sets versions. Signed builds come from `release-build.sh` or Codemagic (`--ci codemagic`). |
| Guardrails in AI tools | Hooks that block destructive commands and secret files and remind the agent about the handoff, permission rules, and a read-only reviewer, generated with rulesync |
| Git hooks | Before a commit: secrets, signing files, Xcode project files, files renamed only in letter case, ESLint, spec format. Before a push: typecheck and tests. With husky, lefthook or simple-git-hooks, they run from those. |
| CI (`--ci github`) | Lint, typecheck, tests, a secret scan, a tool-config check, a 600-line PR limit (`large-pr` label), Android and iOS builds, nightly end-to-end tests (`e2e` label), and a PR template |
| Everyday scripts | `install-deps.sh`, `pm-run.sh`, `ios-build.sh` |

All scripts are in `scripts/ai/`. The [team guide](team-guide.md) has the details.
