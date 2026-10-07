# agentic-mobile-kit

One setup for AI-assisted mobile development that works the same in Claude Code, Codex, Cursor, OpenCode, Kiro and Antigravity.

> **Status: early development.** This version only reserves the package name. It has no commands yet.

## What it will do

- Add a short `AGENTS.md` and shared Agent Skills (`feature`, `bugfix`, `continue`, `pause`, `review`, `release-notes`, `learn`) that every supported tool reads.
- Enforce quality outside the AI: git hooks, CI checks for Android and iOS builds, secret scanning and PR size limits.
- Require evidence before a task counts as done: test output plus simulator and emulator screenshots.
- Keep task state in the repo, so work can continue in another tool or on another machine.
- Support React Native (Expo and bare) first, with Flutter and native apps later.

## License

MIT
