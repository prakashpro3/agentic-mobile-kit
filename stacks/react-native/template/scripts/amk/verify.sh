#!/bin/sh
# Checks the app the way a user would: lint, typecheck and tests, then release builds on the iOS simulator
# and Android emulator, running Maestro flows and saving screenshots as evidence. Apps that support tablets or
# landscape (scripts/amk/screens.js) are checked on each: an iPad simulator and a tablet emulator, and turned.
#
# Usage: sh scripts/amk/verify.sh [quick|ios|android|all|build|plan] [--spec <id>] [--flow <file>] [--label <name>]
#                                [--flavor <name>] [--scheme <name>] [--screens <list>] [--no-build]
#   quick           lint, typecheck, tests
#   ios|android     release build, install, run flows, screenshots
#   all             everything (default)
#   build           the release builds only, iOS and Android at the same time, for --no-build checks after it
#   plan            whether this machine can check the devices at the same time, and the commands to run
#   --spec <id>     run .maestro/<id>*.yaml and save evidence in .amk/evidence/<id>/
#   --label <n>     evidence folder name (default: the spec id, or no-spec)
#   --flavor <name> Android product flavor to check (default: the first one in build.gradle)
#   --scheme <name> iOS scheme to check (default: the one named like the workspace)
#   --screens <l>   only these of the screens the app supports, comma-separated: phone, tablet, portrait,
#                   landscape, or one such as tablet-landscape
#   --no-build      check the last build instead of building again (after `build`)
#   (no flows found: a smoke check that launches the app and takes a screenshot)
#   Evidence per screen: ios/ and android/ (phone, portrait), then -landscape/, -tablet/ and -tablet-landscape/, each
#   with its latest run only (the device's own log only for a flow that failed); the newest 5 evidence folders stay,
#   and every prototype's
# Env: AMK_ANDROID_FLAVOR, AMK_IOS_SCHEME, AMK_SCREENS (defaults for the options), AMK_IOS_DEVICE (simulator name
#      or UDID, or a connected iPhone's or iPad's: the only way to check on one, whose app data the flows clear),
#      AMK_ANDROID_DEVICE (adb serial: the only way to check on a phone, whose app data the flows clear),
#      AMK_ANDROID_AVD (the emulator to use, started if it isn't running; other devices are left alone),
#      AMK_IOS_TABLET (iPad simulator, or a connected iPad: name or UDID), AMK_ANDROID_TABLET_AVD (tablet emulator),
#      AMK_ANDROID_TABLET (serial), AMK_IOS_TEAM (the Apple team ID that signs builds for real iPhones and iPads;
#      default: the project's), AMK_PARALLEL (1 or 0: overrides plan's choice), AMK_DEVICE_WAIT (minutes to wait for a
#      device in use, 30), AMK_LOCK_DIR (where runs on this machine claim devices; /tmp/agentic-mobile-kit-<user id>),
#      AMK_EVIDENCE_KEEP (how many evidence folders stay, newest first: 5; 0 keeps them all)
# A device in use by another run (any project on this machine) is skipped for a free one of the same kind, or waited
# for when it was named or none is free.
# Real iPhones and iPads (iOS 17 or later): Maestro doesn't run on them, so their flows run through maestro-runner, with
# WebDriverAgent signed by the same team. The app is opened once first, and crash reports it leaves join the evidence.
# Flows that log in read ${MAESTRO_EMAIL} and the like from a local, gitignored .maestro/.env.local (never committed).
set -eu

mode=${1:-all}
[ $# -gt 0 ] && shift
args=$* # for the commands plan prints
spec=""
flow=""
label=""
flavor=${AMK_ANDROID_FLAVOR:-}
only=${AMK_SCREENS:-}
no_build=0
build_only=0
while [ $# -gt 0 ]; do
  case $1 in
    --spec) spec=$2; shift 2 ;;
    --flow) flow=$2; shift 2 ;;
    --label) label=$2; shift 2 ;;
    --flavor) flavor=$2; shift 2 ;;
    --scheme) AMK_IOS_SCHEME=$2; export AMK_IOS_SCHEME; shift 2 ;;
    --screens) only=$2; shift 2 ;;
    --no-build) no_build=1; shift ;;
    *) echo "verify: unknown option $1"; exit 2 ;;
  esac
done

