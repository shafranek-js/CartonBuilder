import { recordDiagnostic } from '../diagnostics.js';

export function recordRenderDiagnostic({
  pageIndex,
  box,
  width,
  height,
  scale,
  usage,
  durationMs,
  rendererVersion,
  overprintMode = 0,
  processMask = 15,
  spotBehaviors = null,
  separationBehaviors = null,
  overprintApplied = false,
}) {
  const behaviors = spotBehaviors ?? separationBehaviors;
  recordDiagnostic('pdf-render', {
    pageIndex,
    box,
    width,
    height,
    scale: Number(scale).toFixed(4),
    usage,
    durationMs,
    renderer: rendererVersion,
    overprintMode,
    processMask,
    spotBehaviors: behaviors ? [...behaviors] : [],
    separationBehaviors: behaviors ? [...behaviors] : [],
    overprintApplied,
  });
}
