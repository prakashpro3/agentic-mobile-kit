# Known issues

Recurring errors and their fixes. Check here before debugging a build error. Remove entries that no longer apply.

## Format

### <short error text>
- **Cause:**
- **Fix:**
- **Prevention:**

## Entries

### iOS build fails right after a native dependency was added or removed
- **Cause:** `ios/Pods` is out of date.
- **Fix:** `sh scripts/ai/pod-install.sh`, then rebuild.
- **Prevention:** run `sh scripts/ai/pod-install.sh` in the same change that edits `package.json`.

### `./gradlew` fails with "no main manifest attribute, in …/gradle-wrapper.jar"
- **Cause:** a React Native upgrade updated `android/gradlew` (which now runs `java -jar gradle-wrapper.jar`) but not `android/gradle/wrapper/gradle-wrapper.jar`. The upgrade diff doesn't carry binary files.
- **Fix:** copy `android/gradle/wrapper/gradle-wrapper.jar` from the React Native template of your new version (or run `gradle wrapper` with the version in `gradle-wrapper.properties`).
- **Prevention:** when upgrading, also copy the binary files the upgrade helper lists.

### "Unable to resolve module ./Name" in CI or a fresh clone, while it builds on your machine
- **Cause:** a file was renamed only in letter case (for example `storage.ts` to `Storage.ts`). macOS and Windows treat both names as the same file, so git kept the old name; Metro and Linux CI machines don't.
- **Fix:** rename it through git in two steps, then commit: `git mv src/utils/storage.ts src/utils/tmp.ts && git mv src/utils/tmp.ts src/utils/Storage.ts`.
- **Prevention:** rename files with `git mv`, not only in Finder or the editor.
