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
#   --label <n>     evidence folder name (default: the spec id, or a timestamp)
#   --flavor <name> Android product flavor to check (default: the first one in build.gradle)
#   --scheme <name> iOS scheme to check (default: the one named like the workspace)
#   --screens <l>   only these of the screens the app supports, comma-separated: phone, tablet, portrait,
#                   landscape, or one such as tablet-landscape
#   --no-build      check the last build instead of building again (after `build`)
#   (no flows found: a smoke check that launches the app and takes a screenshot)
#   Evidence per screen: ios/ and android/ (phone, portrait), then -landscape/, -tablet/ and -tablet-landscape/
# Env: AMK_ANDROID_FLAVOR, AMK_IOS_SCHEME, AMK_SCREENS (defaults for the options), AMK_IOS_DEVICE (simulator name
#      or UDID), AMK_ANDROID_DEVICE (adb serial: the only way to check on a phone, whose app data the flows clear),
#      AMK_ANDROID_AVD (the emulator to use, started if it isn't running; other devices are left alone),
#      AMK_IOS_TABLET (iPad simulator name or UDID), AMK_ANDROID_TABLET_AVD (tablet emulator), AMK_ANDROID_TABLET (serial),
#      AMK_PARALLEL (1 or 0: overrides plan's choice)
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
evidence="$root/.amk/evidence/${label:-${spec:-$(date +%Y%m%d-%H%M%S)}}"
mkdir -p "$evidence"
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

run_flow() { # screen device app_id file name orientation
  # Maestro's own log, which has errors its output leaves out; it adds to the file, so one run's log at a time
  debug="$evidence/maestro-logs/$1-$5"
  mkdir -p "$debug" "$out/screenshots"
  rm -f "$debug/maestro.log"
  find "$debug" -path '*/takeScreenshot/*.png' -exec rm -f {} + # an earlier run's, which aren't this run's evidence
  target=$4
  if [ "$6" != PORTRAIT ]; then
    # a turned screen: the flow runs inside one that turns the device first and back to portrait after. Maestro
    # reads the path in it itself, so it's a native path (a Windows path in Git Bash)
    native=$(cd "$(dirname "$4")" && { pwd -W 2> /dev/null || pwd; })/$(basename "$4")
    printf "appId: %s\nonFlowComplete:\n  - setOrientation: PORTRAIT\n---\n- setOrientation: %s\n- runFlow: '%s'\n" "$3" "$6" "$native" > "$debug/screen.yaml"
    target=$debug/screen.yaml
  fi
  # screenshots use relative names: older Maestro saves them in the current folder, then in --test-output-dir, and
  # from 2.7 in the debug output under <flow>/takeScreenshot/, from where they join the screen's evidence
  rc=0
  (cd "$out" && maestro --device "$2" test --test-output-dir "$out" --debug-output "$debug" --flatten-debug-output \
    -e APP_ID="$3" "$target" > "$out/$5.log" 2>&1) || rc=$?
  find "$debug" -path '*/takeScreenshot/*.png' -exec cp {} "$out/screenshots/" \;
  return $rc
}

run_flows() { # screen device app_id orientation (PORTRAIT, or LANDSCAPE_LEFT to turn it)
  out="$evidence/$1"
  mkdir -p "$out"
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
    # an emulator sometimes drops its adb connection for a moment: reconnect, then run the flow once more
    if [ "$ok" != 0 ] && [ "${1%%-*}" = android ] && grep -qs 'device offline' "$debug/maestro.log"; then
      echo "  $1: the device went offline during flow $name; running it once more"
      "$adb" reconnect offline > /dev/null 2>&1 || true
      android_ready "$2" || true
      ok=0
      run_flow "$1" "$2" "$3" "$f" "$name" "$4" || ok=$?
    fi
    if [ "$ok" = 0 ]; then
      passed=$((passed + 1))
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
  shots=$(find "$out" -name '*.png' | wc -l | tr -d ' ')
  echo "$1: flows $passed/$total passed, $shots screenshots in ${out#"$root"/}"
  if [ "$shots" = 0 ]; then
    echo "  $1: no screenshots were saved, so there's no evidence; treating this as a failure"
    status=1
  fi
}

