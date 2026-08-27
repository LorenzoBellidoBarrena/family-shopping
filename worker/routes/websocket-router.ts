import type { Env } from '../env';
import { ApiError } from '../errors';
import { D1Repository } from '../repositories/d1-repository';
import { AuthService } from '../services/auth-service';

const bearerProtocol = (request: Request): string | null => {
  const protocols = request.headers
    .get('sec-websocket-protocol')
    ?.split(',')
    .map((protocol) => protocol.trim());
  const bearer = protocols?.find((protocol) => protocol.startsWith('bearer.'));
  return bearer?.slice('bearer.'.length) ?? null;
};

export const routeWebSocket = async (request: Request, env: Env): Promise<Response> => {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    throw new ApiError(426, 'UPGRADE_REQUIRED', 'Se necesita una conexión WebSocket.');
  }
  const token = bearerProtocol(request);
  if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'No autorizado.');
  const repository = new D1Repository(env.DB);
  const auth = new AuthService(repository, env.HOUSEHOLD_ACCESS_KEY);
  const device = await auth.authorizeToken(token);
  const id = env.HOUSEHOLD_COORDINATOR.idFromName(device.householdId);
  const stub = env.HOUSEHOLD_COORDINATOR.get(id);
  const headers = new Headers(request.headers);
  headers.set('sec-websocket-protocol', 'family-shopping');
  headers.set('x-family-shopping-device-id', device.id);
  const forwarded = new Request('https://household.internal/connect', {
    method: request.method,
    headers,
  });
  return stub.fetch(forwarded);
};
