#!/bin/sh
# Builds signed release apps on this Mac: for apps without CI, or to check a release by hand.
# A person runs it, because it uses the signing keys, which agents must never handle.
#
#   sh scripts/amk/release-build.sh android [flavor]   signed app bundle (.aab) for Google Play
#   sh scripts/amk/release-build.sh ios [scheme]       signed .ipa for App Store Connect, or as ios/ExportOptions.plist says
# Defaults: AMK_ANDROID_FLAVOR and AMK_IOS_SCHEME. An app with product flavors must name the one to build.
#
# Android signs with your upload key. Set its path in your shell, never in the repo:
#   export AMK_UPLOAD_KEYSTORE=~/keys/myapp-upload.jks AMK_UPLOAD_KEY_ALIAS=upload
# The passwords are asked for, unless AMK_UPLOAD_STORE_PASSWORD and AMK_UPLOAD_KEY_PASSWORD are set.
# Without AMK_UPLOAD_KEYSTORE it uses the app's own signing setup, and stops if that's the debug key.
# iOS archives with the scheme's archive configuration and exports with the project's ios/ExportOptions.plist
# (or the one AMK_IOS_EXPORT_OPTIONS names): manual signing, ad hoc or enterprise. Without one, it exports for
# App Store Connect with automatic signing, using the Apple account in Xcode (Settings > Accounts); Xcode may
# create a distribution certificate or profile in that team if one is missing.
# Expo apps without native folders in git: it generates them first (expo prebuild). iOS signing then needs the
# Apple team in app.json (expo.ios.appleTeamId).
# Version and build numbers come from the repo, so set them first (the m-release skill does).
# Output: .amk/release/
set -eu
platform=${1:-}
target=${2:-}
out=.amk/release
mkdir -p "$out"

# secret VAR "question": read it without echo, unless it's already set
secret() {
  eval "[ -n \"\${$1:-}\" ]" && return 0
  [ -t 0 ] || { echo "Set $1 in your shell, or run this in a terminal to be asked." >&2; exit 1; }
  printf '%s: ' "$2" >&2; stty -echo; read -r value; stty echo; echo >&2
  eval "$1=\$value"
}

case "$platform" in
android)
  sh scripts/amk/prebuild.sh android
  target=${target:-${AMK_ANDROID_FLAVOR:-}}
  if [ -z "$target" ]; then
    code=0
    flavors=$(node scripts/amk/android-flavors.js) || code=$?
    case $code in
      0) ;;
      2) echo "This app has several flavor dimensions: name the variant, for example: sh scripts/amk/release-build.sh android devFree" >&2; exit 1 ;;
      *) echo "Couldn't read the product flavors from build.gradle (see the error above)." >&2; exit 1 ;;
    esac
    [ -z "$flavors" ] || { echo "This app has product flavors ($(echo $flavors)). Name the one to build, for example: sh scripts/amk/release-build.sh android $(echo "$flavors" | head -n 1)" >&2; exit 1; }
  fi
  flavor=$(printf %s "$target" | awk '{ print toupper(substr($0, 1, 1)) substr($0, 2) }')
  if [ -n "${AMK_UPLOAD_KEYSTORE:-}" ]; then
    secret AMK_UPLOAD_STORE_PASSWORD 'Keystore password'
    secret AMK_UPLOAD_KEY_PASSWORD 'Key password'
    # injected signing (as Android Studio's "Generate Signed Bundle" does): build.gradle stays as it is
    set -- -Pandroid.injected.signing.store.file="$AMK_UPLOAD_KEYSTORE" \
      -Pandroid.injected.signing.store.password="$AMK_UPLOAD_STORE_PASSWORD" \
      -Pandroid.injected.signing.key.alias="${AMK_UPLOAD_KEY_ALIAS:-upload}" \
      -Pandroid.injected.signing.key.password="$AMK_UPLOAD_KEY_PASSWORD"
  else
    set --
  fi
  (cd android && ./gradlew "bundle${flavor}Release" "$@")
  dir=android/app/build/outputs/bundle/${target:-release}${target:+Release}
  for aab in "$dir"/*.aab; do
    signer=$(keytool -printcert -jarfile "$aab" | sed -n 's/^Owner: //p' | head -n 1)
    case "$signer" in
      ''|*'Android Debug'*) echo "$aab is signed with the debug key. Set AMK_UPLOAD_KEYSTORE (see the top of this script)." >&2; exit 1 ;;
    esac
    cp "$aab" "$out/"
    echo "Signed by: $signer"
    echo "$out/$(basename "$aab")"
  done
  ;;
ios)
  sh scripts/amk/prebuild.sh ios
  if [ ! -d ios/Pods ] || [ ios/Podfile -nt ios/Pods/Manifest.lock ]; then sh scripts/amk/pod-install.sh; fi
  workspace=$(ls -d ios/*.xcworkspace | head -n 1)
  scheme=${target:-${AMK_IOS_SCHEME:-$(basename "$workspace" .xcworkspace)}}
  log="$out/$scheme-ios.log"
  echo "Archiving $scheme (several minutes; log: $log)"
  xcodebuild -workspace "$workspace" -scheme "$scheme" -destination 'generic/platform=iOS' \
    -archivePath "$out/$scheme.xcarchive" -allowProvisioningUpdates archive > "$log" 2>&1 \
    || { grep -E 'error:|BUILD FAILED|ARCHIVE FAILED' "$log" | head -n 20; exit 1; }
  options=${AMK_IOS_EXPORT_OPTIONS:-ios/ExportOptions.plist}
  if [ ! -f "$options" ]; then
    [ -z "${AMK_IOS_EXPORT_OPTIONS:-}" ] || { echo "AMK_IOS_EXPORT_OPTIONS: no file at $options" >&2; exit 1; }
    options="$out/ExportOptions.plist"
    cat > "$options" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>signingStyle</key><string>automatic</string>
</dict></plist>
PLIST
  fi
  echo "Exporting with $options"
  xcodebuild -exportArchive -archivePath "$out/$scheme.xcarchive" -exportPath "$out/$scheme" \
    -exportOptionsPlist "$options" -allowProvisioningUpdates >> "$log" 2>&1 \
    || { grep -E 'error:|EXPORT FAILED' "$log" | head -n 20; exit 1; }
  ipa=$(ls "$out/$scheme"/*.ipa | head -n 1)
  # the export re-signs for distribution, so check the app inside the .ipa, not the archive
  unzip -oq "$ipa" -d "$out/$scheme/unzipped"
  echo "Signed by: $(codesign -dvv "$out/$scheme/unzipped"/Payload/*.app 2>&1 | sed -n 's/^Authority=//p' | head -n 1)"
  echo "$ipa"
  ;;
*)
  sed -n '2,20p' "$0"
  exit 1
  ;;
esac
