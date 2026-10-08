#!/bin/sh
# Sets the version users see on both platforms: iOS MARKETING_VERSION and Android versionName.
# Build numbers are left alone (codemagic.yaml sets them at build time).
# Usage: sh scripts/ai/set-version.sh 1.4.0
set -eu
v=${1:-}
echo "$v" | grep -qE '^[0-9]+\.[0-9]+(\.[0-9]+)?$' || { echo "usage: sh scripts/ai/set-version.sh <version, e.g. 1.4.0>" >&2; exit 1; }
pbx=$(ls ios/*.xcodeproj/project.pbxproj | head -1)
gradle=$(ls android/app/build.gradle android/app/build.gradle.kts 2>/dev/null | head -1)

# several apps in one project (targets or flavors with their own versions): a person decides each one
[ -z "$(grep -oE 'MARKETING_VERSION = [^;]+' "$pbx" | sort -u | sed -n 2p)" ] || { echo "$pbx has several app versions; set each one in Xcode" >&2; exit 1; }
[ -z "$(grep -oE 'versionName( =)? "[^"]+"' "$gradle" | sort -u | sed -n 2p)" ] || { echo "$gradle has several versionName values; set each one by hand" >&2; exit 1; }

sed -i '' -E "s/MARKETING_VERSION = [^;]+;/MARKETING_VERSION = $v;/" "$pbx"
sed -i '' -E "s/versionName( =)? \"[^\"]+\"/versionName\1 \"$v\"/" "$gradle"
grep -q "MARKETING_VERSION = $v;" "$pbx" || { echo "No MARKETING_VERSION in $pbx; set the version in Xcode" >&2; exit 1; }
grep -qE "versionName( =)? \"$v\"" "$gradle" || { echo "No versionName in $gradle; set it by hand" >&2; exit 1; }
plutil -lint -s "$pbx"
echo "Version $v set in $pbx and $gradle."
