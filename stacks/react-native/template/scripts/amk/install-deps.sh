#!/bin/sh
# Installs JS dependencies exactly as locked, with the project's package manager.
set -eu
if [ -f yarn.lock ]; then
  corepack enable 2> /dev/null || true # needs admin rights on some Windows setups; yarn/pnpm may already be installed
  if [ -f .yarnrc.yml ]; then yarn install --immutable; else yarn install --frozen-lockfile; fi
elif [ -f pnpm-lock.yaml ]; then
  corepack enable 2> /dev/null || true # needs admin rights on some Windows setups; yarn/pnpm may already be installed
  pnpm install --frozen-lockfile
elif [ -f bun.lock ] || [ -f bun.lockb ]; then
  bun install --frozen-lockfile # ponytail: CI needs a setup-bun step for this branch
else
  npm ci || {
    echo "install-deps: npm ci failed. If it's a peer-dependency conflict (ERESOLVE) and your team installs with --legacy-peer-deps, commit legacy-peer-deps=true in .npmrc so every install, and CI, does the same." >&2
    exit 1
  }
fi
