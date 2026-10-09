#!/bin/sh
# Checks the app the way a user would: lint, typecheck and tests, then release builds on the iOS simulator
# and Android emulator, running Maestro flows and saving screenshots as evidence.
#
# Usage: sh scripts/ai/verify.sh [quick|ios|android|all] [--spec <id>] [--flow <file>] [--label <name>]
#   quick       lint, typecheck, tests
#   ios|android release build, install, run flows, screenshots
#   all         everything (default)
#   --spec <id> run .maestro/<id>*.yaml and save evidence in .ai/evidence/<id>/
#   --label <n> evidence folder name (default: the spec id, or a timestamp)
#   (no flows found: a smoke check that launches the app and takes a screenshot)
# Env: AMK_IOS_DEVICE (simulator name or UDID), AMK_ANDROID_AVD (emulator name)
set -eu

mode=${1:-all}
[ $# -gt 0 ] && shift
spec=""
flow=""
label=""
while [ $# -gt 0 ]; do
  case $1 in
    --spec) spec=$2; shift 2 ;;
    --flow) flow=$2; shift 2 ;;
    --label) label=$2; shift 2 ;;
    *) echo "verify: unknown option $1"; exit 2 ;;
  esac
done

root=$(pwd)
evidence="$root/.ai/evidence/${label:-${spec:-$(date +%Y%m%d-%H%M%S)}}"
mkdir -p "$evidence"
status=0

flow_files() {
  if [ -n "$flow" ]; then echo "$root/$flow"
  elif [ -n "$spec" ]; then find "$root/.maestro" -maxdepth 1 -iname "$spec*.yaml" 2>/dev/null | sort
  else find "$root/.maestro" -maxdepth 1 -name '*.yaml' 2>/dev/null | sort
  fi
}

run_flows() { # platform device app_id
  out="$evidence/$1"
  mkdir -p "$out"
  files=$(flow_files)
  if [ -z "$files" ]; then
    printf 'appId: %s\n---\n- launchApp\n- takeScreenshot: smoke-launch\n' "$3" > "$out/smoke.yaml"
    files="$out/smoke.yaml"
  fi
  passed=0
  total=0
  for f in $files; do
    total=$((total + 1))
    name=$(basename "$f" .yaml)
    # screenshots use relative names: older Maestro saves them in the current folder, newer in --test-output-dir
    if (cd "$out" && maestro --device "$2" test --test-output-dir "$out" -e APP_ID="$3" "$f" > "$out/$name.log" 2>&1); then
      passed=$((passed + 1))
    else
      echo "  $1: flow $name failed, see ${out#"$root"/}/$name.log"
      status=1
    fi
  done
  shots=$(find "$out" -name '*.png' | wc -l | tr -d ' ')
  echo "$1: flows $passed/$total passed, $shots screenshots in ${out#"$root"/}"
  if [ "$shots" = 0 ]; then
    echo "  $1: no screenshots were saved, so there's no evidence; treating this as a failure"
    status=1
  fi
}

quick() {
  if sh scripts/ai/pm-run.sh lint > "$evidence/lint.log" 2>&1 &&
    sh scripts/ai/pm-run.sh typecheck > "$evidence/typecheck.log" 2>&1 &&
    CI=true sh scripts/ai/pm-run.sh test > "$evidence/test.log" 2>&1; then
    echo "quick: lint, typecheck and tests passed"
  else
    echo "quick: FAILED, see the logs in ${evidence#"$root"/}"
    status=1
  fi
}

