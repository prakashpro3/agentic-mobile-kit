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
- Tested on new bare and Expo apps from `init --new`, on separate test devices (iPhone and iPad simulators, phone and tablet emulators): all eight screens per app passed, each screenshot the right shape, and the `@/` import showed on screen from the release bundles. Found on the way and fixed: Maestro turns an Android device from its natural orientation, which on a Pixel Tablet is landscape, so its two values swap there; iOS saves a turned screen's screenshots sideways, so `verify.sh` turns them upright (one still sideways means the app didn't turn); a just-started emulator may not answer for a moment, so `verify.sh` asks for its CPU type again. Expo's template failed its own `typecheck` until `expo start` generated `expo-env.d.ts`, so new Expo apps get a committed `expo-types.d.ts`. Expo's SDK 57 template, with native tabs, didn't turn on iOS although its `Info.plist` and Expo's app delegate allow every orientation; on Android it turned, and its landscape screenshot showed the title cut off.
- A headless `m-review` on a planted catalog screen found all five planted problems (`Dimensions.get` at load, a centered 390-point column, fixed columns, `any`, `@ts-ignore`), citing the new rules. A `sync` from 0.7.7 on an untouched app added `screens.js` and wrote that app's own Screens line (iPhone portrait only, Android and tablets both ways), leaving its `Info.plist` and tsconfig alone.
