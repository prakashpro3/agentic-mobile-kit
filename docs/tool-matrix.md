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

## Ideas adapted from OpenSpec (2026-10-08)

OpenSpec (Fission-AI, v1.14.1) is a planning-only layer: living specs that each change updates through ADDED, MODIFIED and REMOVED requirements. The kit took its spec format, its change notes and its review practices, implemented as `scripts/ai/spec.js` and skill steps. It didn't take OpenSpec's lack of approval stops, its per-tool copies of skills, or its telemetry.

| Check | Result |
|---|---|
| `spec.js` tests: format check, drafts skipped, merge by name (add, modify, remove, deleting an emptied area), refusals that change nothing, safe re-runs, status | ✅ |
| Pre-commit in a freshly initialized app | ✅ blocked a requirement with no SHALL and no scenario, with clear messages; passed once it was fixed |
| `sync` on the test repo from the recorded version 0.4.0 (no `--from`) | ✅ exact merge base: 13 files updated, 5 added; the CI choice was recorded |
| Headless `/m-feature` in Claude Code | ✅ wrote `## ADDED Requirements: home` with a SHALL requirement and two GIVEN/WHEN/THEN scenarios, dropped the empty sections, ran `spec.js check`, and asked one question at a time. 113 s. |

**Bug found:** `sync` reported a file as "merged with your changes" when only the team had edited it and the kit hadn't changed it. The file was left as it was, but the report was noise. Such files are now left out of the report.

## macOS, Windows and Linux (2026-10-09)

`.github/workflows/test.yml` runs the unit tests and the guard tests on every change, then installs the kit on a fresh app: `init` with real tool-config generation, a commit through the kit's hooks, `doctor` and `uninstall`. It runs on macOS, Windows and Linux. All three pass.

**Found by the Windows runs, all fixed:**
- **Starting `npm`/`npx`:** Node starts these `.cmd` files only through a shell. Worse, a quoted `.cmd` name found on PATH gets the wrong `%~dp0`, so `npx` failed with `MODULE_NOT_FOUND`.
- **Paths:** kit file paths and link targets came back with backslashes. Reports were wrong, and `uninstall` missed the skill links.
- **The executable flag:** files have none on Windows, so `init` stages the hooks as executable for Mac and Linux clones.
- **Line endings:** Git for Windows checks files out with CRLF. `init` adds `.gitattributes` rules that keep shell scripts in LF, and `sync` compares files ignoring CRLF.
- **Symbolic links** need Developer Mode. A refused link is now a warning with the fix.

## Product flavors, iOS schemes and signing keys (2026-10-09)

Checked on a new React Native 0.87 app and on three production apps on React Native 0.84: two in TypeScript, one in JavaScript, all installing with npm.

| Check | Result |
|---|---|
| `android-flavors.js`: Groovy and Kotlin build files, nested blocks, comments, several flavor dimensions | ✅ unit tests |
| The production apps: no flavors, 2 flavors, 4 flavors with app ID suffixes | ✅ listed correctly |
| `verify.sh android` on the app with 4 flavors | ✅ checked the first flavor, built `assembleDevRelease` signed with the debug key, found the APK under its custom file name, read the app ID with its `.dev` suffix from the APK, and the screenshot showed that flavor's login screen |
| `ios-build.sh` with a second scheme (`AMK_IOS_SCHEME`, Release) | ✅ built in 75 s; a wrong scheme name stops with xcodebuild's own message |
| `release-check`: signing keys and passwords in git | ✅ unit test; on the production apps it named the key files and counted the passwords, without printing them |

**Bug found:** the smoke check (used when an app has no Maestro flows yet) took its screenshot as soon as `launchApp` returned, 0.7 s after launch and before the app had drawn. It passed with a picture of the home screen. It now waits for the screen to settle first; 4 runs, including the first launch after a fresh install, all showed the app. The flow template also asserts each scenario's result before its screenshot.

**Found on the way:**
- Building a fresh clone showed that one app imports `./Storage` while git has `storage.ts`, a case-only rename made on a Mac. It builds on the developer's machine and fails everywhere else. Added to `known-issues.md`.
- One app's Gradle wrapper jar didn't match its `gradlew` after a React Native upgrade, so every Gradle command failed. Added to `known-issues.md`.
- One app's `npm ci` failed on a peer-dependency conflict that the team gets past with `--legacy-peer-deps` on their machines. `install-deps.sh` now says to commit `legacy-peer-deps=true` in `.npmrc`.

## Setups beyond the test apps (2026-10-09)

Common React Native setups that the first test apps didn't have, each checked against the kit.

