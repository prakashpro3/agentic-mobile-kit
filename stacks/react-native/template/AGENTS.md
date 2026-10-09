<!-- KIT:START agentic-mobile-kit {{KIT_VERSION}} ci={{KIT_CI}} stack={{KIT_STACK}} (edit outside these markers; the kit updates what's inside) -->
# {{APP_NAME}}: instructions for AI agents

Read by Claude Code (through CLAUDE.md), Codex, Cursor, OpenCode, Kiro and Antigravity. Keep it short; details live in `docs/amk/`.

This project may also use other AI workflow frameworks (for example Superpowers, BMAD or proAgents). They keep working for everything else. When the user starts a task with an `m-` skill (`/m-feature`, `$m-feature`, …), follow that skill's steps for the whole task; where another framework's instructions differ, the `m-` skill wins.

## Project

- Bare React Native {{RN_VERSION}} ({{RN_ARCH}}), React {{REACT_VERSION}}, {{LANGUAGE}}, Node {{NODE_VERSION}}. Package manager: {{PM}}.
- What the app does: `docs/amk/product.md`, and requirement by requirement, as it works now: `specs/current/`. Stack and services: `docs/amk/tech.md`. Folders and layers: `docs/amk/structure.md`. Code style: `docs/amk/conventions.md`.

## Commands

| Task | Command |
|---|---|
| Install dependencies | `sh scripts/amk/install-deps.sh` |
| {{CHECK_TASKS}} | {{CHECK_COMMANDS}} |
| iOS pods (after native dependency changes) | `sh scripts/amk/pod-install.sh` |
| iOS build (simulator, no signing) | `sh scripts/amk/ios-build.sh` |
| Android build | `cd android && ./gradlew assembleDebug` |
| Check on devices (release builds, Maestro flows, screenshots) | `sh scripts/amk/verify.sh all --spec <id>`; with product flavors it checks the first unless `--flavor <name>`; another iOS scheme: `--scheme <name>` |
| Specs: progress, format check, fold a finished feature into the living spec | `node scripts/amk/specs.js status`, `node scripts/amk/specs.js check`, `node scripts/amk/specs.js merge <id>` |
| Check a release before tagging it (versions, permission texts, debug leftovers) | `node scripts/amk/release-check.js` |
| Signed release builds (a person runs them: they use the signing keys) | `sh scripts/amk/release-build.sh android [flavor]`, `sh scripts/amk/release-build.sh ios [scheme]` |

## Definition of done

A task is done only when:
1. `sh scripts/amk/verify.sh quick` passes (lint, typecheck, tests) and you show its output from this session. In an app whose base branch already fails some of them, it passes when your change adds no new failure, and lists the old ones: leave those alone unless the task is to fix them;
2. UI changes were checked with `sh scripts/amk/verify.sh all --spec <id>` on both iOS and Android, and you looked at the screenshots. On Windows or Linux, that covers Android only: write in `progress.md` and the PR that iOS still needs checking on a Mac, and the PR isn't merged until a teammate with a Mac has done it;
3. the change stays inside the task's scope;
4. `specs/<id>/progress.md` is updated, when working from a spec.

Never say a check passed unless you ran it in this session.

## Rules

- Stay inside the task. Ask before touching unrelated files.
- Ask before adding or upgrading dependencies, and before editing `package.json`, lockfiles, `Podfile`, `build.gradle`, `Info.plist`, `AndroidManifest.xml` or `.github/workflows/`.
- Don't hand-edit `ios/*.xcodeproj/project.pbxproj`. If a native file must be added to the Xcode project, stop and ask.
- Never read, print or commit `.env` files, keystores or signing files. Secrets don't belong in this repo.
- Never use `git commit --no-verify`, `git push --force`, `git reset --hard` or `rm -rf`.
- After 2 failed attempts at the same fix, stop and report what you found.
- Chat is not memory: write decisions into the spec or `docs/amk/decisions.md` straight away.
- Follow `docs/amk/react-native.md`. Before fixing a build error, check `docs/amk/known-issues.md`.

## Skills

`react-native-best-practices`, `react-navigation`, `upgrading-react-native` (from Callstack, in `.agents/skills/`).
<!-- KIT:END agentic-mobile-kit -->
