export function disposeObject3D(root, { disposeTextures = true } = {}) {
  if (!root) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();

  root.traverse?.((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : object.material ? [object.material] : [];
    for (const material of objectMaterials) {
      materials.add(material);
      if (!disposeTextures) continue;
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
    }
  });

  for (const geometry of geometries) geometry.dispose?.();
  for (const material of materials) material.dispose?.();
  for (const texture of textures) texture.dispose?.();
  root.removeFromParent?.();
}

export function cancelAnimationFrameSafe(windowRef, frameId) {
  if (frameId != null) windowRef.cancelAnimationFrame(frameId);
}