| Setup | Before | Now | Checked |
|---|---|---|---|
| husky, lefthook, simple-git-hooks, or a team's own hooks folder | Two tools set `core.hooksPath`. husky's `prepare` script runs after the kit's `postinstall`, so the kit's hooks were off after every install | The kit's hooks run from the team's: one line in their hook files, an entry in `lefthook.yml`, or a command in `package.json`. `core.hooksPath` stays theirs; `doctor` and `uninstall` handle it | Unit tests for each manager. Real commits with husky 9.1.7, lefthook 1.13.6 and lefthook 2.1.14 (`commands:` and `jobs:`) ran the kit's checks next to the team's, and a staged `.env` stopped the commit |
| Android check builds | Native code compiled for four CPU types | Only the device's CPU type (`-PreactNativeArchitectures`, as `run-android --active-arch-only` does); the emulator boots during the build; with per-CPU APK splits, the matching APK is installed; `AMK_ANDROID_DEVICE` picks a device | A production app with 4 flavors, cold Gradle builds: 224 s for one CPU type, 733 s for all four. `verify.sh android` then started the emulator itself, built for its arm64-v8a, and the screenshot showed the app |
| Old Architecture apps (React Native 0.81 or older, `newArchEnabled=false`) | `AGENTS.md` said New Architecture for every app | `AGENTS.md` names the app's architecture; `docs/ai/react-native.md` has rules for each | Unit tests for 0.73 to 0.84, with and without the flag |
| iOS: configurations per environment, manual or ad hoc signing, a Gemfile | Check builds always used `Release`; exports always used automatic signing for the App Store; `pod install` ignored the Gemfile | Release builds use the scheme's archive configuration; `release-build.sh` exports with `ios/ExportOptions.plist` (or `AMK_IOS_EXPORT_OPTIONS`) when there is one; `pod-install.sh` uses Bundler when the Gemfile's gems are installed | A fresh clone of the test app: `pod-install.sh` fell back to the CocoaPods on PATH with a hint (the Gemfile's gems weren't installed); `verify.sh ios` built the scheme's Release configuration and the feature flow's 4 screenshots showed the app; a scheme that archives in Debug built in Debug; the smoke check on iOS showed the app |
| fastlane or another CI setting build numbers | `release-check` warned "build number unchanged" on every release | Recognized in Fastfiles and the usual CI files; `m-release` hands the build to the team's lanes | Unit test with `increment_build_number` and `increment_version_code` |
| An app in a monorepo subfolder | `init` ran, but the hooks never ran and GitHub ignored the workflows | `init` stops and says why | Unit test; the CLI exits 1 with the message |
| Files renamed only in letter case | Built on the developer's Mac, failed in CI and fresh clones | `pre-commit` blocks it and shows the `git mv` fix; `doctor` reports it | Unit tests, including a renamed folder |

`release-build.sh ios` with an export options file isn't tested yet: it needs an Apple Developer team.

## Expo (2026-10-09)

Tested on new apps from `create-expo-app` 5.0.0 (Expo SDK 57, React Native 0.86.3, Expo Router) on the iOS simulator and the Android emulator, without an Expo account.

| Check | Result |
|---|---|
| `init` with real tool configs | ✅ Expo's own `AGENTS.md` text stays above the kit's section. `.claude/settings.json` keeps Expo's Claude Code plugin next to the kit's hooks and permissions: edits to `ios/**` and `android/**` are denied, and `eas` commands ask first. `doctor` passes apart from the unfilled docs |
| `verify.sh all` | ✅ prebuild, pods and Release builds on both platforms, and the smoke screenshots show the app. `package.json` and `app.json` are unchanged afterwards |
| Prebuild only when something native changed | ✅ skipped in 1 s while Expo's fingerprint is unchanged. A change to `app.json` regenerated the project and showed up in `Info.plist` |
| `release-check` | ✅ read the app through `expo config`: version, build numbers, permission texts and Android permissions |
| `release-build.sh android` | ✅ signed with a throwaway upload key; without a key it stops on the debug key |
| `/m-feature` in Claude Code (a tap counter on the Home screen) | ✅ requirements in 78 s and design and tasks in 123 s, stopping for approval each time, with no new dependency. Implementation, then `verify.sh all` on both platforms. It didn't count its second run, which had passed: one iOS screenshot showed the splash screen fading over the result. It fixed its flow and ran a third time, and all 10 screenshots matched their scenarios. It found an accessibility problem (at the largest text size, the Home screen overflows) and asked how to handle it |
| `/m-pause`, then `/m-continue` in a new Claude Code session on a fresh clone | ✅ handoff, the living spec merged, and a `wip:` commit. The push failed because the test repo has no remote, so it reported that instead of adding one. The new session reported the status and the next step from the files in 21 s, and noticed that the "no remote" blocker was out of date |
| `/m-continue` in the Antigravity CLI 1.3.1 on another fresh clone | ✅ in 70 s with `--dangerously-skip-permissions`: it reported, in the skill's order, the blockers (it noticed that the "no remote" one was out of date), the status with its commits, and the exact next step. It asked for confirmation and changed nothing. Without that flag, headless mode refuses the skill's first shell command (`git fetch`) and prints nothing. Antigravity's CLI permissions can only be allowed globally; in interactive use, a person approves each command |
| `$m-continue` in the Codex CLI 0.162.0 on another fresh clone | ✅ in 41 s: it ran `git fetch` and `git status`, read the spec files, and reported the status and the exact next step (the review). It noticed that the recorded "no remote" blocker no longer applied, then waited for confirmation. It changed nothing. The test Mac's Codex config named a model this version rejects for ChatGPT accounts (`gpt-5.3-codex`), so the run used `-m gpt-5.5` |

**Bugs found and fixed on the way:**
- The smoke screenshot showed Expo's splash screen. The splash stays up until the JavaScript has loaded, and a still splash counts as a settled screen. The smoke check now waits 5 s first, and the flow template waits after every launch.
- The first `prebuild` rewrites the `package.json` run scripts and writes a placeholder bundle ID into `app.json`. `prebuild.sh` puts both back.
- SDK 57's `prebuild` recreates the native folders by default, which threw away pods and build caches on every check. `prebuild.sh` skips it while Expo's fingerprint is unchanged.
- `prebuild.sh` stopped silently when `app.json` had uncommitted changes. The test for that case found it.
- A fresh Expo app fails `tsc --noEmit` until `expo start` writes `expo-env.d.ts`, so `pm-run.sh` writes the same file before a type check.
- The first `expo lint` installs ESLint and edits `package.json`. `pm-run.sh` skips lint until the team sets it up.

**Expo SDK 55** (a `create-expo-app` app on the SDK 55 template: React Native 0.83.10, React 19.2.0, TypeScript 5.9):

| Check | Result |
|---|---|
| `init`, `doctor`, `uninstall` | ✅ the same results as on SDK 57 |
| `verify.sh` quick checks and iOS | ✅ the type check passed, lint and tests were skipped with their reasons, and the iOS screenshot shows the app |
| Prebuild skip, `release-check`, `set-version.sh` | ✅ |
| Android release builds (`verify.sh`, `release-build.sh`) | ❌ an Expo SDK 55 bug, which fails the same way without the kit (plain `expo prebuild`, then `./gradlew assembleRelease`). The newest SDK 55 `expo-modules-core` (55.0.26) looks for `libworklets.so` in an older build-output folder than the one `react-native-worklets` 0.7.4 builds it into. The cause and the workaround are in the Expo `known-issues.md` |
| Android, with that workaround | ✅ `verify.sh android` showed the app; `release-build.sh android` signed with a throwaway upload key, and without a key it stopped on the debug key |

