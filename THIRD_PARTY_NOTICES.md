# Third-party notices

## MuPDF / MuPDF.js

CartonBuilder distributes a custom MuPDF 1.28.0 WebAssembly build and wrapper
under the GNU Affero General Public License v3. The complete license text is
in [`LICENSES/AGPL-3.0.txt`](LICENSES/AGPL-3.0.txt).

The corresponding source is obtained from the pinned MuPDF tag and rebuilt with
[`scripts/build-mupdf-wasm.sh`](scripts/build-mupdf-wasm.sh). The tracked patch
series is [`patches/mupdf/0001-overprint-core-and-wasm-api.patch`](patches/mupdf/0001-overprint-core-and-wasm-api.patch).
For distribution or network service, publish the complete corresponding source
and build instructions with the product, or obtain a commercial license from
Artifex. This notice is a technical compliance record, not legal advice.

## Poly Haven environment maps

CartonBuilder bundles five 4K Radiance HDR environments from Poly Haven's
abandoned-ruins collection. The assets are CC0 and the source pages,
checksums, and license reference are recorded in
[`public/render-environments/polyhaven/README.md`](public/render-environments/polyhaven/README.md).
