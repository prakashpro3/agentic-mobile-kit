#!/bin/sh
# Release agentic-mobile-kit to npm.
#   1. bumps the version and tags it (npm version)
#   2. pushes the tag; GitHub Actions stages the release on npm (trusted publishing, no token)
#   3. you approve the staged release with 2FA, which makes it live
#
# Usage: scripts/release.sh [patch|minor|major|x.y.z]   (default: patch)
#    or: npm run release -- minor
set -eu

NPM12=npm@12.2.0 # stage publish/approve need npm 12
bump=${1:-patch}

cd "$(git rev-parse --show-toplevel)"
command -v gh > /dev/null || { echo "Install the GitHub CLI (gh) first."; exit 1; }
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)

# --- checks before touching anything
[ "$(git branch --show-current)" = main ] || { echo "Switch to the main branch first."; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Commit or stash your changes first."; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main isn't in sync with origin/main. Pull or push first."; exit 1; }

# --- bump, commit and tag (creates tag vX.Y.Z)
tag=$(npm version "$bump" -m "Release %s")
echo "Tagged $tag"

# --- push; the publish workflow starts on the tag
git push -q origin main "$tag"
echo "Pushed. Waiting for the publish workflow…"

run_id=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  sleep 5
  run_id=$(gh run list -R "$repo" --workflow publish.yml --branch "$tag" --limit 1 --json databaseId --jq '.[0].databaseId // empty')
  [ -n "$run_id" ] && break
done
[ -n "$run_id" ] || { echo "No publish run found for $tag. Check the Actions tab on GitHub."; exit 1; }

if ! gh run watch "$run_id" -R "$repo" --exit-status > /dev/null; then
  echo "The publish workflow failed. See: gh run view $run_id -R $repo --log-failed"
  exit 1
fi

stage_id=$(gh run view "$run_id" -R "$repo" --log | sed -n 's/.*staged with id \([0-9a-f-]*\).*/\1/p' | head -n 1)
[ -n "$stage_id" ] || { echo "Workflow finished but no stage id was found. See: gh run view $run_id -R $repo --log"; exit 1; }
echo "Staged ${tag#v} on npm (stage id $stage_id)."

# --- approval needs you (npm login + 2FA), so it's never automatic
approve="npx -y $NPM12 stage approve $stage_id"
printf 'Approve it now with 2FA? [y/N] '
read -r answer || answer=""
case "$answer" in
  y|Y)
    npx -y "$NPM12" whoami > /dev/null 2>&1 || npx -y "$NPM12" login
    $approve
    echo "Done. ${tag#v} is live: https://www.npmjs.com/package/agentic-mobile-kit"
    ;;
  *)
    echo "Approve later with: $approve"
    ;;
esac