**Not tested:** anything on EAS (no Expo account), and signed iOS builds (no Apple Developer team).

## Three production apps (2026-10-09)

The kit installed on clones of three production React Native 0.84 apps:
- **App A:** TypeScript, proAgents, existing `.claude/skills`, its own Maestro flows, an Airbnb-style ESLint config.
- **App B:** TypeScript, 4 product flavors.
- **App C:** JavaScript, husky 4 with lint-staged, 2 flavors and 2 iOS targets.

| Check | Result |
|---|---|
| `init`, `doctor` | ✅ in all three. The kit section sits next to proAgents, and skills are linked into an existing `.claude/skills`. On App C, husky 4 runs the kit's hooks |
| `release-check` | ✅ found signing keys in git in all three, and a permission text missing from one of App C's two targets |
| Android check builds | ✅ in all three, each checking its first flavor. App A's own Maestro flows stopped at a login that needs test credentials |
| iOS check builds | ✅ App A. ❌ Apps B and C fail to build for the simulator for reasons of their own (a binary SDK without an arm64 simulator slice; stale Pods libraries), also without the kit |
| `verify.sh quick` on apps whose lint and tests already fail | ✅ passes with the old failures listed (App B: 537 type errors; App A: 148). A new lint error, type error or failing test fails, and only that one is listed |

**Fixed on the way:**
- **The kit's first commit failed in every app:** the hook linted the kit's own scripts with the app's ESLint rules. The scripts now pass React Native's default rules, the hook skips them, and eslintrc-based apps get an `.eslintignore` entry.
- **`scripts/ai/spec.js` was collected as a test file** by Jest's default `testMatch`, failing `npm test` in every app on the React Native Jest preset. It's now `scripts/ai/specs.js`; `sync` replaces it.
- **Example env files** such as `.env.local.example` counted as secrets.
- **iOS check builds** compiled both simulator architectures. They now build the Mac's own, unless the project's pods exclude it (Google ML Kit excludes arm64).
- **New:** `scripts/ai/baseline.js` compares failing lint, type checks and tests with the base branch. `verify.sh quick`, the pre-push hook and CI use it.
- **New:** `verify.sh` loads `MAESTRO_*` test values, such as logins, from a local `.maestro/.env.local`. A real Maestro run confirmed that flows receive them.

## Folder rename and `m-onboard` (2026-10-09)

0.7.0 renames the kit's folders to `docs/amk/`, `scripts/amk/` and `.amk/`, and adds the `m-onboard` skill.

| Check | Result |
|---|---|
| Update from a 0.6.2 install from npm | ✅ in a test app and in Apps A, B and C. 24 files moved with the team's edits, and git sees them as renames. The app's own files stay where they are and are listed, and files that still name an old path are flagged. The update commits through the kit's hooks, App C's lint-staged included |
| `verify.sh quick` after the move | ✅ in all three, with the old failures listed (A: 148 type errors, B: 537). A and B install only with `npm ci --legacy-peer-deps`, as `install-deps.sh` points out |
| Android check build after the move | ✅ App A built, installed and launched on a separate emulator. Its own login flow stopped where it needs test credentials, as before |
| `m-onboard` in Claude Code on a 2,300-file open-source app | ✅ drafts naming the file behind each fact, five questions, then the files written and committed on a new branch once approved (about 7 minutes) |
| `m-onboard` in Codex on the same app | ✅ drafts and questions, then stopped for approval |
| `m-onboard` on Apps A, B and C | ✅ drafts and questions in 3 to 7 minutes each. Each also listed problems outside the four files, without changing them |
| `m-onboard` on a fresh React Native template app | ✅ describes the template, marks the stack "not set up yet", asks about the product, and caught the template's iOS bundle ID |
| 0.7.0 from npm, and device checks with test logins (2026-10-12) | ✅ attestation verified; a fresh install through the menu and an update from 0.6.2. `m-onboard` end to end on App B: files written, decisions logged, committed on a branch. App A on Android signed in with its `.maestro/.env.local` login and passed four of its own flows. On iOS it built, installed and launched; its login flow stopped at the password field, a simulator issue in the app's flow |

**Fixed on the way:**
- **`AGENTS.md` said TypeScript in JavaScript apps** that only have the `typescript` package (App C) and listed a `typecheck` script they don't have. It now names the language from the app's files and lists only the checks the app has.
- **No `Assisted-by:` line:** the skills' commit steps no longer add one.
- **`verify.sh ios` ignored a simulator** whose name lacks "iPhone", even when `AMK_IOS_DEVICE` named it, so a separate test simulator couldn't be used (fixed in 0.7.1).

## `m-change` (2026-10-12)

A light workflow for small changes to existing behavior, with one approval instead of two.

