#!/usr/bin/env bash
# Build and publish an ArkaneDAW release to GitHub (elevchyt/ArkaneDAW).
#
#   scripts/release/release.sh 0.2.0 [notes.md]
#
# Steps: bump version → typecheck + tests → native host → AppImage + Windows installer →
# SHA256SUMS → commit + tag → push → GitHub release with assets. The in-app updater reads
# releases/latest and downloads the AppImage (verified against SHA256SUMS).
set -euo pipefail

VERSION="${1:?usage: release.sh <version> [notes.md]}"
NOTES="${2:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ -n "$(git status --porcelain)" ]; then
  echo "working tree not clean — commit or stash first" >&2
  exit 1
fi

npm version "$VERSION" --no-git-tag-version
npm run typecheck
npm test
npm run build:native

# Windows installer needs Wine for the NSIS uninstaller; prefer system wine, fall back to the portable build.
if ! command -v wine >/dev/null 2>&1 && [ -x "$ROOT/.tools/wine/bin/wine" ]; then
  export PATH="$ROOT/.tools/wine/bin:$PATH"
fi
export WINEPREFIX="${WINEPREFIX:-$ROOT/.tools/wineprefix}" WINEDEBUG=-all

rm -rf dist
npm run dist

APPIMAGE="dist/ArkaneDAW-$VERSION-x86_64.AppImage"
EXE="dist/ArkaneDAW-$VERSION-x64.exe"
test -f "$APPIMAGE" && test -f "$EXE"
(cd dist && sha256sum "$(basename "$APPIMAGE")" "$(basename "$EXE")" > SHA256SUMS)

git add package.json package-lock.json
git commit -m "Release v$VERSION"
git tag -a "v$VERSION" -m "ArkaneDAW v$VERSION"
git push origin HEAD --follow-tags

ARGS=(--repo elevchyt/ArkaneDAW --title "ArkaneDAW v$VERSION")
if [ -n "$NOTES" ]; then ARGS+=(--notes-file "$NOTES"); else ARGS+=(--generate-notes); fi
gh release create "v$VERSION" "$APPIMAGE" "$EXE" dist/SHA256SUMS "${ARGS[@]}"
echo "Released v$VERSION"
