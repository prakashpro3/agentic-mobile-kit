# Known issues

Recurring errors and their fixes. Check here before debugging a build error. Remove entries that no longer apply.

## Format

### <short error text>
- **Cause:**
- **Fix:**
- **Prevention:**

## Entries

### iOS build: "unable to initiate PIF transfer session (operation in progress?)"
- **Cause:** two builds of the same project at once: a build from the command line (`verify.sh`, `ios-build.sh`) while Xcode builds or indexes it. No `xcodebuild` needs to be running: Xcode's build service holds the project.
- **Fix:** let Xcode finish, or quit it, then build again. If it stays stuck: `pkill -f SWBBuildService` (Xcode's build service, which starts again when needed), then build again.
- **Prevention:** don't start a command-line build while Xcode builds or indexes the same project.

### iOS build fails right after a native dependency was added or removed
- **Cause:** `ios/Pods` is out of date.
- **Fix:** `sh scripts/amk/pod-install.sh`, then rebuild.
- **Prevention:** run `sh scripts/amk/pod-install.sh` in the same change that edits `package.json`.

### `./gradlew` fails with "no main manifest attribute, in …/gradle-wrapper.jar"
- **Cause:** a React Native upgrade updated `android/gradlew` (which now runs `java -jar gradle-wrapper.jar`) but not `android/gradle/wrapper/gradle-wrapper.jar`. The upgrade diff doesn't carry binary files.
- **Fix:** copy `android/gradle/wrapper/gradle-wrapper.jar` from the React Native template of your new version (or run `gradle wrapper` with the version in `gradle-wrapper.properties`).
- **Prevention:** when upgrading, also copy the binary files the upgrade helper lists.

### "Unable to resolve module ./Name" in CI or a fresh clone, while it builds on your machine
- **Cause:** a file was renamed only in letter case (for example `storage.ts` to `Storage.ts`). macOS and Windows treat both names as the same file, so git kept the old name; Metro and Linux CI machines don't.
- **Fix:** rename it through git in two steps, then commit: `git mv src/utils/storage.ts src/utils/tmp.ts && git mv src/utils/tmp.ts src/utils/Storage.ts`.
- **Prevention:** rename files with `git mv`, not only in Finder or the editor.