| Check | Result |
|---|---|
| `m-change` in Claude Code on a small test app ("allow notes up to 500 characters instead of 200") | ✅ found the constant, its test, the living-spec requirement and a `product.md` line, and showed them for one approval (27 s). It stopped at a failing check (the app's own test script was broken) and asked before editing `package.json`. After the fix: one commit with the code, `specs/<id>/`, the merged living spec (new `Source:`) and the doc, ending with `Spec: specs/<id>` |

`m-feature` now also updates the `docs/amk/` files a feature makes untrue, in its living-spec step.

## `m-prototype` (2026-10-12)

Turns a rough requirement into something to demo before it's built, and into requirements for `m-feature`.

| Check | Result |
|---|---|
| Concepts, in Claude Code on a fresh React Native template app ("let users rate the app and send feedback") | ✅ three different concepts as self-contained, clickable HTML mocks, with trade-offs: it flagged that asking for stars first and sending only happy users to the store breaks App Store and Google Play rules. It recommended the store's own rating sheet plus a feedback form, then stopped for the pick |
| Prototype in the app | ✅ built the chosen concept on a `prototype/<id>` branch with mock data. Store-sheet look-alikes are labelled as prototypes |
| Demo material | ✅ a Maestro walkthrough passed on Android and iOS (separate emulator and simulator): 8 screenshots and an MP4 video per platform (40 s and 24 s) |
| Feedback and hand-off | ✅ the client's answers became requirements and dated decisions. A feature branch from main holds only the spec, the concepts and `decisions.md`, and the next step is `m-feature specs/<id>/requirements.md` |

## `m-learn` issues for the kit (2026-10-12)

| Check | Result |
|---|---|
| `m-learn` in Claude Code on a test app whose docs name a company and an internal URL, with a lesson that applies to every app | ✅ it drafted an issue for the kit's issues page with the kit version from `AGENTS.md` and none of the app's names, URLs or code, and asked before opening it with `gh`. The lesson itself (no rule asked for accessibility labels) went into the kit as a rule in `react-native.md` and `expo.md`, and a check in `m-review` |

## New apps: `init --new` (2026-10-12)

In an empty folder, the menu offers to create the app with the official tool and then installs the kit: `init --new bare` (the React Native CLI) or `init --new expo` (create-expo-app). Both tools make a new folder: in place, the React Native CLI offers to delete a folder that has any file, even `.git`, and create-expo-app refuses `.vscode`. So the tool runs in an empty subfolder and the app moves up.

| Check | Result |
|---|---|
| A bare app in an empty folder with a `.DS_Store` (React Native CLI 20.2.0, React Native 0.87.1) | ✅ the CLI's own first commit on `main`, then the pods in a commit of their own, and the kit installed for React Native 0.87.1 with npm, with no temporary folder left (75 s). A second `pod install` changes nothing. `verify.sh all` passed on a separate iOS simulator and Android emulator, and the screenshots show the app |
| An Expo app in an empty clone with a remote and its own `.vscode` (create-expo 5.0.3, SDK 57) | ✅ the clone's repository and remote kept, the app in one "Initial commit", the clone's `.vscode` kept and the template's left out |
| Installing the packages failed (the network timed out) | Both tools still finish, commit and exit 0, without `node_modules` or a lockfile. The kit now stops there, and the folder is as it was |
| The React Native CLI's pods step | It fetches and builds Ruby gems first; when that timed out, it reported a broken iOS setup. The kit skips it and installs the pods itself, as `scripts/amk/pod-install.sh` does (the Gemfile's CocoaPods when its gems are installed, otherwise the one on PATH), in a commit of its own, "Install the iOS pods". Before that, the first `pod install` ran in the first feature's `verify.sh` and left changes to the Xcode project, `Info.plist` and the privacy manifest in that feature's branch |
| Ctrl-C while the tool runs | ✅ the tool stops, and the kit puts the folder back as it was, `.git` and remote included |
| A folder with other files, one inside another repository, an unknown type | ✅ refused with the reason, before anything runs |

The workflow on a new app, in Claude Code: the menu in a terminal, in an empty folder, then the first steps a team would take.

