#!/usr/bin/env bash
set -euo pipefail

# Reproducible custom MuPDF build. Run from Git Bash or a POSIX shell.
# MuPDF sources are deliberately kept outside Git; only the patch series,
# wrapper, generated WASM and this build recipe belong to the application.

readonly MUPDF_VERSION="1.28.0"
readonly MUPDF_COMMIT="205b8cf43551279d1215e88fe2845c5d595bade9"
readonly EMSCRIPTEN_VERSION="4.0.8"
readonly BUILD_KIND="small"
readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly SOURCE_DIR="${MUPDF_SOURCE_DIR:-${ROOT_DIR}/scratch/mupdf-src}"
readonly PATCH_FILE="${ROOT_DIR}/patches/mupdf/0001-overprint-core-and-wasm-api.patch"
readonly EMSDK_ROOT="${EMSDK:-${ROOT_DIR}/.toolchains/emsdk}"
readonly CUSTOM_DIST="${SOURCE_DIR}/platform/wasm/dist"
readonly CUSTOM_BUILD_SUFFIX="-cartonbuilder-${MUPDF_VERSION}"

die() { printf 'build-mupdf-wasm: %s\n' "$*" >&2; exit 1; }

[[ -d "${SOURCE_DIR}/.git" ]] || die "MuPDF source is missing: ${SOURCE_DIR}"
[[ "$(git -C "${SOURCE_DIR}" rev-parse HEAD)" == "${MUPDF_COMMIT}" ]] \
  || die "source is not pinned to MuPDF ${MUPDF_VERSION} (${MUPDF_COMMIT})"
[[ -f "${PATCH_FILE}" ]] || die "tracked patch series is missing: ${PATCH_FILE}"
if git -C "${SOURCE_DIR}" submodule status --recursive | grep -E '^[+-U]' >/dev/null; then
  die "MuPDF submodules are not clean or initialized"
fi
if git -C "${SOURCE_DIR}" diff --quiet; then
  git -C "${SOURCE_DIR}" apply --check "${PATCH_FILE}" \
    || die "clean MuPDF source does not accept the tracked patch series"
  git -C "${SOURCE_DIR}" apply "${PATCH_FILE}"
else
  git -C "${SOURCE_DIR}" apply --reverse --check "${PATCH_FILE}" \
    || die "source contains changes outside the tracked patch series"
fi
[[ -d "${EMSDK_ROOT}/upstream/emscripten" ]] || die "EMSDK is missing: ${EMSDK_ROOT}"

export PATH="${EMSDK_ROOT}/upstream/emscripten:${EMSDK_ROOT}/node/24.19.0_64bit/bin:${EMSDK_ROOT}/python/3.13.3_64bit:${PATH}"
command -v emcc >/dev/null || die "emcc is not on PATH"
emcc --version | grep -F "${EMSCRIPTEN_VERSION}" >/dev/null || die "expected Emscripten ${EMSCRIPTEN_VERSION}"

mkdir -p "${CUSTOM_DIST}"
rm -f "${CUSTOM_DIST}"/*

make --no-print-directory -C "${SOURCE_DIR}" -j "${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || printf 4)}" \
  build="${BUILD_KIND}" build_suffix="${CUSTOM_BUILD_SUFFIX}" OS=wasm \
  XCFLAGS="-DTOFU -DTOFU_CJK_EXT -DFZ_ENABLE_HYPHEN=0" \
  brotli=no mujs=no extract=no xps=no svg=no libs

emcc -o "${CUSTOM_DIST}/mupdf-wasm.js" \
  -I "${SOURCE_DIR}/include" -Os -g2 --no-entry -mno-nontrapping-fptoint \
  -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -sEXPORT_NAME='"libmupdf_wasm"' -sALLOW_MEMORY_GROWTH=1 -sTEXTDECODER=2 \
  -sFILESYSTEM=0 \
  -sEXPORTED_RUNTIME_METHODS='["UTF8ToString","lengthBytesUTF8","stringToUTF8","HEAPU8","HEAP32","HEAPU32","HEAPF32"]' \
  "${SOURCE_DIR}/platform/wasm/lib/mupdf.c" \
  "${SOURCE_DIR}/build/wasm/${BUILD_KIND}${CUSTOM_BUILD_SUFFIX}/libmupdf.a" \
  "${SOURCE_DIR}/build/wasm/${BUILD_KIND}${CUSTOM_BUILD_SUFFIX}/libmupdf-third.a"

chmod -x "${CUSTOM_DIST}/mupdf-wasm.wasm"
sed < "${SOURCE_DIR}/platform/wasm/lib/mupdf.c" '/#include/d' \
  | emcc -E -I "${SOURCE_DIR}/include" - \
  | node "${SOURCE_DIR}/platform/wasm/tools/make-wasm-type.js" \
  > "${SOURCE_DIR}/platform/wasm/lib/mupdf-wasm.d.ts"
cp "${SOURCE_DIR}/platform/wasm/lib/mupdf-wasm.d.ts" "${CUSTOM_DIST}/mupdf-wasm.d.ts"
(cd "${SOURCE_DIR}/platform/wasm" && npx tsc -p . --pretty false)
npx terser --module -c -m -o "${CUSTOM_DIST}/mupdf-wasm.js" "${CUSTOM_DIST}/mupdf-wasm.js"

for export_name in _wasm_init_context _wasm_pdf_new_pixmap_from_page_with_usage_and_overprint_tile _wasm_convert_pixmap_to_rgb_with_process_mask; do
  grep -F "${export_name}" "${CUSTOM_DIST}/mupdf-wasm.js" >/dev/null || die "missing WASM export ${export_name}"
done
[[ -s "${CUSTOM_DIST}/mupdf-wasm.wasm" ]] || die "empty WASM binary"

MUPDF_MODULE="${CUSTOM_DIST}/mupdf.js" node "${ROOT_DIR}/scripts/test-mupdf-overprint.mjs"

cp "${CUSTOM_DIST}/mupdf.js" "${ROOT_DIR}/src/pdf-renderer/custom/mupdf.js"
cp "${CUSTOM_DIST}/mupdf-wasm.js" "${ROOT_DIR}/src/pdf-renderer/custom/mupdf-wasm.js"
cp "${CUSTOM_DIST}/mupdf-wasm.wasm" "${ROOT_DIR}/src/pdf-renderer/custom/mupdf-wasm.wasm"
printf 'MuPDF %s / Emscripten %s build complete (%s)\n' "${MUPDF_VERSION}" "${EMSCRIPTEN_VERSION}" "${SOURCE_DIR}"
