#!/bin/sh
set -eu

APP_DIR="${PIECEMAKER_APP_DIR:-$HOME/Documents/GitHub/piecemaker-droit-francais}"
APP_REMOTE="https://github.com/PieceMaker-Legal/piecemaker-droit-francais.git"
ENTRY="scripts/piecemaker/cli/piecemaker.mjs"
MINIMUM_MAJOR=20

node_major() {
  "$1" -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>/dev/null || echo 0
}

resolve_node() {
  if command -v node >/dev/null 2>&1; then
    candidate="$(command -v node)"
    if [ "$(node_major "$candidate")" -ge "$MINIMUM_MAJOR" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  fi

  nvm_root="${NVM_DIR:-$HOME/.nvm}/versions/node"
  if [ -d "$nvm_root" ]; then
    for directory in $(ls -1 "$nvm_root" 2>/dev/null | sort -Vr); do
      candidate="$nvm_root/$directory/bin/node"
      if [ -x "$candidate" ] && [ "$(node_major "$candidate")" -ge "$MINIMUM_MAJOR" ]; then
        printf '%s' "$candidate"
        return 0
      fi
    done
  fi

  return 1
}

if ! NODE_BIN="$(resolve_node)"; then
  printf 'PieceMaker : Node %s ou plus recent est requis et introuvable.\n' "$MINIMUM_MAJOR" >&2
  exit 1
fi

if [ ! -d "$APP_DIR/.git" ]; then
  if ! command -v git >/dev/null 2>&1; then
    printf 'PieceMaker : git est requis pour installer le depot.\n' >&2
    exit 1
  fi
  printf 'PieceMaker : installation du depot dans %s\n' "$APP_DIR"
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --branch main "$APP_REMOTE" "$APP_DIR"
fi

if [ ! -f "$APP_DIR/$ENTRY" ]; then
  printf 'PieceMaker : %s est introuvable dans %s.\n' "$ENTRY" "$APP_DIR" >&2
  printf 'Mettez le depot a jour (git -C "%s" pull) puis relancez piecemaker.\n' "$APP_DIR" >&2
  exit 1
fi

PATH="$(dirname "$NODE_BIN"):$PATH"
export PATH

exec "$NODE_BIN" "$APP_DIR/$ENTRY" "$@"
