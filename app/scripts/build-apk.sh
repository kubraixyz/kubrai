#!/usr/bin/env bash
# Build a signed release APK locally (no EAS account needed).
#   ./scripts/build-apk.sh            -> devnet build (app.json extra.cluster)
# Requires: JDK 17, Android SDK at $ANDROID_HOME, a keystore at $KEYSTORE (created on first run).
set -euo pipefail
cd "$(dirname "$0")/.."
export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
KEYSTORE="${KEYSTORE:-$HOME/secrets/kubrai-release.keystore}"
KS_PASS="${KS_PASS:-$(cat "$HOME/secrets/kubrai-keystore.pass" 2>/dev/null || true)}"
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  KS_PASS="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' )"; printf '%s' "$KS_PASS" > "$HOME/secrets/kubrai-keystore.pass"; chmod 600 "$HOME/secrets/kubrai-keystore.pass"
  keytool -genkeypair -v -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" -alias kubrai -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Kubrai, O=Kubrai, C=TW" >/dev/null
  chmod 600 "$KEYSTORE"; echo "created release keystore at $KEYSTORE (password in ~/secrets/kubrai-keystore.pass — back both up; losing them means users must uninstall to update)"
fi
# Regenerate the native project from app.json (idempotent; android/ is not committed).
npx expo prebuild --platform android --no-install --clean >/dev/null
# Point the release signing config at our keystore.
cat > android/keystore.properties <<KP
storeFile=$KEYSTORE
storePassword=$KS_PASS
keyAlias=kubrai
keyPassword=$KS_PASS
KP
python3 - <<'PY'
import re,io
p='android/app/build.gradle'; s=open(p).read()
if 'keystore.properties' not in s:
    s=s.replace('android {', '''def ksProps = new Properties()
def ksFile = rootProject.file("keystore.properties")
if (ksFile.exists()) { ksProps.load(new FileInputStream(ksFile)) }

android {''',1)
    s=s.replace('''        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug''','''        release {
            signingConfig signingConfigs.release''')
    s=s.replace('''    signingConfigs {
        debug {''','''    signingConfigs {
        release {
            storeFile file(ksProps['storeFile'])
            storePassword ksProps['storePassword']
            keyAlias ksProps['keyAlias']
            keyPassword ksProps['keyPassword']
        }
        debug {''')
    open(p,'w').write(s)
PY
( cd android && ./gradlew --no-daemon -q assembleRelease )
VER="$(node -p "require('./app.json').expo.version")"; CODE="$(node -p "require('./app.json').expo.android.versionCode")"; CLUSTER="$(node -p "require('./app.json').expo.extra.cluster")"
NAME="kubrai-${VER}-${CLUSTER}.apk"; OUT="dist/$NAME"
mkdir -p dist && cp android/app/build/outputs/apk/release/app-release.apk "$OUT"
echo "APK: $OUT ($(du -h "$OUT" | cut -f1))"
# Publish: versioned file + latest.json, in a directory the web publish step never touches.
PUB="${APK_PUBLISH_DIR:-$HOME/apps/kubrai/apk}"; mkdir -p "$PUB"; cp "$OUT" "$PUB/$NAME"
SHA="$(sha256sum "$OUT" | cut -c1-64)"; SIZE="$(stat -c %s "$OUT")"
printf '{"version":"%s","versionCode":%s,"cluster":"%s","file":"%s","sha256":"%s","bytes":%s,"builtAt":"%s"}\n' "$VER" "$CODE" "$CLUSTER" "$NAME" "$SHA" "$SIZE" "$(date -u +%FT%TZ)" > "$PUB/latest-$CLUSTER.json"
ls -t "$PUB"/kubrai-*-"$CLUSTER".apk | tail -n +4 | xargs -r rm -f   # keep the last 3 builds
echo "published $PUB/$NAME"
