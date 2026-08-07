export function flattenPdfLayers(order, getGroup) {
  const layers = [];
  function walk(items, prefix) {
    for (const item of items) {
      if (typeof item === 'string') {
        const group = getGroup?.(item) || null;
        layers.push({
          id: item,
          name: group?.name || `Layer ${item}`,
          group: prefix || null,
        });
      } else if (item && Array.isArray(item.order)) {
        const name = item.name || 'Group';
        walk(item.order, prefix ? `${prefix} / ${name}` : name);
      }
    }
  }
  walk(order || [], '');
  return layers;
}
