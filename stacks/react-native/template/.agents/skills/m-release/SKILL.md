---
name: m-release
description: Prepare a store release - version, changelog and store notes from real commits, release check, release PR, then the tag that starts the signed builds. Run only when the user explicitly invokes m-release.
disable-model-invocation: true
---

# m-release

Input: $ARGUMENTS (the new version such as 1.4.0, or patch, minor or major; anything the client should hear about).

1. **Start clean:** `main`, pulled, with a clean working tree. Find the last release with `git describe --tags --abbrev=0 --match 'v*'`. If there's none, this is the first release.
2. **Choose the version.** Show the commits since the last release (`git log --oneline <last tag>..HEAD`). Suggest minor if there's anything new for users, patch for fixes only, and major only if the user asks. Get the user's confirmation, then create the branch `release/v<version>`.
3. **Changelog from real commits:** `npx -y git-cliff@2.14.2 --unreleased --tag v<version> --prepend CHANGELOG.md`. If `CHANGELOG.md` doesn't exist yet, use `-o CHANGELOG.md` instead of `--prepend CHANGELOG.md`. Don't add, merge or reword entries by hand. A misleading commit message gets fixed in the notes below, not in the changelog.
4. **Store and client notes** go in `release-notes/<version>/`. Write them only from the new changelog section, so every line traces back to an entry. Leave out internal changes (refactors, CI, dependency bumps) unless users notice them.
   - `play-store.txt`: plain text for users, at most 500 characters.
   - `app-store.txt`: plain text for users, at most 4000 characters, with no `<` or `>`.
   - `client.md`: for the client or product owner. Cover what's new, what's fixed, what they should test or do, and known issues.

   Show all three files to the user and wait for their approval.
5. **Version name:** `sh scripts/ai/set-version.sh <version>` sets the iOS and Android version names. Leave build numbers alone when `codemagic.yaml` sets them; otherwise ask whether to bump them. If the script stops because the project ships several apps, ask the user which version each app gets.
6. **Release check:** `node scripts/ai/release-check.js`. Show the output. Fix each ✗, asking first when the fix touches native config. List each ! for the user to decide.
7. **Release PR:** commit as `Release <version>` with `Assisted-by: <tool>/<model>`. Ask before pushing. Open a PR titled `Release <version>` with the new changelog section and the release-check output.
8. **Tag after the merge.** Once the PR is merged, ask the user before tagging. Then run `git switch main && git pull && git tag v<version> && git push origin v<version>`. With Codemagic set up (`docs/ai/codemagic.md`), the tag starts the signed builds, which go to TestFlight and Play's internal track.