ios() {
  # iOS builds need Xcode, so off a Mac "all" checks Android and says who has to check iOS
  if [ "$(uname -s)" != Darwin ]; then
    echo "ios: not checked here: iOS builds need a Mac with Xcode. A teammate with a Mac runs: sh scripts/ai/verify.sh ios${spec:+ --spec $spec}"
    [ "$mode" = ios ] && status=1
    return
  fi
  command -v maestro > /dev/null || { echo "ios: Maestro isn't installed (https://maestro.dev)"; status=1; return; }
  # pod install also generates React Native codegen files into ios/build/generated
  if [ ! -d ios/Pods ] || [ ! -d ios/build/generated ]; then (cd ios && pod install > "$evidence/pod-install.log" 2>&1); fi
  if ! CONFIGURATION=Release sh scripts/ai/ios-build.sh > "$evidence/ios-build.log" 2>&1; then
    echo "ios: release build FAILED, see ${evidence#"$root"/}/ios-build.log"; status=1; return
  fi
  app=$(ls -d ios/DerivedData/Build/Products/Release-iphonesimulator/*.app | head -n 1)
  app_id=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Info.plist")
  device=$(xcrun simctl list devices available -j | node -e '
    const all = Object.entries(JSON.parse(require("fs").readFileSync(0, "utf8")).devices)
      .flatMap(([rt, ds]) => ds.map(d => ({ ...d, v: (rt.match(/iOS-(\d+)-(\d+)/) || []).slice(1).map(Number) })))
      .filter(d => d.v.length && /iPhone/.test(d.name));
    const want = process.env.AMK_IOS_DEVICE;
    const pick = want ? all.find(d => d.udid === want || d.name === want)
      : all.find(d => d.state === "Booted") || all.sort((a, b) => b.v[0] - a.v[0] || b.v[1] - a.v[1])[0];
    console.log(pick ? pick.udid : "");')
  [ -n "$device" ] || { echo "ios: no iPhone simulator found (set AMK_IOS_DEVICE)"; status=1; return; }
  xcrun simctl boot "$device" 2> /dev/null || true
  xcrun simctl bootstatus "$device" -b > /dev/null
  xcrun simctl install "$device" "$app"
  run_flows ios "$device" "$app_id"
}

android() {
  command -v maestro > /dev/null || { echo "android: Maestro isn't installed (https://maestro.dev)"; status=1; return; }
  case $(uname -s) in # where Android Studio puts the SDK by default
    Darwin) default_sdk=$HOME/Library/Android/sdk ;;
    MINGW* | MSYS* | CYGWIN*) default_sdk=${LOCALAPPDATA:-$HOME/AppData/Local}/Android/Sdk ;;
    *) default_sdk=$HOME/Android/Sdk ;;
  esac
  sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$default_sdk}}
  adb="$sdk/platform-tools/adb"
  if ! (cd android && ./gradlew assembleRelease --no-daemon -q) > "$evidence/android-build.log" 2>&1; then
    echo "android: release build FAILED, see ${evidence#"$root"/}/android-build.log"; status=1; return
  fi
  apk=$(ls android/app/build/outputs/apk/release/*.apk | head -n 1)
  app_id=$(sed -n 's/.*applicationId *=\{0,1\} *"\([^"]*\)".*/\1/p' android/app/build.gradle* | head -n 1)
  device=$("$adb" devices | awk 'NR > 1 && $2 == "device" { print $1; exit }')
  if [ -z "$device" ]; then
    avd=${AMK_ANDROID_AVD:-$("$sdk/emulator/emulator" -list-avds | head -n 1)}
    [ -n "$avd" ] || { echo "android: no emulator found (create one in Android Studio)"; status=1; return; }
    nohup "$sdk/emulator/emulator" -avd "$avd" -no-snapshot-save -no-boot-anim > /dev/null 2>&1 &
    "$adb" wait-for-device
    until [ "$("$adb" shell getprop sys.boot_completed 2> /dev/null | tr -d '\r')" = 1 ]; do sleep 3; done
    device=$("$adb" devices | awk 'NR > 1 && $2 == "device" { print $1; exit }')
  fi
  "$adb" -s "$device" install -r "$apk" > /dev/null
  # system "isn't responding" pop-ups (common on busy emulators) cover the app and fail flows; app crashes still fail them
  "$adb" -s "$device" shell settings put global hide_error_dialogs 1
  "$adb" -s "$device" shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS > /dev/null 2>&1 || true
  run_flows android "$device" "$app_id"
}

case $mode in
  quick) quick ;;
  ios) ios ;;
  android) android ;;
  all) quick; ios; android ;;
  *) echo "verify: unknown mode $mode (quick, ios, android or all)"; exit 2 ;;
esac

echo "Evidence: ${evidence#"$root"/}/ (open the screenshots: a tool saying 'passed' isn't proof)"
exit $status
