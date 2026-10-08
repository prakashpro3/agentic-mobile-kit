# React Native rules (bare, New Architecture)

Rules for things AI agents commonly get wrong in current React Native. Each one comes from a documented platform change.

## Architecture

- The New Architecture is the only architecture since React Native 0.82. Never set `newArchEnabled=false`; it's ignored.
- Write native modules as Turbo Modules and native views as Fabric components, with TypeScript codegen specs. Don't use the old bridge APIs (`NativeModules`, `requireNativeComponent`) in new code.

## Screens and layout

- Use `react-native-safe-area-context` for safe areas. React Native's built-in `SafeAreaView` is deprecated and iOS-only.
- Android draws edge to edge (Android 15 and later), so handle top and bottom insets on every screen.
- For apps targeting Android 16 (API 36), `onBackPressed` is no longer called. Handle back with `BackHandler` in JS, or `OnBackPressedDispatcher` in native code.
- Check every UI change on both iOS and Android; behavior differs (keyboard, insets, fonts, permissions).

## Native changes

- After adding or removing a native dependency: `cd ios && pod install`, then rebuild both apps. Restart Metro with `--reset-cache` if the bundle looks stale.
- Don't hand-edit `project.pbxproj`. Let CocoaPods or Xcode change it.
- Don't bump the Android Gradle Plugin, Gradle, Kotlin or the iOS deployment target one by one. Upgrade React Native as a whole with the `upgrading-react-native` skill and the React Native Upgrade Helper.

## Performance and libraries

- Follow the `react-native-best-practices` skill for lists, re-renders, startup time and bundle size.
- Follow the `react-navigation` skill for navigation.
