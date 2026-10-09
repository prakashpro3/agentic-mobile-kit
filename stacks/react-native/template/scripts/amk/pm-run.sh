#!/bin/sh
# Runs a package.json script with the project's package manager; skips quietly if the script doesn't exist.
# Usage: sh scripts/amk/pm-run.sh <script> [args…]
set -eu
script=$1; shift

if ! node -e "process.exit(require('./package.json').scripts?.[process.argv[1]] ? 0 : 1)" "$script"; then
  echo "skip: no \"$script\" script in package.json"
  exit 0
fi

# Expo apps: the first `expo lint` installs ESLint and changes package.json, which is the team's decision, not a check
if [ "$script" = lint ] && node -e "process.exit(/^expo lint/.test(require('./package.json').scripts.lint) ? 0 : 1)" &&
  [ -z "$(ls eslint.config.* .eslintrc* 2> /dev/null)" ]; then
  echo "skip: lint: ESLint isn't set up yet. Run npx expo lint once (it installs ESLint) and commit what it adds"
  exit 0
fi
# Expo apps: `expo start` writes expo-env.d.ts (gitignored) with the types of Expo's CSS and asset imports.
# Fresh clones and CI haven't run it, so write the same file.
if [ "$script" = typecheck ] && [ ! -f expo-env.d.ts ] && grep -q 'expo-env\.d\.ts' tsconfig.json 2> /dev/null; then
  printf '/// <reference types="expo/types" />\n\n// NOTE: This file should not be edited and should be in your git ignore' > expo-env.d.ts
fi

if [ -f yarn.lock ]; then yarn run "$script" "$@" # works on Yarn 1 and Yarn Berry
elif [ -f pnpm-lock.yaml ]; then pnpm -s "$script" "$@"
elif [ -f bun.lock ] || [ -f bun.lockb ]; then bun run "$script" "$@"
else npm run -s "$script" -- "$@"
fi
