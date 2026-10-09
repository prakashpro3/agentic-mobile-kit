# React Native rules (bare)

Rules for things AI agents commonly get wrong in current React Native. Each one comes from a documented platform change.

## Architecture

- `AGENTS.md` says which architecture this app runs.
- New Architecture (the only one since React Native 0.82): write native modules as Turbo Modules and native views as Fabric components, with TypeScript codegen specs. Don't use the old bridge APIs (`NativeModules`, `requireNativeComponent`) in new code. From 0.82, `newArchEnabled=false` is ignored.
- Old Architecture (`newArchEnabled=false`): before adding a library, check that it still supports the Old Architecture; Reanimated 4 and FlashList 2, for example, don't. Moving to the New Architecture is a task of its own, needed before React Native 0.82; don't mix it into other work.

## Screens and layout

- Use `react-native-safe-area-context` for safe areas. React Native's built-in `SafeAreaView` is deprecated and iOS-only.
- Android draws edge to edge (Android 15 and later), so handle top and bottom insets on every screen.
- For apps targeting Android 16 (API 36), `onBackPressed` is no longer called. Handle back with `BackHandler` in JS, or `OnBackPressedDispatcher` in native code.
- Check every UI change on both iOS and Android; behavior differs (keyboard, insets, fonts, permissions).
- Give every interactive element a `testID` (kebab-case, for example `dark-mode-switch`). End-to-end tools tap by `testID`. On iOS, React Native exposes a label and its control as duplicate accessibility elements, so tapping by text can hit the label: nothing happens, yet the tool reports success.

## Native changes

- After adding or removing a native dependency: `sh scripts/ai/pod-install.sh`, then rebuild both apps. Restart Metro with `--reset-cache` if the bundle looks stale.
- Don't hand-edit `project.pbxproj`. Let CocoaPods or Xcode change it.
- Don't bump the Android Gradle Plugin, Gradle, Kotlin or the iOS deployment target one by one. Upgrade React Native as a whole with the `upgrading-react-native` skill and the React Native Upgrade Helper.

## Performance and libraries

- Follow the `react-native-best-practices` skill for lists, re-renders, startup time and bundle size.
- Follow the `react-navigation` skill for navigation.
