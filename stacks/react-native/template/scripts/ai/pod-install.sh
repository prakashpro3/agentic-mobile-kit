#!/bin/sh
# Installs the iOS pods. With a Gemfile (React Native's template has one), it uses the CocoaPods version pinned there,
# so Podfile.lock doesn't change just because machines have different CocoaPods versions.
# Usage: sh scripts/ai/pod-install.sh [pod install options]
set -eu
cd ios
if [ -f ../Gemfile ] && command -v bundle > /dev/null && bundle check > /dev/null 2>&1; then
  bundle exec pod install "$@"
else
  [ ! -f ../Gemfile ] || echo "pod-install: the Gemfile's gems aren't installed (run: bundle install), so this uses the CocoaPods on PATH" >&2
  pod install "$@"
fi