root=$(pwd)
. scripts/amk/maestro-env.sh
# runs without a spec or a label (verify.sh quick, mostly) share one folder, so they don't push out a feature's
evidence="$root/.amk/evidence/${label:-${spec:-no-spec}}"
mkdir -p "$evidence"
# Evidence stays on this machine (.amk/ is out of git): the newest AMK_EVIDENCE_KEEP folders stay, this one among
# them, and older ones go (5; 0 keeps them all). A prototype's folder (<id>-prototype, material for a demo) always
# stays and isn't counted
touch "$evidence"
keep=${AMK_EVIDENCE_KEEP:-5}
if [ "$keep" -gt 0 ] 2> /dev/null; then
  old=$(ls -dt "$root"/.amk/evidence/*/ 2> /dev/null | grep -v -- '-prototype/$' | tail -n +$((keep + 1)))
  if [ -n "$old" ]; then
    echo "$old" | while IFS= read -r d; do rm -r "${d:?}" || true; done
    echo "evidence: removed $(echo "$old" | wc -l | tr -d ' ') older folders from .amk/evidence, keeping the newest $keep (AMK_EVIDENCE_KEEP sets how many; 0 keeps them all)"
  fi
fi
status=0

flow_files() {
  if [ -n "$flow" ]; then echo "$root/$flow"
  elif [ -n "$spec" ]; then find "$root/.maestro" -maxdepth 1 -iname "$spec*.yaml" 2>/dev/null | sort
  else find "$root/.maestro" -maxdepth 1 -name '*.yaml' 2>/dev/null | sort
  fi
}

# the screens to check on a platform: the ones the app supports, narrowed by --screens
screens_for() {
  for s in $(node scripts/amk/screens.js "$1"); do
    [ -n "$only" ] || { echo "$s"; continue; }
    for w in $(echo "$only" | tr ',' ' '); do
      case $s in "$w" | "$w"-* | *-"$w") echo "$s"; break ;; esac
    done
  done
}

# Maestro's version (the first lines may be an update notice), and whether it's at least $1
maestro_version() { maestro --version 2> /dev/null | tail -n 1 | tr -d '\r '; }
maestro_at_least() { [ "$(printf '%s\n%s\n' "$1" "$(maestro_version)" | sort -V | head -n 1)" = "$1" ]; }

# Locks shared by every project and agent on this machine, so two runs never use one device (or build one project)
# at once: a run claims a device by creating a folder named after it, and gives it back when it's done with it. A
# claim whose run ended without giving it back is taken over.
locks=${AMK_LOCK_DIR:-/tmp/agentic-mobile-kit-$(id -u 2> /dev/null || echo 0)}
mkdir -p "$locks" 2> /dev/null || true
project=$(printf %s "$root" | cksum | cut -d ' ' -f 1)
held=""
lock_path() { echo "$locks/$(printf %s "$1" | tr -c 'A-Za-z0-9._-' _)"; }
# whether a Maestro run started outside the kit is using device $1 (its command line names the device)
maestro_on() { ps -ax -o command 2> /dev/null | grep -E -- "--(device|udid)[ =]$1( |$)" | grep -q maestro; }
# claims $1 for this run; with a device ID in $2, also when no other Maestro run is using that device
claim() {
  l=$(lock_path "$1")
  if mkdir "$l" 2> /dev/null; then
    printf '%s\n%s\n%s\n' "$$" "$(basename "$root") (${label:-${spec:-$mode}})" "$(date +%H:%M)" > "$l/owner"
    held="$held $l"
    if [ -n "${2:-}" ] && maestro_on "$2"; then unclaim "$1"; return 1; fi
    return 0
  fi
  owner=$(sed -n 1p "$l/owner" 2> /dev/null || true)
  [ "$owner" != "$$" ] || return 0 # this run holds it already
  # its run ended, or was stopped before it could say who it was
  if { [ -n "$owner" ] && ! kill -0 "$owner" 2> /dev/null; } || { [ -z "$owner" ] && [ -n "$(find "$l" -maxdepth 0 -mmin +1 2> /dev/null)" ]; }; then
    rm -f "$l/owner"
    rmdir "$l" 2> /dev/null && { claim "$@"; return; }
  fi
  return 1
}
unclaim() { l=$(lock_path "$1"); rm -f "$l/owner"; rmdir "$l" 2> /dev/null || true; held=$(echo "$held" | sed "s| $l||"); }
release() { for l in $held; do rm -f "$l/owner"; rmdir "$l" 2> /dev/null || true; done; held=""; }
trap release EXIT
trap 'exit 130' INT TERM
holder() {
  l=$(lock_path "$1")
  if [ -f "$l/owner" ]; then echo "$(sed -n 2p "$l/owner") since $(sed -n 3p "$l/owner")"; else echo "another Maestro run"; fi
}
# claims $1 as claim does, waiting while it's in use (AMK_DEVICE_WAIT minutes, 30 by default); $3 names it in messages
claim_wait() {
  claim "$1" "${2:-}" && return 0
  echo "  waiting for $3: in use by $(holder "$1")"
  waited=0
  until claim "$1" "${2:-}"; do
    [ "$waited" -lt $((${AMK_DEVICE_WAIT:-30} * 60)) ] || { echo "  gave up waiting for $3 after ${AMK_DEVICE_WAIT:-30} minutes"; return 1; }
    sleep 5
    waited=$((waited + 5))
  done
}

run_flow() { # screen device app_id file name orientation
  # Maestro's own logs, which have errors its output leaves out: of this flow's latest run only (each run adds a folder
  # of its own), as an earlier run's screenshots aren't this run's evidence
  debug="$evidence/maestro-logs/$1-$5"
  [ ! -d "$debug" ] || rm -r "$debug"
  mkdir -p "$debug" "$out/screenshots"
  target=$4
  # Maestro reads the path in the flows below itself, so it's a native path (a Windows path in Git Bash)
  native=$(cd "$(dirname "$4")" && { pwd -W 2> /dev/null || pwd; })/$(basename "$4")
  if is_real "$2"; then
    # on a real device every flow runs inside one, first: the first launchApp maestro-runner finds in a flow decides
    # whether it answers alerts itself, and for most it does (for permission prompts, which it can't allow ahead),
    # pressing the last button of the app's own alerts too, such as a Delete. Maestro never answers an app's alerts.
    # So one that says to leave permissions alone comes first, where it never runs (on Android only)
    on_complete="" turn=""
    if [ "$6" != PORTRAIT ]; then
      # WebDriverAgent turns the device, then fails the step unless the app in front turned too: here the home
      # screen, which most iPhones never turn. Whether the app turned shows in its screenshots. It knows
      # LANDSCAPE_LEFT only as "landscape"
      on_complete='onFlowComplete:\n  - setOrientation:\n      orientation: PORTRAIT\n      optional: true\n'
      turn='- setOrientation:\n    orientation: landscape\n    optional: true\n'
    fi
    printf "appId: %s\n${on_complete}---\n- runFlow:\n    when:\n      platform: Android\n    commands:\n      - launchApp:\n          permissions:\n            all: unset\n${turn}- runFlow: '%s'\n" "$3" "$native" > "$debug/screen.yaml"
    target=$debug/screen.yaml
  elif [ "$6" != PORTRAIT ]; then
    # a turned screen: the flow runs inside one that turns the device first and back to portrait after
    printf "appId: %s\nonFlowComplete:\n  - setOrientation: PORTRAIT\n---\n- setOrientation: %s\n- runFlow: '%s'\n" "$3" "$6" "$native" > "$debug/screen.yaml"
    target=$debug/screen.yaml
  fi
  rc=0
  if is_real "$2"; then
    # it also saves each named screenshot next to its flow file: the ones it makes there move to its log folder, so
    # the project stays as it was (they're in its report too)
    pngs() { find "$(dirname "$4")" \( -path "$root/.amk" -o -name node_modules \) -prune -o -name '*.png' -print | sort; }
    pngs "$@" > "$debug/.pngs"
    # with the app's build: on a real device, clearState installs the app again
    MAESTRO_RUNNER_NO_TELEMETRY=1 DO_NOT_TRACK=1 npx -y "$runner" --platform ios --driver wda --device "$2" \
      --team-id "$team" --wda-bundle-id "$3.wda" --app-file "$device_app" test -e APP_ID="$3" --output "$debug" \
      --flatten "$target" > "$out/$5.log" 2>&1 || rc=$?
    pngs "$@" | comm -13 "$debug/.pngs" - | while IFS= read -r f; do mv "$f" "$debug/"; done
    # its takeScreenshot files, not the ones of a step that failed (<step>-after.png)
    find "$debug" -path '*/assets/*.png' ! -name '*-[0-9][0-9][0-9]-after.png' -exec cp {} "$out/screenshots/" \;
    return $rc
  fi
  # screenshots use relative names: older Maestro saves them in the current folder, then in --test-output-dir, and
  # from 2.7 in the debug output under <flow>/takeScreenshot/, from where they join the screen's evidence
  (cd "$out" && maestro --device "$2" test --test-output-dir "$out" --debug-output "$debug" --flatten-debug-output \
    -e APP_ID="$3" "$target" > "$out/$5.log" 2>&1) || rc=$?
  find "$debug" -path '*/takeScreenshot/*.png' -exec cp {} "$out/screenshots/" \;
  return $rc
}

run_flows() { # screen device app_id orientation (PORTRAIT, or LANDSCAPE_LEFT to turn it) [again]
  out="$evidence/$1"
  # the screen's latest run only: an earlier run's screenshots aren't this run's evidence
  [ -n "${5:-}" ] || [ ! -d "$out" ] || rm -r "$out"
  mkdir -p "$out"
  # this run's screenshots are the ones newer than this; the status before it, for running the screen again
  : > "$out/.started"
  [ -n "${5:-}" ] || before=$status
  files=$(flow_files)
  if [ -z "$files" ]; then
    # launchApp returns before the app has drawn, and a splash screen stays up until the JavaScript has loaded:
    # a fixed wait (for text that never appears), then for the screen to settle, so the screenshot shows the app
    printf 'appId: %s\n---\n- launchApp\n- extendedWaitUntil:\n    visible: "agentic-mobile-kit: waiting for the app to draw"\n    timeout: 5000\n    optional: true\n- waitForAnimationToEnd\n- takeScreenshot: smoke-launch\n' "$3" > "$out/smoke.yaml"
    files="$out/smoke.yaml"
  fi
  passed=0
  total=0
  for f in $files; do
    total=$((total + 1))
    name=$(basename "$f" .yaml)
    ok=0
    run_flow "$1" "$2" "$3" "$f" "$name" "$4" || ok=$?
    # Maestro now and then stops before a flow starts (it printed nothing), and an emulator sometimes drops its adb
    # connection for a moment: run the flow once more (after reconnecting)
    if [ "$ok" != 0 ] && [ ! -s "$out/$name.log" ]; then
      echo "  $1: Maestro stopped before flow $name started; running it once more"
      ok=0
      run_flow "$1" "$2" "$3" "$f" "$name" "$4" || ok=$?
    elif [ "$ok" != 0 ] && [ "${1%%-*}" = android ] && grep -qs 'device offline' "$debug/maestro.log"; then
      echo "  $1: the device went offline during flow $name; running it once more"
      "$adb" reconnect offline > /dev/null 2>&1 || true
      android_ready "$2" || true
      ok=0
      run_flow "$1" "$2" "$3" "$f" "$name" "$4" || ok=$?
    elif [ "$ok" != 0 ] && is_real "$2" && grep -qs 'explicitly trusted' "$out/$name.log"; then
      # as launch_check found it does: here after clearState installed the app again, which it opened a moment later
      echo "  $1: the device didn't open the app it had just installed again; running flow $name once more"
      sleep 15
      ok=0
      run_flow "$1" "$2" "$3" "$f" "$name" "$4" || ok=$?
    fi
    if [ "$ok" = 0 ]; then
      passed=$((passed + 1))
      # the device's own log (the simulator's or the emulator's, up to 25 MB a run) helps only with a failure
      find "$debug" -path '*/logs/device-*' -type f -exec rm -f {} +
    elif is_real "$2"; then
      echo "  $1: flow $name failed, see ${out#"$root"/}/$name.log and maestro-runner's own log ${debug#"$root"/}/maestro-runner.log"
      status=1
    else
      echo "  $1: flow $name failed, see ${out#"$root"/}/$name.log and Maestro's own log ${debug#"$root"/}/maestro.log"
      status=1
    fi
  done
  # iOS saves a turned screen's screenshots at the device's upright size, with a tag that tells viewers to turn them,
  # and some viewers ignore it: save them turned (through BMP, which keeps no tag), so every viewer shows the screen
  case $1 in
    ios*-landscape) find "$out" -name '*.png' | while read -r png; do
        sips -s format bmp "$png" --out "$png.bmp" > /dev/null && sips -s format png "$png.bmp" --out "$png" > /dev/null
        rm -f "$png.bmp"
      done ;;
  esac
  # a screen checked in the wrong orientation would pass for another screen: a turned one's screenshots are wider than
  # tall, an upright one's taller than wide. A device that didn't turn usually does the next time
  case $1 in *-landscape) want=wide was=upright ;; *) want=tall was=turned ;; esac
  wrong=$(find "$out" -name '*.png' -newer "$out/.started" | WANT=$want node -e '
    const fs = require("fs");
    for (const f of fs.readFileSync(0, "utf8").split("\n").filter(Boolean)) {
      const b = Buffer.alloc(24), fd = fs.openSync(f, "r");
      fs.readSync(fd, b, 0, 24, 0);
      fs.closeSync(fd);
      if ((b.readUInt32BE(16) > b.readUInt32BE(20)) !== (process.env.WANT === "wide")) console.log(f);
    }' | wc -l | tr -d ' ')
  if [ "$wrong" != 0 ] && [ -z "${5:-}" ]; then
    echo "  $1: $wrong screenshots show the screen $was, not as this screen needs; running its flows once more"
    find "$out" -name '*.png' -newer "$out/.started" -exec rm -f {} +
    status=$before
    run_flows "$1" "$2" "$3" "$4" again
    return
  fi
  shots=$(find "$out" -name '*.png' | wc -l | tr -d ' ')
  echo "$1: flows $passed/$total passed, $shots screenshots in ${out#"$root"/}"
  if [ "$shots" = 0 ]; then
    echo "  $1: no screenshots were saved, so there's no evidence; treating this as a failure"
    status=1
  elif [ "$wrong" != 0 ]; then
    echo "  $1: $wrong screenshots show the screen $was: the device or the app didn't turn, so this screen isn't checked; treating this as a failure"
    status=1
    # an app that sets its orientation in code (an orientation library, or native code) can keep it although its native
    # settings allow turning: where it does, so the team can say which is right
    set_in=$(git grep -l -E 'lockTo(Portrait|Landscape)|OrientationLock\.|lockPlatformAsync|setRequestedOrientation|supportedInterfaceOrientationsFor' \
      -- ':!scripts/amk' ':!*.md' 2> /dev/null | head -n 3 | tr '\n' ' ')
    if [ -n "$set_in" ]; then
      case $was in upright) other=landscape ;; *) other=portrait ;; esac
      echo "  $1: the app sets its orientation in its code (${set_in% }), which can keep it $was. If it's meant to stay $was, take $other out of its native settings (UISupportedInterfaceOrientations in Info.plist, screenOrientation in AndroidManifest.xml) and this screen isn't checked any more; otherwise change that code"
    fi
  fi
}

