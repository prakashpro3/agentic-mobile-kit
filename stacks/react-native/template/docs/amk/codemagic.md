# Signed release builds on Codemagic

`codemagic.yaml` has two workflows. `android-release` builds a signed app bundle and uploads it to Google Play's internal track. `ios-release` builds a signed ipa and uploads it to TestFlight. Both start when a version tag is pushed (`git push origin v1.2.0`), and you can start either one by hand in Codemagic.

Each build:
1. runs `node scripts/amk/release-check.js` and stops if it finds a problem;
2. sets the build number on the build machine: one more than the latest in the store, or Codemagic's build counter for a new app. Nothing is committed, so the repo keeps only the version name (for example 1.2.0), which you bump in the release PR;
3. uses `release-notes/<version>/play-store.txt` or `app-store.txt` as the store's "What's new" or TestFlight's "What to test", when the build comes from a tag;
4. signs with keys that Codemagic stores. The repo never holds them, and local release builds (`verify.sh`, the e2e CI) stay signed with the debug key.

## One-time setup for each app

You need admin rights in the Codemagic team (or your personal account). Menus are under **Team settings** for a team and under **Settings** for a personal account.

1. **Add the app:** Applications → Add application → choose the repository, then pick `codemagic.yaml` as the configuration.
2. **Android upload key:** codemagic.yaml settings → Code signing identities → Android keystores. Upload the app's upload keystore, enter its password, key alias and key password, and set the reference name to `upload_keystore`.
   - A new app has no key yet. Create one with `keytool -genkeypair -keystore upload.jks -storetype PKCS12 -alias upload -keyalg RSA -keysize 2048 -validity 10000`, keep the file and password in your password manager, and turn on Play App Signing.
3. **Google Play access:**
   - In Google Cloud, create a service account and download its JSON key.
   - In Play Console → Users and permissions, invite it with release rights for the app.
   - In Codemagic, open the app → Environment variables. Add `GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS` with the JSON as its value, in a group named `google_play`, marked Secret.
   - Upload the first build of a new app by hand in Play Console. If the app has never been published, add `submit_as_draft: true` under `google_play` in `codemagic.yaml`.
4. **App Store Connect API key:** in App Store Connect → Users and Access → Integrations → App Store Connect API, create a key with App Manager access. In Codemagic → Integrations → Developer Portal → Manage keys → Add key, name it `codemagic`, enter the Issuer ID and Key ID, and upload the `.p8` file.
5. **iOS certificate and profile:** codemagic.yaml settings → Code signing identities:
   - iOS certificates → Generate certificate → Apple Distribution. Apple allows three per team, so reuse one that Codemagic created before.
   - iOS provisioning profiles → Fetch profiles → the App Store profile for the app's bundle ID.
6. **Check `codemagic.yaml`:**
   - `bundle_identifier` was filled in from the Xcode project.
   - Set `APP_STORE_APPLE_ID` (App Store Connect → the app → App Information → Apple ID). Without it, the iOS build number falls back to Codemagic's build counter, which the store rejects if it's lower than an earlier upload.

Then start `android-release` by hand and check that the signed `.aab` appears in the build's artifacts. Do the same for `ios-release`.

## Apps with more than one target

When one repo ships several apps (for example a main app and a kiosk app, or product flavors), copy the workflow once per app. In each copy, set the bundle ID, the scheme (iOS) and the Gradle task and package (Android).

## Plan limits

The free personal plan includes 500 macOS minutes a month and runs one build at a time.
