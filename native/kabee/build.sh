#!/usr/bin/env bash
# Builds Kabee's DSP (native/kabee/upstream, git submodule) to WebAssembly for ArkaneDAW.
#
#   bash native/kabee/build.sh
#
# Idempotent. Downloads wasi-sdk into <repo>/.tools/ when it isn't there (no root needed), then writes:
#   src/renderer/src/plugins/kabee/kabee.wasm       the engine (C ABI in kabee_wasm.cpp)
#   src/renderer/src/plugins/kabee/table.gen.ts     parameter/pedal/preset tables read back from the wasm
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TOOLS="$ROOT/.tools"
WASI_VERSION="${WASI_VERSION:-34}"
WASI_SDK="${WASI_SDK_PATH:-$TOOLS/wasi-sdk-$WASI_VERSION.0-x86_64-linux}"
UPSTREAM="$HERE/upstream/plugins/Kabee"
OUT_DIR="$ROOT/src/renderer/src/plugins/kabee"
BUILD="$HERE/build"

# ---- toolchain -----------------------------------------------------------------------------------------------------
if [ ! -x "$WASI_SDK/bin/clang++" ]; then
    echo "==> downloading wasi-sdk $WASI_VERSION into $TOOLS"
    mkdir -p "$TOOLS"
    tarball="wasi-sdk-$WASI_VERSION.0-x86_64-linux.tar.gz"
    curl -fsSL -o "$TOOLS/$tarball" \
        "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-$WASI_VERSION/$tarball"
    tar -xzf "$TOOLS/$tarball" -C "$TOOLS"
    rm -f "$TOOLS/$tarball"
fi

# ---- upstream source -----------------------------------------------------------------------------------------------
if [ ! -f "$UPSTREAM/dsp/Engine.cpp" ]; then
    echo "==> fetching the kabee submodule"
    git -C "$ROOT" submodule update --init native/kabee/upstream
fi

# ---- compile -------------------------------------------------------------------------------------------------------
mkdir -p "$BUILD" "$OUT_DIR"
CXX="$WASI_SDK/bin/clang++"
CXXFLAGS=(
    --target=wasm32-wasip1 --sysroot="$WASI_SDK/share/wasi-sysroot"
    -std=c++17 -O3 -ffast-math -fno-math-errno -fno-exceptions -fno-rtti
    -msimd128 -mbulk-memory -mnontrapping-fptoint -msign-ext
    -DNDEBUG -I"$UPSTREAM"
    -Wall -Wno-unused-function
)
LDFLAGS=(
    -mexec-model=reactor           # no main(); exports _initialize to run static constructors
    -Wl,--strip-all -Wl,--gc-sections
    -Wl,-z,stack-size=262144
    -Wl,--initial-memory=4194304   # grows on demand (engine allocates at create time only)
)

echo "==> compiling Engine.cpp + kabee_wasm.cpp"
"$CXX" "${CXXFLAGS[@]}" -c "$UPSTREAM/dsp/Engine.cpp" -o "$BUILD/Engine.o"
"$CXX" "${CXXFLAGS[@]}" -c "$HERE/kabee_wasm.cpp" -o "$BUILD/kabee_wasm.o"
"$CXX" "${CXXFLAGS[@]}" "${LDFLAGS[@]}" "$BUILD/Engine.o" "$BUILD/kabee_wasm.o" -o "$BUILD/kabee.wasm"

cp "$BUILD/kabee.wasm" "$OUT_DIR/kabee.wasm"
echo "==> $(stat -c %s "$OUT_DIR/kabee.wasm") bytes -> ${OUT_DIR#"$ROOT"/}/kabee.wasm"

# ---- tables for the UI ----------------------------------------------------------------------------------------------
node "$HERE/gen-table.mjs" "$OUT_DIR/kabee.wasm" "$OUT_DIR/table.gen.ts"
echo "==> ${OUT_DIR#"$ROOT"/}/table.gen.ts"
