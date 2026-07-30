import { describe, expect, it } from 'vitest';

import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import { getDielineSegments, getPanelMaskPath } from '../../src/model/dieline.js';

function createReferenceNet() {
  const model = new BoxNetModel();
  model.addPanel('front', 'bottom');
  model.addPanel('front', 'top');
  model.addPanel('top', 'top');
  model.addPanel('front', 'left');
  model.addPanel('back', 'right');
  return model;
}

describe('dieline geometry', () => {
  it('classifies shared panel edges as folds and exterior edges as cuts', () => {
    const segments = getDielineSegments(createReferenceNet());

    expect(segments.fold).toHaveLength(5);
    expect(segments.cut).toHaveLength(14);
    expect(segments.fold.every((segment) => segment.panelIds.length === 2)).toBe(true);
    expect(segments.cut.every((segment) => segment.panelIds.length === 1)).toBe(true);
  });

  it('creates a mask subpath for every panel', () => {
    expect(getPanelMaskPath(createReferenceNet()).match(/M/g)).toHaveLength(6);
  });
});
