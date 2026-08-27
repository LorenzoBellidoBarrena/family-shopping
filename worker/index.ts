import type { Env } from './env';
import { errorResponse } from './http';
import { routeApi } from './routes/api-router';
import { routeWebSocket } from './routes/websocket-router';

export { HouseholdCoordinator } from './durable-objects/household-coordinator';
export type { Env } from './env';

export const worker: ExportedHandler<Env> = {
  async fetch(request, env, context) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      try {
        return await routeApi(request, env, context);
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (pathname === '/ws' || pathname.startsWith('/ws/')) {
      try {
        return await routeWebSocket(request, env);
      } catch (error) {
        return errorResponse(error);
      }
    }

    return env.ASSETS.fetch(request);
  },
};

export default worker;
