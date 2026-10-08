#!/bin/sh
# Checks scripts/ai/guard.js against payload shapes from Claude Code, Codex and Antigravity.
# Run from the repo root: sh tests/guard.test.sh
cd "$(dirname "$0")/../stacks/react-native/template" || exit 1
fails=0
t() {
  printf '%s' "$2" | node scripts/ai/guard.js 2>/dev/null; r=$?
  if [ "$r" = "$1" ]; then echo "ok   $3"; else echo "FAIL $3 (exit $r, want $1)"; fails=$((fails + 1)); fi
}
t 2 '{"tool_name":"Bash","tool_input":{"command":"rm -rf build"}}' "Claude: rm -rf"
t 2 '{"tool_input":{"command":["bash","-lc","rm -r -f ./x"]}}' "Codex: rm -r -f (array)"
t 2 '{"tool_info":{"parameters":{"CommandLine":"git reset --hard"}}}' "Antigravity: git reset --hard"
t 2 '{"tool_input":{"command":"git push origin main --force"}}' "git push --force"
t 2 '{"tool_input":{"command":"git commit -m x --no-verify"}}' "--no-verify"
t 2 '{"tool_input":{"command":"cat .env"}}' "cat .env"
t 2 '{"tool_input":{"command":"grep KEY .env.production"}}' ".env.production"
t 2 '{"tool_input":{"file_path":"/repo/.env"}}' "read .env by path"
t 2 '{"tool_info":{"parameters":{"AbsolutePath":"/repo/android/app/release.keystore"}}}' "keystore path"
t 0 '{"tool_input":{"command":"cat .env.example"}}' ".env.example allowed"
t 0 '{"tool_input":{"command":"yarn test"}}' "yarn test allowed"
t 0 '{"tool_input":{"command":"rm build/tmp.txt"}}' "plain rm allowed"
t 0 '{"tool_input":{"file_path":"/repo/AGENTS.md","content":"Never read .env files or run rm -rf"}}' "text mentioning .env allowed"
t 0 '{"tool_input":{"command":"git push origin feature/x"}}' "normal push allowed"
[ "$fails" = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
