#!/bin/bash
set -e
export EMSDK=/c/emsdk
export PATH="/c/emsdk/python/3.13.3_64bit:/c/emsdk/node/24.19.0_64bit:/c/emsdk/node/24.19.0_64bit/bin:/c/emsdk/upstream/emscripten:/c/emsdk:$PATH"

cat > /c/emsdk/upstream/emscripten/.emscripten <<'EOF'
LLVM_ROOT = "c:/emsdk/upstream/bin"
BINARYEN_ROOT = "c:/emsdk/upstream"
NODE_JS = "c:/emsdk/node/24.19.0_64bit/node.exe"
CACHE = "c:/emsdk/upstream/emscripten/cache"
EOF

cd /c/Projects/CartonBuilder/scratch/mupdf-src/platform/wasm

echo "== npm install =="
npm install -s --no-audit --no-fund

echo "== make libs =="
make --no-print-directory -j 8 -C ../.. \
  build=small \
  OS=wasm \
  XCFLAGS="-DTOFU -DTOFU_CJK_EXT -DFZ_ENABLE_HYPHEN=0" \
  brotli=no mujs=no extract=no xps=no svg=no \
  libs

echo "== emcc link =="
mkdir -p dist
emcc -o dist/mupdf-wasm.js \
  -I ../../include \
  -Os -g2 \
  --no-entry \
  -mno-nontrapping-fptoint \
  -fwasm-exceptions \
  -sSUPPORT_LONGJMP=wasm \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME='"libmupdf_wasm"' \
  -sALLOW_MEMORY_GROWTH=1 \
  -sTEXTDECODER=2 \
  -sFILESYSTEM=0 \
  -sEXPORTED_RUNTIME_METHODS='["UTF8ToString","lengthBytesUTF8","stringToUTF8","HEAPU8","HEAP32","HEAPU32","HEAPF32"]' \
  lib/mupdf.c \
  ../../build/wasm/small/libmupdf.a \
  ../../build/wasm/small/libmupdf-third.a

echo "== typescript glue =="
sed < lib/mupdf.c '/#include/d' | emcc -E - | node tools/make-wasm-type.js > lib/mupdf-wasm.d.ts
cp lib/mupdf-wasm.d.ts dist/mupdf-wasm.d.ts
npx tsc -p .

echo "== terser =="
npx terser --module -c -m -o dist/mupdf-wasm.js dist/mupdf-wasm.js

echo "BUILD DONE"
