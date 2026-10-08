<!-- KIT:START agentic-mobile-kit {{KIT_VERSION}} ci={{KIT_CI}} (edit outside these markers; the kit updates what's inside) -->
# {{APP_NAME}}: instructions for AI agents

Read by Claude Code (through CLAUDE.md), Codex, Cursor, OpenCode, Kiro and Antigravity. Keep it short; details live in `docs/ai/`.

## Project

- Bare React Native {{RN_VERSION}} (New Architecture), React {{REACT_VERSION}}, TypeScript {{TS_VERSION}}, Node {{NODE_VERSION}}. Package manager: {{PM}}.
- What the app does: `docs/ai/product.md`. Stack and services: `docs/ai/tech.md`. Folders and layers: `docs/ai/structure.md`. Code style: `docs/ai/conventions.md`.

## Commands

| Task | Command |
|---|---|
| Install dependencies | `sh scripts/ai/install-deps.sh` |
| Lint, typecheck, test | `{{PM_RUN}} lint`, `{{PM_RUN}} typecheck`, `{{PM_RUN}} test` |
| iOS pods (after native dependency changes) | `cd ios && pod install` |
| iOS build (simulator, no signing) | `sh scripts/ai/ios-build.sh` |
| Android build | `cd android && ./gradlew assembleDebug` |
| Check on devices (release builds, Maestro flows, screenshots) | `sh scripts/ai/verify.sh all --spec <id>` |
| Check a release before tagging it (versions, permission texts, debug leftovers) | `node scripts/ai/release-check.js` |

## Definition of done

A task is done only when:
1. lint, typecheck and tests pass, and you show the command output from this session;
2. UI changes were checked with `sh scripts/ai/verify.sh all --spec <id>` on both iOS and Android, and you looked at the screenshots;
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
- Chat is not memory: write decisions into the spec or `docs/ai/decisions.md` straight away.
- Follow `docs/ai/react-native.md`. Before fixing a build error, check `docs/ai/known-issues.md`.

## Skills

`react-native-best-practices`, `react-navigation`, `upgrading-react-native` (from Callstack, in `.agents/skills/`).
<!-- KIT:END agentic-mobile-kit -->
