# React Native rules (bare)

Rules for things AI agents commonly get wrong in current React Native. Each one comes from a documented platform change, or from a bug agents keep making on screens. `node scripts/amk/rn-check.js`, which `verify.sh quick` runs, checks the lines a branch changes for some of them.

## Architecture

- `AGENTS.md` says which architecture this app runs.
- New Architecture (the only one since React Native 0.82): write native modules as Turbo Modules and native views as Fabric components, with TypeScript codegen specs. Don't use the old bridge APIs (`NativeModules`, `requireNativeComponent`) in new code. From 0.82, `newArchEnabled=false` is ignored.
- Old Architecture (`newArchEnabled=false`): before adding a library, check that it still supports the Old Architecture; Reanimated 4 and FlashList 2, for example, don't. Moving to the New Architecture is a task of its own, needed before React Native 0.82; don't mix it into other work.

## Screens and layout

- Use `react-native-safe-area-context` for safe areas. React Native's built-in `SafeAreaView` is deprecated and iOS-only.
- Android draws edge to edge (Android 15 and later), so handle top and bottom insets on every screen.
- For apps targeting Android 16 (API 36), `onBackPressed` is no longer called. Handle back with `BackHandler` in JS, or `OnBackPressedDispatcher` in native code.
- With the keyboard open, the field being typed in and the button that submits the form stay visible and tappable, on both platforms.
- Lists that grow with the user's data scroll (`FlatList`, or the list component the app already uses), and so does any screen taller than a small phone.
- At the largest system text size, text wraps instead of being cut off: no fixed heights on views that hold text. Don't turn off font scaling (`allowFontScaling={false}`) to make a layout fit.
- Messages that appear after an action, such as a form error, are read out by screen readers. On Android, show the message in a view with `accessibilityLiveRegion="polite"`: Android 16 deprecated announcements. On iOS, announce it with `AccessibilityInfo.announceForAccessibility`.
- Check every UI change on both iOS and Android; behavior differs (keyboard, insets, fonts, permissions).
- Give every interactive element a `testID` (kebab-case, for example `dark-mode-switch`). End-to-end tools tap by `testID`. On iOS, React Native exposes a label and its control as duplicate accessibility elements, so tapping by text can hit the label: nothing happens, yet the tool reports success.
- Give every interactive element an `accessibilityLabel` that says what it does and an `accessibilityRole` (`button`, `link`, `switch`, …), so screen readers can use it. Icon-only buttons need it most; screen readers don't read `testID`.

## Tablets and landscape

`AGENTS.md` lists the screens this app supports: phones and tablets, portrait and landscape. Build every screen for each of them, and skip what isn't listed. `verify.sh` checks each one.

- One set of screens for every device: layouts adapt to the window. No separate tablet copies of screens, and no phone-width column centered on a tablet.
- Read the window size with `useWindowDimensions()`, which updates on rotation, split view and resizable windows. `Dimensions.get` read once at startup goes stale.
- Lay out by window width: under 600 points (dp on Android), the phone layout; from 600, the tablet layout, with more columns, and a list beside its detail where that helps. Text-heavy content and forms keep a readable width (about 600 to 700 points) instead of stretching edge to edge.
- Sizes: when the app already has a way to size things (a scaling helper, or sizes in its theme), use it everywhere and don't mix in another. A new app takes sizes from its theme: spacing and a few text sizes step up from 600 points, and text follows the system font size. Judge the tablet and landscape screenshots like the phone's: each should look made for that screen, not stretched or tiny.
- Landscape leaves little height: screens scroll, the keyboard covers more, and the safe-area insets include the left and right edges (the notch or Dynamic Island side).
- Android ignores orientation and size locks on tablets and foldables (600 dp wide and up) for apps targeting Android 16 (API 36), and from Android 17 (API 37) apps can't opt out. Apple deprecated `UIRequiresFullScreen` with iPadOS 26, so iPad windows resize too. Every screen has to work at any window size and turned, whatever the app's settings say.
- Don't lock the orientation in code to avoid layout work. Which orientations the app supports is a product decision, set in `Info.plist` (`UISupportedInterfaceOrientations`, and `~ipad` for iPads) and the Android manifest (`android:screenOrientation`); the iPad app itself is the Xcode target's device family.

## Current React Native and React

These changed after most AI training data was written: check them instead of writing from memory.

