export function disposeObject(obj) {
  obj?.traverse?.(o => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    mats.forEach(m => {
      for (const k of Object.keys(m)) { const v=m[k]; if (v?.isTexture) v.dispose?.(); }
      m.dispose?.();
    });
  });
}
