#!/bin/sh
# Builds the iOS app for the simulator without code signing (CI and local checks).
# CONFIGURATION=Release builds a self-contained app (JS bundled; no Metro needed).
# Output goes to ios/DerivedData: ios/build holds React Native codegen files from pod install.
set -eu
config=${CONFIGURATION:-Debug}
workspace=$(ls -d ios/*.xcworkspace 2>/dev/null | head -n 1)
[ -n "$workspace" ] || { echo "No ios/*.xcworkspace found. Run pod install in ios/ first."; exit 1; }
scheme=$(basename "$workspace" .xcworkspace)

xcodebuild -workspace "$workspace" -scheme "$scheme" -configuration "$config" \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/DerivedData CODE_SIGNING_ALLOWED=NO -quiet build
echo "iOS simulator build OK ($scheme, $config)"