# runs the flows on each screen given: the phone upright into <platform>/, then <platform>-landscape/,
# <platform>-tablet/ and <platform>-tablet-landscape/
check_screens() { # platform phone tablet app_id screens…
  p=$1 phone=$2 tab=$3 id=$4
  shift 4
  # before 2.6, two Maestro runs clash even on different devices (one port): checks on this machine take turns
  if ! maestro_at_least 2.6.0; then
    claim_wait maestro "" "Maestro (before 2.6 it runs one check at a time on this machine)" || { status=1; return; }
  fi
  for screen in "$@"; do
    case $screen in
      tablet-*) [ -n "$tab" ] || continue; on=$tab where=$p-tablet ;;
      *) [ -n "$phone" ] || continue; on=$phone where=$p ;;
    esac
    # Maestro turns an Android device from its natural orientation, which on most tablets is landscape
    upright=PORTRAIT turned=LANDSCAPE_LEFT
    if [ "$p" = android ] && "$adb" -s "$on" shell wm size 2> /dev/null |
      awk -F'[: x]+' '/Physical size/ { found = 1; wide = $3 + 0 > $4 + 0 } END { exit !(found && wide) }'; then
      upright=LANDSCAPE_LEFT turned=PORTRAIT
    fi
    case $screen in *-landscape) turn=$turned where=$where-landscape ;; *) turn=$upright ;; esac
    # Maestro turns devices from 2.0 on, and taps the right place on a turned iPad from 2.3 (real ones: maestro-runner)
    need=2.0.0
    case $where in ios-tablet*) need=2.3.0 ;; esac
    if [ "$turn" != PORTRAIT ] && ! is_real "$on" && ! maestro_at_least $need; then
      echo "$where: not checked: turning the device needs Maestro ${need%.0} or later (this is $(maestro_version))"
      continue
    fi
    run_flows "$where" "$on" "$id" "$turn"
  done
  release # this platform's devices, and Maestro's turn, for other runs
}

