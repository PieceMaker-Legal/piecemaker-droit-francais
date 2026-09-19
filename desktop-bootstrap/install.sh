#!/bin/sh
set -eu

REPO="${PIECEMAKER_REPO:-PieceMaker-Legal/piecemaker-droit-francais}"
BOOTSTRAP_HOME="${PIECEMAKER_BOOTSTRAP_HOME:-$HOME/.piecemaker/bootstrap}"
NODE_CHANNEL="${PIECEMAKER_NODE_CHANNEL:-latest-v22.x}"
MIN_NODE_MAJOR=22

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
xcode-select -p >/dev/null 2>&1 || fail "Les outils en ligne de commande Xcode sont requis. Lancez : xcode-select --install"

mkdir -p "$BOOTSTRAP_HOME"

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
export PIECEMAKER_TAG="$TAG"
export PIECEMAKER_BOOTSTRAP_HOME="$BOOTSTRAP_HOME"

exec "$NODE_BIN" "$SRC_DIR/desktop-bootstrap/lib/install.mjs" "$@"
