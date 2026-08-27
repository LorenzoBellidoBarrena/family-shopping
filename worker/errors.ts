export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (code: string, message: string): ApiError =>
  new ApiError(400, code, message);

export const unauthorized = (): ApiError =>
  new ApiError(401, 'UNAUTHORIZED', 'Se necesita un dispositivo autorizado.');

export const notFound = (message: string): ApiError => new ApiError(404, 'NOT_FOUND', message);

export const conflict = (code: string, message: string): ApiError =>
  new ApiError(409, code, message);
