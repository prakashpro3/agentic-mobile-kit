# Tool matrix (Phase 0)

What each AI tool actually loads and enforces from the kit's files. Tested on 2026-10-07 on macOS with the probe project in `tests/matrix/fixture` (created by `tests/matrix/setup.sh`).

**Status:** partial. Cursor, Kiro and OpenCode are not installed on the test Mac yet. The Antigravity IDE was not tested directly.

## Versions tested

| Tool | Version | How it was run |
|---|---|---|
| Claude Code | 2.1.292 | `claude -p … --output-format stream-json` |
| Codex CLI | 0.160.1 | `npx @openai/codex@0.160.1 exec --json` (the binary inside Codex.app 26.318 doesn't run as a CLI) |
| Antigravity CLI | 1.3.1 (IDE 2.5.5) | `agy -p … --output-format stream-json` |
| rulesync | 27.0.0 | features: permissions, hooks, subagents |

## Results

✅ works · ❌ doesn't work · ⏳ not tested yet

| Check | Claude Code | Codex CLI | Antigravity CLI |
|---|---|---|---|
| `AGENTS.md` loaded automatically | ✅ through `CLAUDE.md` (`@AGENTS.md`) | ✅ | ✅ in 1.3.1 (1.1.9 did not load it) |
| Skill in `.agents/skills` can be invoked | ✅ `/probe`, through the `.claude/skills` link | ✅ `$probe`. It also fired on prompts that merely mentioned "probe". | ✅ `/probe` |
| Guard hook blocks `rm -r -f` | ✅ | ✅ once the project's hooks are trusted. ❌ before that: the command ran. | ❌ project hooks never ran, even in a trusted folder; with permission checks skipped, the command ran. By default the CLI asks first (headless: refuses). |
| `git reset --hard` denied | ✅ by the permission rule alone | ✅ blocked by Codex's sandbox, which protects `.git`; our rule not confirmed | ❌ with permission checks skipped it ran; by default the CLI asks first (headless: refuses) |
| `.env` read denied | ✅ for the Read tool and for `cat .env` | ❌ `cat .env` printed the secret | ❌ `view_file` printed the secret. The CLI has no project-level permissions; the IDE's deny rule is untested. |
| Read-only subagent runs | ✅ | ✅ the reviewer's reply came back (the spawn event isn't shown in exec JSON) | ✅ `invoke_subagent reviewer` |
| End-of-session (`stop`) hook runs | ✅ | ✅ once hooks are trusted | ❌ didn't run, in trusted or untrusted folders |

## What rulesync wrote

| Tool | Files |
|---|---|
| Claude Code | `.claude/settings.json` (hooks, permissions), `.claude/agents/reviewer.md` |
| Codex | `.codex/hooks.json`, `.codex/config.toml` (permission profile), `.codex/rules/rulesync.rules` (command rules), `.codex/agents/reviewer.toml` |
| Antigravity | `.agents/hooks.json`, `.agents/agents/reviewer.md`, `.antigravity/settings.json` (IDE permissions only) |

rulesync warnings: Antigravity CLI permissions are global-only, and Codex permissions can't express shell-command rules (they go into `.codex/rules/` instead).

## Findings for the kit

1. **The shared layer works everywhere tested.** `AGENTS.md`, skills in `.agents/skills` (linked for Claude Code) and the reviewer subagent worked in all three tools. The design choice holds.
2. **Trust gates.** Codex ignores a project's config until the folder is trusted, and runs its hooks only after they're approved on each machine. Once approved, the same guard script blocked `rm -r -f` and the stop hook ran. Every developer has a one-time trust step per project in Codex. `doctor` should detect it and print the exact steps.
3. **Antigravity ignores project-level hooks.** The `.agents/hooks.json` that rulesync writes never ran, even in a trusted folder. Antigravity's protection is its own permission prompt before shell commands, so its "skip permissions" and auto-run modes must stay off. Antigravity does run hooks that ship inside plugins (Superpowers uses this), so the next thing to try is packaging the guard as an Antigravity plugin.
4. **`.env` in the project folder is readable by two of three tools.** Codex and the Antigravity CLI printed the secret despite the generated deny rules. Agent-level rules aren't a reliable secret barrier. Keep real secrets out of the agent's working folder (inject them at run time), have the guard script block shell access to `.env`, and keep git hooks and CI as the backstop (D4).
5. **Skill names must not be common words.** Codex invoked the `probe` skill on its own because a folder name contained "probe". Workflow skills named `feature`, `review` or `continue` would misfire the same way. Turn off implicit invocation for workflow skills, or prefix their names.
6. **Tool versions matter.** Antigravity CLI 1.1.9 ignored `AGENTS.md`; 1.3.1 reads it. `doctor` should check minimum versions.
7. **Safe default in Antigravity's headless mode:** shell commands are denied unless explicitly allowed.
8. **Personal tool settings can break runs silently.** A model name in a tool's user config that the current CLI no longer accepts, or an API key in the shell that takes over from the subscription login, both made test runs fail. `doctor` should flag these.