- Removed: `InteractionManager` (0.87; use `requestIdleCallback`), the `StatusBar` props `backgroundColor` and `translucent` (0.87; edge to edge, they did nothing), `Modal`'s `animated` (0.87; `animationType`), a boolean `keyboardShouldPersistTaps` (0.87; `"handled"`) and `StyleSheet.absoluteFillObject` (0.85; `StyleSheet.absoluteFill`).
- Deprecated, so not in new code: `ImageBackground` (a `View` with an absolutely positioned `Image`), `InputAccessoryView` (`KeyboardStickyView` from `react-native-keyboard-controller`), `DrawerLayoutAndroid` (`react-native-drawer-layout`) and `AccessibilityInfo.setAccessibilityFocus` (`sendAccessibilityEvent`).
- Import from `react-native` itself. `react-native/Libraries/…` is private, and a type error from 0.87; don't add the `react-native-legacy-deep-imports` opt-out to hide it (it goes after 0.88).
- Jest: from 0.85 the preset is its own package, `preset: '@react-native/jest-preset'`.
- React 19: pass `ref` as a prop instead of `forwardRef`, render `<SomeContext value={…}>` instead of `<SomeContext.Provider>`, and use `useEffectEvent` (19.2) instead of turning off `react-hooks/exhaustive-deps`.
- With the React Compiler on (`babel-plugin-react-compiler` in `babel.config.js`), it memoizes: don't add `memo`, `useMemo` or `useCallback` to new code, and don't remove the ones there as a side task.
- iOS: apps built with Xcode 27 (the iOS 27 SDK) don't launch without the UIScene life cycle, which React Native supports from 0.88. Below 0.88, build with Xcode 26: moving to 0.88 is a task of its own. From then on, URL and user-activity handling goes in `SceneDelegate`.
- Android: Google Play takes only apps targeting Android 16 (API 36) or higher (from 31 August 2026). Don't lower `targetSdkVersion` to get out of edge to edge, back handling or orientation changes.

## Errors, storage and effects

