export const GLB_TEXTURE_SIZE_OPTIONS = Object.freeze(['auto', 1024, 2048, 4096]);
export const GLB_MATERIAL_MODE_OPTIONS = Object.freeze(['full-pbr', 'basic-compatibility']);

export function sanitizeGlbExportOptions(options = {}) {
  const textureSize = options.textureSize === 'auto'
    ? 'auto'
    : GLB_TEXTURE_SIZE_OPTIONS.includes(Number(options.textureSize))
      ? Number(options.textureSize)
      : 'auto';
  return {
    textureSize,
    materialMode: GLB_MATERIAL_MODE_OPTIONS.includes(options.materialMode)
      ? options.materialMode
      : 'full-pbr',
    includeCamera: options.includeCamera !== false,
  };
}
