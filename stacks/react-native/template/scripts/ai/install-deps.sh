#!/bin/sh
# Installs JS dependencies exactly as locked, with the project's package manager.
set -eu
if [ -f yarn.lock ]; then
  corepack enable
  if [ -f .yarnrc.yml ]; then yarn install --immutable; else yarn install --frozen-lockfile; fi
elif [ -f pnpm-lock.yaml ]; then
  corepack enable
  pnpm install --frozen-lockfile
elif [ -f bun.lock ] || [ -f bun.lockb ]; then
  bun install --frozen-lockfile # ponytail: CI needs a setup-bun step for this branch
else
  npm ci
fi
