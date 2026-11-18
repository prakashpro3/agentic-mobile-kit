#!/bin/sh
# Checks scripts/amk/guard.js against payload shapes from Claude Code, Codex and Antigravity.
# Run from the repo root: sh tests/guard.test.sh
cd "$(dirname "$0")/../stacks/react-native/template" || exit 1
# run inside a Claude Code session or not, the same results: Claude Code gets an approval prompt for some (below)
unset CLAUDECODE AMK_AUTOPILOT
fails=0
t() {
  printf '%s' "$2" | node scripts/amk/guard.js > /dev/null 2>&1; r=$?
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
# throwing away uncommitted work, stashes or unmerged commits; not one file's edit, a switch of branch or an unstage
for c in 'git checkout .' 'git checkout -- .' 'git checkout HEAD -- .' 'git checkout ./' 'git checkout :/' 'git checkout -f main' \
  'git checkout --force main' 'git restore .' 'git restore --worktree .' 'git restore -SW .' 'git restore --source=HEAD :/' \
  'git switch -f main' 'git switch --discard-changes main' 'git stash drop' 'git stash drop stash@{1}' 'git stash clear' \
  'git branch -D old' 'git branch -df old' 'git branch --delete --force old' 'git add -A && git checkout .'; do
  t 2 "{\"tool_input\":{\"command\":\"$c\"}}" "blocked: $c"
done
for c in 'git checkout main' 'git checkout -b feature/x' 'git checkout -- src/App.tsx' 'git restore src/App.tsx' \
  'git restore --staged .' 'git restore -S .' 'git switch main' 'git stash' 'git stash pop' 'git stash list' \
  'git branch -d old' 'git branch -f main origin/main' 'git branch -m old new' 'git status .' 'git checkout main && ls .'; do
  t 0 "{\"tool_input\":{\"command\":\"$c\"}}" "allowed: $c"
done
r=$(printf '%s' '{"tool_input":{"command":"git checkout ."}}' | node scripts/amk/guard.js 2>&1)
case $r in *"Ask the user first, or keep the work: git stash, or a commit"*) echo "ok   says what to do instead" ;; *) echo "FAIL discard message: $r"; fails=$((fails + 1)) ;; esac
# text that's only searched for, printed, written as a commit message or a file, or a look whether a secret file is
# there: not run, so not blocked
for c in 'grep -n \"rm -rf\" docs/notes.md' 'rg -- \"--no-verify\" docs' 'grep -n \"git checkout .\\\\|locks=\" scripts/amk/verify.sh' \
  'git commit -m \"guard: blocks rm -rf\"' 'git commit -m \"no --no-verify here\" -q' 'ls .maestro/.env.local' \
  'test -f .maestro/.env.local && echo yes' '[ -f .env ] || echo none' 'cat > notes.md <<\u0027EOF\u0027\nnever rm -rf, never --no-verify, never cat .env\nEOF'; do
  t 0 "{\"tool_input\":{\"command\":\"$c\"}}" "allowed: $c"
done
# but not when the text is run after all: handed to a shell, inside $( ), code in a heredoc, a flag in quotes, or read
for c in 'echo \"rm -rf x\" | sh' 'grep \"$(rm -rf x)\" f' 'git commit -m \"$(rm -rf x)\"' 'git commit \"--no-verify\" -m x' \
  'python3 - <<\u0027EOF\u0027\nimport os; os.system(\"rm -rf x\")\nEOF' 'bash <<\u0027EOF\u0027\nrm -rf x\nEOF' \
  'test -f .env && cat .env' 'grep -r KEY .env.local' 'echo \"git checkout .\" | bash'; do
  t 2 "{\"tool_input\":{\"command\":\"$c\"}}" "blocked: $c"
done
# git reset --hard and --no-verify, which the rules say to ask about first: Claude Code asks the developer; an
# unattended build, and the other tools, block them
cc='{"tool_name":"Bash","transcript_path":"/u/.claude/projects/p/s.jsonl","tool_input":{"command":"git reset --hard origin/main"}}'
r=$(printf '%s' "$cc" | node scripts/amk/guard.js 2>/dev/null); code=$?
case "$code $r" in *'0 '*'"permissionDecision":"ask"'*'throws away every uncommitted change'*) echo "ok   Claude Code: reset --hard asks the developer" ;; *) echo "FAIL ask: $code $r"; fails=$((fails + 1)) ;; esac
t 0 '{"transcript_path":"/u/.claude/projects/p/s.jsonl","tool_input":{"command":"git commit --no-verify -m x"}}' "Claude Code: --no-verify asks (exit 0)"
r=$(printf '%s' "$cc" | AMK_AUTOPILOT=1 node scripts/amk/guard.js 2>/dev/null); code=$?
[ "$code" = 2 ] && [ -z "$r" ] && echo "ok   unattended build: reset --hard blocked" || { echo "FAIL unattended: $code $r"; fails=$((fails + 1)); }
t 2 '{"transcript_path":"/u/.claude/projects/p/s.jsonl","tool_input":{"command":"git reset --hard && rm -rf build"}}' "Claude Code: an ask with a block is blocked"
r=$(printf '%s' '{"tool_input":{"command":"git commit -m \"$(rm -rf x)\""}}' | node scripts/amk/guard.js 2>&1)
case $r in *'git commit -F <file>'*) echo "ok   says how to commit a message that runs a command" ;; *) echo "FAIL commit message hint: $r"; fails=$((fails + 1)) ;; esac
# the project's own secret files, from .amk-secrets (in a copy of a project, as the guard reads it from the project
# it's in), also when the agent has moved into a subfolder
d=$(mktemp -d) && mkdir -p "$d/scripts/amk" "$d/android" && cp scripts/amk/guard.js "$d/scripts/amk/" && printf '# tokens\nconfig/token.json\nsecrets/\n' > "$d/.amk-secrets"
s() { printf '%s' "$2" | (cd "$d/$4" && node "$d/scripts/amk/guard.js" 2>/dev/null); r=$?; if [ "$r" = "$1" ]; then echo "ok   $3"; else echo "FAIL $3 (exit $r, want $1)"; fails=$((fails + 1)); fi; }
s 2 '{"tool_input":{"command":"cat config/token.json"}}' ".amk-secrets: a listed file"
s 2 '{"tool_input":{"file_path":"/repo/secrets/play.json"}}' ".amk-secrets: a file in a listed folder"
s 0 '{"tool_input":{"command":"cat config/app.json"}}' ".amk-secrets: other files allowed"
s 2 '{"tool_input":{"command":"cat ../config/token.json"}}' ".amk-secrets: from a subfolder" android
rm -r "$d"
[ "$fails" = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
