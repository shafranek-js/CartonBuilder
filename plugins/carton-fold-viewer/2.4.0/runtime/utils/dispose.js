export function disposeObject(obj) {
  if (!obj?.traverse) return;

  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const inspectedMaterialValues = new Set();
  const collectTextures = (value) => {
    if (!value || (typeof value !== 'object' && typeof value !== 'function') || inspectedMaterialValues.has(value)) return;
    inspectedMaterialValues.add(value);
    if (value.isTexture) {
      textures.add(value);
      return;
    }
    if (Array.isArray(value)) value.forEach(collectTextures);
    else Object.values(value).forEach(collectTextures);
  };
  obj.traverse((o) => {
    if (o.geometry) geometries.add(o.geometry);
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    mats.forEach((material) => {
      if (!material) return;
      materials.add(material);
      collectTextures(material);
    });
  });

  textures.forEach((texture) => texture.dispose?.());
  materials.forEach((material) => material.dispose?.());
  geometries.forEach((geometry) => geometry.dispose?.());
}
