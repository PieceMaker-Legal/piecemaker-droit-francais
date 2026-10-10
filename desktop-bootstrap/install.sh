#!/bin/sh
set -eu

REPO="${PIECEMAKER_REPO:-PieceMaker-Legal/piecemaker-droit-francais}"
BOOTSTRAP_HOME="${PIECEMAKER_BOOTSTRAP_HOME:-$HOME/.piecemaker/bootstrap}"
NODE_CHANNEL="${PIECEMAKER_NODE_CHANNEL:-latest-v22.x}"
MIN_NODE_MAJOR=22

say() { printf '\033[1;34m==\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31m!!\033[0m %s\n' "$1" >&2; exit 1; }

progress_wanted() {
  [ "${PIECEMAKER_NO_PROGRESS:-}" = "1" ] && return 1
  for arg in "$@"; do
    [ "$arg" = "--no-progress" ] && return 1
  done
  return 0
}

write_progress() {
  command -v python3 >/dev/null 2>&1 || return 0
  python3 -c 'import json,sys; json.dump({"state":"running","step":sys.argv[1],"detail":"","current":int(sys.argv[2]),"total":14,"pid":int(sys.argv[3]),"version":sys.argv[4]}, open(sys.argv[5],"w"), ensure_ascii=False)' \
    "$1" "$2" "$$" "$TAG" "$BOOTSTRAP_HOME/progress.json" || return 0
}

launch_progress() {
  progress_wanted "$@" || return 0
  [ -f "$SRC_DIR/desktop-bootstrap/lib/progress-darwin.py" ] || return 0
  write_progress "Préparation de l'installation…" 1
  python3 "$SRC_DIR/desktop-bootstrap/lib/progress-darwin.py" "$BOOTSTRAP_HOME/progress.json" "$$" >/dev/null 2>&1 &
  echo $! > "$BOOTSTRAP_HOME/progress.pid"
}

[ "$(uname -s)" = "Darwin" ] || fail "Ce script installe PieceMaker sur macOS. Sur Windows, utilisez install.ps1."

case "$(uname -m)" in
  arm64) NODE_ARCH=arm64 ;;
  x86_64) NODE_ARCH=x64 ;;
  *) fail "Architecture non prise en charge : $(uname -m)" ;;
esac

command -v curl >/dev/null 2>&1 || fail "curl est requis."
command -v tar >/dev/null 2>&1 || fail "tar est requis."
command -v openssl >/dev/null 2>&1 || fail "openssl est requis."
xcode-select -p >/dev/null 2>&1 || fail "Les outils en ligne de commande Xcode sont requis. Lancez : xcode-select --install"

mkdir -p "$BOOTSTRAP_HOME"
cd "$BOOTSTRAP_HOME"
BOOTSTRAP_HOME="$PWD"

resolve_release() {
  curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' \
    | head -n 1
}

say "Recherche de la dernière version publiée de PieceMaker…"
TAG="${PIECEMAKER_TAG:-$(resolve_release)}"
[ -n "$TAG" ] || fail "Impossible de déterminer la dernière version publiée de $REPO."
say "Version retenue : $TAG"

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

launch_progress "$@"

NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  CURRENT_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$CURRENT_MAJOR" -ge "$MIN_NODE_MAJOR" ] 2>/dev/null; then
    NODE_BIN="$(command -v node)"
  fi
fi

if [ -z "$NODE_BIN" ]; then
  write_progress "Installation d'un Node.js dédié…" 2
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
export PIECEMAKER_TAG="$TAG"
export PIECEMAKER_BOOTSTRAP_HOME="$BOOTSTRAP_HOME"

if [ -d "$SRC_DIR/node_modules/better-sqlite3" ]; then
  say "Recompilation des modules natifs pour $("$NODE_BIN" -v)…"
  (cd "$SRC_DIR" && npm rebuild better-sqlite3 --no-audit --no-fund)
fi

exec "$NODE_BIN" "$SRC_DIR/desktop-bootstrap/lib/install.mjs" "$@"