quick() {
  # each one passes when the app's script passes, or when all its failures were already on the base branch
  if node scripts/amk/baseline.js lint > "$evidence/lint.log" 2>&1 &&
    node scripts/amk/baseline.js typecheck > "$evidence/typecheck.log" 2>&1 &&
    node scripts/amk/baseline.js test > "$evidence/test.log" 2>&1; then
    echo "quick: lint, typecheck and tests passed"
    # what didn't run (no such script, or an Expo app without ESLint yet), and failures the base branch already had
    cat "$evidence/lint.log" "$evidence/typecheck.log" "$evidence/test.log" |
      sed -n -E -e 's/^skip: /  skipped: /p' -e 's/^(lint|typecheck|test): /  \1: /p'
  else
    echo "quick: FAILED, see the logs in ${evidence#"$root"/}"
    cat "$evidence/lint.log" "$evidence/typecheck.log" "$evidence/test.log" 2> /dev/null | sed -n -E '/^(lint|typecheck|test): /,/^[^ ]/p' | head -n 20
    status=1
  fi
}

ios() {
  # iOS builds need Xcode, so off a Mac "all" checks Android and says who has to check iOS
  if [ "$(uname -s)" != Darwin ]; then
    echo "ios: not checked here: iOS builds need a Mac with Xcode. A teammate with a Mac runs: sh scripts/amk/verify.sh ios${spec:+ --spec $spec}"
    [ "$mode" = ios ] && status=1
    return
  fi
  [ "$build_only" = 1 ] || command -v maestro > /dev/null || { echo "ios: Maestro isn't installed (https://maestro.dev)"; status=1; return; }
  if [ "$no_build" = 0 ]; then
    # Expo apps without native folders in git: generate ios/ first
    if ! sh scripts/amk/prebuild.sh ios > "$evidence/prebuild-ios.log" 2>&1; then
      echo "ios: expo prebuild FAILED, see ${evidence#"$root"/}/prebuild-ios.log"; status=1; return
    fi
    # pod install also generates React Native codegen files into ios/build/generated; a newer Podfile needs it again
    if [ ! -d ios/Pods ] || [ ! -d ios/build/generated ] || [ ios/Podfile -nt ios/Pods/Manifest.lock ]; then
      if ! sh scripts/amk/pod-install.sh > "$evidence/pod-install.log" 2>&1; then
        echo "ios: pod install FAILED, see ${evidence#"$root"/}/pod-install.log"; status=1; return
      fi
    fi
  fi
  # the simulators first, so they boot while Xcode builds. A real iPhone or iPad only when named, as the flows clear
  # the app's data on it
  device="" tablet=""
  if [ "$build_only" = 0 ]; then
    screens=$(screens_for ios)
    [ -n "$screens" ] || { echo "ios: none of the app's screens is $only"; return; }
    if echo "$screens" | grep -q '^phone-'; then
      take_simulator iPhone "${AMK_IOS_DEVICE:-}" || { status=1; return; }
      device=$taken
      if [ -z "$device" ]; then
        if [ -n "${AMK_IOS_DEVICE:-}" ]; then echo "ios: no simulator or connected iPhone or iPad has the name or UDID \"$AMK_IOS_DEVICE\""; else echo "ios: no iPhone simulator found (set AMK_IOS_DEVICE)"; fi
        status=1; return
      fi
    fi
    if echo "$screens" | grep -q '^tablet-'; then
      take_simulator iPad "${AMK_IOS_TABLET:-}" || { status=1; return; }
      tablet=$taken
      if [ -z "$tablet" ] && [ -n "${AMK_IOS_TABLET:-}" ]; then echo "ios: no simulator or connected iPad has the name or UDID \"$AMK_IOS_TABLET\""; status=1; return; fi
      [ -n "$tablet" ] || echo "ios: the app runs on iPad, but there's no iPad simulator, so iPads aren't checked (add one in Xcode, or set AMK_IOS_TABLET)"
    fi
    [ -n "$device$tablet" ] || return
    for d in $device $tablet; do
      if is_real "$d"; then echo "ios: checking on $d, a real device; the flows clear the app's data on it"
      else xcrun simctl boot "$d" 2> /dev/null || true; fi
    done
  else
    # the plan's build step: a build for each real device named too
    for n in "${AMK_IOS_DEVICE:-}" "${AMK_IOS_TABLET:-}"; do
      [ -z "$n" ] || [ -n "$(simulators iPhone "$n")" ] || { r=$(real_ios "$n"); [ -z "$r" ] || reals="$reals $r"; }
    done
  fi
  team=$(ios_team)
  if [ -n "$reals" ] && [ -z "$team" ]; then
    echo "ios: a real device runs only apps signed by an Apple team: set AMK_IOS_TEAM to your team ID (Xcode > Settings > Accounts lists them)"
    status=1; return
  fi
  sims=$build_only # whether to build for simulators: the plan's build step always does
  for d in $device $tablet; do is_real "$d" || sims=1; done
  # one build of this project at a time; a check without its own build waits for one that's under way
  claim_wait "build-ios-$project" "" "the iOS build of this project" || { status=1; return; }
  if [ "$no_build" = 0 ]; then
    if [ "$sims" = 1 ] && ! CONFIGURATION=Release sh scripts/amk/ios-build.sh > "$evidence/ios-build.log" 2>&1; then
      echo "ios: release build FAILED, see ${evidence#"$root"/}/ios-build.log"; status=1; return
    fi
    for d in $reals; do
      if ! CONFIGURATION=Release AMK_IOS_TEAM=$team sh scripts/amk/ios-build.sh device "$d" > "$evidence/ios-device-build.log" 2>&1; then
        echo "ios: release build for $d FAILED, see ${evidence#"$root"/}/ios-device-build.log"; status=1; return
      fi
    done
  fi
  unclaim "build-ios-$project"
  [ "$build_only" = 0 ] || { echo "ios: release build done"; return; }
  # the newest app: the scheme just built (another scheme's app may still be there from an earlier build)
  app=$(ls -dt ios/DerivedData/Build/Products/*-iphonesimulator/*.app 2> /dev/null | head -n 1)
  device_app=$(ls -dt "$root"/ios/DerivedData/Build/Products/*-iphoneos/*.app 2> /dev/null | head -n 1)
  a=$app
  [ "$sims" = 1 ] || a=$device_app
  if [ -z "$a" ] || { [ -n "$reals" ] && [ -z "$device_app" ]; }; then
    echo "ios: there's no build to check yet: run sh scripts/amk/verify.sh build first"; status=1; return
  fi
  app_id=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$a/Info.plist")
  for d in $device $tablet; do
    if is_real "$d"; then
      launch_check "$d" || { status=1; return; }
    else
      xcrun simctl bootstatus "$d" -b > /dev/null
      xcrun simctl install "$d" "$app"
    fi
  done
  check_screens ios "$device" "$tablet" "$app_id" $screens
  for d in $reals; do crash_reports "$d"; done
}

# the simulators for $1 (iPhone or iPad), best first: the one named in $2 (name or UDID); else the booted ones,
# then the others, newest iOS first
simulators() {
  xcrun simctl list devices available -j | KIND=$1 WANT=$2 node -e '
    const all = Object.entries(JSON.parse(require("fs").readFileSync(0, "utf8")).devices)
      .flatMap(([rt, ds]) => ds.map(d => ({ ...d, v: (rt.match(/iOS-(\d+)-(\d+)/) || []).slice(1).map(Number) })))
      .filter(d => d.v.length);
    const want = process.env.WANT;
    // by device type: a simulator can have any name, such as a separate one kept for tests
    const kind = all.filter(d => (d.deviceTypeIdentifier || d.name).includes(process.env.KIND))
      .sort((a, b) => (b.state === "Booted") - (a.state === "Booted") || b.v[0] - a.v[0] || b.v[1] - a.v[1]);
    const list = want ? all.filter(d => d.udid === want || d.name === want).slice(0, 1) : kind;
    console.log(list.map(d => d.udid).join("\n"));'
}
# a simulator for $1 (iPhone or iPad) that this run holds, in $taken: the one named in $2, once it's free; else the
# first free one; else the best one, once it's free. Empty when there's none. A name no simulator has can be a real
# device's
take_simulator() {
  taken=""
  candidates=$(simulators "$1" "$2")
  if [ -z "$candidates" ] && [ -n "$2" ]; then
    candidates=$(real_ios "$2")
    [ -z "$candidates" ] || reals="$reals $candidates"
  fi
  [ -n "$candidates" ] || return 0
  first=$(echo "$candidates" | head -n 1)
  if [ -z "$2" ]; then
    for u in $candidates; do claim "ios-$u" "$u" && { taken=$u; break; }; done
    [ -z "$taken" ] || [ "$taken" = "$first" ] || echo "ios: $first is in use by $(holder "ios-$first"), so checking on $taken"
  fi
  [ -n "$taken" ] || { claim_wait "ios-$first" "$first" "the $1 $first" || return 1; taken=$first; }
}

# Real iPhones and iPads, through Xcode's devicectl (iOS 17 or later). Maestro doesn't run on them, so their flows run
# through maestro-runner: pinned, as a newer one may behave differently, and without its usage data
runner=maestro-runner@1.1.29
reals="" # the real devices this run checks on
is_real() { case " $reals " in *" $1 "*) ;; *) return 1 ;; esac; }
# the UDID of the connected iPhone or iPad with the name or UDID $1
real_ios() {
  xcrun devicectl list devices --json-output "$evidence/.devices.json" > /dev/null 2>&1 || return 0
  WANT=$1 node -e 'const want = process.env.WANT;
    const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).result.devices.find(d => d.hardwareProperties?.reality === "physical" &&
      [d.identifier, d.deviceProperties?.name, d.hardwareProperties.udid].includes(want));
    if (d) console.log(d.hardwareProperties.udid);' "$evidence/.devices.json"
}
# the Apple team that signs the app and WebDriverAgent for real devices: AMK_IOS_TEAM, else the project's
ios_team() { echo "${AMK_IOS_TEAM:-$(sed -n 's/.*DEVELOPMENT_TEAM = "\{0,1\}\([A-Z0-9]\{10\}\)"\{0,1\};.*/\1/p' ios/*.xcodeproj/project.pbxproj 2> /dev/null | head -n 1)}"; }
# installs the app on the real device $1 and opens it, so what the device needs (trusting the team, unlocking) shows
# before the flows, and an app that closes at once is caught with its crash report. Notes the crash reports already there
launch_check() {
  exe=$(/usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$device_app/Info.plist")
  crashes "$1" > "$evidence/.crashes-$1"
  log=$evidence/launch-$1.log
  if ! xcrun devicectl device install app --device "$1" "$device_app" > "$log" 2>&1; then
    echo "ios: the app didn't install on $1 (is it unlocked, with Developer Mode on?), see ${log#"$root"/}"
    return 1
  fi
  # a device now and then refuses an app it has just installed for a moment, as if it didn't trust the team
  tries=0
  until said=$(xcrun devicectl device process launch --device "$1" --terminate-existing "$app_id" 2>&1); do
    echo "$said" >> "$log"
    tries=$((tries + 1))
    case $said in
      *'explicitly trusted'*) [ "$tries" -lt 3 ] || {
          echo "ios: $1 doesn't open apps from this team yet: on it, Settings > General > VPN & Device Management > Developer App > Trust, then run this again"
          return 1; } ;;
      *) echo "ios: the app didn't open on $1 (is it unlocked?), see ${log#"$root"/}"; return 1 ;;
    esac
    sleep 10
  done
  echo "$said" >> "$log"
  sleep 10
  xcrun devicectl device info processes --device "$1" --json-output "$evidence/.processes.json" > /dev/null 2>&1 || true
  if ! grep -qs "/$(basename "$device_app")/" "$evidence/.processes.json"; then
    echo "ios: the app closed within 10 seconds of opening on $1"
    crash_reports "$1"
    return 1
  fi
}
# the app's crash reports on the real device $1
crashes() {
  xcrun devicectl device info files --device "$1" --domain-type systemCrashLogs --json-output "$evidence/.files.json" > /dev/null 2>&1 || return 0
  EXE=$exe node -e 'for (const f of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).result.files || [])
    if (f.relativePath.startsWith(process.env.EXE + "-") && f.relativePath.endsWith(".ips")) console.log(f.relativePath)' "$evidence/.files.json"
}
# the ones that weren't there before launch_check join the evidence: the app crashed during the checks
crash_reports() {
  new=$(crashes "$1" | grep -v -x -F -f "$evidence/.crashes-$1" || true)
  [ -n "$new" ] || return 0
  mkdir -p "$evidence/crashes"
  for c in $new; do
    xcrun devicectl device copy from --device "$1" --domain-type systemCrashLogs --source "$c" --destination "$evidence/crashes/$c" > /dev/null 2>&1 || true
  done
  echo "ios: the app crashed on $1 during the checks: $(echo "$new" | wc -l | tr -d ' ') crash reports in ${evidence#"$root"/}/crashes"
  status=1
}

# a running emulator's adb serial: of the AVD named in $1 if one is, else of the kind in $2 (phone or tablet) if given
running_emulator() {
  for d in $("$adb" devices | awk 'NR > 1 && $2 == "device" && /^emulator-/ { print $1 }'); do
    if [ -n "$1" ]; then
      [ "$("$adb" -s "$d" emu avd name 2> /dev/null | head -n 1 | tr -d '\r')" = "$1" ] || continue
    elif [ -n "${2:-}" ]; then
      [ "$(kind_of "$(device_width "$d")")" = "$2" ] || continue
    fi
    echo "$d"; return
  done
}

# a screen's smallest width in dp: 600 and up is a tablet
kind_of() { if [ "${1:-0}" -ge 600 ]; then echo tablet; else echo phone; fi; }
device_width() {
  "$adb" -s "$1" shell 'wm size; wm density' 2> /dev/null | tr -d '\r' | awk -F': ' '
    /Physical size/ { split($2, s, "x"); w = s[1] + 0 < s[2] + 0 ? s[1] : s[2] } /Physical density/ { d = $2 }
    END { if (d) print int(w * 160 / d) }'
}
# the same for an emulator that isn't running, from its config.ini
avd_width() {
  awk -F' *= *' '$1 == "hw.lcd.width" { w = $2 } $1 == "hw.lcd.height" { h = $2 } $1 == "hw.lcd.density" { d = $2 }
    END { if (d) print int((w + 0 < h + 0 ? w : h) * 160 / d) }' \
    "${ANDROID_AVD_HOME:-${ANDROID_USER_HOME:-$HOME/.android}/avd}/$1.avd/config.ini" 2> /dev/null || true
}
# the emulators of the kind $1 (phone or tablet), best first: the running ones, then the others
emulators() {
  {
    for d in $("$adb" devices | awk 'NR > 1 && $2 == "device" && /^emulator-/ { print $1 }'); do
      [ "$(kind_of "$(device_width "$d")")" != "$1" ] || "$adb" -s "$d" emu avd name 2> /dev/null | head -n 1 | tr -d '\r'
    done
    for a in $avds; do [ "$(kind_of "$(avd_width "$a")")" != "$1" ] || echo "$a"; done
  } | awk 'NF && !seen[$0]++'
}
# an Android device of the kind $1 that this run holds, in $taken (its serial): the device ($2, an adb serial) or
# emulator ($3) named for it, once it's free; else the first free emulator of that kind, running or not; else the
# best one, once it's free. Empty when there's none of that kind. An emulator is claimed by its name, however named
take_android() {
  taken="" pick=""
  if [ -n "$2" ]; then
    key=android-$2
    case $2 in emulator-*) key=android-avd-$("$adb" -s "$2" emu avd name 2> /dev/null | head -n 1 | tr -d '\r') ;; esac
    claim_wait "$key" "$2" "$2" || return 1
    taken=$2
    return 0
  fi
  if [ -n "$3" ]; then
    echo "$avds" | grep -qxF "$3" || { echo "android: there's no emulator named $3 (see: emulator -list-avds)"; return 1; }
    names=$3
  else
    names=$(emulators "$1")
  fi
  [ -n "$names" ] || return 0
  first=$(echo "$names" | head -n 1)
  if [ -z "$3" ]; then
    for n in $names; do claim "android-avd-$n" "$(running_emulator "$n")" && { pick=$n; break; }; done
    [ -z "$pick" ] || [ "$pick" = "$first" ] || echo "android: emulator $first is in use by $(holder "android-avd-$first"), so checking on $pick"
  fi
  [ -n "$pick" ] || { claim_wait "android-avd-$first" "$(running_emulator "$first")" "emulator $first" || return 1; pick=$first; }
  taken=$(running_emulator "$pick")
  [ -n "$taken" ] || taken=$(start_emulator "$pick") || { echo "android: emulator $pick didn't start"; return 1; }
}
# starts the AVD $1 and prints its serial once adb sees it (up to 5 minutes)
start_emulator() {
  nohup "$sdk/emulator/emulator" -avd "$1" -no-snapshot-save -no-boot-anim > /dev/null 2>&1 &
  tries=0
  until serial=$(running_emulator "$1") && [ -n "$serial" ]; do
    tries=$((tries + 1))
    [ "$tries" -le 150 ] || return 1
    sleep 2
  done
  echo "$serial"
}

