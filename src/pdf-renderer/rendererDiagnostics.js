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
}) {
  recordDiagnostic('pdf-render', {
    pageIndex,
    box,
    width,
    height,
    scale: Number(scale).toFixed(4),
    usage,
    durationMs,
    renderer: rendererVersion,
  });
}
