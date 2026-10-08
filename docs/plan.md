# Mobile AI Dev Kit: Implementation Plan (v1, React Native)

**Date:** 2026-10-07 · **Status:** Draft for review (rev 5: Phase 0 results for Claude Code, Codex and Antigravity, see section 10; rev 4: ideas borrowed from proAgents, see section 3.2; rev 3: session continuity across days, machines and tools, see D6 and section 5.12; rev 2: hybrid approach for tool configs, see D1, D2 and section 3.1) · **Based on:** [AI agentic development lifecycle issues](research/agentic-dev-lifecycle-issues.md) (162 issues, all confirmed by the team)

---

## 1. Goal

Build one kit that any React Native repo installs with a single command. It makes AI-assisted development repeatable and safe in Claude Code, Antigravity, Codex, OpenCode, Cursor and Kiro.

- A new requirement or bug starts with one command. Nobody re-types project context.
- Any tool can pick up work another tool started, using only files in the repo.
- Nothing merges on the agent's word. CI results and evidence decide when work is done.

### Success criteria for v1

| Measure | Target |
|---|---|
| Install into a new or existing RN repo | One command, under 15 minutes |
| Same workflows in all six tools | `feature`, `bugfix` and `continue` produce the same files in each tool |
| Switching tools mid-task | A feature started in one tool is finished in another from repo files alone |
| Merge gate | Every PR passes CI (lint, types, tests, Android and iOS build) and includes evidence |
| Team metrics | Measure now, compare after 6 weeks: PR size, review wait time, CI failure rate, reopened bugs, time from requirement to PR |

## 2. Inputs and constraints

- **Stack:** React Native first. The design leaves a slot for Flutter and native packs later.
- **Tools:** Claude Code, Antigravity, Codex, OpenCode, Cursor, Kiro.
- **CI:** none today. GitHub Actions for PR checks, Codemagic for signed builds.
- **Requirements sources:** Excel sheets, Trello cards and an internal task platform. There is no single tracker.
- **Research:** all 162 issues apply. They reduce to 12 root causes (section 7). The kit targets causes, not individual issues.

## 3. Key decisions

