#!/bin/sh
# Copies the probe fixture into a fresh temp project and generates tool configs with pinned rulesync.
# Prints the temp project path; delete it when you're done testing.
set -eu
RULESYNC_VERSION=27.0.0
here=$(cd "$(dirname "$0")" && pwd)
# outside $HOME, so npm never treats a home-level .npmrc as project config
dir=$(mktemp -d "${TMPDIR:-/tmp}/amk-matrix.XXXXXX")
cp -R "$here/fixture/." "$dir/"
cd "$dir"
mkdir -p .claude tmp-probe
ln -s ../.agents/skills .claude/skills
printf 'PROBE_SECRET=CEDAR-5583\n' > .env
printf '.env\n.amk/\n' > .gitignore
git init -q
git add -A
git -c user.name=probe -c user.email=probe@example.invalid commit -qm fixture
npx -y "rulesync@$RULESYNC_VERSION" generate > .amk-rulesync.log 2>&1
echo "$dir"
echo "Delete it when you're done: rm -r $dir" >&2