# waits for the Android device $1 to finish starting, for up to 5 minutes
android_ready() {
  tries=0
  until [ "$("$adb" -s "$1" shell getprop sys.boot_completed 2> /dev/null | tr -d '\r')" = 1 ]; do
    tries=$((tries + 1))
    [ "$tries" -le 100 ] || return 1
    sleep 3
  done
}

android() {
  [ "$build_only" = 1 ] || command -v maestro > /dev/null || { echo "android: Maestro isn't installed (https://maestro.dev)"; status=1; return; }
  case $(uname -s) in # where Android Studio puts the SDK by default
    Darwin) default_sdk=$HOME/Library/Android/sdk ;;
    MINGW* | MSYS* | CYGWIN*) default_sdk=${LOCALAPPDATA:-$HOME/AppData/Local}/Android/Sdk ;;
    *) default_sdk=$HOME/Android/Sdk ;;
  esac
  sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$default_sdk}}
  adb="$sdk/platform-tools/adb"
  # Expo apps without native folders in git: generate android/ first
  if [ "$no_build" = 0 ] && ! sh scripts/amk/prebuild.sh android > "$evidence/prebuild-android.log" 2>&1; then
    echo "android: expo prebuild FAILED, see ${evidence#"$root"/}/prebuild-android.log"; status=1; return
  fi
  # apps with product flavors: check one, the first in build.gradle unless --flavor names another
  if [ -z "$flavor" ]; then
    code=0
    flavors=$(node scripts/amk/android-flavors.js) || code=$?
    case $code in
      0) ;;
      2) echo "android: the app has several flavor dimensions; name the variant with --flavor (for example devFree)"; status=1; return ;;
      *) echo "android: couldn't read the product flavors from build.gradle (see the error above)"; status=1; return ;;
    esac
    flavor=$(echo "$flavors" | head -n 1)
    [ -z "$flavor" ] || echo "android: checking the \"$flavor\" flavor (the app has: $(echo $flavors)); --flavor <name> checks another"
  fi
  variant=$(printf %s "$flavor" | awk '{ print toupper(substr($0, 1, 1)) substr($0, 2) }')
  device="" tablet=""
  if [ "$build_only" = 1 ]; then
    # no device to ask: emulators run this machine's CPU type
    case $(uname -m) in arm64 | aarch64) abi=arm64-v8a ;; *) abi=x86_64 ;; esac
  else
    # the devices first: the build only needs the CPU type, and emulators boot while Gradle builds.
    # The flows clear the app's data, so a phone plugged in over USB is used only when AMK_ANDROID_DEVICE names it
    screens=$(screens_for android)
    [ -n "$screens" ] || { echo "android: none of the app's screens is $only"; return; }
    avds=$("$sdk/emulator/emulator" -list-avds 2> /dev/null || true)
    if echo "$screens" | grep -q '^phone-'; then
      take_android phone "${AMK_ANDROID_DEVICE:-}" "${AMK_ANDROID_AVD:-}" || { status=1; return; }
      # only tablet emulators: one of them
      [ -n "$taken" ] || take_android tablet "" "" || { status=1; return; }
      device=$taken
      if [ -z "$device" ]; then
          phone=$("$adb" devices | awk 'NR > 1 && $2 == "device" { print $1; exit }')
          echo "android: no emulator found (create one in Android Studio)"
          [ -z "$phone" ] || echo "  or check on the phone $phone, which clears the app's data on it: AMK_ANDROID_DEVICE=$phone sh scripts/amk/verify.sh android"
          status=1; return
      fi
      case $device in
        emulator-*) echo "android: checking on $device" ;;
        *) echo "android: checking on the phone $device; the flows clear the app's data on it" ;;
      esac
    fi
    if echo "$screens" | grep -q '^tablet-'; then
      take_android tablet "${AMK_ANDROID_TABLET:-}" "${AMK_ANDROID_TABLET_AVD:-}" || { status=1; return; }
      tablet=$taken
      [ -n "$tablet" ] || echo "android: the app runs on tablets, but there's no tablet emulator, so tablets aren't checked (create one in Android Studio: Device Manager > Tablet, or set AMK_ANDROID_TABLET_AVD)"
      [ "$tablet" != "$device" ] || tablet="" # only tablet emulators: the one in use is checked as the phone
      case $tablet in
        "") ;;
        emulator-*) echo "android: tablets on $tablet" ;;
        *) echo "android: tablets on $tablet; the flows clear the app's data on it" ;;
      esac
    fi
    [ -n "$device$tablet" ] || return
    # an emulator that has just started (another one starting too) may not answer for a moment
    first=${device:-$tablet}
    tries=0
    until abi=$("$adb" -s "$first" shell getprop ro.product.cpu.abi 2> /dev/null | tr -d '\r') && [ -n "$abi" ]; do
      tries=$((tries + 1))
      [ "$tries" -le 30 ] || { echo "android: device $first isn't connected (see: adb devices)"; status=1; return; }
      sleep 2
    done
  fi
  # one build of this project at a time; a check without its own build waits for one that's under way
  claim_wait "build-android-$project" "" "the Android build of this project" || { status=1; return; }
  if [ "$no_build" = 0 ]; then
    # native code for that CPU type only, as run-android --active-arch-only does: much faster than all four
    set -- -PreactNativeArchitectures="$abi"
    # signed with the project's debug key, so the check build installs whatever key its real release needs
    if [ -f android/app/debug.keystore ]; then
      keystore=$(cd android/app && { pwd -W 2> /dev/null || pwd; })/debug.keystore # pwd -W: a Windows path in Git Bash
      set -- "$@" -Pandroid.injected.signing.store.file="$keystore" -Pandroid.injected.signing.store.password=android \
        -Pandroid.injected.signing.key.alias=androiddebugkey -Pandroid.injected.signing.key.password=android
    fi
    # a check build isn't a release: its mapping files and debug symbols stay off the crash reporters
    set -- "$@" --init-script "$(cd scripts/amk && { pwd -W 2> /dev/null || pwd; })/no-symbol-upload.gradle"
    if ! (cd android && SENTRY_DISABLE_AUTO_UPLOAD=true ./gradlew "assemble${variant}Release" --no-daemon -q "$@") > "$evidence/android-build.log" 2>&1; then
      echo "android: release build FAILED, see ${evidence#"$root"/}/android-build.log"; status=1; return
    fi
  fi
  unclaim "build-android-$project"
  [ "$build_only" = 0 ] || { echo "android: release build done"; return; }
  # apps that split APKs by CPU type get one per type: take this device's, else the universal one
  apks=$(ls android/app/build/outputs/apk/${flavor:+$flavor/}release/*.apk 2> /dev/null || true)
  [ -n "$apks" ] || { echo "android: there's no build to check yet: run sh scripts/amk/verify.sh build first"; status=1; return; }
  apk=$(echo "$apks" | grep -e "-$abi-" | head -n 1)
  [ -n "$apk" ] || apk=$(echo "$apks" | grep universal | head -n 1)
  [ -n "$apk" ] || apk=$(echo "$apks" | head -n 1)
  # the app ID from the built APK, which includes flavor suffixes such as .dev
  aapt2="$(ls -d "$sdk"/build-tools/*/ 2> /dev/null | sort -V | tail -n 1)aapt2"
  app_id=$("$aapt2" dump badging "$apk" 2> /dev/null | sed -n "s/^package: name='\([^']*\)'.*/\1/p")
  [ -n "$app_id" ] || app_id=$(sed -n 's/.*applicationId *=\{0,1\} *"\([^"]*\)".*/\1/p' android/app/build.gradle* | head -n 1)
  if [ -n "$device" ]; then
    android_ready "$device" || { echo "android: $device didn't finish starting (see: adb devices)"; status=1; return; }
    "$adb" -s "$device" install -r "$apk" > /dev/null
  fi
  if [ -n "$tablet" ]; then
    if ! android_ready "$tablet"; then echo "android: $tablet didn't finish starting, so tablets aren't checked"; tablet=""
    elif ! "$adb" -s "$tablet" install -r "$apk" > /dev/null 2>&1; then
      echo "android: the app didn't install on the tablet $tablet (a different CPU type?), so tablets aren't checked"; tablet=""
    fi
  fi
  for d in $device $tablet; do
    # system "isn't responding" pop-ups (common on busy emulators) cover the app and fail flows; app crashes still fail
    # them. Emulators only: the setting is device-wide and stays, so a phone keeps showing them
    case $d in emulator-*) "$adb" -s "$d" shell settings put global hide_error_dialogs 1 ;; esac
    "$adb" -s "$d" shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS > /dev/null 2>&1 || true
  done
  check_screens android "$device" "$tablet" "$app_id" $screens
}