| # | Decision | Why (issue IDs) |
|---|---|---|
| D1 | **Rules and workflows use open standards, with no generator.** One hand-edited `AGENTS.md` plus a one-line `CLAUDE.md` (`@AGENTS.md`). Skills live in `.agents/skills/`, and `.claude/skills` and `.kiro/skills` link to that same folder. | Codex, Cursor, OpenCode, Kiro and Antigravity read `AGENTS.md` directly; Claude Code reads it through the import. Codex, Cursor, OpenCode and Antigravity read `.agents/skills/`; only Claude Code and Kiro use their own folder. No third-party tool sits in the core path (XTL-01 to XTL-03). |
| D2 | Use **rulesync** (exact version pinned) **only for the parts with no shared format**: permissions, guard hooks and subagents. Its output is committed, and a CI check fails when it drifts from the source. | These three need six different file formats (OpenCode hooks are even a JavaScript plugin), and those formats change often (XTL-05, XTL-14). If rulesync breaks or is abandoned, the committed files keep working and can be maintained by hand. |
| D3 | Write workflows as **Agent Skills**, not slash commands. | Skills work at project level in all six tools. Codex has deprecated custom prompts in favor of skills. |
| D4 | **Enforcement lives outside the agent**, in git hooks, CI and scripts. Agent permissions and hooks are a second layer. | Rules files are only advice (CTX-09, GEN-07), and agent hooks vanish when you switch tools (XTL-05). Git hooks and CI apply no matter which tool or model wrote the code. |
| D5 | **One writer, read-only helpers.** The main session writes code. Subagents only review or research. BA and Architect are phases of `feature` with a human approval step, not separate agents. | Parallel writers conflict and multiply token cost (ORC-02 to ORC-05), and handoffs lose decisions. |
| D6 | **Work state lives in the repo:** `specs/<id>/requirements.md`, `design.md`, `tasks.md`, `progress.md` (with a handoff block updated after every step), plus `docs/ai/decisions.md`. A `pause` skill pushes it all before you stop, so any tool on any machine can pick up the work the next day (section 5.12). | Chat history, memories and approvals stay inside one tool on one machine (XTL-06, CTX-08, HUM-10). Git is the only thing every tool on every machine can read. The file names match Kiro's spec format. |
| D7 | **"Done" requires evidence:** command output, a test summary, and simulator/emulator screenshots, recorded in `progress.md` and in the PR. | Agents misreport success (TST-02, GEN-05, REQ-03) and can't see the app (TST-08). |
| D8 | **Intake works from any source.** `feature` accepts pasted text, a file (CSV/XLSX export, Trello card text, a task from the team's task platform) or a link, and turns it into `requirements.md`. No tracker integration in v1. | Requirements arrive from three places. A common format matters more than an API connection. |
| D9 | **Reuse before writing.** Workflows are adapted from Superpowers and Spec Kit skills (MIT). Stack knowledge is copied from Callstack, Expo and Google's Android skills (MIT and Apache-2.0), pinned to a commit. Changelogs, secret scanning, metadata checks and end-to-end tests use existing tools. Section 3.2 lists every piece. We write only what is specific to mobile and to the evidence rules. Full frameworks are not adopted (section 3.1). | Maintainers keep these current as frameworks change (GEN-09 to GEN-14). The borrowed skills already target the main failure modes (TST-02, DBG-01, REV-06), and less custom text means less for us to maintain. |
| D10 | **Safe defaults everywhere:** deny destructive commands and secret files, keep no signing or store credentials on dev machines, run Codex with workspace-write access instead of full access. | SEC-08, SEC-15 to SEC-18, REL-05, REL-06. Note that `rulesync init` sets Codex to full access by default, so the kit ships its own rulesync config and never runs `rulesync init`. |

### 3.1 Alternatives considered

The whole kit is our own code either way. The question was only who writes each tool's config files, and what we reuse for the development process.

**Config translators** (checked 2026-10-07)

| Option | Covers for our six tools | State | Decision |
|---|---|---|---|
| rulesync | Rules, skills, subagents, hooks, permissions | 1.5k stars, ~1M downloads/month, active. One main maintainer; 27 major versions since June 2025. | Use only for permissions, hooks and subagents (D2) |
| ruler | Rules, skills, some subagents; no hooks, no permissions | 2.9k stars, last release June 2026; still writes Antigravity's old `.agent/` paths | Rejected: doesn't cover what we need translated |
| Vercel `skills` CLI | Skills only | 33k stars, ~25M downloads/month, maintained by Vercel | Optional, for pulling in outside skills |
| vibe-rules | Rules only | No release since August 2025 | Rejected: abandoned |
| Fully custom | Whatever we write | — | Used for rules, skills, git hooks, CI and scripts. Rejected for permissions, hooks and subagents: six formats that changed repeatedly in 2025–26 |

**Workflow frameworks**

| Reference | Decision | Reason |
|---|---|---|
| Superpowers (MIT) | Borrow two skills, adapted | It doesn't support Kiro, and it is installed per tool on each machine, so versions drift across the team. It runs a subagent per task in separate git worktrees: that multiplies token cost (ORC-04), and React Native worktrees fight over one simulator and Metro port (ORC-08). It has no device checks. |
| GitHub Spec Kit, BMAD, Agent OS | Borrow the spec file shape only | Heavy process overhead: Spec Kit produced 2,577 lines of markdown for one small increment and was about 10x slower than plain prompting (REQ-05). BMAD's license is unclear. |
| Callstack agent-skills (MIT) | Reuse directly, pinned | Maintained React Native knowledge |
| Expo agent guidance | Reuse in Expo projects | Official and kept current |
| proAgents (MIT, npm `proagents` 1.6.22; same goal as this kit) | Borrow seven ideas (section 3.2); write our own text | Its `pa:` commands rely on a long instruction file every AI must read; that's only advice (CTX-09) and takes up context (CTX-10). Native skills now do this job. Its per-tool files (`.cursorrules`, `KIRO.md`, `GEMINI.md`…) are replaced by `AGENTS.md`. Its 240 files of prompts are mostly web and Node. "Always do, never just tell" conflicts with our approval gates (GEN-06, SEC-17). Its custom activity logs repeat what git does, and its JSON learning memory goes stale (CTX-12). |

**Memory tools** (checked 2026-10-07)

| Option | Decision | Reason |
|---|---|---|
| agentmemory (Apache-2.0, 29k stars, v0.9, started February 2026, mostly one maintainer) | Not part of the kit. Borrow three ideas (section 3.2). Optional personal trial later (P6). | It's a memory server that records prompts and tool calls through hooks and MCP, and supports all six tools. But memory stays on one machine unless you host a shared server, which is more infrastructure to secure. Memories are hidden from code review and can go stale silently. It stores prompts and code outside git, and text injected from a malicious page or issue can be saved and fed into later sessions (SEC-09). Repo files cover the handoff need without a server. |

### 3.2 Reuse map: what we borrow from existing frameworks

Rule: we write only what no one else has written. There are three ways to reuse:
- **Copy:** vendored unchanged at a pinned commit, with credit in `.agents/skills/THIRD_PARTY.md`.
- **Adapt:** we copy a skill and edit it for mobile and our evidence rules. Allowed only for MIT or Apache-2.0 sources.
- **Idea:** we take the pattern and write our own text. Used where the license is unclear (BMAD, HumanLayer, anthropics/skills).

**Workflows and process**

| Kit part | Borrowed from | What exactly | How |
|---|---|---|---|
| `AGENTS.md` shape | OpenAI "Harness engineering"; Kiro steering; Spec Kit `constitution` | `AGENTS.md` is a ~100-line map that points to docs (it is not a full manual). Docs are split the way Kiro's steering is (product, tech, structure). Project principles are written once. | Idea |
| `feature`, BA phase | Superpowers `brainstorming`; Spec Kit `clarify` and `checklist`; Kiro EARS notation | Ask questions one at a time and offer alternatives. Mark unclear points. Use a checklist to test the requirements themselves. Write acceptance criteria as "WHEN … THE APP SHALL …". | Adapt + idea |
| `tasks.md` | Superpowers `writing-plans`; BMAD story files; Anthropic "Effective harnesses for long-running agents" | Small tasks, each with exact file paths and its own check. Each task holds all the context it needs, so any tool can pick it up. Every task carries a pass/fail status. One commit per task. | Adapt + idea |
| Build loop | Superpowers `executing-plans` and `test-driven-development` | Work through tasks in a single session. Write tests first for logic code; UI work is not forced into strict TDD. | Adapt |
| Definition of done | Superpowers `verification-before-completion`; Spec Kit bug verdicts; Anthropic harness | No "done" without fresh command output. Verdict is `verified`, `partial` or `failed`; missing verification is not success. Test the app the way a user would. | Adapt |
| `bugfix` | Superpowers `systematic-debugging`; Spec Kit bug extension (assess → fix → test) | Find the root cause before changing code. Keep diagnosis, repair and verification as separate steps. | Adapt |
| Spec drift check | Spec Kit `converge` and consistency analysis | At the end of `feature` and in `continue`, compare acceptance criteria with the code, then fix the code or update the spec (REQ-04). | Idea |
| `review` | Superpowers `requesting-code-review` and `receiving-code-review` | Findings ranked by severity. When receiving feedback, verify each point before acting on it and push back on wrong suggestions (REV-06). | Adapt |
| PR step | Superpowers `finishing-a-development-branch` | Re-run tests, then open the PR with evidence | Adapt |
| `learn` | Superpowers `writing-skills` and `diagnosing-superpowers`; OpenAI "doc-gardening"; agentmemory `lesson` | How to write and test a skill. Diagnose a misbehaving session from its transcript. Routinely clean up stale docs (CTX-12). | Adapt + idea |
| `continue` and `pause` | agentmemory `handoff`; Anthropic harness progress file | Start with the unanswered question, then the next step. Never invent anything that isn't recorded. Keep a progress file that every session reads first. | Idea |
| Commit trailers | agentmemory `commit-context` | Link every commit to its spec, so "why is this code here?" leads from `git blame` to the spec and its decisions, without a memory server | Idea |
| Phase structure | HumanLayer "advanced context engineering"; Anthropic "context engineering" | Research → plan → implement, with a fresh session per phase and progress written to files | Idea |

**Stack knowledge** (copied, pinned)

| Source | Skills we take | Covers |
|---|---|---|
| Callstack `agent-skills` (MIT) | `react-native-best-practices`, `react-navigation`, `upgrading-react-native`, `github-actions` | GEN-11, GEN-16, BLD-01 |
| Expo `skills` (MIT) | Expo and EAS skills, in Expo projects only | GEN-12, REL-07 |
| Google `android/skills` (Apache-2.0) | `build-system`, `performance`, `security`, `testing` | BLD-04, GEN-14 |

**Tools reused as they are**

| Tool | Used for |
|---|---|
| rulesync (MIT) | Per-tool permissions, hooks and subagents (D2) |
| gitleaks (MIT) | Secret scanning in git hooks and CI |
| GitHub dependency review | Flagging risky new dependencies on PRs (SEC-01, SEC-14), if your GitHub plan includes it |
| git-cliff (Apache-2.0) | Building the factual changelog from commits. The AI only rewrites it into store notes, so it can't invent changes (REL-08). |
| fastlane `precheck` (MIT) | Catching App Store metadata problems that get apps rejected (REL-03) |
| Maestro (Apache-2.0) | End-to-end test flows (TST-08, TST-12) |
| Codemagic's React Native sample config | Starting point for `codemagic.yaml` |

**From proAgents** (ideas only, our own text; credited in `THIRD_PARTY.md`)

| Idea | Where it lands in the kit |
|---|---|
| Marker-based merge: the kit's section sits between `<!-- KIT:START -->` and `<!-- KIT:END -->` inside an existing `AGENTS.md` or `CLAUDE.md` | `init` and `sync` add or replace only that section, and `uninstall` removes only it. Expo's `create-expo-app` already writes an `AGENTS.md`, and many repos already have a `CLAUDE.md`. |
| A clean `uninstall` command | Removes the kit's files and marked sections, leaving the project's own content (section 4.1) |
| Tool picker: detect installed tools and remember the choice | `init` asks which of the six tools the team uses (detected ones pre-ticked) and generates files only for those |
| Workflow modes with hard size limits | Size triage in `feature` (section 5.2) |
| Error log with cause, fix and prevention | `docs/ai/known-issues.md`: `bugfix` checks it first, and `learn` adds recurring errors |
| Extra handoff fields: blocked items, notes for the next session, tool and model | The handoff block (section 5.12) |
| Watchlist of files to confirm before editing | The "ask before editing" permission row (section 5.4), extended with mobile files |
| Existing-project adoption: fit around existing patterns, adopt in steps | Section 4.1, "Adding the kit to an existing project" |

**Not borrowed, on purpose**

- Superpowers `subagent-driven-development`, `dispatching-parallel-agents` and `using-git-worktrees`: they cost more tokens, and React Native worktrees conflict over the simulator (ORC-04, ORC-08).
- BMAD's agent personas: too much process, and the license is unclear.
- Spec Kit's full pipeline for every change: its overhead hurts small tasks (REQ-05).

## 4. Architecture

```
  agentic-mobile-kit (kit repo, public npm package and git URL)
  ├─ core/                 AGENTS.md template, skills, subagents, docs & spec templates, guardrails
  ├─ stacks/react-native/  stack rules, vendored RN skills, lint presets, CI templates, verify scripts
  └─ bin/                  init · sync · doctor · uninstall
                │  npx agentic-mobile-kit init | sync
                ▼
  app repo
  ├─ Layer 3  Workflows    .agents/skills/  feature · bugfix · continue · review · release-notes · learn
  │                        (.claude/skills and .kiro/skills link here; the other four tools read it directly)
  ├─ Layer 2  Context      AGENTS.md (+ one-line CLAUDE.md) · docs/ai/ · specs/
  └─ Layer 1  Enforcement  .githooks/ · .github/workflows/ · scripts/ai/ · codemagic.yaml
     + agent guardrails    .rulesync/ (permissions, hooks, subagents only)
                │  rulesync generate (pinned version, 3 features)
                ▼
  per-tool permission, hook and subagent files in .claude/ .codex/ .cursor/ .opencode/ .kiro/ .agents/   (generated, committed)
```

### 4.1 What `init` adds to an app repo

```
# Source files (edit these)
AGENTS.md                    # root rules for every tool (≤150 lines)
CLAUDE.md                    # one line: @AGENTS.md
.agents/skills/<name>/SKILL.md   # workflows + vendored RN skills (one canonical folder)
.claude/skills -> ../.agents/skills   # folder link for Claude Code
.kiro/skills   -> ../.agents/skills   # folder link for Kiro
.rulesync/                   # only for parts with no shared format
  subagents/                 # reviewer, researcher (read-only)
  hooks.jsonc                # preToolUse → scripts/ai/guard.sh
  permissions.jsonc          # deny / ask / allow lists
rulesync.jsonc               # six targets; features: permissions, hooks, subagents; pinned version
.agents/skills/THIRD_PARTY.md   # vendored skills: source, commit, license
docs/ai/                     # split the way Kiro's steering docs are
  product.md                 # what the app does, users, key journeys
  tech.md                    # stack, services, environments
  structure.md               # folders, layers, state, navigation, networking
  react-native.md            # stack rules, linked from AGENTS.md
  conventions.md             # naming, components, styling, tests, i18n, analytics
  decisions.md               # short decision log: date, decision, reason
  known-issues.md            # recurring errors: cause, fix, prevention
  team-process.md            # human rules (section 5.11)
specs/_templates/            # requirements · design · tasks · progress
.githooks/                   # pre-commit, pre-push (no dependencies)
scripts/ai/                  # verify.sh · guard.sh · release-check.sh · pr-size.sh
.github/workflows/ci.yml
.github/pull_request_template.md
codemagic.yaml               # added in Phase 5

# Generated by rulesync (don't edit by hand; committed)
permission, hook and subagent files inside .claude/ .codex/ .cursor/ .opencode/ .kiro/ .agents/
```

The folder links work on macOS and Linux. Windows machines need git's symlink support turned on; if that's a problem, `sync` copies the folder instead and CI checks that the copies match.

`init` also:
- refuses to run on a repo with uncommitted changes, so git is the backup for everything it touches;
- asks which of the six tools the team uses, with the installed ones pre-ticked, and generates files only for those;
- detects Expo or bare React Native and the package manager;
- writes the installed versions (React Native, Expo SDK, React, TypeScript, Node) into `AGENTS.md`;
- merges into an existing `AGENTS.md` or `CLAUDE.md` between `<!-- KIT:START -->` and `<!-- KIT:END -->` markers instead of overwriting it, and skips any other file that already exists, reporting what it skipped;
- adds the `lint`, `typecheck` and `test` scripts if they are missing (it never overwrites existing ones);
- sets the git hooks path.

`sync` updates a repo to a newer kit version, replacing only the marked sections and the files the kit owns. `doctor` checks that hooks are installed, that generated files are current, that each rules file is within its size limit and that the required scripts exist. On a new machine it also checks that dependencies, pods and `.env` are in place. `uninstall` removes the kit's files and marked sections and leaves the project's own content.

**Adding the kit to an existing project:**
- `docs/ai/` describes the patterns the project already uses; it doesn't impose new ones.
- Adopt in two steps: first enforcement (git hooks, CI) and `AGENTS.md`, then the workflows once the team is comfortable.

### 4.2 Tool support

Rules and skills folders are from each tool's docs and the Vercel `skills` CLI's folder table. Hook and permission support is from rulesync's support tables. Invocation styles are confirmed in Phase 0.

| Tool | Rules | Skills folder | Run a workflow | Guard hook and permissions (via rulesync) |
|---|---|---|---|---|
| Claude Code | `CLAUDE.md` → `@AGENTS.md` | `.claude/skills` (link) | `/feature` | ✅ |
| Codex | `AGENTS.md` | `.agents/skills` | skill mention (confirm) | ✅ |
| Cursor | `AGENTS.md` | `.agents/skills` | `/feature` (confirm) | ✅ |
| OpenCode | `AGENTS.md` | `.agents/skills` | skill tool, or a thin command wrapper (confirm) | ✅ |
| Kiro IDE and Kiro CLI | `AGENTS.md` (always loaded) | `.kiro/skills` (link) | confirm | ✅ (IDE and CLI subagent formats differ; rulesync writes both) |
| Antigravity IDE and CLI (`agy`) | `AGENTS.md` | `.agents/skills` | `/feature` (confirm) | ✅ |

rulesync supports `preToolUse`, `postToolUse` and `stop` hooks for all six tools.

## 5. Components

### 5.1 Root rules (AGENTS.md)

Size limit: 150 lines or 8 KB at most, so every tool loads all of it (CTX-10, CTX-11).

1. **Project map:** 5 to 10 lines.
2. **Versions:** filled in by `init` (GEN-11, GEN-12).
3. **Commands:** install, start, lint, typecheck, test, and `verify quick|ios|android`.
4. **Definition of done:** the evidence a task needs (D7).
5. **Hard rules:**
   - Stay inside the task's scope.
   - Don't edit generated native folders (Expo CNG) or `project.pbxproj`.
   - Don't add dependencies without asking.
   - Never use `--no-verify`.
   - Never read or write secrets.
   - After 2 failed fix attempts, stop and report.
   - Chat is not memory. Write every decision or instruction into the spec or `docs/ai/decisions.md` straight away, and update the handoff block in `progress.md` after every step.
6. **Pointers** to `docs/ai/`, `specs/` and the workflow list. Details stay in those files, not here.

### 5.2 Workflows (skills)

Each workflow adapts the skills listed for it in section 3.2. What we add on top is mobile-specific: the edge-case checklist, device evidence, platform parity and the native-folder rules.

| Skill | Steps | Output | Issues addressed |
|---|---|---|---|
| `feature` | 1. Intake and size triage. **Quick change** (1 file, ≤20 lines): skip the spec, change, verify, commit. **Bug fix** (up to 5 files): hand over to `bugfix`. **Feature** (anything larger): the full flow below. If the work outgrows its size partway through, stop and move up a level.<br>2. **BA phase:** acceptance criteria plus an edge-case checklist (offline, error, empty, loading, permission denied, background/resume, screen sizes and tablets, dark mode, accessibility, iOS vs Android, analytics) and open questions. **Stop for approval.**<br>3. **Architect phase:** search for existing components and helpers first, then write the design and a task list. Each task is about 1 hour and under ~300 lines. **Stop for approval.**<br>4. Per task: implement, run `verify quick`, commit, record evidence in progress.md.<br>5. Run `verify ios` and `verify android` for screenshots.<br>6. Review by the reviewer subagent in a fresh context.<br>7. Open the PR from the template. | `specs/<id>/*`, commits, PR | REQ-01 to REQ-05, ARC-01 to ARC-06, GEN-05, GEN-06, TST-02, TST-08 |
| `bugfix` | Check `docs/ai/known-issues.md` for a known fix → reproduce → write a failing test → find the root cause → minimal fix → regression test → evidence → PR. After 2 failed attempts, stop and report findings. | Test, fix, PR | DBG-01 to DBG-04, DBG-08, TST-04 |
| `continue` | Run `git fetch` and warn if the branch is behind or has uncommitted changes. Read `AGENTS.md`, `specs/<id>/*` and `git log`. Start with any open question, then the next step, and never invent anything that isn't in the files. Confirm with the user, then resume. | Resumed work | XTL-06, CTX-03, CTX-05, ARC-03 |
| `pause` | Update the handoff block in `progress.md`. Move decisions made in chat into the spec or `decisions.md`. Commit the work in progress to the feature branch (git hooks still run) and push it. | Pushed branch with a current handoff | XTL-06, XTL-08, CTX-08, HUM-10 |
| `review` | Read-only checklist: scope, tests changed or weakened, platform parity, accessibility, performance, security, secrets. Findings come with a severity; no style nits. | Findings list | REV-02, REV-04 to REV-06, TST-01 |
| `release-notes` | Build notes from a git range plus the specs. Outputs: Play "What's new" (≤500 characters), App Store "What's New" (≤4,000 characters), client changelog. Cite only real commits and tasks. | Notes | REL-08 |
| `learn` | Turn a correction into the smallest durable change. Prefer a lint rule or guard over more prose, then docs, then a skill. Add recurring errors (error, cause, fix, prevention) to `docs/ai/known-issues.md`, and remove entries that no longer apply. | PR to the project or the kit | CTX-12, HUM-07, HUM-10 |

### 5.3 Subagents

Defined once in `.rulesync/subagents/`; rulesync writes each tool's format. Both run read-only.
- **reviewer:** checks the diff in a fresh context. It may run tests.
- **researcher:** looks things up in the codebase and docs and returns a short summary.

### 5.4 Agent guardrails (second layer)

Defined once in `.rulesync/`; rulesync writes each tool's format.

**`permissions.jsonc`**

| Rule | Covers |
|---|---|
| Deny | `rm -rf`, `git reset --hard`, `git push --force`, `git clean -f`, `xcrun simctl erase`, `eas submit`, release `fastlane` lanes, production `eas update`, piping `curl` into `sh` |
| Ask first | adding dependencies (`npm install`, `yarn add`, `npx expo install`), `git push` |
| Ask before editing | `package.json` and lockfiles, `.github/workflows/*`, `app.json`/`app.config.*`, `eas.json`, `tsconfig.json`, Babel and Metro config; in bare projects also `Podfile`, `build.gradle`, `Info.plist`, `AndroidManifest.xml` |
| Allow | `npm run lint/typecheck/test`, `scripts/ai/verify.sh`, `git status/diff/log/add/commit` |
| Deny reading | `.env*` (except `.env.example`), `*.keystore`, `*.jks`, `*.p8`, `*.p12`, `*.mobileprovision`. Phase 0 showed Codex and the Antigravity CLI still read `.env`, so real secrets must stay out of the project folder (section 10). |
| Deny editing | Expo CNG: all of `ios/` and `android/` (they are generated). Bare React Native: `*.pbxproj` |

**`hooks.jsonc`:**
- `preToolUse` on shell commands runs `scripts/ai/guard.sh`. It applies the same deny list but also catches variants that glob rules miss, such as `rm -r -f` or chained commands (SEC-15).
- `stop` runs `scripts/ai/handoff-check.sh`. If code changed after the last handoff update, it reminds the agent to update `progress.md` first, or blocks the stop in tools that allow it (checked in P0).

None of this is a security boundary. Turn on each tool's sandbox where it offers one.

### 5.5 Git hooks (first layer, every tool)

Installed through the `prepare` script (`git config core.hooksPath .githooks`), so they activate on `npm install` with no extra dependency.

- **pre-commit:**
  - block sensitive files;
  - scan for secrets (gitleaks if installed, otherwise built-in patterns);
  - run eslint and prettier on staged files;
  - run `plutil -lint` when a `.pbxproj` is staged;
  - warn when the staged diff is over 400 lines.
- **pre-push:** typecheck, then jest on changed files.

CI is the backstop when someone bypasses the hooks.

### 5.6 CI on GitHub Actions

| Job | Runner | What it runs | When |
|---|---|---|---|
| `checks` | Linux | Install from lockfile; lint; typecheck; unit tests; gitleaks; PR size (fails over 600 changed lines, excluding lockfiles and snapshots, unless labelled `large-pr`); rulesync drift; PR has an Evidence section | Every PR |
| `android` | Linux | `expo prebuild` if CNG, then `./gradlew assembleDebug`, with Gradle cache | Every PR |
| `ios` | macOS | `pod install`, then a simulator build with no signing | PRs that touch native files, dependencies or app config (path filter, because macOS minutes cost several times more than Linux) |
| `e2e` (Phase 4) | Linux + Android emulator | Maestro flows for the critical user journeys | Nightly, and on PRs with an `e2e` label |

Also set up:
- branch protection: required checks plus one human approval;
- CODEOWNERS for native folders and release config.

### 5.7 Codemagic (Phase 5)

- Signed iOS builds go to TestFlight and Android builds to Play internal testing.
- A human pushing a tag triggers the build.
- Signing keys live only in Codemagic, never on dev machines or with agents (REL-05, SEC-08, SEC-17).

### 5.8 Verify scripts: the agent's eyes

`scripts/ai/verify.sh quick|ios|android|all`

- **quick:** lint, typecheck and related tests.
- **ios:** simulator build → install → launch → `xcrun simctl io booted screenshot` → `.ai/evidence/<task>/`.
- **android:** `assembleDebug` → install on emulator → launch → `adb exec-out screencap -p` → `.ai/evidence/<task>/`.

Each mode exits non-zero on failure and prints a one-line summary, which the agent copies into `progress.md`. Screenshots are the ground truth. A tool reporting "tap succeeded" is not (TST-11).

The `.ai/evidence/` folder is gitignored. The PR author attaches the relevant screenshots. In Phase 4, CI uploads Maestro screenshots as build artifacts, which become the trusted record.

### 5.9 Release check

`scripts/ai/release-check.sh` checks:
- version and build number are bumped on both platforms;
- `PrivacyInfo.xcprivacy` is present;
- every iOS permission has a usage string;
- Android permission changes since the last release are listed for review;
- no debug flags are left on;
- with `expo-updates`, native changes since the last release require a new build instead of an OTA update (REL-07);
- release notes are within the store length limits.

### 5.10 MCP servers

None are required in v1, because each one adds context cost and attack surface (CTX-07, SEC-03, SEC-10).

Optional per project, pinned and approved:
- **Expo MCP:** for Expo projects. Deny its store-submit and review-reply tools (REL-06).
- **Figma MCP:** for design-to-code. Its output is React + Tailwind by default, so the stack rules translate it to React Native (UI-01).
- **One device driver:** mobile-mcp or Maestro MCP, evaluated in Phase 4.

### 5.11 Team process (`docs/ai/team-process.md`)

- The person who opens a PR owns it and must be able to explain every change without AI (REV-03, HUM-09).
- Agent-made commits carry an `Assisted-by: <tool>/<model>` trailer and a `Spec: specs/<id>` trailer, so `git blame` leads to the spec and its decisions.
- PRs stay under 600 changed lines; split anything bigger.
- Each person runs at most 2 or 3 agents in parallel (HUM-06).
- Juniors use an explain-first mode for learning tasks (HUM-04).
- A 30-minute monthly review covers the metrics and `learn` changes.
- Re-audit rules on every React Native, Expo, Xcode or AGP upgrade and on every model change (CTX-12).

### 5.12 Continuing on another day, machine or tool

The task's memory lives in the repo, so it travels with `git push` and `git pull`, and every tool can read it.

**Handoff block at the top of `specs/<id>/progress.md`.** The agent updates it after every step, so a sudden stop (usage limit, laptop closed) loses one step at most.

```md
## Handoff  (updated 2026-10-07 18:40 · Claude Code / opus-5 · branch feat/PROJ-12-login)
Status:        in progress — task 3 of 5
Done:          1 API client ✔ (tests pass) · 2 auth store ✔
In progress:   3 Login screen — form done; "forgot password" link not wired (src/screens/Login.tsx)
Next step:     wire the link to the ForgotPassword route, then run verify ios/android
Decisions:     use react-hook-form (chat, 18:20) → also added to design.md
Open question: should the error banner auto-hide? (asked PO, no answer yet)
Last verify:   quick ✔ · ios ✔ (screenshot ios-login.png) · android not run
Blocked:       none
Notes:         Android emulator needs a cold boot after the Gradle upgrade
```

**Flow**

```
Day 1, Mac A, Claude Code                   Day 2, Mac B, Cursor (or any tool)
──────────────────────────────              ─────────────────────────────────────
/feature PROJ-12  → work…                   git pull · npx <kit> doctor
"pause"                                     /continue PROJ-12
 → handoff block updated                     → reads AGENTS.md, spec, handoff, git log
 → chat decisions written to files           → "Open question: … Next step: … OK?"
 → WIP commit pushed to feat/PROJ-12         → continues
```

**Safety nets**
- The "chat is not memory" rule in `AGENTS.md` (5.1).
- Handoff updates after every step.
- The `stop` hook check (5.4).
- `continue` warns about stale or uncommitted work.
- `doctor` checks the new machine's setup.

**What doesn't transfer:** the chat itself, "don't ask again" approvals, MCP logins, simulator state and secrets. Each machine gets its own `.env` from the team's password manager, never through git. None of these are needed to continue when the files are current.

## 6. Phases

Estimates assume one engineer working with AI assistance.

| Phase | Scope | Done when | Estimate |
|---|---|---|---|
| **P0 Compatibility spike** | Two sample apps (Expo and bare). In each tool, confirm that: `AGENTS.md` loads (Claude Code through `CLAUDE.md`); skills in `.agents/skills` and in the linked folders load and can be invoked; rulesync's output works, with the guard blocking `git reset --hard`, the `.env` read deny holding, and a subagent running; `specs/` is visible; and the `stop` hook can remind or block. | `docs/ai/tool-matrix.md` is written, with a fallback for anything that fails (copies instead of links, hand-written configs instead of rulesync) | 2–3 days |
| **P1 Enforcement** | Git hooks with gitleaks, PR template, CI (`checks`, `android`, `ios`) starting from Callstack's `github-actions` skill, dependency review, branch protection guide | Test PRs containing a secret, a 1,000-line diff, a failing test and a broken iOS build are each blocked | 3–4 days |
| **P2 Context** | `AGENTS.md` template with version fill-in; `docs/ai` skeleton (product, tech, structure, conventions, decisions); spec templates; RN stack pack (rules, restricted-import lint presets); vendored Callstack, Expo and Android skills pinned in `THIRD_PARTY.md`; rulesync config and drift check | Each tool correctly answers "how do I test, what counts as done, what must I not touch" with no extra prompting | 3–4 days |
| **P3 Workflows** | `feature`, `bugfix`, `continue`, `pause` and `review`, adapted from the skills in section 3.2; handoff block and `stop` check; subagents; guardrails | A real feature started in Claude Code on one Mac is paused, then finished the next day in Cursor or Kiro on another Mac via `continue`, and its PR passes CI with evidence. A real bug is fixed via `bugfix`, failing test first | 3–4 days |
| **P4 Mobile verification** | Verify scripts with screenshots, 3 Maestro flows, Android E2E in CI, evaluation of one device MCP | An agent's "done" includes screenshots for both platforms, and CI runs the flows nightly | 4–5 days |
| **P5 Release, learning, packaging** | Release check with fastlane `precheck`; `release-notes` built on git-cliff; Codemagic signed builds from their React Native sample; `learn` adapted from Superpowers `writing-skills`; public npm package with `init`/`sync`/`doctor`/`uninstall`, published through trusted publishing; team guide and a 1-hour training | A pilot release ships through Codemagic, and a second project installs the kit in under 15 minutes | 4–5 days |
| **P6 Later** | Flutter and native packs, Trello and task-platform intake, iOS E2E in CI, a kit eval suite (golden tasks re-run after model or tool upgrades), metrics dashboard, optional personal agentmemory trial (local only, its AI summarizing off) | — | — |

The total is about 5–6 weeks for one engineer.

## 7. Coverage: root causes → components

| # | Root cause | Issues | Components | Phase |
|---|---|---|---|---|
| 1 | The agent checks its own work | REQ-03, GEN-05, TST-01/02/04/05, DBG-02, ORC-07, GIT-01 | D7 evidence, `verify.sh`, reviewer subagent, CI | P1, P3, P4 |
| 2 | Missing project knowledge | REQ-01/02, ARC-01/02/03, API-02, CTX-08, HUM-10 | `docs/ai/`, `feature` BA and Architect phases, decision log | P2, P3 |
| 3 | Long sessions degrade, and context is lost between sessions | CTX-01–06, CTX-08, CTX-10, ARC-05/06, ORC-02 | Small tasks, the handoff block, `pause` and `continue`, the "chat is not memory" rule, rule size limits | P2, P3 |
| 4 | Outdated platform knowledge | GEN-08–14, ARC-07, BLD-04, UI-05, API-01 | Version fill-in, upstream skills, restricted-import lint presets | P2 |
| 5 | Rules are advice, not enforcement | CTX-09, GEN-06/07, GIT-04, DBG-07, BLD-02/03 | Git hooks, CI, permissions, guard hook, native-folder deny | P1, P3 |
| 6 | Each tool reads config differently | XTL-01–05, XTL-07, XTL-14, CTX-11/13 | Open standards (`AGENTS.md`, `.agents/skills` plus links), rulesync only for permissions, hooks and subagents, committed outputs, drift check, `doctor`, P0 matrix | P0, P2 |
| 7 | The agent can't see the app | TST-08–12, BLD-05/08/09, UI-02/06 | `verify.sh` screenshots, macOS CI job, Maestro | P1, P4 |
| 8 | More code than people can review | REV-01–08, GIT-02, HUM-03/08 | PR size check, PR template with evidence, reviewer subagent, team rules | P1, P3 |
| 9 | Supply chain and secrets | SEC-01–19, API-04, GIT-05, TST-13 | Secret scanning, sensitive-file blocks, read denies, dependency "ask first", MCP off by default, keys only in Codemagic | P1, P3, P5 |
| 10 | Release with no gates | REL-01–08 | `release-check.sh`, `release-notes`, tag-triggered Codemagic | P5 |
| 11 | Cost and limits | XTL-08–13, ORC-03–06, ORC-08–10 | Single writer, handoff updated after every step, `pause` and `continue` for switching tools at usage limits, no parallel writers | P3 |
| 12 | People and process | HUM-01–14, DBG-05 | `team-process.md`, `learn`, metrics review | P5 |

**Not solvable with tooling.** These need management decisions; they are listed so nobody expects the kit to fix them:
- junior hiring pipeline (HUM-05);
- mandates and expectations (HUM-11);
- vendor policy changes (XTL-11);
- AI budget (XTL-12);
- store review queue times (REL-02).

## 8. Risks

| Risk | Mitigation |
|---|---|
| rulesync changes often (27 major versions so far) or is abandoned | It only handles the safety layer; rules and workflows don't depend on it. Pin the exact version and commit its output, so projects keep working without it. Upgrade on purpose in the kit repo and re-run the P0 matrix. |
| Vendored or adapted skills fall behind their upstream | Pinned commits in `THIRD_PARTY.md`; `sync` reports newer upstream versions; review them on every React Native, Expo or AGP upgrade |
| Folder links don't work on a machine (e.g. Windows) | `sync` falls back to copying, and CI checks that the copies match |
| `init` damages a team's existing AI setup | It refuses to run with uncommitted changes, merges between markers instead of overwriting, skips existing files, and `uninstall` reverses it |
| A session stops suddenly before `pause` runs | The handoff is updated after every step and commits are made per task, so at most one step is lost; the `stop` hook catches a forgotten update |
| A tool changes where it reads config (XTL-14) | `doctor` checks, plus a matrix re-run after tool updates |
| Hook scripts behave differently in each tool | P0 tests the guard in each tool. Git hooks and CI remain the real backstop. |
| Process overhead slows small tasks (REQ-05) | Size triage: small tasks skip the design step and its approval |
| macOS CI cost | Path filters, cancelling superseded runs, Codemagic for release builds |
| Expo and bare React Native need different setups | `init` detects which one; CI and verify scripts have a variant for each |
| People keep their own prompts | One pilot project, 1-hour training, a named champion, and `learn` so improvements flow back into the kit |
| The kit itself becomes a supply-chain risk | rulesync is the only dependency, pinned; install with `--ignore-scripts` where possible |

## 9. Answers (2026-10-07) and what they change

| # | Question | Answer | Effect on the plan |
|---|---|---|---|
| 1 | Expo or bare React Native? | Both | `init` detects which one. CI and verify scripts get an Expo (CNG) variant and a bare variant. |
| 2 | Package manager? | All; use the project's existing one or the user's choice | `init` detects npm, yarn, pnpm or bun from the lockfile; with no lockfile, it asks (or takes `--pm`). Hooks, CI and `AGENTS.md` commands use the detected one. |
| 3 | GitHub? | Yes | GitHub Actions for PR checks, as planned |
| 4 | Pilot project? | One that covers all of this | The kit gets its own test projects: an Expo app and a bare app across npm, yarn and pnpm. The P3 acceptance test still needs one real team project. |
| 5 | Kiro and Antigravity: IDE or CLI? | Both | Targets become Kiro IDE, Kiro CLI, Antigravity IDE and Antigravity CLI: eight tool variants in the P0 matrix |
| 6 | Everyone has a Mac? | Yes | Local iOS checks (simulator build and screenshot) become part of "done" for everyone |
| 7 | Task platform? | An internal HR and task platform | v1 intake: paste the task text plus its link into `feature`. A direct connection comes later (P6), if the platform offers an API or export. |
| 8 | Distribution? | Public npm package and git URL | See section 9.1 |

### 9.1 What a public package changes

- **Generic content only.** The kit holds no company-specific rules, URLs or names. Team-specific content (conventions, task-platform links, team process) lives in each project's `docs/ai/`.
- **License:** MIT for our own content. Vendored MIT and Apache-2.0 skills keep their license and notice files, listed in `THIRD_PARTY.md`.
- **Safe publishing:** releases are published from GitHub Actions with npm trusted publishing (no long-lived npm token) and provenance, with 2FA on the npm account. The kit must not become the next compromised package (SEC-01, SEC-19).
- **Install:** `npx agentic-mobile-kit init`, or `npx github:<org>/agentic-mobile-kit init` from the git URL.
- **Versions:** semver, with the changelog generated by git-cliff.

### 9.2 Tool availability for Phase 0

Phase 0 ran on one Mac with Claude Code, Codex and Antigravity installed, plus Xcode, Android Studio, CocoaPods and Maestro. Cursor, Kiro and OpenCode were not installed and are tested later.

## 10. Phase 0 results (2026-10-07) and what they change

Tested on one Mac with Claude Code 2.1.292, Codex CLI 0.160.1 and Antigravity CLI 1.3.1. Full results: `docs/tool-matrix.md` in the kit repo.

**Confirmed:** one `AGENTS.md`, skills in `.agents/skills` (linked for Claude Code) and a subagent defined once in `.rulesync/` worked in all three tools. D1, D2 and D3 hold.

**Changes to the plan:**

| Finding | Change |
|---|---|
| Codex runs project hooks only after each person approves them on each machine; then the guard worked | `doctor` checks Codex trust and hook approval and prints the exact steps. Onboarding includes this one-time step. |
| Antigravity ignored the project-level hooks rulesync wrote, even in a trusted folder | For Antigravity, the guard has to ship as an Antigravity plugin (to be tested). Until then, its own permission prompts are the guard, so "skip permissions" and auto-run modes stay off (team rule in 5.11). |
| Codex and the Antigravity CLI read `.env` despite the deny rules | Real secrets stay out of the project folder and are injected at run time (password manager or shell environment). `guard.sh` also blocks shell commands that touch `.env`. The "Deny reading" row in 5.4 is a second layer, not a barrier. |
| Codex ran a skill on its own because a folder name matched the skill's name | Workflow skills get a prefix (`m-feature`, `m-bugfix`, `m-continue`, `m-pause`, `m-review`) and have implicit invocation turned off |
| Antigravity CLI 1.1.9 ignored `AGENTS.md`; 1.3.1 reads it | `doctor` checks minimum tool versions |

Still open from Phase 0: Cursor, Kiro and OpenCode (not installed yet), the Antigravity IDE and plugin route, and a single `tests/matrix/run.sh` for re-runs after tool updates.

## 11. Next step

The name is reserved: `agentic-mobile-kit` 0.0.1 (a placeholder with no commands) was published to npm on 2026-10-07 from the `prakashpro1` account. The repo is public at https://github.com/prakashpro3/agentic-mobile-kit (commits use the account's noreply email), and Phase 0 results are pushed. Next: Phase 1 (enforcement: git hooks, CI, PR template), with the remaining Phase 0 tools added when they're installed.
