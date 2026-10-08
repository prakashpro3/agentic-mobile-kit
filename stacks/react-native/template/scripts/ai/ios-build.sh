#!/bin/sh
# Builds the iOS app for the simulator without code signing (CI and local checks).
set -eu
workspace=$(ls -d ios/*.xcworkspace 2>/dev/null | head -n 1)
[ -n "$workspace" ] || { echo "No ios/*.xcworkspace found. Run pod install in ios/ first."; exit 1; }
scheme=$(basename "$workspace" .xcworkspace)

xcodebuild -workspace "$workspace" -scheme "$scheme" -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/build CODE_SIGNING_ALLOWED=NO -quiet build
echo "iOS simulator build OK ($scheme)"
