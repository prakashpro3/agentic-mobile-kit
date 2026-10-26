# Team guide

How to work day to day in a bare React Native app that has agentic-mobile-kit installed. It takes about 10 minutes to read; a 1-hour training plan is at the end.

## The idea in one paragraph

Every AI tool reads the same rules (`AGENTS.md`), the same project facts (`docs/amk/`) and the same workflows (the `m-` skills). The work itself lives in git: each task has a folder `specs/<id>/` with its requirements, design, task list and a handoff in `progress.md`. So you can stop in one tool and continue in another, or on another machine, without repeating anything. Checks that matter (secrets, tests, builds, release problems) run as git hooks, CI and scripts, so they apply whichever tool, or person, made the change.

## Setup

**Once per project** (the lead):
1. In the app's root, on a clean branch, run `npx agentic-mobile-kit` and choose an install: the recommended setup, or your own choice of AI tools and CI. Choose CI only if the app uses GitHub Actions or Codemagic; without it, the kit adds no CI files. You can add CI later from the same menu. In scripts: `npx agentic-mobile-kit init`, with `--tools claude,codex,antigravity` and `--ci github`, `--ci codemagic` or both. For a new app, run it in an empty folder (an empty clone of the team's repository works too) and choose a React Native or an Expo app: the kit creates it with the official tool, commits it, and installs itself (`init --new bare` or `init --new expo`).
2. Run `m-onboard` in your AI tool. It drafts `docs/amk/product.md`, `tech.md`, `structure.md`, `conventions.md` and `glossary.md` (the app's own words) from the code and asks what the code can't show. Read the drafts carefully: agents are only as good as these five files.
3. Open a PR with the `large-pr` label, merge it, and turn on branch protection (see `docs/branch-protection.md` in the kit repo).
4. With `--ci codemagic`, do the one-time Codemagic setup in the app's `docs/amk/codemagic.md`.

**What `init` changes.** It never overwrites a file. Besides adding the kit's files, it:
- adds its section to an existing `AGENTS.md` between `KIT` markers, and an `@AGENTS.md` line to an existing `CLAUDE.md`;
- records the kit version and CI choice there, so `sync` knows what's installed;
- adds `.env`, `.env.*` and `.amk/` to `.gitignore`, and in Expo apps also `/ios` and `/android`, which `expo prebuild` generates;
- adds a `typecheck` script for TypeScript apps;
- turns on the kit's git hooks: with a `postinstall` script that does it for every clone, and for this clone right away. A team that keeps `.githooks` out of git gets no such script, as a fresh clone has no `.githooks` to point git at: each clone turns the hooks on when it runs `sync`, which puts the folder back. If the app already uses husky, lefthook, simple-git-hooks or its own hooks folder, it adds one line to those hooks instead, and leaves `core.hooksPath` to them. That line runs the kit's hook through `scripts/amk/run-hook.sh`, which skips it with a hint in a clone that doesn't have `.githooks` yet;
- generates each chosen tool's permissions, hooks and reviewer agent, and links the skills folder for Claude Code and Kiro.

**What `doctor` checks**, with a fix for each problem:
- **The project:** the kit is installed, `AGENTS.md` is within its size limit, the git hooks are active (also through husky or lefthook), git and the disk agree on file names, no `.env` file is in git, the tool configs are current, and `docs/amk/` is filled in.
- **This Mac:** Node, installed dependencies, Xcode, CocoaPods and pods, an iPhone simulator, the Android SDK and an emulator, Java, Maestro (the same version as CI) and gitleaks.
- **The AI tools:** whether Codex and Antigravity trust the project, the Antigravity version, and an `ANTHROPIC_API_KEY` in the shell that would override a Claude subscription.

**When the kit has a new version** (the lead): on a clean branch, run `npx agentic-mobile-kit` and choose the update, or run `npx agentic-mobile-kit@latest sync`. The first time on an install older than 0.4.0, add `--from <the version you installed>`. `sync` keeps your edits, inside `AGENTS.md`'s kit section too. Where the kit changed the same lines, a Markdown file shows both with `<<<<<<<` markers, and a script, hook, workflow or config gets the kit's version, with yours beside it as `<file>.mine` (markers would stop it from working). `sync` ends with an error while one is left: resolve each, delete the `.mine` files, run the checks and open a PR.

**Once per machine** (every developer):
1. On Windows, first turn on Developer Mode (Settings > System > For developers) and run `git config --global core.symlinks true`, so the Claude Code skills link works. Run the kit's scripts from Git Bash. iOS work needs a Mac.
2. Clone, then `sh scripts/amk/install-deps.sh`. This also turns on the git hooks.
3. Run `npx agentic-mobile-kit doctor` and fix what it lists. It checks Node, Xcode, CocoaPods, simulators, the Android SDK, Java, Maestro, gitleaks and each AI tool's trust settings.
4. Open the project once in each AI tool you use. In Codex, trust the project and approve its hooks; they stay off until you do. In Antigravity, trust the workspace.

## Daily work

| You want to | Run | What happens |
|---|---|---|
| Describe the app for agents (after installing, and after big changes) | `m-onboard` | Reads the project, drafts the five `docs/amk/` files, asks what the code can't show, and writes them once you approve. Files the team already wrote get suggested changes, never a rewrite. |
| Think a problem through first | `m-explore <question or problem>` | Reads the code, explains how it works today and lays out options with trade-offs. It never edits code; it hands off to `m-feature` or `m-bugfix`. |
| Demo an idea to the client or team before building it | `m-prototype <rough requirement>` | **You choose the UI/UX level** (Simple, the default; Mixed; or Premium) → two or three concepts as clickable HTML mocks if how it should work is open → **you pick** → real screens with mock data on a throwaway `prototype/<id>` branch → screenshots and a video → feedback into the requirements → hands off to `m-feature` |
| Build a feature | `m-feature <task text or link>` | Requirements with acceptance criteria → **you approve** → **you choose the UI/UX level** for its screens (Simple, the default; Mixed; or Premium) → design and tasks → **you approve** → one task at a time with tests and real command output → device check with screenshots → living spec updated → review → PR |
| Make a small change to existing behavior (a text, a limit, a rule, a style) | `m-change <the change>` | Checks it's small → shows the code, living-spec and docs changes → **you approve** → makes them together, with tests and screens on both platforms for visible changes |
| Fix a bug | `m-bugfix <report>` | Checks known issues → a check that fails on the bug (a test, or a Maestro flow for a device bug) → three to five likely causes, shown to you → root cause → smallest fix → verifies, keeping the check |
| Stop for now, or switch tool | `m-pause` | Writes the handoff in `progress.md`, moves decisions out of the chat, commits as `wip:` and pushes |
| Carry on anywhere | `m-continue <id>` | Reads the spec and handoff, tells you the open question, the status and the next step, then waits for you |
| Review a branch | `m-review` | A read-only review for scope, tests, both platforms, error states, security and native changes |
| Ship a release | `m-release <version>` | Changelog from real commits, store and client notes, version bump, release check, release PR, then the tag. Signed builds come from Codemagic, or from `sh scripts/amk/release-build.sh` run by a person on a Mac. |
| Stop a mistake from repeating | `m-learn <what went wrong>` | The smallest lasting fix: a check, a known-issues entry, a docs line or a skill step |

How to invoke a skill: `/m-feature` in Claude Code and Antigravity, and `$m-feature` in Codex. The skills only run when you invoke them; they never start on their own.

When agents need your decisions, they ask in rounds: every question they can ask at that point, numbered, each with the answer they recommend. Reply "yes" to take all the recommendations, or answer by number. Facts they find in the code themselves. A question only someone else can answer, such as the client, goes into `specs/<id>/questions-<who>.md` for you to send, and the work goes on with the rest.

`specs/current/` is the living spec: one file per area of the app, saying what it does now, requirement by requirement. Each feature's requirements say what they add, change and remove, and `m-feature` merges them in when the feature is done (`node scripts/amk/specs.js merge <id>`). `m-bugfix` corrects it when a fix changes behavior, and `node scripts/amk/specs.js status` shows every feature's progress. It starts empty and grows with each change, so there's no need to write it all up front.

Small changes don't need a skill. Ask the agent directly; the rules in `AGENTS.md` and the git hooks still apply.

## Switching tool or machine in the middle of a task

1. If the current tool still works, run `m-pause`. If it stopped at a usage limit, commit what's there yourself (`wip: <id> …`) and push.
2. In the next tool or on the next machine: `git pull`, then `m-continue <id>`.

Everything in git carries over: the spec, the handoff and the code. Chat history doesn't, on purpose, so anything decided in a chat must be written into the spec or `docs/amk/decisions.md`. `m-pause` does that.

## What "done" means

An agent's work is done only when:
1. lint, typecheck and tests pass, and `rn-check` finds no React Native problem in the lines the branch changed, with the command output from that session;
2. UI changes were checked on both platforms with `sh scripts/amk/verify.sh all --spec <id>`, and the screenshots were looked at (they're in `.amk/evidence/<id>/`). On Windows or Linux, `verify.sh` checks Android only; a teammate with a Mac runs `verify.sh ios` before the PR is merged;
3. the diff stays inside the task;
4. `specs/<id>/progress.md` is updated.

If an agent says "done" without these, it isn't done. Open the screenshots yourself before you approve a UI PR.

## What's enforced, and where

| Where | What |
|---|---|
| `pre-commit` hook | Blocks `.env` files, keystores and signing files, and secrets (gitleaks). Checks Xcode project files, and files renamed only in letter case that git missed. Lints staged files: errors a file already had before the commit don't block it, new ones do. Warns above 400 changed lines. |
| `pre-push` hook | Typecheck and tests |
| CI on every PR | Lint, typecheck, tests, secret scan, config drift, PR size ≤ 600 lines (`large-pr` label to override), Android build, and the iOS build when native files change |
| Nightly, or the `e2e` label | Android emulator with the Maestro flows; the screenshots are attached to the run |
| Inside AI tools | A guard hook blocks `rm -rf` (and `-Rf`, `--recursive --force`), force pushes (`--force`, `-f`, `+branch`), `git reset --hard`, commands that throw away uncommitted work, stashes or unmerged commits (`git checkout .`, `git restore .`, `git stash drop` and `clear`, `git branch -D`; undoing one file's edit stays allowed), `--no-verify` and reading secret files: `.env` files, keystores, and the paths listed in `.amk-secrets`. Permission rules ask before dependency and native config changes. A stop hook reminds the agent to update the handoff. |
| Releases | `scripts/amk/release-check.js` before tagging, and again on Codemagic before every signed build (with `--ci codemagic`) |

Never bypass a hook with `--no-verify`. If a hook is wrong, fix the hook in a PR.

## Tool differences to know

| | Claude Code | Codex | Antigravity |
|---|---|---|---|
| Reads `AGENTS.md` | ✅ (through `CLAUDE.md`) | ✅ | ✅ (CLI 1.3.1 or later) |
| Skills | `/m-…` | `$m-…` | `/m-…` |
| Guard and stop hooks | ✅ | ✅ after you approve them on each machine | ❌ project hooks don't run, so approve commands carefully |
| Keeps `.env` out of reach | ✅ | ❌ can read it | ❌ can read it |
| iOS builds | ✅ | ❌ inside its sandbox; run `sh scripts/amk/ios-build.sh` yourself | not tested yet |

Because two of the three tools can read `.env`, keep real secrets outside the project folder and inject them at run time. Cursor, OpenCode and Kiro are set up the same way, but they haven't been tested yet.

## Rules for people

From `docs/amk/team-process.md`:
- You own the PRs you open, and must be able to explain every change without AI.
- A commit made for a spec ends with `Spec: specs/<id>`.
- Run at most 2 or 3 agents in parallel.
- Don't use "skip permissions", "YOLO" or auto-run modes.

## When something goes wrong

| Problem | Do this |
|---|---|
| Anything odd after setup | `npx agentic-mobile-kit doctor` |
| `scripts/ai/…` or `docs/ai/…` not found after updating from 0.6 | Since 0.7.0 they're `scripts/amk/` and `docs/amk/`. The update lists your files that still use the old paths, such as scripts in `package.json` or your own CI; change them there |
| A build error | Check `docs/amk/known-issues.md` first; `m-bugfix` does this too |
| The agent made a mistake you had to correct | `m-learn`, so it doesn't happen again |
| `pre-commit` says to fix the spec format | Each requirement needs a SHALL sentence and a scenario with WHEN and THEN; see `specs/current/README.md` |
| Hooks don't run | `npx agentic-mobile-kit doctor` says why. Without a hook manager, `git config core.hooksPath` must print `.githooks` (`sh scripts/amk/install-deps.sh` sets it). With husky or lefthook, your install sets them up |
| A hook another tool put in `.git/hooks` (a time tracker's `post-commit`, say) stopped running | `core.hooksPath .githooks` switches `.git/hooks` off. `init` and `sync` add a `.githooks/<name>` for each such hook they find, which runs the clone's own `.git/hooks/<name>` (and nothing in a clone without one): run `npx agentic-mobile-kit@latest sync` on that machine and commit the file |
| `pre-commit` says a file was renamed only in letter case | Rename it through git in two steps, as the message shows. macOS and Windows don't tell the two names apart, so git kept the old one and the app fails on other machines |
| `release-check.js` warns about a store rule that doesn't apply to your app | Most store rules have exceptions it can't see: Sign in with Apple isn't needed when the app signs in only with your company's accounts, and a restricted Android permission is fine with an approved Play Console declaration. Read the warning, decide, and note why in the release PR. A permission a library adds that the app doesn't use is removed in `AndroidManifest.xml` with `tools:node="remove"` (Expo: `android.blockedPermissions`) |
| `rn-check` reports a problem in a Maestro flow | Before any build, `verify.sh quick` checks the flows a branch changes: Maestro's own syntax check (when Maestro is installed), a `runFlow` or `runScript` file that isn't there, and secrets fail it; taps by text, text with an apostrophe, a hard-coded `appId`, a typed password and a flow that checks nothing warn. For each spec the branch touches, every `#### Scenario:` in `requirements.md` needs a `# Scenario <n>: <name>` block in its flow, with an assertion and a screenshot. A line that's right as it is keeps a `# amk-ok <date>: <reason>` comment |
| A device check failed: where to look | The output says at which step and what Maestro said, and shows the screen then. `.amk/evidence/<id>/report.md` lists every screen and flow of the run, with each flow's screenshots and, for a failed one, the reason and its log; `junit.xml` next to it is for CI, and the e2e workflow adds a summary to the job page |
| Accessibility warnings after a device check (Android) | After each screenshot on an Android screen, Maestro saves the screen's view tree, and `verify.sh` lists the tappable elements without a label (a screen reader can't say what they do) and those smaller than 48×48 dp. They come from the running app, so they catch what code checks can't: sizes from helpers like `wp()`, and buttons inside the app's own components. They're warnings; `report.md` says which screenshot each is on. iOS' view tree doesn't say what's tappable, but React Native lays out both platforms alike. `AMK_A11Y=0` turns it off |
| Checking a few flows quickly | Tag them in their header (`tags: [smoke]`) and run `sh scripts/amk/verify.sh all --tags smoke`; the full set before the PR. Steps several flows share (logging in, test data) go in `.maestro/subflows/` (`specs/_templates/subflow.yaml`) |
| `verify.sh quick` reports a React Native problem (✗) | `rn-check` reads only the lines your branch adds or changes, for mistakes the React Native rules list: removed or private APIs, the old `SafeAreaView`, tokens in AsyncStorage, secrets and base64 images in code. The agent asks you, for each one: fix it, or keep the line with `// amk-ok <date>: <your reason>`; it never adds one by itself. A line kept over two weeks ago is asked about again when its file changes. Warnings (!), such as a button without a label or an empty `catch`, don't fail it |
| The app's lint or tests already fail on `main` | Nothing to do first: `verify.sh quick`, the `pre-push` hook and CI pass when a change adds no new failure, and list the old ones. The `pre-commit` hook lets a file's old lint errors through the same way. They compare with the remote's default branch, or `origin/main`, `origin/master`, `main` or `master`: the first that has the app where it meets your branch. `node scripts/amk/baseline.js base` prints it. Another base: set `AMK_BASE` (for example `export AMK_BASE=origin/develop` in your shell profile) |
| An agent may read a secret file that isn't a `.env` file or a keystore | List it in `.amk-secrets` at the project root, one path from the root per line (a folder ends in `/`), and commit that file: the guard hook then blocks agents from reading it |
| Debug symbols from check builds turned up in the crash reporter | `verify.sh`'s check builds aren't releases. On iOS they make no dSYMs and look for them where there are none, and on Android a Gradle init script turns off every task named for uploading (Crashlytics, PostHog, Sentry, Bugsnag, Datadog, …). Sentry's automatic upload is off for both. Release builds (`release-build.sh`) still upload |
| `pre-push` says dependencies aren't installed | `sh scripts/amk/install-deps.sh` |
| `verify.sh` checks the wrong Android flavor or iOS app | Add `--flavor <name>` or `--scheme <name>`, or set `AMK_ANDROID_FLAVOR` / `AMK_IOS_SCHEME` in your shell |
| A Maestro flow needs a test login | Put `MAESTRO_EMAIL=…`, `MAESTRO_PASSWORD=…` (any `MAESTRO_` name) in `.maestro/.env.local`, which git ignores; flows read them as `${MAESTRO_EMAIL}`. `verify.sh` loads them, and values set in your shell win |
| `verify.sh` uses the wrong Android device | It uses a running emulator, else starts one. It never picks a phone plugged in over USB by itself, because the flows clear the app's data. Set `AMK_ANDROID_AVD` to the emulator to use, or `AMK_ANDROID_DEVICE` to a serial from `adb devices` to check on a phone |
| Checking on a real iPhone or iPad | Set `AMK_IOS_DEVICE` (or `AMK_IOS_TABLET`) to its name or UDID, as Xcode's Devices window shows them. It's never used unless named, because the flows clear the app's data on it. It needs iOS 17 or later, Developer Mode on (Settings > Privacy & Security), and the device unlocked while it's checked. Xcode's automatic signing signs the release build and WebDriverAgent for the project's team, or `AMK_IOS_TEAM`, with the Apple account in Xcode (Settings > Accounts), and registers the device with that team the first time. Then, once, trust the team on the device: Settings > General > VPN & Device Management. The device also needs a network to open the app: in airplane mode it won't, as if the team weren't trusted, so after each flow `verify.sh` turns airplane mode off when the app's flows use it, also when a flow fails. A free Personal Team works too: its builds expire after 7 days, it can make about 10 app IDs a week, and it can't sign an app whose bundle ID another team owns. Maestro doesn't run on real iOS devices, so their flows run through maestro-runner (pinned, without its usage data); the app is opened once first, and crash reports it leaves on the device go into the evidence. Two differences from a simulator: a permission prompt isn't allowed ahead, so a flow that meets one taps it (`- tapOn: { text: "Allow.*", optional: true }` does nothing on a simulator); and a tap by text can hit a hidden element whose text only contains it, such as a "Delete vehicle" button behind a "Delete" alert, so tap with an `id`, or with text nothing else on the screen contains |
| `verify.sh` says tablets or iPads aren't checked | The app runs on iPad (and so the kit checks tablets on both platforms), but this machine has no iPad simulator or tablet emulator. Add an iPad simulator in Xcode, and a tablet emulator in Android Studio (Device Manager > Tablet); `npx agentic-mobile-kit doctor` says which is missing. `AMK_IOS_TABLET` and `AMK_ANDROID_TABLET_AVD` pick specific ones |
| Why does `verify.sh` run the flows several times? | Once per screen the app supports, as `AGENTS.md` lists them: phone upright, phone turned, tablet upright, tablet turned. Each has its own evidence folder (`ios/`, `ios-landscape/`, `ios-tablet/`, `ios-tablet-landscape/`, and the same for `android`). A turned screen's screenshot that's portrait means the app didn't turn, although its settings allow it. A flow that passes upright but fails turned often taps or checks something further down a screen without scrolling to it: add `scrollUntilVisible` first |
| `verify.sh` says screenshots show the screen upright (or turned), not as the screen needs | A turned screen's screenshots must be wider than tall, an upright one's taller than wide. Now and then a device misses Maestro's turn; `verify.sh` then runs that screen's flows once more, and fails the screen if it's still wrong, so a check never passes in the wrong orientation. A turned screen that stays upright twice usually means the app doesn't turn, although its settings say it does. Then `verify.sh` names the files where the app's code sets its orientation (an orientation library such as `react-native-orientation-locker` or `expo-screen-orientation`, or native code): if the app is meant to stay that way, take the other orientation out of its native settings (`UISupportedInterfaceOrientations` in `Info.plist`, `screenOrientation` in `AndroidManifest.xml`) and that screen isn't checked any more |
| `verify.sh` says it's waiting for a device, or checks on another one | Another run on this Mac (any project, any agent) is using that device. A run takes another free simulator or emulator of the same kind, and waits only when the device was named (`AMK_IOS_DEVICE`, `AMK_ANDROID_AVD`, …) or none is free, for up to `AMK_DEVICE_WAIT` minutes (30). Runs claim devices in `/tmp/agentic-mobile-kit-<user id>/` (`AMK_LOCK_DIR` moves it); a run that crashed leaves a claim the next run takes over. A Maestro run started outside the kit on a device counts as using it. With Maestro before 2.6, checks on the whole Mac take turns, and two builds of one project always do |
| "Stop hook error" or a hook failing with `Cannot find module …/scripts/amk/handoff-check.js` (or `guard.js`) | The agent moved into a subfolder, and the kit's hooks were set up with a path from the project folder. Update the kit (`npx agentic-mobile-kit@latest sync`): its hooks find the project folder through git, from any folder. Until then, ask the agent to `cd` back to the project folder: while it's in a subfolder, the guard that blocks destructive commands doesn't run either |
| Antigravity runs commands the guard should block | Update the kit: before 0.7.15, Antigravity rejected the kit's hooks file and ran none of its hooks. Antigravity also loads a project's `.agents/hooks.json` only in a trusted folder, so trust the project. `/hooks` in Antigravity lists them; its log says when a hooks file fails to parse |
| A commit or push says the kit's checks were skipped | This clone has no `.githooks` yet, as when the team keeps it out of git: run `npx agentic-mobile-kit sync` once in it, which puts the kit's hooks back. Until then, husky, lefthook or simple-git-hooks skips the kit's checks and says so, and `doctor` reports it |
| `.amk/evidence` takes up space | Evidence stays on your machine: `.amk/` is out of git. At the start of each check, `verify.sh` keeps the newest 5 evidence folders and deletes older ones (`AMK_EVIDENCE_KEEP` sets how many; `0` keeps them all). A prototype's folder (`<id>-prototype`) always stays and isn't counted: delete it yourself once the demo is done. So do a spec's folders while it's in progress (its `progress.md` isn't `done`), as its evidence table points there. The folders kits before 0.7.12 named after the time of each run go first. Each folder holds only the latest run of each screen, and the simulator's or emulator's own log only for a flow that failed. Runs without `--spec` or `--label`, such as `verify.sh quick`, share one folder, `no-spec`. Other evidence you need for longer: copy it out of `.amk/evidence` |
| `verify.sh` takes too long while you fix something | `--screens` (or `AMK_SCREENS`) checks only some screens, for example `--screens phone` or `--screens tablet-landscape`. The definition of done still needs every screen the app supports, once, at the end |
| Checking devices at the same time | `sh scripts/amk/verify.sh plan --spec <id>` sizes it by memory: a device under test takes about 6 GB (a simulator or an emulator with Maestro), so 2 at once from 16 GB and 4 from 28 GB. It also needs 20 GB free disk and Maestro 2.6 or later, which runs several devices at once. It prints the steps: quick checks, `verify.sh build` (both release builds at the same time), then one `--no-build --screens …` command per device, in rounds when they don't all fit, which agents give to `m-device-checker` subagents round by round and check their reports. With room for more devices than kinds (a part's device counts about 6 GB for a simulator and 8 GB for an emulator, so Android parts start from about 20 GB), each kind's flows split into parts (`--part 1/2`, …): part 1 on the usual device, the others on temporary copies of it, deleted afterwards (an emulator copy restarts once first, as a new emulator's first boot drops its connection during flows); a real iPhone, iPad or phone isn't split. `AMK_MEMORY_GB` sets the memory to count on (less when your own emulator stays open), `AMK_DEVICES` the number of devices, and `AMK_PARALLEL=1` or `0` overrides |
| Turned screens say "not checked: turning the device needs Maestro 2.0 or later" | Your Maestro is older than 2.0. Upright screens are still checked as before. Install the version CI uses (`npx agentic-mobile-kit doctor` names it) |
| A Maestro flow fails and its log doesn't say why | Maestro's own log, with the full error, is in `.amk/evidence/<id>/maestro-logs/`. When an emulator drops its connection for a moment ("device offline"), `verify.sh` reconnects and runs the flow once more by itself |
| `release-build.sh ios` should sign manually, or export ad hoc or enterprise | Commit your `ios/ExportOptions.plist`, or point `AMK_IOS_EXPORT_OPTIONS` at one |
| `release-check` says signing keys are in git | Move the keystores out of the repo into a password manager, read the passwords from the environment or `~/.gradle/gradle.properties`, and reset the upload key in Play Console if Play App Signing is on |
| Metro's port 8081 is busy | Nothing to do: `verify.sh` uses release builds, which don't need Metro |
| iOS build fails after a native dependency change | `sh scripts/amk/pod-install.sh` |
| Expo: `verify.sh` says lint was skipped | Run `npx expo lint` once: it installs ESLint and writes `eslint.config.js`. Commit what it adds |
| Expo: a native change doesn't show up in the build | Delete `ios/.amk-fingerprint` and `android/.amk-fingerprint`, then check again. The scripts regenerate the native folders only when Expo's fingerprint changes |

## Once a month (30 minutes)

- Read `git log --grep 'chore(learn)'`: what did agents get wrong, and did the fixes hold?
- Remove stale entries from `docs/amk/known-issues.md`.
- After a React Native, Xcode, Android Gradle Plugin or AI model upgrade, re-read `AGENTS.md` and `docs/amk/` for anything that's no longer true.

## 1-hour training

| Minutes | Topic |
|---|---|
| 0–10 | The idea: the three layers (enforcement, context, workflows) and why chat isn't memory |
| 10–30 | Live: `m-feature` on a small real task, up to the first approved task, with lint, tests and a commit |
| 30–40 | Switch tools: `m-pause` in one tool, `m-continue` in another |
| 40–50 | `verify.sh` screenshots, `m-review` and the PR checklist |
| 50–60 | `m-release` and Codemagic, `m-learn`, questions |

Before the session, every attendee runs `doctor` on their machine, so setup problems don't use up the hour.
