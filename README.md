# agentic-mobile-kit

One setup for AI-assisted mobile development that works the same in Claude Code, Codex and Antigravity (Cursor, OpenCode and Kiro next).

> **Status: early development.** Bare React Native projects only for now; Expo comes next.

## Install into a bare React Native app

Run in the app's root, on a clean git working tree:

```sh
npx agentic-mobile-kit init
npx agentic-mobile-kit init --tools claude,codex,antigravity   # choose your AI tools
```

Then check the project and your machine, with a fix for each problem:

```sh
npx agentic-mobile-kit doctor
```

`init` never overwrites your files. It adds its section to an existing `AGENTS.md` between `KIT` markers, and it's safe to run again. Undo it with git.

## What it adds

- **Context for every AI tool:** `AGENTS.md` (plus a one-line `CLAUDE.md`), `docs/ai/` (product, tech, structure, conventions, decisions, known issues, React Native rules) and spec templates in `specs/_templates/`.
- **Workflows:** the skills `m-feature`, `m-bugfix`, `m-continue`, `m-pause`, `m-review` and `m-release`. Invoke them with `/m-feature` in Claude Code and Antigravity, or `$m-feature` in Codex. Also Callstack's React Native skills.
- **Guardrails in each tool:** a guard hook that blocks destructive commands and secret files, a stop hook that asks for a handoff update, permission rules and a read-only `m-reviewer` subagent, generated with rulesync.
- **Releases:** `m-release` writes `CHANGELOG.md` from real commits with git-cliff, plus store and client notes, then runs `scripts/ai/release-check.js`, which catches what store review would reject. A version tag starts signed builds on Codemagic (`codemagic.yaml`, one-time setup in `docs/ai/codemagic.md`).
- **Checks no tool can skip:** git hooks (secrets, signing files, broken Xcode project files, lint, typecheck, tests) and GitHub Actions CI (lint, typecheck, tests, secret scan, PR size, Android and iOS builds).

Work continues across tools and machines through `specs/<id>/progress.md`: run `m-pause` in one tool, then `m-continue` in another.

## License

MIT
