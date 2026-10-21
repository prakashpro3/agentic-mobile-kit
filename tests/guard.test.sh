#!/bin/sh
# Checks scripts/amk/guard.js against payload shapes from Claude Code, Codex and Antigravity.
# Run from the repo root: sh tests/guard.test.sh
cd "$(dirname "$0")/../stacks/react-native/template" || exit 1
fails=0
t() {
  printf '%s' "$2" | node scripts/amk/guard.js 2>/dev/null; r=$?
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
t 0 '{"tool_input":{"command":"cat .maestro/.env.local.example"}}' ".env.local.example allowed"
t 0 '{"tool_input":{"file_path":"/repo/.env.sample"}}' ".env.sample allowed"
t 2 '{"tool_input":{"command":"cat .env.local"}}' ".env.local blocked"
t 0 '{"tool_input":{"command":"yarn test"}}' "yarn test allowed"
t 0 '{"tool_input":{"command":"rm build/tmp.txt"}}' "plain rm allowed"
t 0 '{"tool_input":{"file_path":"/repo/AGENTS.md","content":"Never read .env files or run rm -rf"}}' "text mentioning .env allowed"
t 0 '{"tool_input":{"command":"git push origin feature/x"}}' "normal push allowed"
# every way of writing a recursive, forced rm, and every force push
for c in 'rm -Rf dir' 'rm -fR dir' 'rm -fr dir' 'rm -r -f dir' 'rm --recursive --force dir' 'rm dir -rf' 'cd x && /bin/rm -rf y' \
  'git push --force' 'git push -f origin main' 'git push origin main --force-with-lease' 'git push origin +main'; do
  t 2 "{\"tool_input\":{\"command\":\"$c\"}}" "blocked: $c"
done
for c in 'rm -r build' 'rm -f build.log' 'git rm --cached -q file' 'rm -r build && ls -f' 'npm run lint -- --fix' 'git push origin main'; do
  t 0 "{\"tool_input\":{\"command\":\"$c\"}}" "allowed: $c"
done
# a commit message that mentions one is blocked, and says how to commit it
r=$(printf '%s' '{"tool_input":{"command":"git commit -m \"guard: blocks rm -rf\""}}' | node scripts/amk/guard.js 2>&1)
case $r in *'git commit -F <file>'*) echo "ok   says how to commit a message that mentions one" ;; *) echo "FAIL commit message hint: $r"; fails=$((fails + 1)) ;; esac
# the project's own secret files, from .amk-secrets (in a copy, as the guard reads it from the project root)
d=$(mktemp -d) && cp scripts/amk/guard.js "$d/" && printf '# tokens\nconfig/token.json\nsecrets/\n' > "$d/.amk-secrets"
s() { printf '%s' "$2" | (cd "$d" && node guard.js 2>/dev/null); r=$?; if [ "$r" = "$1" ]; then echo "ok   $3"; else echo "FAIL $3 (exit $r, want $1)"; fails=$((fails + 1)); fi; }
s 2 '{"tool_input":{"command":"cat config/token.json"}}' ".amk-secrets: a listed file"
s 2 '{"tool_input":{"file_path":"/repo/secrets/play.json"}}' ".amk-secrets: a file in a listed folder"
s 0 '{"tool_input":{"command":"cat config/app.json"}}' ".amk-secrets: other files allowed"
rm -r "$d"
[ "$fails" = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
