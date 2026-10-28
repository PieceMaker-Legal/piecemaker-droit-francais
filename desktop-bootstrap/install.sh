#!/bin/sh
set -eu

REPO="${PIECEMAKER_REPO:-PieceMaker-Legal/piecemaker-droit-francais}"
BOOTSTRAP_HOME="${PIECEMAKER_BOOTSTRAP_HOME:-$HOME/.piecemaker/bootstrap}"
NODE_CHANNEL="${PIECEMAKER_NODE_CHANNEL:-latest-v22.x}"
MIN_NODE_MAJOR=22
unset PIECEMAKER_PREBUILT_APP_PATH

say() { printf '\033[1;34m==\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31m!!\033[0m %s\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "Ce script installe PieceMaker sur macOS. Sur Windows, utilisez install.ps1."

case "$(uname -m)" in
  arm64) NODE_ARCH=arm64 ;;
  x86_64) NODE_ARCH=x64 ;;
  *) fail "Architecture non prise en charge : $(uname -m)" ;;
esac

command -v curl >/dev/null 2>&1 || fail "curl est requis."
command -v tar >/dev/null 2>&1 || fail "tar est requis."
command -v openssl >/dev/null 2>&1 || fail "openssl est requis."

mkdir -p "$BOOTSTRAP_HOME"
cd "$BOOTSTRAP_HOME"
BOOTSTRAP_HOME="$(pwd -P)"

resolve_release() {
  curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' \
    | head -n 1
}

say "Recherche de la dernière version publiée de PieceMaker…"
TAG="${PIECEMAKER_TAG:-$(resolve_release)}"
[ -n "$TAG" ] || fail "Impossible de déterminer la dernière version publiée de $REPO."
say "Version retenue : $TAG"

PREBUILT_DIR="$BOOTSTRAP_HOME/prebuilt/$TAG"
mkdir -p "$PREBUILT_DIR"
TRANSACTION="$(mktemp -d "$PREBUILT_DIR/install.XXXXXX")"
trap 'rm -rf "$TRANSACTION"' 0
trap 'exit 130' INT
trap 'exit 143' HUP TERM
export PIECEMAKER_PREBUILT_ASSET_DIR="$TRANSACTION"

export PIECEMAKER_TAG="$TAG"
export PIECEMAKER_REPO="$REPO"
export PIECEMAKER_BOOTSTRAP_HOME="$BOOTSTRAP_HOME"

