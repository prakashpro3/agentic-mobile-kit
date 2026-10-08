# Team guide

How to work day to day in a bare React Native app that has agentic-mobile-kit installed. It takes about 10 minutes to read; a 1-hour training plan is at the end.

## The idea in one paragraph

Every AI tool reads the same rules (`AGENTS.md`), the same project facts (`docs/ai/`) and the same workflows (the `m-` skills). The work itself lives in git: each task has a folder `specs/<id>/` with its requirements, design, task list and a handoff in `progress.md`. So you can stop in one tool and continue in another, or on another machine, without repeating anything. Checks that matter (secrets, tests, builds, release problems) run as git hooks, CI and scripts, so they apply whichever tool, or person, made the change.

## Setup

**Once per project** (the lead):
1. In the app's root, on a clean branch: `npx agentic-mobile-kit init`. To choose AI tools, add `--tools claude,codex,antigravity`.
2. Fill in `docs/ai/product.md`, `tech.md`, `structure.md` and `conventions.md`. Agents are only as good as these four files.
3. Open a PR with the `large-pr` label, merge it, and turn on branch protection (see `docs/branch-protection.md` in the kit repo).
4. For signed store builds, do the one-time Codemagic setup in the app's `docs/ai/codemagic.md`.

**Once per machine** (every developer):
1. Clone, then `sh scripts/ai/install-deps.sh`. This also turns on the git hooks.
2. Run `npx agentic-mobile-kit doctor` and fix what it lists. It checks Node, Xcode, CocoaPods, simulators, the Android SDK, Java, Maestro, gitleaks and each AI tool's trust settings.
3. Open the project once in each AI tool you use. In Codex, trust the project and approve its hooks; they stay off until you do. In Antigravity, trust the workspace.

## Daily work

| You want to | Run | What happens |
|---|---|---|
| Build a feature | `m-feature <task text or link>` | Requirements with acceptance criteria → **you approve** → design and tasks → **you approve** → one task at a time with tests and real command output → device check with screenshots → review → PR |
| Fix a bug | `m-bugfix <report>` | Checks known issues → reproduces → failing test → root cause → smallest fix → verifies |
| Stop for now, or switch tool | `m-pause` | Writes the handoff in `progress.md`, moves decisions out of the chat, commits as `wip:` and pushes |
| Carry on anywhere | `m-continue <id>` | Reads the spec and handoff, tells you the open question, the status and the next step, then waits for you |
| Review a branch | `m-review` | A read-only review for scope, tests, both platforms, error states, security and native changes |
| Ship a release | `m-release <version>` | Changelog from real commits, store and client notes, version bump, release check, release PR, then the tag that starts the signed builds |
| Stop a mistake from repeating | `m-learn <what went wrong>` | The smallest lasting fix: a check, a known-issues entry, a docs line or a skill step |

How to invoke a skill: `/m-feature` in Claude Code and Antigravity, and `$m-feature` in Codex. The skills only run when you invoke them; they never start on their own.

Small changes don't need a skill. Ask the agent directly; the rules in `AGENTS.md` and the git hooks still apply.

## Switching tool or machine in the middle of a task

1. If the current tool still works, run `m-pause`. If it stopped at a usage limit, commit what's there yourself (`wip: <id> …`) and push.
2. In the next tool or on the next machine: `git pull`, then `m-continue <id>`.

Everything in git carries over: the spec, the handoff and the code. Chat history doesn't, on purpose, so anything decided in a chat must be written into the spec or `docs/ai/decisions.md`. `m-pause` does that.

## What "done" means