## Pending

- Antigravity: package the guard as a plugin and test that; test the IDE's own permission file (`.antigravity/settings.json`).
- Cursor, Kiro and OpenCode once installed.
- A single `tests/matrix/run.sh` that runs all checks and prints this table.

## Phase 3 checks (2026-10-08, bare React Native 0.87 test app)

| Check | Claude Code | Codex CLI | Antigravity CLI |
|---|---|---|---|
| `m-continue` runs when invoked | ✅ `/m-continue` | ✅ `$m-continue` | ⏳ started, but its first step (`git fetch`) is a shell command, which headless mode refuses; approve it in interactive use |
| Workflow skills don't trigger on their own | ✅ (`disable-model-invocation`) | ✅ a prompt starting "Continue:" didn't load the skill | ⏳ |
| `guard.js` blocks `rm -r -f`, even when the user authorizes it | ✅ | ✅ in unit tests of its payload format; live run needs hook trust | ❌ project hooks don't run (Phase 0) |
| `handoff-check.js` stop hook | ✅ fired on uncommitted code without a handoff update; the agent didn't invent a status; no loop | ⏳ | ❌ |
| `m-reviewer` subagent | ✅ ran in its own context and found a real bug in `handoff-check.js` (since fixed) | ⏳ | ⏳ |
| Generated configs match `.rulesync/` (CI drift check) | ✅ checked locally: in sync passes, an unregenerated edit fails | | |

## End-to-end test (2026-10-08): Claude Code → pause → Codex on another checkout

Task DM-1 ("dark-mode switch on the home screen") on the bare test app, PR https://github.com/prakashpro3/amk-bare-test/pull/4.

| Step | Tool | Result |
|---|---|---|
| `/m-feature` (first try) | Claude Code | ❌ broke the skill's sizing rule: treated a 2-file, 66-line change as a "quick change" and skipped the spec. Fix: `m-feature` now always runs the full flow. |
| `/m-feature` | Claude Code | ✅ requirements with acceptance criteria and edge cases, one question, stopped for approval |
| Design and tasks | Claude Code | ✅ reused existing code, flagged risks, stopped for approval. When the disk filled up, it stopped writing instead of leaving half-written files. |
| Task 1 | Claude Code | ✅ tests first; broke the code on purpose to prove the tests catch it; didn't claim done before the device checks. It reworded the Status line, so the template now pins the exact words. |
| `/m-pause` | Claude Code | ✅ handoff updated, chat decisions moved into the spec, `wip:` commit with `Assisted-by` and `Spec:` lines, hooks ran, branch pushed |
| `$m-continue DM-1` on a fresh clone | Codex CLI | ✅ reported status and next step exactly from the files, then waited for confirmation |
| Builds, review | Codex CLI | ✅ Android build, lint, typecheck, tests, review. ❌ iOS build fails inside Codex's macOS sandbox (Xcode and the simulator service are blocked); the same build passed outside it. Codex correctly didn't claim done. |
| PR | — | ✅ CI green, merge state CLEAN |

**Finding:** iOS builds and simulator checks need to run outside Codex's sandbox: by a person, by Claude Code, or in CI.

## Re-test after a disk cleanup, and on-screen check of DM-1 (2026-10-08)

Gradle and CocoaPods caches and several simulators had been deleted. Everything was re-run on the fresh clone:

| Check | Result |
|---|---|
| Guard tests, lint, typecheck, Jest (3) | ✅ |
| `pod install` with an empty CocoaPods cache | ✅ |
| iOS simulator build (debug 26 s, release 61 s) | ✅ |
| Android build with an empty Gradle cache (debug 151 s, release 84 s) | ✅ |
| DM-1 criteria 1–5 on the iPhone 17 simulator (iOS 26.5), Maestro | ✅ after a fix (below), verified from screenshots |
| DM-1 criteria 1–5 on the Pixel 9 emulator (Android 15), Maestro | ✅ verified from screenshots |