- Wrap the app in an error boundary (the crash reporter's, or a component with `getDerivedStateFromError`), so a render error shows a screen to recover from instead of a blank or closed app.
- Every failure reaches the user or the crash reporter: no empty `catch`, and an action started from a button catches its error and shows it, with a way to retry, so a spinner never stays up.
- Tokens, passwords and keys go in the Keychain and Keystore (`react-native-keychain`), never in AsyncStorage or other plain storage. Anything in the JavaScript bundle can be read by anyone who has the app: no secret keys in code, or in `.env` values the bundle includes.
- Session replay and analytics mask what users type, and logs leave out tokens and personal data.
- Effects clean up what they start: timers (`clearTimeout`, `clearInterval`), listeners and subscriptions (return their `remove`), and async work that can finish after the screen closes (an `AbortController`, or a flag the cleanup sets).
- List keys come from the item's ID, not its index: index keys mix up rows when items are added, removed or reordered.
- Images go in asset files, never in code as base64 strings: they bloat the bundle, and all of it loads with the JavaScript.
- Component tests use React Native Testing Library (`@testing-library/react-native`) and find elements as users and screen readers do, by role, label or text (`getByRole('button', { name: 'Save' })`), rather than relying on snapshots.
- A test checks what a user or a caller sees, through the public interface (rendered text and roles, a hook's result, a function's return), so a refactor that keeps the behavior keeps the test passing.
- Mock only what the app doesn't own: the network, storage, native modules, time and randomness. Not the app's own components, hooks or modules: a test of mocks passes whatever the code does.
- Expected values come from the spec or a worked example (`expect(total([10, 5])).toBe(15)`), never computed the way the code computes them, or the test can't fail.
- A bug fix comes with a test that failed before the fix.

## Platform guidelines and accessibility

From Apple's Human Interface Guidelines, Android's design and app quality guidelines, and WCAG 2.2.

- Touch targets: every button, link and control is at least 44×44 points on iOS and 48×48 dp on Android (`minWidth`/`minHeight: 48` covers both): pad a small icon instead of sizing the button to it. `hitSlop` doesn't reach past the parent's bounds, so use it only where the layout can't grow.
- Text: no `fontSize` under 11, and don't cap scaling below 2× (`maxFontSizeMultiplier`), in `Text.defaultProps`, or in native code (a `fontScale` or content size override).
- Contrast, in both light and dark: text 4.5:1 against its background (3:1 from 18 points, or 14 bold), and input borders, focus rings and icons that carry meaning 3:1. Colors come from the theme, whose pairs are checked once; a grey like `#999` on white is only 2.8:1.
- Screen readers: controls show their state in `accessibilityState` (`checked`, `selected`, `expanded`, `disabled`), and screen and section titles have `accessibilityRole="header"`. A label names the action ("Delete photo"), without the role ("button") the reader already says. Put `accessible` on a row that reads as one item, never on one that holds its own buttons. Meaningful images get a label; decorative ones need nothing.
- Every swipe, drag or long-press action also has a visible button or menu item, and is in `accessibilityActions`. Color is never the only signal: an error shows text, and a state adds an icon or a word.
- Back: keep swipe back on iOS and the system back on Android. To ask before leaving unsaved changes, use React Navigation's `usePreventRemove`, not `gestureEnabled: false`. A `hardwareBackPress` listener returns `true` only while it closes something on screen; apps don't quit themselves (`BackHandler.exitApp`). Every `Modal` has `onRequestClose`, which Android's back button calls; forms open as sheets (`presentationStyle="pageSheet"`, or the navigator's sheet presentation).
- Permissions: ask when the user starts the feature that needs it, never at launch or when a screen opens; first say in the app why. When it's denied, say what's unavailable and keep the rest working. When the system won't ask again (`never_ask_again`, `blocked`), the feature's button explains that and offers `Linking.openSettings()`. Ask for notifications (Android 13 and later need `POST_NOTIFICATIONS`) after an action they serve, not on launch.
- Use the native controls (`@react-native-community/datetimepicker`, `Alert.alert` with verb buttons and `style: 'destructive'` and `'cancel'`, `ActionSheetIOS`, `Switch`); a custom one gets the same role, state and size.
- Dark mode: colors come from the theme's light and dark values (`useColorScheme()`), not hex values in components; don't lock the app to light.
- Data screens have loading, empty (why, and what to do next), error (what failed, with Retry) and content states. A message the user has to read doesn't vanish on a timer, and screen readers announce it.
- Reduce Motion: with it on, nothing loops or moves for decoration. Don't pass `ReduceMotion.Never` to Reanimated for decoration; with `Animated` or Lottie, read `AccessibilityInfo.isReduceMotionEnabled()` and the `reduceMotionChanged` event, and fade or stop instead.
- iOS 26: use native headers and tab bars (React Navigation's native stack and native tabs), which iOS draws in its current style; don't draw imitation glass behind content, or opt out with `UIDesignRequiresCompatibility` (builds with the iOS 27 SDK ignore it). Nothing the user needs sits under a floating tab bar, button or footer: scroll content gets bottom padding for it.
- Haptics only for success, error or a selection, never as the only feedback, through the app's haptics library; not `Vibration.vibrate`.

## Store review

What App Store review and Google Play reject. `node scripts/amk/release-check.js` checks the project for some of it.

- Apps where people can create an account let them start deleting it in the app: a full deletion, not deactivation; a direct link to a web page that finishes it is fine (Apple 5.1.1(v)). Google Play also needs that web link in the Data safety form.
- A third-party or social login (Google, Facebook) as the main sign-in also needs an equivalent private one, usually Sign in with Apple (4.8); an app that signs in only with the company's own accounts doesn't.
- Digital content and subscriptions are sold with in-app purchase (3.1.1); physical goods and services aren't. Links to buy elsewhere follow the storefront's current rules.
- Permission texts (`…UsageDescription`) say what the app does with the data and why, for each use; ask only for what the app uses.
- The privacy manifest and App Store Connect's privacy details list the data the app and its SDKs collect (analytics, crash reporting, session replay). Tracking needs the App Tracking Transparency prompt first.
- Google Play restricts these permissions to apps whose core feature needs them, with a declaration in Play Console: photos and videos (`READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`: others use the Android photo picker), `QUERY_ALL_PACKAGES`, `MANAGE_EXTERNAL_STORAGE`, SMS and call log, `USE_EXACT_ALARM`, and background location (also a video and an in-app disclosure first). A library can add one: remove it in `AndroidManifest.xml` with `tools:node="remove"` when the app doesn't need it.
- Android foreground services declare their type (`android:foregroundServiceType`) and its `FOREGROUND_SERVICE_<TYPE>` permission, and each type is declared in Play Console.
- From 1 February 2027, Google Play takes updates to apps targeting Android 15 or later only with 16 KB page size support, which React Native has from 0.77.

## TypeScript

- Keep the checks `tsconfig.json` has. Don't loosen them, or get past one with `any`, `@ts-ignore` or a non-null `!`.
- New apps from `init --new` also turn on `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns` and `noFallthroughCasesInSwitch`. In an existing app, turning these on is a change of its own (`m-change`), since they flag code that already exists.
- Import with the app's path alias when `tsconfig.json` has one (`@/` for `src/` in new apps) instead of long relative paths. In a bare app the alias also needs `babel-plugin-module-resolver` with the same mapping in `babel.config.js`, or Metro and Jest won't find the files.

## Native changes

- After adding or removing a native dependency: `sh scripts/amk/pod-install.sh`, then rebuild both apps. Restart Metro with `--reset-cache` if the bundle looks stale.
- Don't hand-edit `project.pbxproj`. Let CocoaPods or Xcode change it.
- Don't bump the Android Gradle Plugin, Gradle, Kotlin or the iOS deployment target one by one. Upgrade React Native as a whole with the `upgrading-react-native` skill and the React Native Upgrade Helper.

## Performance and libraries

- Follow the `react-native-best-practices` skill for lists, re-renders, startup time and bundle size.
- Follow the `react-navigation` skill for navigation.
