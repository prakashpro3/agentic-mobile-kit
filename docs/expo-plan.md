# Plan: Expo support

Status: done, 2026-10-09. Results are in the [tool matrix](tool-matrix.md#expo-2026-10-09).

**Goal:** the kit works for Expo apps that use Continuous Native Generation (CNG). In those apps, `npx expo prebuild` generates `ios/` and `android/`, which aren't kept in git. That's how `create-expo-app` starts every app (SDK 57: React Native 0.86 and Expo Router).

**Already works:** Expo apps that keep `ios/` and `android/` in git. They use the bare setup, and every script runs as it does for bare apps.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| EAS (Build, Submit, Workflows) | The kit reads `eas.json`. `m-release` hands EAS steps to a person, as it does with fastlane lanes. Nothing runs on EAS, and none of it is tested | No Expo account |
| Over-the-air updates (EAS Update) | Not in scope | The user's choice |
| Tests | iOS simulator and Android emulator, with release builds made on this Mac. No account is needed. Expo Go isn't used: it runs development builds and can't load an app's own native code | The user's choice |
| Template | One template plus an Expo overlay, `stacks/react-native/expo/`. It holds only the files that differ and replaces or adds to the bare ones. The `AGENTS.md` marker records `stack=expo`, so `sync` and `uninstall` use the same files | Most files are shared: skills, specs, hooks, scripts and CI |
| Detection | `expo` is a dependency, and git has no `ios/` or `android/` | Apps with native folders in git keep the bare setup |
| Native folders | Generated, so agents never edit them. Changes go through `app.json`/`app.config.*` and config plugins. Tool permissions deny edits to `ios/**` and `android/**` | `prebuild --clean` would erase hand edits |
| Builds | The scripts run `npx expo prebuild` first, then reuse the bare flow: pods, Release builds, Maestro flows and screenshots, signing | No second build path to maintain |
| Versions | Read from the resolved app config (`npx expo config --json`). `eas.json` says when EAS sets the build numbers | `app.config.js` can compute them |

## Phases

| Phase | Work | Time |
|---|---|---|
| 1. Install | Detection, the overlay and the marker. An `AGENTS.md` for Expo: `npx expo install`, `npx expo start`, `npx expo prebuild`, `npx expo-doctor`, and the rules. `docs/ai/expo.md`. A few of Expo's own skills (MIT), chosen after reading them. Tool permissions. `sync` and `uninstall`. Unit tests. The CI smoke test on a new Expo app on macOS, Windows and Linux | ½ day |
| 2. Device checks | `prebuild` in `verify.sh`, `ios-build.sh` and `pod-install.sh`. Release builds on the iOS simulator and the Android emulator, with Maestro flows. CI templates: `e2e.yml` and `codemagic.yaml` get the `prebuild` step that `ios.yml` already has. Tested on a new Expo app | 1 day |
| 3. Releases | `release-check` reads versions from the app config, and permission texts from the generated native files. It knows `eas.json` `autoIncrement` and `appVersionSource: remote`. `set-version.sh` edits `app.json`, and asks first if the app uses `app.config.*`. `release-build.sh` runs `prebuild`, then the same signed builds. `m-release` hands EAS builds to a person | ½–1 day |
| 4. End to end | `/m-feature` in Claude Code on the Expo test app, continued in Codex. Results in the tool matrix. README, team guide and what-it-adds | ½ day |

Total: about 3 days.

## Not tested

- Anything on EAS (needs an Expo account).
- Signed iOS builds (need an Apple Developer team). Android signed builds are tested with a throwaway key.
