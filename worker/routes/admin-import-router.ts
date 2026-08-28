import type { Env } from '../env';
import { ApiError, badRequest, notFound } from '../errors';
import { jsonResponse, methodNotAllowed } from '../http';
import { SupermarketImportRepository } from '../repositories/supermarket-import-repository';
import { secretsMatch } from '../security/tokens';
import { SupermarketImportService } from '../services/supermarket-import-service';

const authorizeImport = async (request: Request, env: Env): Promise<void> => {
  if (!env.IMPORT_ADMIN_KEY) {
    throw new ApiError(503, 'IMPORT_ADMIN_NOT_CONFIGURED', 'La importación no está configurada.');
  }
  const provided = request.headers.get('x-import-admin-key');
  if (!provided || !(await secretsMatch(provided, env.IMPORT_ADMIN_KEY))) {
    throw new ApiError(401, 'UNAUTHORIZED', 'No autorizado.');
  }
};

export const routeAdminImports = async (request: Request, env: Env): Promise<Response> => {
  await authorizeImport(request, env);
  const url = new URL(request.url);
  const repository = new SupermarketImportRepository(env.DB);
  const service = new SupermarketImportService(repository);

  if (url.pathname === '/api/admin/imports') {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    return jsonResponse({ imports: await service.listRuns() });
  }

  if (
    url.pathname === '/api/admin/imports/carrefour' ||
    url.pathname === '/api/admin/imports/dia' ||
    url.pathname === '/api/admin/imports/lidl'
  ) {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    if (env.SUPERMARKET_FEATURE_ENABLED !== 'true') {
      throw new ApiError(503, 'SUPERMARKET_FEATURE_DISABLED', 'La importación está desactivada.');
    }
    const rawLimit = url.searchParams.get('limit') ?? '5';
    if (!/^\d{1,2}$/u.test(rawLimit)) {
      throw badRequest('INVALID_LIMIT', 'limit debe ser un entero entre 1 y 20.');
    }
    const limit = Number.parseInt(rawLimit, 10);
    if (limit < 1 || limit > 20) {
      throw badRequest('INVALID_LIMIT', 'limit debe ser un entero entre 1 y 20.');
    }
    const imported = url.pathname.endsWith('/dia')
      ? await service.importDia(limit)
      : url.pathname.endsWith('/lidl')
        ? await service.importLidl(limit)
        : await service.importCarrefour(limit);
    return jsonResponse({ import: imported }, 201);
  }

  throw notFound('La ruta solicitada no existe.');
};
