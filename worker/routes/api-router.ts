import type { Env } from '../env';
import { badRequest, notFound } from '../errors';
import { jsonResponse, methodNotAllowed } from '../http';
import { D1Repository } from '../repositories/d1-repository';
import { AuthService } from '../services/auth-service';
import { ShoppingService } from '../services/shopping-service';
import { RealtimePublisher } from '../services/realtime-publisher';
import { OffersService } from '../services/offers-service';
import { LidlD1OffersProvider } from '../providers/lidl-d1-offers-provider';
import { readJsonObject } from '../validation';
import { routeAdminImports } from './admin-import-router';
import { ProductMatchRepository } from '../repositories/product-match-repository';
import { ListOfferMatchingService } from '../services/list-offer-matching-service';
import { HouseholdLoyaltyRepository } from '../repositories/household-loyalty-repository';
import { HouseholdLoyaltyService } from '../services/household-loyalty-service';

const itemMatch = (pathname: string): { itemId: string; toggle: boolean } | null => {
  const match = /^\/api\/items\/([^/]+)(\/toggle)?$/u.exec(pathname);
  if (!match) return null;
  return { itemId: decodeURIComponent(match[1]), toggle: match[2] === '/toggle' };
};

const productMatch = (pathname: string): { itemId: string } | null => {
  const match = /^\/api\/items\/([^/]+)\/product-match$/u.exec(pathname);
  return match ? { itemId: decodeURIComponent(match[1]) } : null;
};

const loyaltyProgramMatch = (pathname: string): { program: string } | null => {
  const match = /^\/api\/settings\/loyalty-programs\/([^/]+)$/u.exec(pathname);
  return match ? { program: decodeURIComponent(match[1]) } : null;
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
  const loyaltyRepository = new HouseholdLoyaltyRepository(env.DB);
  const loyalty = new HouseholdLoyaltyService(loyaltyRepository);
  const offers =
    env.SUPERMARKET_FEATURE_ENABLED === 'true'
      ? new OffersService(repository, [new LidlD1OffersProvider(env.DB)], 'REAL', loyaltyRepository)
      : new OffersService(repository);
  const listMatching = new ListOfferMatchingService(
    repository,
    new ProductMatchRepository(env.DB),
    new LidlD1OffersProvider(env.DB),
    loyaltyRepository,
  );

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
  const matchedProductPreference = productMatch(url.pathname);
  const matchedLoyaltyProgram = loyaltyProgramMatch(url.pathname);
  const knownPrivatePath =
    matchedItem !== null ||
    matchedProductPreference !== null ||
    matchedLoyaltyProgram !== null ||
    url.pathname === '/api/pairings' ||
    url.pathname === '/api/shopping-cycle/active' ||
    url.pathname === '/api/shopping-cycle/complete' ||
    url.pathname === '/api/shopping-cycle/clear' ||
    url.pathname === '/api/items' ||
    url.pathname === '/api/supermarkets' ||
    url.pathname === '/api/offers' ||
    url.pathname === '/api/offers/for-list' ||
    url.pathname === '/api/settings/loyalty-programs' ||
    url.pathname === '/api/product-preferences/suggestions';
  if (!knownPrivatePath) throw notFound('La ruta solicitada no existe.');

  const device = await auth.authorize(request);

  if (url.pathname === '/api/settings/loyalty-programs') {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    return jsonResponse(await loyalty.list(device));
  }

  if (matchedLoyaltyProgram) {
    if (request.method !== 'PUT') return methodNotAllowed(['PUT']);
    const setting = await loyalty.set(
      device,
      matchedLoyaltyProgram.program,
      await readJsonObject(request),
    );
    realtime.publish(device, 'SETTINGS_UPDATED', { program: setting.program });
    return jsonResponse(setting);
  }

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

  if (matchedProductPreference) {
    if (request.method === 'PUT') {
      const body = await readJsonObject(request);
      const externalProductId = body['externalProductId'];
      if (
        typeof externalProductId !== 'string' ||
        externalProductId.length < 1 ||
        externalProductId.length > 100
      ) {
        throw badRequest(
          'INVALID_EXTERNAL_PRODUCT',
          'externalProductId debe identificar un producto publicado.',
        );
      }
      await listMatching.confirm(device, matchedProductPreference.itemId, externalProductId);
      return jsonResponse({ saved: true });
    }
    if (request.method === 'DELETE') {
      await listMatching.dismiss(device, matchedProductPreference.itemId);
      return new Response(null, { status: 204 });
    }
    return methodNotAllowed(['PUT', 'DELETE']);
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

  if (url.pathname === '/api/offers/for-list') {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    return jsonResponse(await listMatching.list(device));
  }

  if (url.pathname === '/api/product-preferences/suggestions') {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    return jsonResponse({ suggestions: await shopping.suggestions(device, url) });
  }

  throw notFound('La ruta solicitada no existe.');
};
