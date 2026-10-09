#!/usr/bin/env bash
# App-level VST e2e (silent): ELECTRON=/path/to/electron bash native/bridge/test/app/run.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
ELECTRON="${ELECTRON:-$ROOT/node_modules/electron/dist/electron}"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
ARK_OUT="$OUT/app" "$ROOT/node_modules/.bin/vite" build --config "$HERE/vite.config.mjs"
"$ROOT/node_modules/.bin/esbuild" --bundle --platform=node --format=cjs --external:electron --log-level=warning \
  "$ROOT/src/preload/index.ts" --outfile="$OUT/app/preload.cjs"
mkdir -p "$OUT/userData"
"$ELECTRON" --no-sandbox "$HERE/main.cjs" "$OUT/app" "$ROOT" "$ROOT/native/vsthost/build/arkane-test-synth.clap" "$OUT/userData" 2>&1 \
  | grep -v -E "dbus|Fontconfig|libva|ERROR:.*(gpu|viz|vaapi)"
