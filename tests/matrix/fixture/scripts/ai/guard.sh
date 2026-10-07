#!/bin/sh
# Probe guard: blocks destructive shell commands for any agent tool.
# The hook payload format differs per tool, so match on its raw text.
payload=$(cat)
mkdir -p .ai
printf '%s pre-tool-use\n' "$(date +%H:%M:%S)" >> .ai/hook-log.txt
case "$payload" in
  *"git reset --hard"*|*"rm -rf"*|*"rm -r -f"*|*"rm -fr"*|*"git push --force"*|*"git push -f"*|*"git clean -f"*)
    printf '%s blocked\n' "$(date +%H:%M:%S)" >> .ai/hook-log.txt
    echo "BLOCKED-BY-GUARD: destructive command" >&2
    exit 2 ;;
esac
exit 0
