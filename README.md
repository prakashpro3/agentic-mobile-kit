# agentic-mobile-kit

One setup for AI-assisted mobile development that works the same in Claude Code, Codex and Antigravity (Cursor, OpenCode and Kiro next).

> **Status: early development.** Bare React Native projects only for now; Expo comes next.

## Install into a bare React Native app

Run in the app's root, on a clean git working tree:

```sh
npx agentic-mobile-kit init
npx agentic-mobile-kit init --tools claude,codex,antigravity   # choose your AI tools
npx agentic-mobile-kit init --ci github,codemagic              # only if the app uses that CI
```

Then check the project and your machine, with a fix for each problem:

```sh
npx agentic-mobile-kit doctor
```

`init` never overwrites your files. It adds its section to an existing `AGENTS.md` between `KIT` markers, and it's safe to run again. Undo it with git.

## Update or remove it

```sh
npx agentic-mobile-kit@latest sync   # update the kit's files; your own changes to them are merged in
npx agentic-mobile-kit uninstall     # remove the kit; files you changed are kept and listed
```

Both need a clean working tree, and both leave the result for you to review with `git diff`.

`sync` reports what it updated, added, removed and merged. If you and the kit changed the same lines, the file gets `<<<<<<<` conflict markers to resolve. The docs your team filled in (`docs/ai/product.md`, `tech.md`, `structure.md`, `conventions.md`) are never changed.

Installs older than 0.4.0 don't record which kit version made them, so their first `sync` or `uninstall` needs `--from <version>`, for example `--from 0.3.0`. That version can only be a guess, so `sync` doesn't merge on top of it: every file that matches neither version gets conflict markers instead.

## What it adds

- **Context for every AI tool:** `AGENTS.md` (plus a one-line `CLAUDE.md`), `docs/ai/` (product, tech, structure, conventions, decisions, known issues, React Native rules), spec templates in `specs/_templates/`, and a living spec in `specs/current/` that says what the app does now, one area at a time.
- **Workflows:** the skills `m-feature`, `m-bugfix`, `m-continue`, `m-pause`, `m-review`, `m-release` and `m-learn`. Invoke them with `/m-feature` in Claude Code and Antigravity, or `$m-feature` in Codex. Also Callstack's React Native skills.
- **Guardrails in each tool:** a guard hook that blocks destructive commands and secret files, a stop hook that asks for a handoff update, permission rules and a read-only `m-reviewer` subagent, generated with rulesync.
- **Releases:** `m-release` writes each release's changelog from real commits with git-cliff, plus store and client notes, all in `release-notes/<version>/`. It then runs `scripts/ai/release-check.js`, which catches what store review would reject. Signed builds come from `scripts/ai/release-build.sh` on a Mac: an app bundle signed with your upload key, and an `.ipa` signed through Xcode's account. With `--ci codemagic`, a version tag starts them on Codemagic instead (`codemagic.yaml`, one-time setup in `docs/ai/codemagic.md`).
- **Checks no tool can skip:** git hooks (secrets, signing files, broken Xcode project files, lint, typecheck, tests) and, with `--ci github`, GitHub Actions CI (lint, typecheck, tests, secret scan, PR size, Android and iOS builds, nightly Android end-to-end tests).

Work continues across tools and machines through `specs/<id>/progress.md`: run `m-pause` in one tool, then `m-continue` in another.

For the day-to-day workflow, what's enforced, and a 1-hour training plan, see the [team guide](docs/team-guide.md).

## License

MIT
