#!/usr/bin/env bash
# Electron end-to-end test of the VST bridge (silent). Needs an X display (or xvfb) and an Electron binary:
#   ELECTRON=/path/to/electron bash native/bridge/test/electron/run.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
ELECTRON="${ELECTRON:-$ROOT/node_modules/electron/dist/electron}"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
"$ROOT/node_modules/.bin/esbuild" --bundle --format=esm --log-level=warning "$ROOT/src/renderer/src/audio/vst/bridge.worklet.ts" --outfile="$OUT/worklet.js"
"$ROOT/node_modules/.bin/esbuild" --bundle --format=iife --global-name=ArkVst --log-level=warning "$HERE/lib.ts" --outfile="$OUT/lib.js"
cp "$HERE/index.html" "$HERE/page.js" "$OUT/"
"$ELECTRON" --no-sandbox "$HERE/main.cjs" "$OUT" "$ROOT/resources/native" "$ROOT/native/vsthost/build/arkane-test-synth.clap" 2>&1 | grep -v -E "dbus|Fontconfig|libva|ERROR:.*(gpu|viz|vaapi)" || true
"$ELECTRON" --version >/dev/null
