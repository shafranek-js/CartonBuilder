import { BoxNetModel } from './BoxNetModel.js';

export const QUICK_CONSTRUCTION_TEMPLATE_ID = 'legacy-six-panel';
export const QUICK_SURFACE_KEYS = Object.freeze([
  'front',
  'back',
  'left',
  'right',
  'top',
  'bottom',
]);
export const QUICK_CONSTRUCTION_MIGRATION_FLAG = '__quickConstructionMigrated';

const QUICK_CONSTRUCTION = Object.freeze({
  templateId: QUICK_CONSTRUCTION_TEMPLATE_ID,
  templateVersion: 1,
  parameters: {},
});

const STANDARD_PANEL_SEQUENCE = Object.freeze([
  ['front', 'bottom'],
  ['front', 'top'],
  ['top', 'top'],
  ['front', 'left'],
  ['back', 'right'],
]);

function assertObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
}

function buildStandardQuickNet(state) {
  const model = new BoxNetModel(state.dimensions, state.board, QUICK_CONSTRUCTION);
  for (const [parentId, edge] of STANDARD_PANEL_SEQUENCE) {
    const panel = model.addPanel(parentId, edge);
    if (!panel) throw new Error(`Could not build Quick Custom Net at ${parentId}:${edge}.`);
  }
  return model;
}

function isParametricConstruction(state) {
  return state?.construction?.templateId === 'ste' || state?.construction?.templateId === 'rte';
}

/**
 * Converts the former Quick STE/RTE state to the only public Quick shape:
 * a deterministic six-panel Custom Net. Technical states must not enter here.
 */
export function normalizeQuickBoxState(input) {
  assertObject(input, 'Invalid Quick box state.');
  const model = isParametricConstruction(input)
    ? buildStandardQuickNet(input)
    : BoxNetModel.fromJSON({
        ...structuredClone(input),
        construction: QUICK_CONSTRUCTION,
      });
  const box = model.toJSON();
  if (box.construction.templateId !== QUICK_CONSTRUCTION_TEMPLATE_ID) {
    throw new Error('Quick box state did not normalize to Custom Net.');
  }
  return {
    box,
    migrated: isParametricConstruction(input),
  };
}

export function normalizeQuickProjectSnapshot(input) {
  assertObject(input, 'Invalid project snapshot.');
  const snapshot = structuredClone(input);
  if (snapshot.cartonSource?.mode !== 'quick') return { snapshot, migrated: false };

  const normalized = normalizeQuickBoxState(snapshot.cartonSource.box);
  snapshot.cartonSource = {
    ...snapshot.cartonSource,
    box: normalized.box,
  };
  if (normalized.migrated) {
    snapshot.workflowSelection = 'quick';
    markQuickConstructionMigrated(snapshot);
  }
  return { snapshot, migrated: normalized.migrated };
}

export function markQuickConstructionMigrated(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  Object.defineProperty(snapshot, QUICK_CONSTRUCTION_MIGRATION_FLAG, {
    value: true,
    enumerable: false,
    configurable: true,
  });
  return snapshot;
}

export function wasQuickConstructionMigrated(snapshot) {
  return snapshot?.[QUICK_CONSTRUCTION_MIGRATION_FLAG] === true;
}

export function getQuickConstruction() {
  return structuredClone(QUICK_CONSTRUCTION);
}

export function isQuickSurfaceKey(value) {
  return QUICK_SURFACE_KEYS.includes(value);
}
