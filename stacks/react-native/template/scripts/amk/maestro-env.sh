# Sourced by verify.sh. Test logins and other values that Maestro flows read as ${MAESTRO_…} come from a local,
# gitignored .maestro/.env.local (or .maestro/.env), as KEY=value lines. Only MAESTRO_ keys are read: the values
# are never evaluated or printed, and a value already set in the shell wins. Maestro passes MAESTRO_ variables to flows.
for amk_file in .maestro/.env.local .maestro/.env; do
  [ -f "$amk_file" ] || continue
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
unset amk_file amk_line amk_key amk_value
