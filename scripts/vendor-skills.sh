#!/bin/sh
# Copies pinned third-party skills into the React Native template and its Expo overlay (text files only; images
# are skipped). To update: change a commit, run this script, review the diff, update THIRD_PARTY.md.
set -eu
CALLSTACK_COMMIT=61e6e7dfdf3a8ee862254c200d751fcb1fb863dc
EXPO_COMMIT=d4f484024fec15196bfd3c272e953e3f983972cf

cd "$(git rev-parse --show-toplevel)"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# vendor <owner/repo> <commit> <skills folder in the repo> <destination> <license file name> <skill>…
vendor() {
  repo=$1 commit=$2 folder=$3 dest=$4 license=$5
  shift 5
  curl -sfL "https://codeload.github.com/$repo/tar.gz/$commit" | tar -xz -C "$tmp"
  root="$tmp/${repo#*/}-$commit"
  for s in "$@"; do
    rm -rf "${dest:?}/$s"
    (cd "$root/$folder" && find "$s" -type f ! -name '*.png' ! -name '*.jpg' ! -name '*.gif' ! -name '*.webp') |
      while read -r f; do mkdir -p "$dest/$(dirname "$f")"; cp "$root/$folder/$f" "$dest/$f"; done
  done
  cp "$root/LICENSE" "$dest/$license"
  echo "Vendored $* from $repo@$commit"
}

vendor callstackincubator/agent-skills "$CALLSTACK_COMMIT" skills stacks/react-native/template/.agents/skills LICENSE-callstack \
  react-native-best-practices upgrading-react-native react-navigation
vendor expo/skills "$EXPO_COMMIT" plugins/expo/skills stacks/react-native/expo/.agents/skills LICENSE-expo \
  expo-router expo-upgrade expo-module
