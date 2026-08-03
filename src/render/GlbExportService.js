import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
export {
  GLB_TEXTURE_SIZE_OPTIONS,
  GLB_MATERIAL_MODE_OPTIONS,
  sanitizeGlbExportOptions,
} from './glbOptions.js';
import { sanitizeGlbExportOptions } from './glbOptions.js';

function assertNotAborted(signal) {
  if (signal?.aborted) throw new DOMException('GLB export aborted.', 'AbortError');
}

function toArrayBuffer(result) {
  if (result instanceof ArrayBuffer) return result;
  if (ArrayBuffer.isView(result)) {
    return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
  }
  throw new Error('GLTFExporter did not return a binary GLB.');
}

/**
 * Export the current closed Render scene as a self-contained binary glTF.
 * The renderer supplies an export-owned scene so the live WebGL scene is not
 * mutated or disposed by the exporter.
 */
export async function exportGlb({
  renderer,
  options = {},
  signal,
  onProgress = () => {},
} = {}) {
  if (!renderer?.createPortableScene) throw new Error('A live Render renderer is required for GLB export.');
  const normalized = sanitizeGlbExportOptions(options);
  assertNotAborted(signal);
  onProgress(0);
  const portable = renderer.createPortableScene(normalized);
  try {
    assertNotAborted(signal);
    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(portable.scene, {
      binary: true,
      onlyVisible: true,
      maxTextureSize: normalized.textureSize === 'auto' ? 4096 : normalized.textureSize,
    });
    assertNotAborted(signal);
    const buffer = toArrayBuffer(result);
    if (buffer.byteLength < 32) throw new Error('GLB export returned an empty asset.');
    onProgress(1);
    return new Blob([buffer], { type: 'model/gltf-binary' });
  } finally {
    portable.dispose?.();
  }
}
