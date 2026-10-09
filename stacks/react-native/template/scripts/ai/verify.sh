#!/bin/sh
# Checks the app the way a user would: lint, typecheck and tests, then release builds on the iOS simulator
# and Android emulator, running Maestro flows and saving screenshots as evidence.
#
# Usage: sh scripts/ai/verify.sh [quick|ios|android|all] [--spec <id>] [--flow <file>] [--label <name>]
#                                [--flavor <name>] [--scheme <name>]
#   quick           lint, typecheck, tests
#   ios|android     release build, install, run flows, screenshots
#   all             everything (default)
#   --spec <id>     run .maestro/<id>*.yaml and save evidence in .ai/evidence/<id>/
#   --label <n>     evidence folder name (default: the spec id, or a timestamp)
#   --flavor <name> Android product flavor to check (default: the first one in build.gradle)
#   --scheme <name> iOS scheme to check (default: the one named like the workspace)
#   (no flows found: a smoke check that launches the app and takes a screenshot)
# Env: AMK_ANDROID_FLAVOR, AMK_IOS_SCHEME (defaults for the two options), AMK_IOS_DEVICE (simulator name
#      or UDID), AMK_ANDROID_DEVICE (adb serial, when several are connected), AMK_ANDROID_AVD (emulator to start)
set -eu

mode=${1:-all}
[ $# -gt 0 ] && shift
spec=""
flow=""
label=""
flavor=${AMK_ANDROID_FLAVOR:-}
while [ $# -gt 0 ]; do
  case $1 in
    --spec) spec=$2; shift 2 ;;
    --flow) flow=$2; shift 2 ;;
    --label) label=$2; shift 2 ;;
    --flavor) flavor=$2; shift 2 ;;
    --scheme) AMK_IOS_SCHEME=$2; export AMK_IOS_SCHEME; shift 2 ;;
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
    # launchApp returns before the app has drawn: without the wait, the screenshot can show the home screen
    printf 'appId: %s\n---\n- launchApp\n- waitForAnimationToEnd\n- takeScreenshot: smoke-launch\n' "$3" > "$out/smoke.yaml"
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
  if [ ! -d ios/Pods ] || [ ! -d ios/build/generated ]; then sh scripts/ai/pod-install.sh > "$evidence/pod-install.log" 2>&1; fi
  if ! CONFIGURATION=Release sh scripts/ai/ios-build.sh > "$evidence/ios-build.log" 2>&1; then
    echo "ios: release build FAILED, see ${evidence#"$root"/}/ios-build.log"; status=1; return
  fi
  # the newest app: the scheme just built (another scheme's app may still be there from an earlier build)
  app=$(ls -dt ios/DerivedData/Build/Products/*-iphonesimulator/*.app | head -n 1)
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
  # apps with product flavors: check one, the first in build.gradle unless --flavor names another
  if [ -z "$flavor" ]; then
    code=0
    flavors=$(node scripts/ai/android-flavors.js) || code=$?
    case $code in
      0) ;;
      2) echo "android: the app has several flavor dimensions; name the variant with --flavor (for example devFree)"; status=1; return ;;
      *) echo "android: couldn't read the product flavors from build.gradle (see the error above)"; status=1; return ;;
    esac
    flavor=$(echo "$flavors" | head -n 1)
    [ -z "$flavor" ] || echo "android: checking the \"$flavor\" flavor (the app has: $(echo $flavors)); --flavor <name> checks another"
  fi
  variant=$(printf %s "$flavor" | awk '{ print toupper(substr($0, 1, 1)) substr($0, 2) }')
  # the device first: the build only needs its CPU type, and an emulator boots while Gradle builds
  device=${AMK_ANDROID_DEVICE:-$("$adb" devices | awk 'NR > 1 && $2 == "device" { print $1; exit }')}
  if [ -z "$device" ]; then
    avd=${AMK_ANDROID_AVD:-$("$sdk/emulator/emulator" -list-avds | head -n 1)}
    [ -n "$avd" ] || { echo "android: no emulator found (create one in Android Studio)"; status=1; return; }
    nohup "$sdk/emulator/emulator" -avd "$avd" -no-snapshot-save -no-boot-anim > /dev/null 2>&1 &
    "$adb" wait-for-device
    device=$("$adb" devices | awk 'NR > 1 && $2 == "device" { print $1; exit }')
  fi
  abi=$("$adb" -s "$device" shell getprop ro.product.cpu.abi 2> /dev/null | tr -d '\r')
  [ -n "$abi" ] || { echo "android: device $device isn't connected (see: adb devices)"; status=1; return; }
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
  # apps that split APKs by CPU type get one per type: take this device's, else the universal one
  apks=$(ls android/app/build/outputs/apk/${flavor:+$flavor/}release/*.apk)
  apk=$(echo "$apks" | grep -e "-$abi-" | head -n 1)
  [ -n "$apk" ] || apk=$(echo "$apks" | grep universal | head -n 1)
  [ -n "$apk" ] || apk=$(echo "$apks" | head -n 1)
  # the app ID from the built APK, which includes flavor suffixes such as .dev
  aapt2="$(ls -d "$sdk"/build-tools/*/ 2> /dev/null | sort -V | tail -n 1)aapt2"
  app_id=$("$aapt2" dump badging "$apk" 2> /dev/null | sed -n "s/^package: name='\([^']*\)'.*/\1/p")
  [ -n "$app_id" ] || app_id=$(sed -n 's/.*applicationId *=\{0,1\} *"\([^"]*\)".*/\1/p' android/app/build.gradle* | head -n 1)
  until [ "$("$adb" -s "$device" shell getprop sys.boot_completed 2> /dev/null | tr -d '\r')" = 1 ]; do sleep 3; done
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
