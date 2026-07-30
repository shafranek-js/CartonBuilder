export class AppError extends Error {
  constructor(code, parameters = {}, options = {}) {
    super(code, options);
    this.name = 'AppError';
    this.code = code;
    this.parameters = { ...parameters };
  }
}

export function serializeAppError(error, fallbackCode = 'unexpectedError') {
  if (error instanceof AppError) {
    return {
      code: error.code,
      parameters: { ...error.parameters },
    };
  }
  return {
    code: fallbackCode,
    parameters: {},
  };
}

export function deserializeAppError(payload, fallbackCode = 'unexpectedError') {
  if (!payload?.code) return new AppError(fallbackCode);
  return new AppError(payload.code, payload.parameters || {});
}
