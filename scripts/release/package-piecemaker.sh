#!/bin/sh

# Build a PieceMaker npm package from the latest fast-forwardable remote commit.
# Nothing is published or pushed unless PUBLISH=1 or PUSH=1 is supplied.

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
REMOTE=${REMOTE:-origin}
BUMP=${1:-patch}
OUTPUT_DIR=${OUTPUT_DIR:-"$ROOT_DIR/release/npm"}
REGISTRY=${REGISTRY:-https://registry.npmjs.org}

cd "$ROOT_DIR"

case "$BUMP" in
  patch|minor|major)
    VERSION_ARGUMENT=$BUMP
    ;;
  v[0-9]*|[0-9]*)
    VERSION_ARGUMENT=$BUMP
    ;;
  *)
    printf '%s\n' 'Usage: npm run package:release -- [patch|minor|major|VERSION]' >&2
    exit 2
    ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  printf '%s\n' 'Release aborted: the working tree is not clean.' >&2
  printf '%s\n' 'Commit or stash existing changes before regenerating the package.' >&2
  exit 1
fi

BRANCH=$(git symbolic-ref --quiet --short HEAD || true)
if [ -z "$BRANCH" ]; then
  printf '%s\n' 'Release aborted: HEAD is detached.' >&2
  exit 1
fi

printf 'Updating %s from %s/%s...\n' "$BRANCH" "$REMOTE" "$BRANCH"
git fetch "$REMOTE" "$BRANCH"
git pull --ff-only "$REMOTE" "$BRANCH"

printf 'Bumping package version (%s)...\n' "$VERSION_ARGUMENT"
npm version "$VERSION_ARGUMENT" --no-git-tag-version
VERSION=$(node -p "require('./package.json').version")
PACKAGE_NAME=$(node -p "require('./package.json').name")

printf 'Building %s %s...\n' "$PACKAGE_NAME" "$VERSION"
npm run build

mkdir -p "$OUTPUT_DIR"
printf 'Creating package archive in %s...\n' "$OUTPUT_DIR"
npm pack --pack-destination "$OUTPUT_DIR"

if [ "${PUBLISH:-0}" = "1" ]; then
  printf 'Publishing %s to %s...\n' "$PACKAGE_NAME" "$REGISTRY"
  npm publish --registry "$REGISTRY" --access public
else
  printf '%s\n' 'Not publishing. Set PUBLISH=1 to publish to the selected registry.'
fi

if [ "${PUSH:-0}" = "1" ]; then
  git add package.json package-lock.json
  git commit -m "release: PieceMaker $VERSION"
  git push "$REMOTE" "$BRANCH"
else
  printf '%s\n' 'Not pushing the version bump. Set PUSH=1 to commit and push it.'
fi

printf 'Done: %s %s\n' "$PACKAGE_NAME" "$VERSION"