# runs the flows on each screen given: the phone upright into <platform>/, then <platform>-landscape/,
# <platform>-tablet/ and <platform>-tablet-landscape/
check_screens() { # platform phone tablet app_id screens…
  p=$1 phone=$2 tab=$3 id=$4
  shift 4
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
    # Maestro turns devices from 2.0 on, and taps the right place on a turned iPad from 2.3
    need=2.0.0
    case $where in ios-tablet*) need=2.3.0 ;; esac
    if [ "$turn" != PORTRAIT ] && ! maestro_at_least $need; then
      echo "$where: not checked: turning the device needs Maestro ${need%.0} or later (this is $(maestro_version))"
      continue
    fi
    run_flows "$where" "$on" "$id" "$turn"
  done
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
      sh scripts/amk/pod-install.sh > "$evidence/pod-install.log" 2>&1
    fi
  fi
  # the simulators first, so they boot while Xcode builds
  device="" tablet=""
  if [ "$build_only" = 0 ]; then
    screens=$(screens_for ios)
    [ -n "$screens" ] || { echo "ios: none of the app's screens is $only"; return; }
    if echo "$screens" | grep -q '^phone-'; then
      device=$(simulator iPhone "${AMK_IOS_DEVICE:-}")
      if [ -z "$device" ]; then
        if [ -n "${AMK_IOS_DEVICE:-}" ]; then echo "ios: no simulator has the name or UDID \"$AMK_IOS_DEVICE\""; else echo "ios: no iPhone simulator found (set AMK_IOS_DEVICE)"; fi
        status=1; return
      fi
    fi
    if echo "$screens" | grep -q '^tablet-'; then
      tablet=$(simulator iPad "${AMK_IOS_TABLET:-}")
      if [ -z "$tablet" ] && [ -n "${AMK_IOS_TABLET:-}" ]; then echo "ios: no simulator has the name or UDID \"$AMK_IOS_TABLET\""; status=1; return; fi
      [ -n "$tablet" ] || echo "ios: the app runs on iPad, but there's no iPad simulator, so iPads aren't checked (add one in Xcode, or set AMK_IOS_TABLET)"
    fi
    for d in $device $tablet; do xcrun simctl boot "$d" 2> /dev/null || true; done
  fi
  if [ "$no_build" = 0 ]; then
    if ! CONFIGURATION=Release sh scripts/amk/ios-build.sh > "$evidence/ios-build.log" 2>&1; then
      echo "ios: release build FAILED, see ${evidence#"$root"/}/ios-build.log"; status=1; return
    fi
    [ "$build_only" = 0 ] || { echo "ios: release build done"; return; }
  fi
  # the newest app: the scheme just built (another scheme's app may still be there from an earlier build)
  app=$(ls -dt ios/DerivedData/Build/Products/*-iphonesimulator/*.app 2> /dev/null | head -n 1)
  [ -n "$app" ] || { echo "ios: there's no build to check yet: run sh scripts/amk/verify.sh build first"; status=1; return; }
  app_id=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Info.plist")
  for d in $device $tablet; do
    xcrun simctl bootstatus "$d" -b > /dev/null
    xcrun simctl install "$d" "$app"
  done
  check_screens ios "$device" "$tablet" "$app_id" $screens
}

# a simulator's UDID: the one named in $2 (name or UDID), else a booted $1 (iPhone or iPad), else one with the newest iOS
simulator() {
  xcrun simctl list devices available -j | KIND=$1 WANT=$2 node -e '
    const all = Object.entries(JSON.parse(require("fs").readFileSync(0, "utf8")).devices)
      .flatMap(([rt, ds]) => ds.map(d => ({ ...d, v: (rt.match(/iOS-(\d+)-(\d+)/) || []).slice(1).map(Number) })))
      .filter(d => d.v.length);
    const want = process.env.WANT;
    // by device type: a simulator can have any name, such as a separate one kept for tests
    const kind = all.filter(d => (d.deviceTypeIdentifier || d.name).includes(process.env.KIND));
    const pick = want ? all.find(d => d.udid === want || d.name === want)
      : kind.find(d => d.state === "Booted") || kind.sort((a, b) => b.v[0] - a.v[0] || b.v[1] - a.v[1])[0];
    console.log(pick ? pick.udid : "");'
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
# the first AVD of the kind $1 (phone or tablet)
first_avd() {
  for a in $avds; do
    if [ "$(kind_of "$(avd_width "$a")")" = "$1" ]; then echo "$a"; return; fi
  done
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
      device=${AMK_ANDROID_DEVICE:-$(running_emulator "${AMK_ANDROID_AVD:-}" phone)}
      if [ -z "$device" ]; then
        avd=${AMK_ANDROID_AVD:-$(first_avd phone)}
        [ -n "$avd" ] || avd=$(echo "$avds" | head -n 1) # only tablet emulators: one of them
        if [ -n "$avd" ]; then
          echo "$avds" | grep -qxF "$avd" || { echo "android: there's no emulator named $avd (see: emulator -list-avds)"; status=1; return; }
          device=$(start_emulator "$avd") || { echo "android: emulator $avd didn't start"; status=1; return; }
        else
          phone=$("$adb" devices | awk 'NR > 1 && $2 == "device" { print $1; exit }')
          echo "android: no emulator found (create one in Android Studio)"
          [ -z "$phone" ] || echo "  or check on the phone $phone, which clears the app's data on it: AMK_ANDROID_DEVICE=$phone sh scripts/amk/verify.sh android"
          status=1; return
        fi
      fi
      case $device in
        emulator-*) echo "android: checking on $device" ;;
        *) echo "android: checking on the phone $device; the flows clear the app's data on it" ;;
      esac
    fi
    if echo "$screens" | grep -q '^tablet-'; then
      tablet=${AMK_ANDROID_TABLET:-$(running_emulator "${AMK_ANDROID_TABLET_AVD:-}" tablet)}
      if [ -z "$tablet" ]; then
        tablet_avd=${AMK_ANDROID_TABLET_AVD:-$(first_avd tablet)}
        if [ -z "$tablet_avd" ]; then
          echo "android: the app runs on tablets, but there's no tablet emulator, so tablets aren't checked (create one in Android Studio: Device Manager > Tablet, or set AMK_ANDROID_TABLET_AVD)"
        elif ! echo "$avds" | grep -qxF "$tablet_avd"; then
          echo "android: there's no emulator named $tablet_avd (see: emulator -list-avds)"; status=1; return
        else
          tablet=$(start_emulator "$tablet_avd") || { echo "android: emulator $tablet_avd didn't start, so tablets aren't checked"; tablet=""; }
        fi
      fi
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
  if [ "$no_build" = 0 ]; then
    # native code for that CPU type only, as run-android --active-arch-only does: much faster than all four
    set -- -PreactNativeArchitectures="$abi"
    # signed with the project's debug key, so the check build installs whatever key its real release needs
    if [ -f android/app/debug.keystore ]; then
      keystore=$(cd android/app && { pwd -W 2> /dev/null || pwd; })/debug.keystore # pwd -W: a Windows path in Git Bash
      set -- "$@" -Pandroid.injected.signing.store.file="$keystore" -Pandroid.injected.signing.store.password=android \
        -Pandroid.injected.signing.key.alias=androiddebugkey -Pandroid.injected.signing.key.password=android
    fi
    if ! (cd android && ./gradlew "assemble${variant}Release" --no-daemon -q "$@") > "$evidence/android-build.log" 2>&1; then
      echo "android: release build FAILED, see ${evidence#"$root"/}/android-build.log"; status=1; return
    fi
    [ "$build_only" = 0 ] || { echo "android: release build done"; return; }
  fi
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
    (ios; exit $status) > "$evidence/build-ios.out" 2>&1 &
    ios_pid=$!
  fi
  (android; exit $status) > "$evidence/build-android.out" 2>&1 &
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