An agent's work is done only when:
1. lint, typecheck and tests pass, with the command output from that session;
2. UI changes were checked on both platforms with `sh scripts/ai/verify.sh all --spec <id>`, and the screenshots were looked at (they're in `.ai/evidence/<id>/`);
3. the diff stays inside the task;
4. `specs/<id>/progress.md` is updated.

If an agent says "done" without these, it isn't done. Open the screenshots yourself before you approve a UI PR.

## What's enforced, and where

| Where | What |
|---|---|
| `pre-commit` hook | Blocks `.env` files, keystores and signing files, and secrets (gitleaks). Checks Xcode project files. Lints staged files. Warns above 400 changed lines. |
| `pre-push` hook | Typecheck and tests |
| CI on every PR | Lint, typecheck, tests, secret scan, config drift, PR size ≤ 600 lines (`large-pr` label to override), Android build, and the iOS build when native files change |
| Nightly, or the `e2e` label | Android emulator with the Maestro flows; the screenshots are attached to the run |
| Inside AI tools | A guard hook blocks `rm -rf`, force pushes, `git reset --hard`, `--no-verify` and reading secret files. Permission rules ask before dependency and native config changes. A stop hook reminds the agent to update the handoff. |
| Releases | `scripts/ai/release-check.js` before tagging, and again on Codemagic before every signed build |

Never bypass a hook with `--no-verify`. If a hook is wrong, fix the hook in a PR.

## Tool differences to know

| | Claude Code | Codex | Antigravity |
|---|---|---|---|
| Reads `AGENTS.md` | ✅ (through `CLAUDE.md`) | ✅ | ✅ (CLI 1.3.1 or later) |
| Skills | `/m-…` | `$m-…` | `/m-…` |
| Guard and stop hooks | ✅ | ✅ after you approve them on each machine | ❌ project hooks don't run, so approve commands carefully |
| Keeps `.env` out of reach | ✅ | ❌ can read it | ❌ can read it |
| iOS builds | ✅ | ❌ inside its sandbox; run `sh scripts/ai/ios-build.sh` yourself | not tested yet |

Because two of the three tools can read `.env`, keep real secrets outside the project folder and inject them at run time. Cursor, OpenCode and Kiro are set up the same way, but they haven't been tested yet.

## Rules for people

From `docs/ai/team-process.md`:
- You own the PRs you open, and must be able to explain every change without AI.
- Commits made by an agent end with `Assisted-by: <tool>/<model>` and, when there's a spec, `Spec: specs/<id>`.
- Run at most 2 or 3 agents in parallel.
- Don't use "skip permissions", "YOLO" or auto-run modes.

## When something goes wrong

| Problem | Do this |
|---|---|
| Anything odd after setup | `npx agentic-mobile-kit doctor` |
| A build error | Check `docs/ai/known-issues.md` first; `m-bugfix` does this too |
| The agent made a mistake you had to correct | `m-learn`, so it doesn't happen again |
| Hooks don't run | `git config core.hooksPath` must print `.githooks`; `sh scripts/ai/install-deps.sh` sets it |
| `pre-push` says dependencies aren't installed | `sh scripts/ai/install-deps.sh` |
| Metro's port 8081 is busy | Nothing to do: `verify.sh` uses release builds, which don't need Metro |
| iOS build fails after a native dependency change | `cd ios && pod install` |

## Once a month (30 minutes)

- Read `git log --grep 'chore(learn)'`: what did agents get wrong, and did the fixes hold?
- Remove stale entries from `docs/ai/known-issues.md`.
- After a React Native, Xcode, Android Gradle Plugin or AI model upgrade, re-read `AGENTS.md` and `docs/ai/` for anything that's no longer true.

## 1-hour training

| Minutes | Topic |
|---|---|
| 0–10 | The idea: the three layers (enforcement, context, workflows) and why chat isn't memory |
| 10–30 | Live: `m-feature` on a small real task, up to the first approved task, with lint, tests and a commit |
| 30–40 | Switch tools: `m-pause` in one tool, `m-continue` in another |
| 40–50 | `verify.sh` screenshots, `m-review` and the PR checklist |
| 50–60 | `m-release` and Codemagic, `m-learn`, questions |

Before the session, every attendee runs `doctor` on their machine, so setup problems don't use up the hour.