verify_bundle_links() {
  find "$1" -type l > "$TRANSACTION/links.txt" || return 1
  while IFS= read -r LINK; do
    DEPTH=0
    while [ -L "$LINK" ]; do
      DEPTH=$((DEPTH + 1))
      [ "$DEPTH" -le 40 ] || return 1
      TARGET="$(readlink "$LINK")" || return 1
      case "$TARGET" in
        /*) LINK="$TARGET" ;;
        *) LINK="$(dirname "$LINK")/$TARGET" ;;
      esac
      PARENT="$(cd -P "$(dirname "$LINK")" && pwd)" || return 1
      LINK="$PARENT/$(basename "$LINK")"
    done
    [ -e "$LINK" ] || return 1
    if [ -d "$LINK" ]; then LINK="$(cd -P "$LINK" && pwd)" || return 1; fi
    case "$LINK" in "$1"/*) ;; *) return 1 ;; esac
  done < "$TRANSACTION/links.txt"
}

ASSET="piecemaker-desktop-darwin-$NODE_ARCH.tar.gz"
BUNDLE_ARCHIVE="$TRANSACTION/$ASSET"
say "Téléchargement de l'application précompilée…"
STATUS="$(curl -fsSL -w '%{http_code}' -o "$BUNDLE_ARCHIVE.partial" "https://github.com/$REPO/releases/download/$TAG/$ASSET")" || {
  [ "$STATUS" = 404 ] || fail "Téléchargement du bundle impossible ($STATUS). L'application actuelle est conservée."
}
if [ "$STATUS" = 200 ]; then
  curl -fsSL -o "$BUNDLE_ARCHIVE.sha256" "https://github.com/$REPO/releases/download/$TAG/$ASSET.sha256" || fail "Empreinte du bundle absente. L'application actuelle est conservée."
  EXPECTED="$(awk 'NR == 1 { print tolower($1) }' "$BUNDLE_ARCHIVE.sha256")"
  ACTUAL="$(shasum -a 256 "$BUNDLE_ARCHIVE.partial" | awk '{ print $1 }')"
  [ "$ACTUAL" = "$EXPECTED" ] || fail "Empreinte du bundle invalide. L'application actuelle est conservée."
  mv "$BUNDLE_ARCHIVE.partial" "$BUNDLE_ARCHIVE"
  /usr/bin/tar -tzf "$BUNDLE_ARCHIVE" > "$TRANSACTION/entries.txt" || fail "Archive du bundle illisible."
  awk '
    { sub(/^\.\//, ""); if ($0 !~ /^PieceMaker\.app(\/|$)/ || $0 ~ /(^|\/)\.\.(\/|$)/) exit 1; count++ }
    END { if (!count) exit 1 }
  ' "$TRANSACTION/entries.txt" || fail "Chemin hors de l'application dans l'archive."
  BUNDLE_STAGE="$TRANSACTION/bundle"
  mkdir "$BUNDLE_STAGE"
  /usr/bin/tar -xzf "$BUNDLE_ARCHIVE" -C "$BUNDLE_STAGE" || fail "Extraction du bundle impossible."
  BUNDLE="$BUNDLE_STAGE/PieceMaker.app"
  [ ! -L "$BUNDLE" ] && verify_bundle_links "$BUNDLE" || fail "Lien hors de l'application dans l'archive."
  [ -x "$BUNDLE/Contents/MacOS/PieceMaker" ] || fail "Exécutable PieceMaker absent du bundle."
  APP_ROOT="$BUNDLE/Contents/Resources/app"
  if [ -f "$APP_ROOT/desktop-bootstrap/lib/install.mjs" ]; then
    export PIECEMAKER_SRC_DIR="$APP_ROOT"
    export PIECEMAKER_PREBUILT_APP_PATH="$BUNDLE"
    ELECTRON_RUN_AS_NODE=1 "$BUNDLE/Contents/MacOS/PieceMaker" "$APP_ROOT/desktop-bootstrap/lib/install.mjs" "$@" || exit "$?"
    rm -rf "$BOOTSTRAP_HOME/src" "$BOOTSTRAP_HOME/toolchain"
    find "$BOOTSTRAP_HOME/prebuilt" -mindepth 1 -maxdepth 1 ! -name "$TAG" -exec rm -rf {} +
    find "$PREBUILT_DIR" -mindepth 1 -maxdepth 1 ! -path "$TRANSACTION" -exec rm -rf {} +
    exit 0
  fi
  say "Cette ancienne application ne livre pas ses scripts de préparation — reprise du bootstrap historique."
elif [ "$STATUS" != 404 ]; then
  fail "Téléchargement du bundle impossible ($STATUS). L'application actuelle est conservée."
fi
rm -f "$BUNDLE_ARCHIVE.partial"

SRC_DIR="$BOOTSTRAP_HOME/src/$TAG"
if [ ! -d "$SRC_DIR" ]; then
  say "Téléchargement des sources…"
  rm -rf "$SRC_DIR.partial"
  mkdir -p "$SRC_DIR.partial"
  ARCHIVE="$BOOTSTRAP_HOME/$TAG.tar.gz"
  curl -fsSL -o "$ARCHIVE" "https://codeload.github.com/$REPO/tar.gz/refs/tags/$TAG"
  tar -xzf "$ARCHIVE" -C "$SRC_DIR.partial" --strip-components 1
  rm -f "$ARCHIVE"
  mv "$SRC_DIR.partial" "$SRC_DIR"
fi

NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  CURRENT_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$CURRENT_MAJOR" -ge "$MIN_NODE_MAJOR" ] 2>/dev/null; then
    NODE_BIN="$(command -v node)"
  fi
fi

if [ -z "$NODE_BIN" ]; then
  say "Installation d'un Node.js dédié (aucune modification du système)…"
  NODE_FILE="$(curl -fsSL "https://nodejs.org/dist/$NODE_CHANNEL/SHASUMS256.txt" \
    | sed -n "s/.*\(node-v[0-9.]*-darwin-$NODE_ARCH\.tar\.gz\)$/\1/p" | head -n 1)"
  [ -n "$NODE_FILE" ] || fail "Impossible de déterminer la version de Node.js à télécharger."
  NODE_NAME="${NODE_FILE%.tar.gz}"
  NODE_DIR="$BOOTSTRAP_HOME/toolchain/$NODE_NAME"
  if [ ! -x "$NODE_DIR/bin/node" ]; then
    mkdir -p "$NODE_DIR"
    curl -fsSL -o "$BOOTSTRAP_HOME/$NODE_FILE" "https://nodejs.org/dist/$NODE_CHANNEL/$NODE_FILE"
    tar -xzf "$BOOTSTRAP_HOME/$NODE_FILE" -C "$NODE_DIR" --strip-components 1
    rm -f "$BOOTSTRAP_HOME/$NODE_FILE"
  fi
  NODE_BIN="$NODE_DIR/bin/node"
fi

say "Node.js utilisé : $NODE_BIN ($("$NODE_BIN" -v))"

PATH="$(dirname "$NODE_BIN"):$PATH"
export PATH
export PIECEMAKER_SRC_DIR="$SRC_DIR"

if [ -d "$SRC_DIR/node_modules/better-sqlite3" ]; then
  say "Recompilation des modules natifs pour $("$NODE_BIN" -v)…"
  (cd "$SRC_DIR" && npm rebuild better-sqlite3 --no-audit --no-fund)
fi

"$NODE_BIN" "$SRC_DIR/desktop-bootstrap/lib/install.mjs" "$@"
find "$BOOTSTRAP_HOME/src" -mindepth 1 -maxdepth 1 ! -name "$TAG" -exec rm -rf {} +
