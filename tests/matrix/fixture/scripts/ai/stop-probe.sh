#!/bin/sh
# Probe stop hook: records that the agent's end-of-turn hook ran.
cat > /dev/null
mkdir -p .ai
printf '%s stop\n' "$(date +%H:%M:%S)" >> .ai/hook-log.txt
exit 0
