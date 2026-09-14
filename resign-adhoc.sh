#!/bin/bash
# Re-signe une app Electron en ad-hoc SANS hardened runtime,
# pour un lancement local sans notarisation Apple.
# Usage: ./resign-adhoc.sh "/chemin/vers/MonApp.app"

set -e
APP="$1"
if [ -z "$APP" ]; then
  echo "Usage: $0 <chemin vers le .app>"
  exit 1
fi

echo "Re-signature (ad-hoc, sans hardened runtime) de: $APP"

find "$APP/Contents/Frameworks" -depth -maxdepth 1 \( -name '*.framework' -o -name '*.app' \) \
  -exec codesign --force --deep --sign - {} \;

codesign --force --deep --sign - "$APP"

echo "Vérification:"
codesign --verify --deep --verbose=4 "$APP"
echo "OK - l'app devrait maintenant se lancer sans crash SIGTRAP/AMFI."
