#!/bin/sh
# Runs a package.json script with the project's package manager; skips quietly if the script doesn't exist.
# Usage: sh scripts/ai/pm-run.sh <script> [args…]
set -eu
script=$1; shift

if ! node -e "process.exit(require('./package.json').scripts?.[process.argv[1]] ? 0 : 1)" "$script"; then
  echo "skip: no \"$script\" script in package.json"
  exit 0
fi

if [ -f yarn.lock ]; then yarn run "$script" "$@" # works on Yarn 1 and Yarn Berry
elif [ -f pnpm-lock.yaml ]; then pnpm -s "$script" "$@"
elif [ -f bun.lock ] || [ -f bun.lockb ]; then bun run "$script" "$@"
else npm run -s "$script" -- "$@"
fi
