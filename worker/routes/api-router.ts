import type { Env } from '../env';
import { notFound } from '../errors';
import { jsonResponse, methodNotAllowed } from '../http';
import { D1Repository } from '../repositories/d1-repository';
import { AuthService } from '../services/auth-service';
import { ShoppingService } from '../services/shopping-service';
import { RealtimePublisher } from '../services/realtime-publisher';
import { OffersService } from '../services/offers-service';
import { LidlD1OffersProvider } from '../providers/lidl-d1-offers-provider';
import { readJsonObject } from '../validation';
import { routeAdminImports } from './admin-import-router';

const itemMatch = (pathname: string): { itemId: string; toggle: boolean } | null => {
  const match = /^\/api\/items\/([^/]+)(\/toggle)?$/u.exec(pathname);
  if (!match) return null;
  return { itemId: decodeURIComponent(match[1]), toggle: match[2] === '/toggle' };
};

export const routeApi = async (
  request: Request,
  env: Env,
  context: ExecutionContext,
): Promise<Response> => {
  const url = new URL(request.url);
  const repository = new D1Repository(env.DB);
  const auth = new AuthService(repository, env.HOUSEHOLD_ACCESS_KEY, context);
  const shopping = new ShoppingService(repository);
  const realtime = new RealtimePublisher(env, repository, context);
  const offers =
    env.SUPERMARKET_FEATURE_ENABLED === 'true'
      ? new OffersService(repository, [new LidlD1OffersProvider(env.DB)], 'REAL')
      : new OffersService(repository);

  if (url.pathname === '/api/health') {
    return request.method === 'GET' ? jsonResponse({ status: 'ok' }) : methodNotAllowed(['GET']);
  }

  if (url.pathname === '/api/admin/imports' || url.pathname.startsWith('/api/admin/imports/')) {
    return routeAdminImports(request, env);
  }

  if (url.pathname === '/api/bootstrap' || url.pathname === '/api/bootstrap/household') {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    return jsonResponse(await auth.bootstrap(await readJsonObject(request)), 201);
  }

  if (url.pathname === '/api/pairings/consume') {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    return jsonResponse(await auth.consumePairing(await readJsonObject(request)), 201);
  }

  const matchedItem = itemMatch(url.pathname);
  const knownPrivatePath =
    matchedItem !== null ||
    url.pathname === '/api/pairings' ||
    url.pathname === '/api/shopping-cycle/active' ||
    url.pathname === '/api/shopping-cycle/complete' ||
    url.pathname === '/api/shopping-cycle/clear' ||
    url.pathname === '/api/items' ||
    url.pathname === '/api/supermarkets' ||
    url.pathname === '/api/offers' ||
    url.pathname === '/api/product-preferences/suggestions';
  if (!knownPrivatePath) throw notFound('La ruta solicitada no existe.');

  const device = await auth.authorize(request);

  if (url.pathname === '/api/pairings') {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    return jsonResponse(await auth.createPairing(device, request.url), 201);
  }

  if (url.pathname === '/api/shopping-cycle/active') {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    return jsonResponse({ cycle: await shopping.getActiveCycle(device) });
  }

  if (url.pathname === '/api/shopping-cycle/complete') {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    const result = await shopping.complete(device);
    realtime.publish(device, 'LIST_CLOSED', result);
    return jsonResponse(result, 201);
  }

  if (url.pathname === '/api/shopping-cycle/clear') {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    const result = await shopping.clear(device, await readJsonObject(request));
    if (!result.cancelled) realtime.publish(device, 'LIST_REPLACED', result);
    return jsonResponse(result, result.cancelled ? 200 : 201);
  }

  if (url.pathname === '/api/items') {
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    const item = await shopping.addItem(device, await readJsonObject(request));
    realtime.publish(device, 'ITEM_CREATED', { item });
    return jsonResponse({ item }, 201);
  }

  if (matchedItem) {
    if (matchedItem.toggle) {
      if (request.method !== 'POST') return methodNotAllowed(['POST']);
      const item = await shopping.toggleItem(device, matchedItem.itemId);
      realtime.publish(device, item.checked ? 'ITEM_CHECKED' : 'ITEM_UNCHECKED', { item });
      return jsonResponse({ item });
    }
    if (request.method === 'PATCH') {
      const item = await shopping.updateItem(
        device,
        matchedItem.itemId,
        await readJsonObject(request),
      );
      realtime.publish(device, 'ITEM_UPDATED', { item });
      return jsonResponse({ item });
    }
    if (request.method === 'DELETE') {
      await shopping.deleteItem(device, matchedItem.itemId);
      realtime.publish(device, 'ITEM_DELETED', { itemId: matchedItem.itemId });
      return new Response(null, { status: 204 });
    }
    return methodNotAllowed(['PATCH', 'DELETE']);
  }

  if (url.pathname === '/api/supermarkets') {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    return jsonResponse({ supermarkets: await shopping.getSupermarkets() });
  }

  if (url.pathname === '/api/offers') {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    return jsonResponse(await offers.list(device, url));
  }

  if (url.pathname === '/api/product-preferences/suggestions') {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    return jsonResponse({ suggestions: await shopping.suggestions(device, url) });
  }

  throw notFound('La ruta solicitada no existe.');
};
