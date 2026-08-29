import type { Env } from './env';
import { errorResponse } from './http';
import { routeApi } from './routes/api-router';
import { routeWebSocket } from './routes/websocket-router';
import { withSecurityHeaders } from './security/response-headers';
import { SupermarketImportRepository } from './repositories/supermarket-import-repository';
import { SupermarketImportService } from './services/supermarket-import-service';
import { runScheduledLidlImport } from './scheduled/lidl-schedule';

export { HouseholdCoordinator } from './durable-objects/household-coordinator';
export type { Env } from './env';

export const worker: ExportedHandler<Env> = {
  async fetch(request, env, context) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      try {
        return withSecurityHeaders(request, await routeApi(request, env, context));
      } catch (error) {
        return withSecurityHeaders(request, errorResponse(error));
      }
    }

    if (pathname === '/ws' || pathname.startsWith('/ws/')) {
      try {
        return await routeWebSocket(request, env);
      } catch (error) {
        return errorResponse(error);
      }
    }

    return withSecurityHeaders(request, await env.ASSETS.fetch(request));
  },
  scheduled(controller, env, context) {
    if (env.SUPERMARKET_FEATURE_ENABLED !== 'true') return;
    const service = new SupermarketImportService(new SupermarketImportRepository(env.DB));
    context.waitUntil(runScheduledLidlImport(controller.scheduledTime, service));
  },
};

export default worker;
