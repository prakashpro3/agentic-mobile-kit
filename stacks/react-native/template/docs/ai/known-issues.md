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
- **Fix:** `cd ios && pod install`, then rebuild.
- **Prevention:** run `pod install` in the same change that edits `package.json`.
