#!/bin/sh
# Runs one of the kit's git hooks from the project's hook manager (husky, lefthook, simple-git-hooks).
# Usage: sh scripts/amk/run-hook.sh .githooks/<hook> [args…]
# A team may keep .githooks out of git, so a fresh clone has none until it runs sync: then this says so and lets the
# commit or push go on, as failing every one of them would leave only git commit --no-verify
set -eu
hook=$1; shift
if [ -f "$hook" ]; then exec sh "$hook" "$@"; fi
# a git worktree (Claude Code's .claude/worktrees/) has no copy of what git ignores: the main checkout's hook, run here
main="$(git rev-parse --git-common-dir 2> /dev/null)/../$hook"
if [ -f "$main" ]; then exec sh "$main" "$@"; fi
echo "agentic-mobile-kit: this clone has no $hook yet, so the kit's checks were skipped: run npx agentic-mobile-kit sync" >&2