# both release builds at the same time, each in its own log; the --no-build checks on each device come after
build() {
  build_only=1
  ios_pid=""
  if [ "$(uname -s)" = Darwin ]; then
    (trap release EXIT; ios; exit $status) > "$evidence/build-ios.out" 2>&1 &
    ios_pid=$!
  fi
  (trap release EXIT; android; exit $status) > "$evidence/build-android.out" 2>&1 &
  android_pid=$!
  [ -z "$ios_pid" ] || wait "$ios_pid" || status=1
  wait "$android_pid" || status=1
  cat "$evidence"/build-*.out
}

# Checking every device at the same time, one subagent each, is faster where the machine has room: about 20 GB of
# memory for four devices and both builds, and Maestro 2.6 or later, which runs several devices at once
plan() {
  set -- $(node -e 'const os = require("os"), fs = require("fs"), s = fs.statfsSync(".");
    console.log(Math.round(os.totalmem() / 2 ** 30), Math.round(s.bavail * s.bsize / 2 ** 30))')
  have="$1 GB of memory, $2 GB free disk, Maestro $(maestro_version)"
  checks=""
  if [ "$(uname -s)" = Darwin ]; then
    for kind in phone tablet; do screens_for ios | grep -q "^$kind-" && checks="$checks ios:$kind"; done
  fi
  for kind in phone tablet; do screens_for android | grep -q "^$kind-" && checks="$checks android:$kind"; done
  n=$(echo $checks | wc -w | tr -d ' ')
  why=""
  case ${AMK_PARALLEL:-} in
    0) why="AMK_PARALLEL=0" ;;
    1) ;;
    *)
      [ "$1" -ge 32 ] || why="it needs 32 GB of memory"
      [ "$2" -ge 20 ] || why="${why:+$why and }it needs 20 GB free disk"
      maestro_at_least 2.6.0 || why="${why:+$why and }it needs Maestro 2.6 or later" ;;
  esac
  [ "$n" -ge 2 ] || why="there's one device to check"
  if [ -n "$why" ]; then
    echo "plan: $have: one device at a time ($why; AMK_PARALLEL=1 overrides)"
    echo "  sh scripts/amk/verify.sh all${args:+ $args}"
    return
  fi
  echo "plan: $have: check the $n devices at the same time"
  echo "  1. sh scripts/amk/verify.sh quick${args:+ $args}"
  echo "  2. sh scripts/amk/verify.sh build${args:+ $args}"
  echo "  3. at the same time, each in its own subagent (m-device-checker), which checks its screenshots and reports:"
  for c in $checks; do echo "     sh scripts/amk/verify.sh ${c%:*} --no-build --screens ${c#*:}${args:+ $args}"; done
  [ "$(uname -s)" = Darwin ] || echo "  iOS isn't checked here: it needs a Mac with Xcode"
}

case $mode in
  quick) quick ;;
  ios) ios ;;
  android) android ;;
  all) quick; ios; android ;;
  build) build ;;
  plan) plan; exit 0 ;;
  *) echo "verify: unknown mode $mode (quick, ios, android, all, build or plan)"; exit 2 ;;
esac

echo "Evidence: ${evidence#"$root"/}/ (open the screenshots: a tool saying 'passed' isn't proof)"
exit $status
