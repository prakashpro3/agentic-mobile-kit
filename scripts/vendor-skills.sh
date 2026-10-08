#!/bin/sh
# Copies pinned third-party skills into the React Native template (text files only; images are skipped).
# To update: change COMMIT, run this script, review the diff, update THIRD_PARTY.md.
set -eu
REPO=callstackincubator/agent-skills
COMMIT=61e6e7dfdf3a8ee862254c200d751fcb1fb863dc
SKILLS="react-native-best-practices upgrading-react-native react-navigation"

cd "$(git rev-parse --show-toplevel)"
dest=stacks/react-native/template/.agents/skills
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -sfL "https://codeload.github.com/$REPO/tar.gz/$COMMIT" | tar -xz -C "$tmp"
src="$tmp/agent-skills-$COMMIT"
for s in $SKILLS; do
  rm -rf "${dest:?}/$s"
  (cd "$src/skills" && find "$s" -type f ! -name '*.png' ! -name '*.jpg' ! -name '*.gif' ! -name '*.webp') |
    while read -r f; do mkdir -p "$dest/$(dirname "$f")"; cp "$src/skills/$f" "$dest/$f"; done
done
cp "$src/LICENSE" "$dest/LICENSE-callstack"
echo "Vendored $SKILLS from $REPO@$COMMIT"
