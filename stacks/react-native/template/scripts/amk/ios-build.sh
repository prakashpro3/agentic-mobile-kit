#!/bin/sh
# Builds the iOS app for the simulator without code signing (CI and local checks).
# CONFIGURATION=Release builds a self-contained app (JS bundled; no Metro needed), with the configuration the scheme
# archives with: apps with one per environment (for example "Release Staging") get theirs.
# AMK_IOS_SCHEME picks the scheme (default: the one named like the workspace).
# Output goes to ios/DerivedData: ios/build holds React Native codegen files from pod install.
set -eu
config=${CONFIGURATION:-Debug}
workspace=$(ls -d ios/*.xcworkspace 2>/dev/null | head -n 1)
[ -n "$workspace" ] || { echo "No ios/*.xcworkspace found. Run sh scripts/amk/pod-install.sh first."; exit 1; }
scheme=${AMK_IOS_SCHEME:-$(basename "$workspace" .xcworkspace)}
if [ "$config" = Release ]; then
  file=$(ls ios/*.xcodeproj/xcshareddata/xcschemes/"$scheme".xcscheme ios/*.xcworkspace/xcshareddata/xcschemes/"$scheme".xcscheme 2> /dev/null | head -n 1)
  [ -z "$file" ] || config=$(awk '/<ArchiveAction/ { a = 1 } a && /buildConfiguration/ { split($0, q, "\""); print q[2]; exit }' "$file")
  [ -n "$config" ] || config=Release
fi

# only this Mac's simulator architecture: a Release build would otherwise compile Intel and Apple silicon both,
# and fail to link libraries that ship without an Intel simulator slice. Not when the project or a pod excludes it
# for the simulator (Google's ML Kit pods exclude arm64): then Xcode builds what the project allows.
arch=x86_64
[ "$(sysctl -n hw.optional.arm64 2> /dev/null)" != 1 ] || arch=arm64
set -- ARCHS="$arch"
! grep -rqsE "EXCLUDED_ARCHS\[sdk=iphonesimulator\*\]\"? = [^;]*$arch" ios/*.xcodeproj/project.pbxproj "ios/Pods/Target Support Files" || set --

xcodebuild -workspace "$workspace" -scheme "$scheme" -configuration "$config" \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/DerivedData "$@" CODE_SIGNING_ALLOWED=NO -quiet build
echo "iOS simulator build OK ($scheme, $config)"
