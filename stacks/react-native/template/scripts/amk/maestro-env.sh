# Sourced by verify.sh. Test logins and other values that Maestro flows read as ${MAESTRO_…} come from a local,
# gitignored .maestro/.env.local (or .maestro/.env), as KEY=value lines. Only MAESTRO_ keys are read: the values
# are never evaluated or printed, and a value already set in the shell wins. Maestro passes MAESTRO_ variables to flows.
# In a git worktree (Claude Code's .claude/worktrees/), which has no copy of a gitignored file, the main checkout's
# files come after its own.
amk_main=$(amk_git=$(git rev-parse --git-common-dir 2> /dev/null) && cd "$amk_git/.." && pwd -P) || amk_main=
[ "$amk_main" != "$(pwd -P)" ] || amk_main=
amk_read=
for amk_file in .maestro/.env.local .maestro/.env ${amk_main:+"$amk_main/.maestro/.env.local" "$amk_main/.maestro/.env"}; do
  [ -f "$amk_file" ] || continue
  amk_read=1
  while IFS= read -r amk_line || [ -n "$amk_line" ]; do
    amk_line=$(printf %s "$amk_line" | tr -d '\r')
    case $amk_line in MAESTRO_*=*) ;; *) continue ;; esac
    amk_key=${amk_line%%=*}
    amk_value=${amk_line#*=}
    case $amk_key in *[!A-Za-z0-9_]*) continue ;; esac
    [ -z "$(printenv "$amk_key")" ] || continue
    case $amk_value in
      \"*\") amk_value=${amk_value#\"}; amk_value=${amk_value%\"} ;;
      \'*\') amk_value=${amk_value#\'}; amk_value=${amk_value%\'} ;;
    esac
    export "$amk_key=$amk_value"
  done < "$amk_file"
done
# flows that use ${MAESTRO_…} values (a test login) with none to read fail at that step: say why first
if [ -z "$amk_read" ] && grep -rqs '\${MAESTRO_' .maestro 2> /dev/null; then
  echo "verify.sh: the flows use \${MAESTRO_…} values, but there's no .maestro/.env.local here${amk_main:+ or in the main checkout ($amk_main)}: steps that need them will fail" >&2
fi
unset amk_file amk_line amk_key amk_value amk_main amk_read
