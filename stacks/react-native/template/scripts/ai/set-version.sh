#!/bin/sh
# Sets the version users see on both platforms: iOS MARKETING_VERSION and Android versionName, or in Expo
# apps without native folders, expo.version in app.json.
# Build numbers are left alone (codemagic.yaml sets them at build time).
# Usage: sh scripts/ai/set-version.sh 1.4.0
set -eu
v=${1:-}
echo "$v" | grep -qE '^[0-9]+\.[0-9]+(\.[0-9]+)?$' || { echo "usage: sh scripts/ai/set-version.sh <version, e.g. 1.4.0>" >&2; exit 1; }

# Expo apps without native folders in git: the version is expo.version in the app config
if [ -z "$(git ls-files -- ios android 2> /dev/null)" ] &&
  node -e "const p = require('./package.json'); process.exit({ ...p.dependencies, ...p.devDependencies }.expo ? 0 : 1)" 2> /dev/null; then
  config=$(ls app.config.js app.config.ts app.config.mjs app.config.cjs 2> /dev/null | head -1)
  [ -z "$config" ] || { echo "This app computes its config in $config: set the version there by hand" >&2; exit 1; }
  node -e '
    const fs = require("fs");
    const text = fs.readFileSync("app.json", "utf8");
    const json = JSON.parse(text);
    (json.expo || json).version = process.argv[1];
    const indent = (text.match(/^[ \t]+(?=")/m) || ["  "])[0];
    fs.writeFileSync("app.json", `${JSON.stringify(json, null, indent)}\n`);
  ' "$v"
  echo "Version $v set in app.json."
  exit 0
fi
pbx=$(ls ios/*.xcodeproj/project.pbxproj | head -1)
gradle=$(ls android/app/build.gradle android/app/build.gradle.kts 2>/dev/null | head -1)

# several apps in one project (targets or flavors with their own versions): a person decides each one
[ -z "$(grep -oE 'MARKETING_VERSION = [^;]+' "$pbx" | sort -u | sed -n 2p)" ] || { echo "$pbx has several app versions; set each one in Xcode" >&2; exit 1; }
[ -z "$(grep -oE 'versionName( =)? "[^"]+"' "$gradle" | sort -u | sed -n 2p)" ] || { echo "$gradle has several versionName values; set each one by hand" >&2; exit 1; }

# -i.bak works with both macOS and GNU sed (Linux, Git Bash on Windows)
sed -i.bak -E "s/MARKETING_VERSION = [^;]+;/MARKETING_VERSION = $v;/" "$pbx" && rm -f "$pbx.bak"
sed -i.bak -E "s/versionName( =)? \"[^\"]+\"/versionName\1 \"$v\"/" "$gradle" && rm -f "$gradle.bak"
grep -q "MARKETING_VERSION = $v;" "$pbx" || { echo "No MARKETING_VERSION in $pbx; set the version in Xcode" >&2; exit 1; }
grep -qE "versionName( =)? \"$v\"" "$gradle" || { echo "No versionName in $gradle; set it by hand" >&2; exit 1; }
! command -v plutil > /dev/null || plutil -lint -s "$pbx"
echo "Version $v set in $pbx and $gradle."
