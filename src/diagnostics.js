const MAX_EVENTS = 200;
const events = [];

function browserFamily(userAgent) {
  if (/Edg\//.test(userAgent)) return 'Edge';
  if (/Firefox\//.test(userAgent)) return 'Firefox';
  if (/Chrome\//.test(userAgent)) return 'Chrome';
  if (/Safari\//.test(userAgent)) return 'Safari';
  return 'Other';
}

export function recordDiagnostic(type, detail = {}) {
  events.push({
    at: new Date().toISOString(),
    type,
    detail: { ...detail },
  });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

export function createDiagnosticsBlob({ boxModel, artwork, workflowStep, windowRef = window }) {
  const payload = {
    format: 'carton-builder-diagnostics',
    version: 1,
    generatedAt: new Date().toISOString(),
    environment: {
      browser: browserFamily(windowRef.navigator.userAgent),
      language: windowRef.document.documentElement.lang,
      viewport: {
        width: windowRef.innerWidth,
        height: windowRef.innerHeight,
      },
    },
    workflowStep,
    box: {
      dimensions: { ...boxModel.dimensions },
      panelCount: boxModel.panelCount,
      complete: boxModel.isComplete,
    },
    artwork: artwork.hasArtwork ? {
      mimeType: artwork.source.mimeType,
      widthPx: artwork.source.widthPx,
      heightPx: artwork.source.heightPx,
      pageIndex: artwork.source.pageIndex,
      pageCount: artwork.source.pageCount,
      vector: artwork.source.vector,
      transform: {
        centerXmm: artwork.centerXmm,
        centerYmm: artwork.centerYmm,
        scale: artwork.scale,
        rotation: artwork.rotation,
        opacity: artwork.opacity,
        bgOpacity: artwork.bgOpacity,
      },
    } : null,
    events: [...events],
    privacy: 'No artwork bytes, file names, checksums or project identifiers are included.',
  };
  return new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
}
