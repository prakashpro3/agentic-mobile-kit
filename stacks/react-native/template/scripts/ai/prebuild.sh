#!/bin/sh
# Expo apps whose ios/ and android/ aren't in git (Continuous Native Generation): generates the platform's native
# project with `expo prebuild`, so release builds can run. Does nothing for apps that keep the folders in git.
# Usage: sh scripts/ai/prebuild.sh ios|android
set -eu
platform=$1
[ -z "$(git ls-files -- "$platform")" ] || exit 0
node -e "const p = require('./package.json'); process.exit({ ...p.dependencies, ...p.devDependencies }.expo ? 0 : 1)" 2> /dev/null || exit 0

# prebuild recreates the folder, which throws away its pods and build caches. Expo's fingerprint covers everything
# the native project is generated from (app config, config plugins, native libraries): while it's unchanged since
# the last prebuild, the generated project is still right and the next build stays incremental.
stamp="$platform/.amk-fingerprint"
hash=$(node node_modules/expo/bin/fingerprint fingerprint:generate --platform "$platform" 2> /dev/null |
  node -e 'try { console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).hash) } catch {}') || hash=""
if [ -n "$hash" ] && [ "$(cat "$stamp" 2> /dev/null)" = "$hash" ]; then
  echo "prebuild: $platform/ already matches the app config"
  exit 0
fi

# the first prebuild also writes into package.json (run scripts) and app.json (a placeholder bundle ID):
# put those files back, unless they already had changes of the team's
clean=$(for f in package.json app.json; do
  if git ls-files --error-unmatch "$f" > /dev/null 2>&1 && git diff --quiet HEAD -- "$f"; then echo "$f"; fi
done)
CI=1 npx expo prebuild --platform "$platform" --no-install
for f in $clean; do git checkout -q HEAD -- "$f"; done
[ -z "$hash" ] || echo "$hash" > "$stamp"