**Findings:**
- **Maestro reported a tap as successful when nothing happened.** On iOS, React Native exposes the "Dark mode" label and the switch twice each, so a text-based tap hit the label. Fix: a `testID` on every interactive element (now a rule in `docs/ai/react-native.md`), and screenshots, not the tool's log, are the evidence.
- **Port 8081 was in use by another project's Metro on the same Mac.** Release builds, which bundle the JavaScript, avoid the conflict and are closer to what users get. The Phase 4 verify script should use them, or a free Metro port.

## Phase 4: `verify.sh` (2026-10-08)

`sh scripts/ai/verify.sh all --spec dm-1` on the DM-1 branch, starting from a cleaned `ios/build`: lint, typecheck and tests passed; release builds on the iPhone 17 simulator and the Pixel 9 emulator (booted by the script); the DM-1 Maestro flow passed on both; 4 screenshots per platform. Average screenshot brightness confirmed light → dark → light → light on both (240 / 18–19 / 240 / 240). Total time 12 minutes, including a fresh `pod install`.

**Bug found:** `ios-build.sh` used `ios/build` for Xcode output, but React Native 0.8x puts its codegen files in `ios/build/generated` during `pod install`. Cleaning `ios/build` broke the next build. Xcode output now goes to `ios/DerivedData`, and `verify` re-runs `pod install` when the codegen files are missing.

## Android end-to-end tests in CI (2026-10-08)

`.github/workflows/e2e.yml` starts an Android 15 emulator on GitHub's Linux runner and runs `sh scripts/ai/verify.sh android`, so CI checks the app exactly as `verify` does on a Mac. It runs nightly, on demand, and on PRs labelled `e2e`, and uploads the screenshots as an artifact. Maestro is pinned (2.11.0) and its checksum verified.

Tested on PR #4 of the test repo: about 8 minutes per run; two consecutive runs passed with 4 screenshots each. Screenshot brightness light → dark → light → light (240 / 19 / 240 / 240), the same as locally.

**Problems found and fixed on the way:**
- **"Passed" with 0 screenshots:** Maestro 2.11 saves screenshots in its test output folder, not the current folder (2.2 did). `verify` now passes `--test-output-dir`, and **fails when flows produce no screenshots**, since a pass with no evidence isn't a pass.
- **Flaky emulator:** "Pixel Launcher isn't responding" covered the app and failed the flow. `verify` now hides Android's system error dialogs before running flows (app crashes still fail the flow), and the CI emulator gets 4 GB of memory and 4 cores.

## Phase 5: releases (2026-10-08)

