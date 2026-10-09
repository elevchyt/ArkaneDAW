#!/usr/bin/env bash
# Builds the native plugin-hosting pieces and installs them into resources/native/ (app:paths().resources):
#   native/vsthost → arkane-vsthost        (sidecar: CLAP / VST3 / VST2 host, one process per plugin instance)
#   native/bridge  → arkane_bridge.node    (N-API addon: SharedArrayBuffer ⇄ shm copier, ABI-stable)
# Only g++ and make are required: CLAP/VST3/N-API headers are vendored, X11 is loaded with dlopen at runtime.
#
#   npm run build:native            build + install
#   npm run test:native             build + C++ sidecar tests + Node bridge e2e test
#   EXTRA_PLUGINS="vst3:/path/X.vst3 clap:/path/Y.clap" npm run test:native   also smoke-test real plugins
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JOBS="$(nproc 2>/dev/null || echo 4)"

make -C "$ROOT/native/vsthost" -j"$JOBS" all
make -C "$ROOT/native/bridge" -j"$JOBS" all

mkdir -p "$ROOT/resources/native"
install -m 755 "$ROOT/native/vsthost/build/arkane-vsthost" "$ROOT/resources/native/arkane-vsthost"
install -m 755 "$ROOT/native/bridge/build/arkane_bridge.node" "$ROOT/resources/native/arkane_bridge.node"
echo "native: installed into resources/native/"

if [[ "${1:-}" == "--test" ]]; then
  # shellcheck disable=SC2086
  "$ROOT/native/vsthost/build/vsthost-test" "$ROOT/native/vsthost/build/arkane-vsthost" \
    "$ROOT/native/vsthost/build/arkane-test-synth.clap" ${EXTRA_PLUGINS:-}
  node "$ROOT/native/bridge/test/e2e.mjs" "$ROOT/resources/native" "$ROOT/native/vsthost/build/arkane-test-synth.clap"
fi
