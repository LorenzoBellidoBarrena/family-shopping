import { ApiError } from './errors';

export const jsonResponse = (body: unknown, status = 200, headers?: HeadersInit): Response =>
  Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...headers,
    },
  });

export const methodNotAllowed = (allowed: string[]): Response =>
  jsonResponse(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Método HTTP no permitido.' } },
    405,
    { allow: allowed.join(', ') },
  );

export const errorResponse = (error: unknown): Response => {
  if (error instanceof ApiError) {
    return jsonResponse({ error: { code: error.code, message: error.message } }, error.status);
  }
  return jsonResponse(
    { error: { code: 'INTERNAL_ERROR', message: 'No se pudo completar la operación.' } },
    500,
  );
};
