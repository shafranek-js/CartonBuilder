export const RendererRequestType = Object.freeze({
  recognize: 'recognize',
  open: 'open',
  authenticate: 'authenticate',
  close: 'close',
  info: 'info',
  layers: 'layers',
  render: 'render',
  cancel: 'cancel',
  separations: 'separations',
});

export const RendererResponseType = Object.freeze({
  ok: 'ok',
  error: 'error',
});

export function createRequest(type, payload = {}) {
  return {
    id: crypto.randomUUID(),
    type,
    payload,
  };
}

export function serializeRendererError(error, fallbackCode = 'pdfRenderFailed') {
  if (error && typeof error === 'object' && error.code) {
    return { code: error.code, parameters: { ...error.parameters } };
  }
  return { code: fallbackCode, parameters: {} };
}

export function deserializeRendererError(payload, fallbackCode = 'pdfRenderFailed') {
  return {
    code: payload?.code || fallbackCode,
    parameters: payload?.parameters || {},
  };
}
