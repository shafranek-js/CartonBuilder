import { describe, expect, it } from 'vitest';

import { flattenPdfLayers } from '../../src/artwork/fileProcessing.js';

describe('flattenPdfLayers', () => {
  const groups = {
    '1': { name: 'Background' },
    '2': { name: 'Labels' },
    '3': { name: 'Hairlines' },
  };

  it('flattens a plain list of layer ids', () => {
    const layers = flattenPdfLayers(['1', '2'], (id) => groups[id]);
    expect(layers).toEqual([
      { id: '1', name: 'Background', group: null },
      { id: '2', name: 'Labels', group: null },
    ]);
  });

  it('prefixes nested collections onto the layer names', () => {
    const order = [
      { name: 'Set A', order: ['1', { name: 'Sub', order: ['2'] }] },
      '3',
    ];
    const layers = flattenPdfLayers(order, (id) => groups[id]);
    expect(layers).toEqual([
      { id: '1', name: 'Background', group: 'Set A' },
      { id: '2', name: 'Labels', group: 'Set A / Sub' },
      { id: '3', name: 'Hairlines', group: null },
    ]);
  });

  it('falls back to a generated name when the group has none', () => {
    const layers = flattenPdfLayers(['7'], () => null);
    expect(layers[0]).toEqual({ id: '7', name: 'Layer 7', group: null });
  });

  it('handles null and empty orders', () => {
    expect(flattenPdfLayers(null, () => null)).toEqual([]);
    expect(flattenPdfLayers([], () => null)).toEqual([]);
  });
});
