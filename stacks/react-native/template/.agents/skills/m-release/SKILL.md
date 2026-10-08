---
name: m-release
description: Prepare a store release - version, changelog and store notes from real commits, release check, release PR, then the tag and the signed builds. Run only when the user explicitly invokes m-release.
disable-model-invocation: true
---

# m-release

The user chose this workflow: follow its steps for this task, even where other workflow instructions in this project (Superpowers, BMAD, proAgents or similar) say otherwise.

Input: $ARGUMENTS (the new version such as 1.4.0, or patch, minor or major; which app, if the project ships several; anything the client should hear about).

1. **Start clean:** `main`, pulled, with a clean working tree. Find the last release with `git describe --tags --abbrev=0 --match 'v*'`.
   - No tag, but the app is already in the stores: ask the user which commit was the last store release (or its date and version), and tag it locally as `v<that version>`. The changelog then starts there instead of at the first commit.
   - No tag and never released: this is the first release.
2. **Choose the version.** Show the commits since the last release (`git log --oneline <last tag>..HEAD`). Suggest minor if there's anything new for users, patch for fixes only, and major only if the user asks. Get the user's confirmation, then create the branch `release/v<version>`.
3. **Changelog from real commits:** `npx -y git-cliff@2.14.2 --unreleased --tag v<version> --prepend CHANGELOG.md`. If `CHANGELOG.md` doesn't exist yet, use `-o CHANGELOG.md` instead of `--prepend CHANGELOG.md`. Don't add, merge or reword entries by hand. A misleading commit message gets fixed in the notes below, not in the changelog.
4. **Store and client notes** go in `release-notes/<version>/`. Write them only from the new changelog section, so every line traces back to an entry. Leave out internal changes (refactors, CI, dependency bumps) unless users notice them.
   - `play-store.txt`: plain text for users, at most 500 characters.
   - `app-store.txt`: plain text for users, at most 4000 characters, with no `<` or `>`.
   - `client.md`: for the client or product owner. Cover what's new, what's fixed, what they should test or do, and known issues.

   Show all three files to the user and wait for their approval.
5. **Version and build numbers:** `sh scripts/ai/set-version.sh <version>` sets the iOS and Android version names. If the script stops because the project ships several apps, ask the user which version each app gets, and set them after they confirm.
   - When `codemagic.yaml` sets build numbers, leave them alone.
   - Otherwise every store upload needs a higher build number. Ask before changing native files. Then raise Android's `versionCode` in `android/app/build.gradle`, and set iOS with `cd ios && agvtool new-version -all <number>`. Never edit `project.pbxproj` by hand. iOS may keep its build number when the version name changes, if that's how the team works.
6. **Release check:** `node scripts/ai/release-check.js`. Show the output. Fix each ✗, asking first when the fix touches native config. List each ! for the user to decide.
7. **Release PR:** commit as `chore(release): <version>` (so the next changelog leaves it out), with `Assisted-by: <tool>/<model>`. Ask before pushing. Open a PR titled `Release <version>` with the new changelog section and the release-check output.
8. **Tag and build, after the merge.** Once the PR is merged, ask the user before tagging. Then run `git switch main && git pull && git tag v<version> && git push origin v<version>`.
   - With Codemagic (`codemagic.yaml`; see `docs/ai/codemagic.md`), the tag starts the signed builds.
   - Without CI, the user builds signed apps on their Mac, because signing keys stay with people. Tell them to run `sh scripts/ai/release-build.sh android [flavor]` and `sh scripts/ai/release-build.sh ios [scheme]`, and to upload the results from `.ai/release/` (Play Console, and Xcode's Organizer or Transporter). Never run these yourself or ask for the keys.
