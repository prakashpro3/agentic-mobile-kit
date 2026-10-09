# Known issues

Recurring errors and their fixes. Check here before debugging a build error. Remove entries that no longer apply.

## Format

### <short error text>
- **Cause:**
- **Fix:**
- **Prevention:**

## Entries

### A native change doesn't show up in the build
- **Cause:** the kit's scripts regenerate `ios/` and `android/` only when Expo's fingerprint changes. It covers the app config, config plugins and native libraries, but not, for example, a file that a config plugin reads.
- **Fix:** delete `ios/.amk-fingerprint` and `android/.amk-fingerprint`, then check again. The next build regenerates both folders and takes longer.
- **Prevention:** none needed for app config, plugin and library changes.

### Expo SDK 55: the Android release build fails with "libworklets.so … missing and no known rule to make it"
- **Cause:** SDK 55's `expo-modules-core` looks for `libworklets.so` in an older build-output folder (`node_modules/react-native-worklets/android/build/intermediates/cmake/release/obj/<abi>/`). `react-native-worklets` 0.7 builds it into `intermediates/cxx/RelWithDebInfo/<hash>/obj/<abi>/`. It fails without the kit too.
- **Fix:** move to a later Expo SDK (SDK 57 builds). Until then: build worklets once (`cd android && ./gradlew :react-native-worklets:assembleRelease`), copy each `libworklets.so` from `cxx/RelWithDebInfo/*/obj/<abi>/` to `cmake/release/obj/<abi>/`, and build again. The copy stays until `node_modules` is reinstalled.
- **Prevention:** upgrade the SDK.

### A library fails at build or run time right after it was added
- **Cause:** it was added with `npm install` or `yarn add`, so its version may not match the Expo SDK.
- **Fix:** `npx expo install --fix`, then `npx expo-doctor`.
- **Prevention:** add libraries with `npx expo install <package>`.

### "Unable to resolve module ./Name" in CI or a fresh clone, while it builds on your machine
- **Cause:** a file was renamed only in letter case (for example `storage.ts` to `Storage.ts`). macOS and Windows treat both names as the same file, so git kept the old name; Metro and Linux CI machines don't.
- **Fix:** rename it through git in two steps, then commit: `git mv src/utils/storage.ts src/utils/tmp.ts && git mv src/utils/tmp.ts src/utils/Storage.ts`.
- **Prevention:** rename files with `git mv`, not only in Finder or the editor.