| Check | Result |
|---|---|
| The menu, option 1 | ✅ printed `Running: npx agentic-mobile-kit init --new bare`, created the app and installed the kit (49 s) |
| `m-onboard` | ✅ drafted `tech.md`, `structure.md` and `conventions.md` from the code, asked five questions for `product.md` (one about the iOS bundle ID still being the template's), and showed `product.md` and two dated decisions before writing them. It committed them as `docs(amk):` on a branch and suggested `m-explore` for the stack |
| `m-feature`: a calculator on the first screen | ✅ stopped for the requirements and again for the design. It built two tasks with the tests first; `verify.sh all` passed on a separate simulator and emulator, and it checked all 18 screenshots. It merged the living spec, updated the four `docs/amk/` files, fixed what the `m-reviewer` subagent found and checked both platforms again: four commits ending with `Spec:`, and it asked before pushing (21 min). It left the first `pod install`'s changes alone and asked about them, which is how the pods step above was found |

`doctor` in an empty folder now suggests `init --new`, and no longer suggests `scripts/amk/install-deps.sh` where there's no app.

## Final requirements in one place (2026-10-13)

From an `m-learn` issue in a team's new app: `m-explore` changed most of the planned first version, but nothing asked whether the requirements were now final or wrote them in one place. They ended up spread over about 28 rows of `decisions.md`, mixed with reasons, and `product.md` stayed an empty outline. `m-prototype` also handed off without asking for the approval its step 5 requires.

- `m-explore` step 5 asks whether the requirements are final, then writes them: the whole app's features with their rules in `product.md`, marked planned, or one feature's draft in `specs/<id>/requirements.md`. The text is the team's own local fix, so their next `sync` merges with no conflict (checked with `git merge-file`).
- `m-prototype` stops for the approval and records it under `## Decisions` before the hand-off, and a prototype that covers several features writes them to `product.md`, marked planned.
- The `product.md` outline lists planned features with their rules, in build order. When `m-feature` ships one, the rules move to `specs/current/` and one line stays, so `product.md` ends up short again.
- `m-feature` with no input checks `specs.js status` first and suggests `m-continue` for a spec in progress. Otherwise it lists the planned features from `product.md` and recommends the first whose dependencies are built, then waits for the pick. Tested in Claude Code both ways on a test app: it started nothing either time, and it noticed when a feature `product.md` called built had no code.
- Tested end to end in Claude Code on a clone of a team's new bare app (0.7.5 updated with `sync`, which left the team's local `m-explore` fix alone as identical):
  - `m-explore` found 3 open questions and 13 gaps, asked whether the requirements were final, and only after the yes wrote 14 features in build order, each planned with its rules (148 lines in `product.md`).
  - `/m-feature` with no input recommended feature 1, built it (8 requirements, 9 commits, both platforms, the review's must-fix fixed), and replaced its rules with one line pointing to `specs/current/vehicles.md`. Rules it didn't build moved to the features that build them.
  - Run again after the merge, it recommended feature 2, which used those moved rules and replaced its own with one line (13 requirements, 15 commits). A third run recommended feature 3 and suggested splitting it, since parts of it need features 4, 5 and 12.
- `verify.sh` picks an emulator before a phone plugged in over USB. It used to take the first device in `adb devices`, and `AMK_ANDROID_AVD` only mattered when nothing was connected: in that test, a phone plugged in mid-run was used instead of the named emulator, and the flow's `clearState` erased the app's data on it. Now `AMK_ANDROID_AVD` means that emulator only (started if it isn't running), any other running emulator comes next, then starting one, and a phone only when `AMK_ANDROID_DEVICE` names it or there's no emulator at all. Each run says which device it uses.

## After the end-to-end test (2026-10-14)

Follow-ups from building two features in a team's new app with `m-explore` and `m-feature`.

- `verify.sh` never picks a phone plugged in over USB by itself. With no emulator at all it stops and says how to name the phone with `AMK_ANDROID_DEVICE`, since the flows clear the app's data on it. It turns off the "isn't responding" pop-ups only on emulators: the setting is device-wide and stays after the run, and it had stayed on that phone.
- `verify.sh` waits up to 5 minutes for an Android device to finish starting, instead of forever. When a flow fails because the emulator dropped its connection for a moment ("device offline"), it reconnects and runs that flow once more. Maestro writes that error only to its own log, which is now saved per flow in `.amk/evidence/<id>/maestro-logs/`. Tested with stand-ins for adb and Maestro; the tests fail on the old script.
- Both features spent their device-check rounds and their review's must-fix on the same kinds of bug: the keyboard covering a button, a button on the home indicator, a list that didn't scroll, text cut off at large sizes, and form errors that screen readers didn't read out. The React Native and Expo rules files now have a line for each, `m-feature` points to them while building screens, and `m-review` and `m-reviewer` check them.
- `m-explore` offers to commit the confirmed requirements on their own. In the test they were left uncommitted, so the first feature's branch would have carried them.
- `release.sh` creates a GitHub release with each commit's message since the last tag, so people using the kit can see what changed and why to `sync`.

## Tablets, landscape and TypeScript (2026-10-14)

A team asked for three practices: screens that adapt to tablets and iPads instead of a centered phone layout, landscape support, and React Native's TypeScript best practices. New apps get all three; existing apps follow what they already support.

- `scripts/amk/screens.js` reads which screens an app supports from its native projects: iPad from the Xcode target's device family, orientations from `Info.plist` (`~ipad` for iPads) and the Android manifest, and from `app.json` in an Expo app before prebuild. Apps targeting Android 16 turn on tablets whatever the manifest says, since the system ignores the lock there. The kit checks Android tablets for apps that run on iPad. `AGENTS.md` gets a "Screens" line from it, refreshed on every `sync`.
- `verify.sh` runs the flows once per supported screen, inside a flow that turns the device (Maestro's `setOrientation`) and back: phone upright into `ios/` and `android/` as before, then `-landscape/`, `-tablet/` and `-tablet-landscape/`. It picks an iPad simulator, and tells a tablet emulator from a phone by its smallest width (600 dp and up), starting one while Gradle builds. Without one it says so and checks the phone; `doctor` warns.
- `init --new`: React Native's template locks iPhones to portrait, and Expo's locks everything to portrait and leaves iPad out. New apps turn on every orientation and iPad, and get `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns` and `noFallthroughCasesInSwitch` on top of the strict base config, plus `@/` imports for `src/` (bare apps through `babel-plugin-module-resolver`; Expo's Metro reads `tsconfig.json` itself). It's a commit of its own.
- The React Native and Expo rules files have "Tablets and landscape" and "TypeScript" sections: one set of screens laid out by window width (`useWindowDimensions`, 600-point breakpoint, a readable width for text), sizes the app's existing way or from the theme with the system font size, landscape height and side insets, and no loosened checks. `m-feature`, `m-review` and `m-reviewer` use them.
- Tested on new bare and Expo apps from `init --new`, on separate test devices (iPhone and iPad simulators, phone and tablet emulators): all eight screens per app passed, each screenshot the right shape, and the `@/` import showed on screen from the release bundles. Found on the way and fixed: Maestro turns an Android device from its natural orientation, which on a Pixel Tablet is landscape, so its two values swap there; iOS saves a turned screen's screenshots at the upright size with a tag that tells viewers to turn them (see the next section for how `verify.sh` handles that); a just-started emulator may not answer for a moment, so `verify.sh` asks for its CPU type again. Expo's template failed its own `typecheck` until `expo start` generated `expo-env.d.ts`, so new Expo apps get a committed `expo-types.d.ts`. Expo's SDK 57 template turned on Android, and its landscape screenshot showed the title cut off. (These notes first said it didn't turn on iOS; that came from the screenshot tag described in the next section, not from the app.)
- A headless `m-review` on a planted catalog screen found all five planted problems (`Dimensions.get` at load, a centered 390-point column, fixed columns, `any`, `@ts-ignore`), citing the new rules. A `sync` from 0.7.7 on an untouched app added `screens.js` and wrote that app's own Screens line (iPhone portrait only, Android and tablets both ways), leaving its `Info.plist` and tsconfig alone.

## Existing apps and checking devices at the same time (2026-10-15)

- Existing apps' checks don't change where they were already checked: upright flows run as they are, as before 0.7.8, and only turned screens run inside a flow that turns the device. Maestro added `setOrientation` in 2.0.0, so with an older Maestro the turned screens say they weren't checked and why, instead of every flow failing. `--screens` and `AMK_SCREENS` check only some screens (`phone`, `tablet`, `landscape`, or one such as `tablet-landscape`), for quick reruns while fixing.
- Checking devices at the same time: Maestro 2.5.0 stopped using a host port for Android and 2.6.0 runs several iOS simulators at once, so separate runs on separate devices no longer collide (with 2.2.0, two runs on one Mac fought over port 7001). `verify.sh plan` checks memory (32 GB for four devices and two builds), free disk (20 GB) and Maestro (2.6 or later), and prints either one command or the steps: `quick`, `build` (both release builds at the same time, without devices), then one `--no-build --screens phone|tablet` command per device. `m-feature` gives each to an `m-device-checker` subagent, all at once; each checks its device's screenshots and reports, and the main agent checks every report and opens the screenshots a report flags plus one per screen. `AMK_PARALLEL=1` or `0` overrides the choice.
- iOS saves a turned screen's screenshots at the device's upright size with an EXIF orientation tag (8 when the app turned, 1 when it didn't). Preview and browsers apply the tag, but some viewers, including agents' image readers, show the raw pixels. 0.7.8 turned the pixels and kept the tag, which looked right in one kind of viewer and sideways in the other. `verify.sh` now re-saves them through BMP, which applies the tag and drops it, so every viewer shows the screen as it was; a portrait screenshot on a turned screen means the app didn't turn.
- Tested on a clone of a team's app with one finished feature (a 15-screenshot flow), updated from 0.7.6 with `sync` (no conflicts) and checked on separate test devices. Upright, all four devices passed exactly as before. Turned, the Android tablet passed; the iPad failed because Maestro 2.2.0 taps the wrong place on a turned iPad (fixed in Maestro 2.3), so turned iPads now need 2.3; the Android phone failed because the flow checked a field further down the form without scrolling to it, which a short turned screen hides, so the flow template and `m-feature` now say to `scrollUntilVisible` first. `verify.sh build` built both apps at the same time in 9 minutes from cold.
- From Maestro 2.7 on, a run given `--debug-output` (0.7.7 added it, to keep Maestro's own log per flow) saves `takeScreenshot` images in the debug output under `<flow>/takeScreenshot/`, not in `--test-output-dir`. With Maestro 2.7 or later, including the 2.11.0 the CI workflow pins, 0.7.7 and 0.7.8 found no screenshots and failed every flow. `verify.sh` now copies them into the screen's evidence folder after each run, and clears the bundle's copies first, so a rerun never counts an earlier run's.
- Checking devices at the same time, tested with a headless agent on the same clone (16 GB Mac, `AMK_PARALLEL=1`, Maestro 2.11.0): it ran `plan`, quick checks and the build, then started four `m-device-checker` subagents together; iPhone, iPad and Android phone ran at the same time with no collisions, and the flows took about 4 minutes against 13 one device at a time. The checkers and the main agent found the screenshot-folder problem above, the flow that doesn't scroll, an app bug only on the Android tablet (a segment label missing), and a spec that keeps forms phone-width on tablets against the new tablet rule. Every checker had added a pipe or `; echo` to its command, which a permission rule then refused, delaying one device by 4 minutes: the checker and `m-feature` now say to run the printed commands exactly.

## Stop hook and new spec folders (2026-10-16)

From an `m-learn` issue in a team's app on 0.7.9: while a new `specs/<id>/` wasn't in git yet, the stop hook kept saying `progress.md` hadn't been updated right after it was written. `git status --porcelain` lists a new folder as one line (`?? specs/<id>/`), so `handoff-check.js` never saw the file inside; it happened on every `m-change` and `m-feature` until the folder was staged. It now asks for every new file (`--untracked-files=all`), and `tests/handoff-check.test.js` covers it (it fails on the old script). The kit's other `git status` uses only check whether anything changed, which a new folder still shows.

## Runs that want the same device (2026-10-16)

Two runs on one device break each other: one installs while the other's flow is on screen, and flows that clear state wipe the other's app. Agents in one project, several projects and people's own runs all share the Mac's simulators and emulators.
- `verify.sh` claims each device it uses, in a lock folder shared by every project on the machine (`/tmp/agentic-mobile-kit-<user id>/`, a folder per device, made atomically with `mkdir`, holding the run's process, project, check and start time). It gives them back when its platform's flows end, and on exit, Ctrl-C or a stop. A claim whose process is gone is taken over.
- A device that isn't named is skipped for the next free one of the same kind (booted or running first), with a line saying who has it; a named one, or the best one when none is free, is waited for, saying who has it, for up to `AMK_DEVICE_WAIT` minutes. Emulators are claimed by their AVD name, so `emulator-5554` and `P35` are the same claim, and starting one is part of the claim. A Maestro process outside the kit naming a device in its command line counts as using it.
- With Maestro before 2.6, every check on the machine takes turns (one machine-wide claim), since two runs clash on one port even on different devices. Two builds of one project take turns too, and a `--no-build` check waits for a build that's under way.
- Devices are claimed in one order (phone, then tablet; iOS, then Android) and the Maestro turn last, and each platform gives back what it holds before the next, so two runs can't wait on each other.
- What a lock can't see: someone using a simulator by hand.
- Tested on a new app and separate test devices, with Maestro 2.11.0 (other runs of a team's own were using the Mac's other devices at the same time, and were left alone): two `verify.sh build` runs of one project, started together, built one after the other; two Android checks without a named device, started together, took the two free emulators and ran at the same time; two Android checks naming the same emulator ran one after the other, the second saying who had it; two iOS checks took the two free simulators; a check stopped with `kill` gave its device back once its flow ended; a check killed outright left its claim, which the next check took over, but it waited for the Maestro process the killed check left running. Once, Maestro quit two seconds after starting, before running anything and printing nothing: `verify.sh` now runs such a flow once more, as nothing has run on the device yet.

## Turned screens that didn't turn (2026-10-16)

From an `m-learn` issue in a team's app on 0.7.9: `android-landscape` passed twice in three runs with every screenshot upright, so the turned layout went unchecked (its keyboard hid the field being typed in, which a run that did turn showed). Maestro turns an Android device with `settings put system user_rotation`, and the log said the turn completed.
- Reproduced without the kit, with plain Maestro 2.11.0 on a new emulator at font scale 2.0: the first turned run after the emulator started stayed upright, and the 22 runs after it turned, whether the screen had gone to sleep, after `verify.sh`'s own steps, or with auto-rotate switched on first (a race between turning auto-rotate off and setting the rotation didn't show). The cause isn't known.
- `verify.sh` now checks each screenshot a screen's run saved: wider than tall on a turned screen, taller than wide on an upright one (from the PNG header, so on every OS). When they're wrong it runs that screen's flows once more, and fails the screen if they're still wrong, saying the device or the app didn't turn. A check can't pass in the wrong orientation any more, on iOS or Android.

## Real iPhones and iPads (2026-10-16)

Maestro doesn't run on real iOS devices. Its iOS driver is an XCUITest app: on a device it must be signed, but its bundle IDs belong to Maestro's own team, so no other team can sign it (Maestro issue #2697, closed as not planned), and the device doesn't share the Mac's network, so the driver's port has to be forwarded over USB, which Maestro never finished. The driver project it ships for devices also misses files and doesn't build (#3608). A community pull request that added device support (#2856) was closed as unfinished in June 2026, and since 2.11.0 Maestro no longer lists iPhones and fails at once on them (#3609, which says it never worked). Its commands built on Apple's simulator tool (`clearState`, permissions, `setLocation`, `addMedia`) wouldn't work on a device either.
- `verify.sh` now checks on a connected iPhone or iPad (iOS 17 or later) when `AMK_IOS_DEVICE` or `AMK_IOS_TABLET` names it. Xcode's automatic signing signs the release build for it, for `AMK_IOS_TEAM` or the project's team, registering the device with the team the first time. Xcode's `devicectl` installs the app and opens it once, which catches a device that doesn't trust the team yet and an app that closes at once. Then the flows run through maestro-runner, an Apache-2.0 runner for Maestro's YAML flows, pinned and with its usage data off, with its WebDriverAgent driver signed by the same team. The app's new crash reports on the device go into the evidence and fail the check.
- maestro-runner's WebDriverAgent driver hands Maestro's `LANDSCAPE_LEFT` to WebDriverAgent unchanged, and WebDriverAgent knows that turn only as `LANDSCAPE`: `setOrientation` fails at once with "Unable To Rotate Device". On a real device a turned screen's flow therefore turns with `landscape`, which the driver translates. WebDriverAgent also fails the turn unless the app in front turned with the device; before a flow that's the home screen, which only Plus and Max iPhones turn. So on a real device the turn is optional, as Maestro's is on simulators (it doesn't check), and the screenshots' shape decides whether the app turned. Its screenshots of a turned device are already landscape, with no orientation tag. On a real device `clearState` installs the app again, so the runner gets the build (`--app-file`).
- maestro-runner answers alerts itself when a flow's first `launchApp` doesn't say to leave permissions alone, which is most flows: on a real device it can't allow permissions ahead, so it has WebDriverAgent accept every alert, and an alert without an "Allow" or "OK" button gets its last button pressed. In a team's app that confirmed a "Delete … ?" alert the flow was about to check. Maestro never answers an app's own alerts. So on a real device every flow runs inside one that starts with a `launchApp` with `permissions: { all: unset }`, inside a `runFlow` for Android only, so it never runs on iOS but is the first one maestro-runner finds. Then nothing answers alerts, permission prompts included: a flow that meets one taps it, for example `- tapOn: { text: "Allow.*", optional: true }`, which does nothing on a simulator, where permissions are allowed ahead.
- Not solved: for a text selector, maestro-runner's WebDriverAgent driver first asks for any element whose label contains the text (`label CONTAINS[c]`), and taps it even when it's hidden. In the same app, `tapOn: "(?i)delete"` on a "Delete … ?" alert tapped the screen's "Delete vehicle" button behind the alert, so the alert stayed. Maestro matches the whole text, as maestro-runner's own matcher does. On a real device, tap with an `id`, or with text no other element on the screen contains.
- maestro-runner also saves each named `takeScreenshot` next to its flow file (Maestro doesn't), which would leave pictures in `.maestro/` to be committed by mistake: the ones a run makes there move to its log folder, and files already there stay. Now and then, right after installing the app again, a device refused to open it for a moment with the error it gives for a team it doesn't trust (once in about seven reinstalls, signed by a free Personal Team; the same app opened 30 seconds later): the first launch is tried up to three times, 10 seconds apart, and a flow that fails that way runs once more.
- Not used: maestro-runner's default iOS driver (a closed-source agent); the earlier community tool that patches Maestro (it works with Maestro 2.0 to 2.1 only); screenshots through Apple's tools alone (on iOS 17 and later they need `pymobiledevice3`'s tunnel service, which runs as root; the flows take theirs through WebDriverAgent); `devicectl device orientation` (real iPhones report it unsupported). iPhones and iPads on iOS 16 or earlier aren't supported: `devicectl` works with iOS 17 and later.
- Tested on an iPhone XS Max (iOS 18.7.10, USB) with Xcode 26.6, a new app from `init --new` and a free Personal Team: the signed release build, the launch check, and a spec's flow (`clearState`, a text check, a screenshot) passed upright and turned, with portrait and landscape screenshots of the right sizes, in about 2 minutes, then in 1 minute 15 seconds with WebDriverAgent built. A build that throws an error a second after it starts was caught: "the app closed within 10 seconds", with its crash report (`EXC_CRASH`, `SIGABRT`) copied from the device into the evidence. Unit tests cover the rest with stand-ins for Xcode's tools and maestro-runner: the signing team, a device that doesn't trust the team, an app that closes at once, crash reports, the momentary refusal, and the screenshots next to flow files.
- Tested on a team's production app too (a clone of its release branch, updated from 0.7.9 with `sync`), on the same iPhone, signed by the team's paid account: the release build, the launch check and the upright smoke check passed. Signing used the team's existing development profile for the app and its existing wildcard profile for WebDriverAgent: nothing was added to the account. Its turned screen showed an app that keeps itself upright: its `Info.plist` allows landscape on iPhone, but its code locks portrait at start (`react-native-orientation-locker`, with its `AppDelegate` hook). Any check of such an app's turned screens fails, on simulators too since 0.7.10's screenshot shape check (0.7.9 passed them with upright screenshots). When a screen's screenshots come out in the wrong orientation, `verify.sh` now names the files where the app's code sets its orientation (orientation libraries, `setRequestedOrientation`, `supportedInterfaceOrientationsFor`), and says to either take that orientation out of the native settings, so the screen isn't checked, or change the code. Rerun on the iPhone: the turn no longer stops the flow, the screenshots stayed upright, and the message named both files.

## Six issues from a team's app (2026-10-21)

Reported from a bare app on 0.7.9 (PostHog, Crashlytics and Clarity; a default branch left at an old first commit; a time tracker's git hook; no CI), all still in 0.7.11.
- Check builds uploaded debug symbols. On iOS the Release check build made dSYMs, and the app's build phases uploaded them under the real app's version (a prebuilt XCFramework's own dSYM too, copied into the products folder). Now `ios-build.sh` builds with `DEBUG_INFORMATION_FORMAT=dwarf`, looks for dSYMs in a folder that never exists, and sets `SENTRY_DISABLE_AUTO_UPLOAD`, for simulator and device builds. On Android, `verify.sh` passes `scripts/amk/no-symbol-upload.gradle`, an init script that turns off every task named for uploading (`upload…`, `…Upload…`, `bugsnagRelease…`) without touching the app's `build.gradle`. Release builds (`release-build.sh`) still upload.
- `verify.sh` stopped without a word when `pod install` failed (`set -e`); now it says so and goes on to Android.
- The guard missed `rm -Rf`, `rm -fR`, `rm --recursive --force` and force pushes through a `+branch` refspec; a project can now list its own secret files in `.amk-secrets`, and a commit message that mentions a blocked command gets a hint to commit it from a file (skipping quoted text instead would let `sh -c '…'` through).
- The checks compared with a default branch that has no `package.json` where it meets the work branch, and typecheck failed with a stack trace. Now the base is the first of the default branch, `origin/main`, `origin/master`, `main` and `master` that has the app there, said when the default branch is passed over, and a base without the app gets a clear message. `baseline.js base` prints it, and `m-review` and `m-reviewer` use it instead of `main`.
- Hooks: setting `core.hooksPath` switched off a time tracker's `post-commit` in `.git/hooks`. Now `init` and `sync` add a `.githooks/<name>` that runs the clone's own `.git/hooks/<name>` (a clone without one skips it), for git's other client-side hooks, and uninstall removes them. And the `pre-commit` lint blocked commits that touched files with old errors; now it fails only on errors a file didn't have at `HEAD` (`baseline.js staged`), as `verify.sh quick` does.
- Installs without CI said that CI enforces the PR size and that `codemagic.yaml` sets build numbers. Those three texts now follow the CI chosen at `init`, and `sync --ci` updates them.
- Found while testing on a clone of that app, which keeps `.githooks`, `.agents` and `rulesync.jsonc` out of git: `sync` crashed in a fresh clone, on the missing `.githooks` folder (new code) and on the missing `rulesync.jsonc` (since 0.6). Now it makes the folder, and skips generating the tools' configs with a note.
- Tested: unit tests for each, a real Gradle 9.4.1 build with upload tasks that fail if they run (they didn't; without the init script they did), and on the clone of the team's app, with its default branch at the old first commit: `sync` from 0.7.9 (the team's own fixes conflict only where the kit now makes the same change), the base found by itself (148 type errors, all on the base, instead of the stack trace), the team's 21 guard tests passing with the kit's guard and one `.amk-secrets` line, a commit through the `pre-commit` hook that touched a file with an old error passing and one with a new error failing, the time tracker's hook (a stand-in) running through `.githooks/post-commit`, a Gradle dry run of the release build turning off exactly its two upload tasks (Crashlytics' and PostHog's), and Xcode's build settings for the app's Release target with the dSYM settings in place. PostHog's script stops at "dSYM folder not found", before it needs its CLI. Nothing was built or uploaded to the app's crash reporters.

## Evidence that stays small (2026-10-21)

Evidence never leaves the machine (`.amk/` is out of git), but nothing deleted it either. In a team's app it had grown to 380 MB in a week, in 44 folders. One feature's folder was 185 MB, of which 15 MB were its 114 screenshots: the rest was Maestro's own debug output, as every rerun of a check added a run folder per flow with a 10–23 MB copy of the simulator's system log. A screen's screenshots from an earlier run also stayed next to the new ones and counted as evidence, which could hide "no screenshots were saved".
- At the start of each check, `verify.sh` keeps the newest 5 evidence folders, this check's among them, and deletes older ones, saying how many (`AMK_EVIDENCE_KEEP` sets the number; `0` keeps them all). A count rather than a size cap, as one full check is about 15 MB of screenshots: a 30 MB cap would delete the feature under review, or the check just made.
- Each screen keeps its latest run only (its folder, and each flow's Maestro output, are emptied first), and a passing flow drops the device's own log (`logs/device-*`: the simulator's system log, the emulator's logcat), which helps only with a failure. Maestro's step log stays.
- Tested on a clone of a team's app with six older evidence folders: the check removed the two oldest and kept four plus its own. Its folder was 6.5 MB for the iPhone's upright screen (2 flows, 20 screenshots, one Maestro run per flow, no device logs), and a second run left it at 6.5 MB, where before each rerun added about 16 MB per flow.