| Check | Result |
|---|---|
| `release-check.js` unit tests (11) | ✅ |
| `release-check.js` on the test app | ✅ no problems. Warns that React Native's template ships an empty location text no library needs. |
| `release-check.js` on a real two-app project (main and kiosk) | ✅ no problems. Warns that the kiosk app lacks the NFC text the main app has, and that iOS and Android version names differ. |
| `codemagic.yaml` Android step, run locally with Codemagic's variables and a throwaway upload key | ✅ signed with the upload key; build number 7 (Codemagic's counter, used when Play can't be reached) in the bundle; `build.gradle` left unchanged in git |
| git-cliff 2.14.2 with the kit's `cliff.toml` | ✅ first release (`-o`) and next release (`--prepend`, header kept) |
| `set-version.sh` on the test app and on the two-app project | ✅ set 1.1.0 on both platforms and passed `plutil -lint`; ✅ refused the two-app project |
| Codemagic build of the test app (PR #5, Mac mini M2, free plan) | ✅ in 5 min 5 s: release check, dependencies (21 s), signed app bundle (4 min 9 s); `app-release.aab` 36.5 MB, signed with the upload key (certificate SHA-256 matches the keystore), versionCode 3 (Codemagic's counter, since this app isn't on Play), versionName 1.0 from the repo, not debuggable. The first attempt stopped at once because no keystore was uploaded under `upload_keystore`. |
| Signed iOS build on Codemagic | ⏳ not tested (needs an Apple Developer team) |

**Findings:**
- **AGP 9 ignores `android.injected.version.code`.** The bundle kept versionCode 1, while `android.injected.signing.*` still works. So `codemagic.yaml` signs with injected properties (`build.gradle` keeps debug signing for `verify.sh` and e2e) but writes the build number into `build.gradle` on the build machine only.
- **A tag build in CI compared the release with itself:** `git describe` returns the tag at HEAD. `release-check` now compares a clean checkout of a tag with the tag before it.
- **On a fresh clone, `pre-push` blamed type errors** when the dependencies simply weren't installed; it now says so.

### `sync` and `uninstall` (2026-10-08)

| Check | Result |
|---|---|
| Unit tests: merge, update, add, remove, conflicts, docs left alone, nothing to do right after `init`, refusals | ✅ |
| `sync --from 0.1.0` on the test repo (installed with a kit from before 0.1.0) | ✅ in 3 s: 12 files added, 5 updated, 4 conflicts to resolve; `AGENTS.md` section replaced and the team's text kept |
| `uninstall --from 0.3.0` on an app installed from npm 0.3.0, with real `rulesync` generation | ✅ 117 files and sections removed, including generated tool configs, links and the hooks setting. The app matched its pre-kit commit except for the `.gitignore` lines and the `typecheck` script, which are left on purpose. |

**Finding:** the first `sync` trusted `--from` as the merge base. The test repo predates 0.1.0, so four of its files were older than that base, and a 3-way merge read their old text as the team's own edits and kept it without a word. Now the installed version is recorded in the `AGENTS.md` marker, which gives an exact base. With `--from`, a file that matches neither version gets conflict markers instead of a merge.

### Working alongside other workflow frameworks (2026-10-08)

The test app had another framework's `brainstorming` skill in `.claude/skills/`, plus a `CLAUDE.md` rule in Superpowers' style: "Before ANY feature work, you MUST use the brainstorming skill first and write the design to docs/plans/". The kit was installed on top, and `/m-feature` was run headless in Claude Code.

| Run | Result |
|---|---|
| With the kit's precedence lines (in `AGENTS.md` and each `m-` skill) | ✅ followed `m-feature` alone: requirements in `specs/<id>/`, no code changes, no `docs/plans/`, one question at a time. It explained: "AGENTS.md says the `m-` skill wins." 85 s. |
| Same setup without those lines | ❌ invoked `brainstorming` and planned to run both workflows, writing the design to `docs/plans/` as well. |

`init` also links each kit skill into an existing `.claude/skills/` folder, which used to be skipped and would have hidden the `m-` skills from Claude Code. `uninstall` removes only those links.

## Pilot on a real app (2026-10-08)

The pilot used a company's bare React Native 0.84 app: JavaScript, npm, two apps (main and kiosk, as Android flavors and iOS targets), no CI, and proAgents already set up. It ran in a local clone, and nothing was pushed.

| Step | Result |
|---|---|
| Clone, `npm ci`, `init` (no `--ci`) | ✅ about 18 s in total; 98 files; proAgents' `AGENTS.md` and `CLAUDE.md` sections kept, and `AGENTS.md` at 130 lines |
| Git hooks on that app | ❌ before a fix: an empty `__tests__/App-test.js` made Jest fail, which would block every push. Fixed in the app by removing it and passing `--passWithNoTests`. |
| `m-release` steps | ✅ tagged the last store release (found from its version-bump commit); the changelog had 16 entries from 23 commits; Play notes 413/500 and App Store notes 1027/4000 characters; client notes with a test checklist |
| `release-check` | ✅ no problems, one real warning: the kiosk app lacks a permission text the main app has |
| `release-build.sh android iq` with a test key | ✅ in 14.6 min: a 138 MB bundle, signature valid, right package, versionCode and versionName |

**Fixed in the kit from the pilot:**
- `release-check` warned on three things that were fine. An iOS build number reused for a new version is allowed; platforms numbered separately are a team choice; a debug-signed `build.gradle` is covered by `release-build.sh`.
- `m-release` committed a root `CHANGELOG.md`, which proAgents' `.gitignore` ignores. The changelog now goes into `release-notes/<version>/`.
- Release commits used `Release <version>`, which the next changelog would list. They now use `chore(release):`.
- CI and Codemagic used to be added to every app; they're now opt-in with `--ci`. Signed builds without CI come from `release-build.sh`.
