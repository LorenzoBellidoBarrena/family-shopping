import {
  applyD1Migrations,
  createExecutionContext,
  env,
  waitOnExecutionContext,
  type D1Migration,
} from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ShoppingCycle, ShoppingItem } from './domain/types';
import worker, { type Env } from './index';

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
  HOUSEHOLD_ACCESS_KEY: string;
}

interface BootstrapResponse {
  household: { id: string; name: string };
  device: { id: string };
  token: string;
  activeCycle: ShoppingCycle;
}

interface ItemResponse {
  item: ShoppingItem;
}

interface CycleResponse {
  cycle: ShoppingCycle;
}

interface PairingResponse {
  code: string;
  expiresAt: string;
  pairingUrl: string;
}

const testEnv = env as unknown as TestEnv;

const api = async (
  path: string,
  options: { method?: string; body?: unknown; token?: string; headers?: HeadersInit } = {},
): Promise<Response> => {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.token) headers.set('authorization', `Bearer ${options.token}`);
  const request = new Request(`https://example.test${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }) as unknown as Request<unknown, IncomingRequestCfProperties>;
  const context = createExecutionContext();
  const response = await worker.fetch!(request, testEnv, context);
  await waitOnExecutionContext(context);
  return response;
};

const connectWebSocket = async (token: string): Promise<Response> => {
  const request = new Request('https://example.test/ws', {
    headers: {
      connection: 'Upgrade',
      upgrade: 'websocket',
      'sec-websocket-protocol': `family-shopping, bearer.${token}`,
    },
  }) as unknown as Request<unknown, IncomingRequestCfProperties>;
  return worker.fetch!(request, testEnv, createExecutionContext());
};

const readJson = async <T>(response: Response): Promise<T> => (await response.json()) as T;

const bootstrap = async (): Promise<BootstrapResponse> => {
  const response = await api('/api/bootstrap', {
    method: 'POST',
    body: {
      accessKey: testEnv.HOUSEHOLD_ACCESS_KEY,
      householdName: 'Casa',
      deviceName: 'Móvil principal',
    },
  });
  expect(response.status).toBe(201);
  return readJson<BootstrapResponse>(response);
};

const addItem = async (
  token: string,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<ShoppingItem> => {
  const response = await api('/api/items', {
    method: 'POST',
    token,
    body: { name, ...extra },
  });
  expect(response.status).toBe(201);
  return (await readJson<ItemResponse>(response)).item;
};

const toggleItem = async (token: string, itemId: string): Promise<ShoppingItem> => {
  const response = await api(`/api/items/${itemId}/toggle`, { method: 'POST', token });
  expect(response.status).toBe(200);
  return (await readJson<ItemResponse>(response)).item;
};

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.batch([
    testEnv.DB.prepare(`DELETE FROM household_loyalty_programs`),
    testEnv.DB.prepare(`DELETE FROM product_aliases`),
    testEnv.DB.prepare(`DELETE FROM offers`),
    testEnv.DB.prepare(`DELETE FROM product_prices`),
    testEnv.DB.prepare(`DELETE FROM store_products`),
    testEnv.DB.prepare(`DELETE FROM external_products`),
    testEnv.DB.prepare(`DELETE FROM stores`),
    testEnv.DB.prepare(`DELETE FROM import_runs`),
    testEnv.DB.prepare(`DELETE FROM pairing_codes`),
    testEnv.DB.prepare(`DELETE FROM product_preferences`),
    testEnv.DB.prepare(`DELETE FROM shopping_items`),
    testEnv.DB.prepare(`DELETE FROM shopping_cycles`),
    testEnv.DB.prepare(`DELETE FROM devices`),
    testEnv.DB.prepare(`DELETE FROM app_state`),
    testEnv.DB.prepare(`DELETE FROM households`),
  ]);
});

describe('household bootstrap and authorization', () => {
  it('creates the household, first device, and one empty active cycle', async () => {
    const result = await bootstrap();

    expect(result.household.name).toBe('Casa');
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{40,100}$/u);
    expect(result.activeCycle.status).toBe('ACTIVE');
    expect(result.activeCycle.items).toEqual([]);
    const count = await testEnv.DB.prepare(
      `SELECT COUNT(*) AS count FROM shopping_cycles WHERE status = 'ACTIVE'`,
    ).first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it('rejects a second bootstrap after initialization', async () => {
    await bootstrap();
    const response = await api('/api/bootstrap', {
      method: 'POST',
      body: { accessKey: testEnv.HOUSEHOLD_ACCESS_KEY },
    });

    expect(response.status).toBe(409);
    expect(await readJson<{ error: { code: string } }>(response)).toMatchObject({
      error: { code: 'HOUSEHOLD_ALREADY_INITIALIZED' },
    });
  });

  it('rejects bootstrap when the one-time access key is invalid', async () => {
    const response = await api('/api/bootstrap/household', {
      method: 'POST',
      body: { accessKey: 'incorrect-access-key' },
    });

    expect(response.status).toBe(401);
    const count = await testEnv.DB.prepare(`SELECT COUNT(*) AS count FROM households`).first<{
      count: number;
    }>();
    expect(count?.count).toBe(0);
  });

  it('rejects an invalid device token on private endpoints', async () => {
    await bootstrap();
    const response = await api('/api/shopping-cycle/active', {
      token: 'invalid_token_that_is_long_enough_to_parse_123456789',
    });

    expect(response.status).toBe(401);
  });
});

describe('household loyalty settings API', () => {
  it('starts UNKNOWN and persists an authenticated Lidl Plus choice', async () => {
    const { token } = await bootstrap();
    const initial = await api('/api/settings/loyalty-programs', { token });
    expect(initial.status).toBe(200);
    expect(await readJson(initial)).toEqual({
      loyaltyPrograms: [{ program: 'LIDL_PLUS', status: 'UNKNOWN' }],
    });

    const enabled = await api('/api/settings/loyalty-programs/LIDL_PLUS', {
      method: 'PUT',
      token,
      body: { status: 'ENABLED', householdId: 'household-not-authorized' },
    });
    expect(enabled.status).toBe(200);
    expect(await readJson(enabled)).toEqual({ program: 'LIDL_PLUS', status: 'ENABLED' });

    const disabled = await api('/api/settings/loyalty-programs/LIDL_PLUS', {
      method: 'PUT',
      token,
      body: { status: 'DISABLED' },
    });
    expect(disabled.status).toBe(200);
    const current = await api('/api/settings/loyalty-programs', { token });
    expect(await readJson(current)).toEqual({
      loyaltyPrograms: [{ program: 'LIDL_PLUS', status: 'DISABLED' }],
    });
  });

  it('requires a device token and validates program and status', async () => {
    const { token } = await bootstrap();
    expect((await api('/api/settings/loyalty-programs')).status).toBe(401);
    expect(
      (
        await api('/api/settings/loyalty-programs/CLUB_DIA', {
          method: 'PUT',
          token,
          body: { status: 'ENABLED' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api('/api/settings/loyalty-programs/LIDL_PLUS', {
          method: 'PUT',
          token,
          body: { status: 'YES' },
        })
      ).status,
    ).toBe(400);
  });
});

describe('production hardening', () => {
  it('returns a JSON 404 for an unknown API route before authentication', async () => {
    const response = await api('/api/unknown');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await readJson<{ error: { code: string } }>(response)).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
  });

  it('adds restrictive security and cache headers to HTTP responses', async () => {
    const response = await api('/api/health');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(response.headers.get('content-security-policy')).not.toContain("'unsafe-inline'");
    expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('rejects oversized JSON before bootstrap processing', async () => {
    const response = await api('/api/bootstrap', {
      method: 'POST',
      body: { accessKey: 'x'.repeat(17 * 1024) },
    });

    expect(response.status).toBe(413);
    expect(await readJson<{ error: { code: string } }>(response)).toMatchObject({
      error: { code: 'PAYLOAD_TOO_LARGE' },
    });
  });
});

describe('shopping list domain', () => {
  it('keeps toggle isolated when the supermarket catalog contains 1,000 offers', async () => {
    const { token } = await bootstrap();
    const item = await addItem(token, 'Leche');
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO stores
           (id, supermarket_id, external_id, name, address, city, postal_code, active)
         VALUES ('perf-store', 'lidl', 'perf-store', 'Ámbito de prueba',
                 'Ámbito regional', 'Badajoz', '06000', 1)`,
      ),
      testEnv.DB.prepare(
        `WITH RECURSIVE sequence(value) AS (
           SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 1000
         )
         INSERT INTO external_products
           (id, supermarket_id, external_id, name, normalized_name, visual_category,
            offer_browse_category, last_seen_at)
         SELECT 'perf-product-' || value, 'lidl', 'perf-' || value,
                'Producto ' || value, 'producto ' || value, 'OTHER', 'OTHER',
                '2026-08-30T00:00:00.000Z'
         FROM sequence`,
      ),
      testEnv.DB.prepare(
        `INSERT INTO offers
           (id, product_id, store_id, normal_price_cents, offer_price_cents,
            promotion_type, valid_from, valid_until, source_url,
            requires_loyalty_card, observed_at)
         SELECT 'perf-offer-' || substr(id, 14), id, 'perf-store', 200, 150,
                'Oferta de prueba', '2026-08-01', '2026-09-30',
                'https://www.lidl.es/', 0, '2026-08-30T00:00:00.000Z'
         FROM external_products
         WHERE id LIKE 'perf-product-%' AND CAST(substr(id, 14) AS INTEGER) <= 10`,
      ),
    ]);

    const initialOfferCount = await testEnv.DB.prepare(
      `SELECT COUNT(*) AS count FROM offers WHERE id LIKE 'perf-offer-%'`,
    ).first<{ count: number }>();
    expect(initialOfferCount?.count).toBe(10);
    expect((await toggleItem(token, item.id)).checked).toBe(true);

    await testEnv.DB.prepare(
      `INSERT INTO offers
         (id, product_id, store_id, normal_price_cents, offer_price_cents,
          promotion_type, valid_from, valid_until, source_url,
          requires_loyalty_card, observed_at)
       SELECT 'perf-offer-' || substr(id, 14), id, 'perf-store', 200, 150,
              'Oferta de prueba', '2026-08-01', '2026-09-30',
              'https://www.lidl.es/', 0, '2026-08-30T00:00:00.000Z'
       FROM external_products
       WHERE id LIKE 'perf-product-%' AND CAST(substr(id, 14) AS INTEGER) > 10`,
    ).run();
    const expandedOfferCount = await testEnv.DB.prepare(
      `SELECT COUNT(*) AS count FROM offers WHERE id LIKE 'perf-offer-%'`,
    ).first<{ count: number }>();
    expect(expandedOfferCount?.count).toBe(1000);
    expect((await toggleItem(token, item.id)).checked).toBe(false);
  });

  it('adds a product with precise quantity and a stable sort order', async () => {
    const { token } = await bootstrap();
    const item = await addItem(token, 'Leche entera', {
      quantity: '1.5',
      unit: 'litro',
      supermarketId: 'lidl',
    });

    expect(item).toMatchObject({
      name: 'Leche entera',
      normalizedName: 'leche entera',
      category: 'DAIRY',
      quantity: '1.5',
      unit: 'litro',
      supermarketId: 'lidl',
      checked: false,
      sortOrder: 1000,
    });
  });

  it('reuses the existing normalization before deterministic classification', async () => {
    const { token } = await bootstrap();
    const milk = await addItem(token, '  LÉCHE   ');
    const unknown = await addItem(token, 'Producto desconocido');

    expect(milk).toMatchObject({ normalizedName: 'leche', category: 'DAIRY' });
    expect(unknown.category).toBe('OTHER');
  });

  it('rejects category codes outside the shared runtime contract', async () => {
    const { token } = await bootstrap();
    const response = await api('/api/items', {
      method: 'POST',
      token,
      body: { name: 'Leche', category: 'FOOD' },
    });

    expect(response.status).toBe(400);
    expect(await readJson<{ error: { code: string } }>(response)).toMatchObject({
      error: { code: 'INVALID_CATEGORY' },
    });
  });

  it('edits name, quantity, unit, and supermarket', async () => {
    const { token } = await bootstrap();
    const item = await addItem(token, 'Tomate');
    const response = await api(`/api/items/${item.id}`, {
      method: 'PATCH',
      token,
      body: { name: 'Tomates pera', quantity: '2.25', unit: 'kg', supermarketId: 'dia' },
    });

    expect(response.status).toBe(200);
    expect((await readJson<ItemResponse>(response)).item).toMatchObject({
      id: item.id,
      name: 'Tomates pera',
      normalizedName: 'tomates pera',
      quantity: '2.25',
      unit: 'kg',
      supermarketId: 'dia',
    });
  });

  it('toggles checked without changing the item position', async () => {
    const { token } = await bootstrap();
    const first = await addItem(token, 'Leche');
    const second = await addItem(token, 'Pan');
    const checked = await toggleItem(token, first.id);
    const response = await api('/api/shopping-cycle/active', { token });
    const cycle = (await readJson<CycleResponse>(response)).cycle;

    expect(checked.checked).toBe(true);
    expect(checked.sortOrder).toBe(first.sortOrder);
    expect(cycle.items.map((item) => item.id)).toEqual([first.id, second.id]);

    const unchecked = await toggleItem(token, first.id);
    expect(unchecked.checked).toBe(false);
    expect(unchecked.checkedAt).toBeNull();
    expect(unchecked.sortOrder).toBe(first.sortOrder);
  });

  it('deletes one product without affecting the rest', async () => {
    const { token } = await bootstrap();
    const first = await addItem(token, 'Leche');
    const second = await addItem(token, 'Pan');
    const deletion = await api(`/api/items/${first.id}`, { method: 'DELETE', token });
    const cycle = await api('/api/shopping-cycle/active', { token });

    expect(deletion.status).toBe(204);
    expect((await readJson<CycleResponse>(cycle)).cycle.items.map((item) => item.id)).toEqual([
      second.id,
    ]);
  });

  it('completes explicitly only after all products are checked', async () => {
    const { token, activeCycle } = await bootstrap();
    const item = await addItem(token, 'Leche');
    const premature = await api('/api/shopping-cycle/complete', { method: 'POST', token });
    expect(premature.status).toBe(409);

    await toggleItem(token, item.id);
    const response = await api('/api/shopping-cycle/complete', { method: 'POST', token });
    const result = await readJson<{ closedCycleId: string; cycle: ShoppingCycle }>(response);

    expect(response.status).toBe(201);
    expect(result.closedCycleId).toBe(activeCycle.id);
    expect(result.cycle.status).toBe('ACTIVE');
    expect(result.cycle.items).toEqual([]);
    const closed = await testEnv.DB.prepare(`SELECT status FROM shopping_cycles WHERE id = ?`)
      .bind(activeCycle.id)
      .first<{ status: string }>();
    expect(closed?.status).toBe('COMPLETED');
  });

  it('clears all products and starts a new empty cycle atomically', async () => {
    const { token, activeCycle } = await bootstrap();
    await addItem(token, 'Leche');
    await addItem(token, 'Pan');
    const response = await api('/api/shopping-cycle/clear', {
      method: 'POST',
      token,
      body: { action: 'CLEAR_ALL' },
    });
    const result = await readJson<{ closedCycleId: string; cycle: ShoppingCycle }>(response);

    expect(response.status).toBe(201);
    expect(result.closedCycleId).toBe(activeCycle.id);
    expect(result.cycle.items).toEqual([]);
    const closed = await testEnv.DB.prepare(
      `SELECT status, close_reason FROM shopping_cycles WHERE id = ?`,
    )
      .bind(activeCycle.id)
      .first<{ status: string; close_reason: string }>();
    expect(closed).toEqual({ status: 'CLEARED', close_reason: 'CLEAR_ALL' });
  });

  it('cancels clearing without changing the active cycle or its products', async () => {
    const { token, activeCycle } = await bootstrap();
    const item = await addItem(token, 'Leche');
    const response = await api('/api/shopping-cycle/clear', {
      method: 'POST',
      token,
      body: { action: 'CANCEL' },
    });
    const result = await readJson<{ cancelled: boolean; cycle: ShoppingCycle }>(response);

    expect(response.status).toBe(200);
    expect(result.cancelled).toBe(true);
    expect(result.cycle.id).toBe(activeCycle.id);
    expect(result.cycle.items.map((current) => current.id)).toEqual([item.id]);
  });

  it('carries only pending products into the new cycle', async () => {
    const { token } = await bootstrap();
    const pending = await addItem(token, 'Leche', {
      quantity: '6',
      unit: 'unidad',
      supermarketId: 'lidl',
    });
    const bought = await addItem(token, 'Pan');
    await toggleItem(token, bought.id);

    const response = await api('/api/shopping-cycle/clear', {
      method: 'POST',
      token,
      body: { action: 'CARRY_PENDING' },
    });
    const result = await readJson<{ cycle: ShoppingCycle }>(response);

    expect(result.cycle.items).toHaveLength(1);
    expect(result.cycle.items[0]).toMatchObject({
      name: pending.name,
      category: 'DAIRY',
      quantity: '6',
      unit: 'unidad',
      supermarketId: 'lidl',
      checked: false,
      sortOrder: pending.sortOrder,
    });
    expect(result.cycle.items[0].id).not.toBe(pending.id);
  });

  it('enforces one ACTIVE cycle per household at database level', async () => {
    const { household } = await bootstrap();
    await expect(
      testEnv.DB.prepare(
        `INSERT INTO shopping_cycles (id, household_id, status, created_at)
         VALUES (?, ?, 'ACTIVE', ?)`,
      )
        .bind(crypto.randomUUID(), household.id, new Date().toISOString())
        .run(),
    ).rejects.toThrow();
  });

  it('updates product preferences and returns habitual suggestions', async () => {
    const { token } = await bootstrap();
    await addItem(token, 'Leche', {
      quantity: '6',
      unit: 'unidad',
      supermarketId: 'lidl',
    });
    await api('/api/shopping-cycle/clear', {
      method: 'POST',
      token,
      body: { action: 'CLEAR_ALL' },
    });
    await addItem(token, 'Leche', {
      quantity: '2',
      unit: 'botella',
      supermarketId: 'mercadona',
    });
    const response = await api('/api/product-preferences/suggestions?query=lech&limit=5', {
      token,
    });
    const result = await readJson<{
      suggestions: { name: string; useCount: number; quantity: string; unit: string }[];
    }>(response);

    expect(result.suggestions[0]).toMatchObject({
      name: 'Leche',
      category: 'DAIRY',
      useCount: 2,
      quantity: '2',
      unit: 'botella',
    });
  });

  it('learns a manual category correction and prioritizes it on the next creation', async () => {
    const { token } = await bootstrap();
    const original = await addItem(token, 'Bebida de casa');
    expect(original.category).toBe('OTHER');

    const correction = await api(`/api/items/${original.id}`, {
      method: 'PATCH',
      token,
      body: { category: 'DAIRY' },
    });
    expect((await readJson<ItemResponse>(correction)).item.category).toBe('DAIRY');

    await api('/api/shopping-cycle/clear', {
      method: 'POST',
      token,
      body: { action: 'CLEAR_ALL' },
    });
    const learned = await addItem(token, '  BEBIDA DE CASA ');
    expect(learned).toMatchObject({ normalizedName: 'bebida de casa', category: 'DAIRY' });
  });
});

describe('device pairing', () => {
  it('requires an authorized device to create a pairing', async () => {
    await bootstrap();
    const missing = await api('/api/pairings', { method: 'POST' });
    const invalid = await api('/api/pairings', {
      method: 'POST',
      token: 'invalid-token-long-enough-for-validation-123456789',
    });

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
  });

  it('rejects an expired pairing code', async () => {
    const primary = await bootstrap();
    const { token } = primary;
    const generated = await api('/api/pairings', { method: 'POST', token });
    const pairing = await readJson<PairingResponse>(generated);
    await testEnv.DB.prepare(`UPDATE pairing_codes SET expires_at = ?`)
      .bind('2000-01-01T00:00:00.000Z')
      .run();

    const response = await api('/api/pairings/consume', {
      method: 'POST',
      body: { code: pairing.code, deviceName: 'Segundo móvil' },
    });
    expect(response.status).toBe(410);
  });

  it('allows pairing exactly once and stores only the new token hash', async () => {
    const primary = await bootstrap();
    const { token } = primary;
    const generated = await api('/api/pairings', { method: 'POST', token });
    const pairing = await readJson<PairingResponse>(generated);
    expect(new Date(pairing.expiresAt).getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    expect(new URL(pairing.pairingUrl).pathname).toBe('/pair');
    expect(new URL(pairing.pairingUrl).searchParams.get('code')).toBe(pairing.code);

    const first = await api('/api/pairings/consume', {
      method: 'POST',
      body: { code: pairing.code, deviceName: 'Segundo móvil' },
    });
    const firstResult = await readJson<{
      device: { id: string; householdId: string };
      token: string;
    }>(first);
    const second = await api('/api/pairings/consume', {
      method: 'POST',
      body: { code: pairing.code, deviceName: 'Tercer móvil' },
    });

    expect(first.status).toBe(201);
    expect(firstResult.token).toMatch(/^[A-Za-z0-9_-]{40,100}$/u);
    expect(firstResult.token).not.toBe(primary.token);
    expect(firstResult.device.id).not.toBe(primary.device.id);
    expect(firstResult.device.householdId).toBe(primary.household.id);
    expect(second.status).toBe(410);
    const stored = await testEnv.DB.prepare(
      `SELECT id, household_id, token_hash FROM devices ORDER BY created_at, id`,
    ).all<{ id: string; household_id: string; token_hash: string }>();
    expect(stored.results).toHaveLength(2);
    expect(new Set(stored.results.map((device) => device.id)).size).toBe(2);
    expect(stored.results.every((device) => device.household_id === primary.household.id)).toBe(
      true,
    );
    expect(stored.results.every((device) => device.token_hash.length === 64)).toBe(true);
    expect(stored.results.every((device) => device.token_hash !== primary.token)).toBe(true);
    expect(stored.results.every((device) => device.token_hash !== firstResult.token)).toBe(true);
  });
});

describe('supermarket offers module', () => {
  it('protects imports with a separate secret while allowing controlled manual runs', async () => {
    const unauthorized = await api('/api/admin/imports');
    const listing = await api('/api/admin/imports', {
      headers: { 'x-import-admin-key': 'integration-test-import-admin-key' },
    });
    const invalidCarrefour = await api('/api/admin/imports/carrefour?limit=0', {
      method: 'POST',
      headers: { 'x-import-admin-key': 'integration-test-import-admin-key' },
    });
    const invalidDia = await api('/api/admin/imports/dia?limit=0', {
      method: 'POST',
      headers: { 'x-import-admin-key': 'integration-test-import-admin-key' },
    });
    const invalidLidl = await api('/api/admin/imports/lidl?limit=0', {
      method: 'POST',
      headers: { 'x-import-admin-key': 'integration-test-import-admin-key' },
    });

    expect(unauthorized.status).toBe(401);
    expect(listing.status).toBe(200);
    expect(await readJson<{ imports: unknown[] }>(listing)).toEqual({ imports: [] });
    expect(invalidCarrefour.status).toBe(400);
    expect(invalidDia.status).toBe(400);
    expect(invalidLidl.status).toBe(400);
    expect(await readJson<{ error: { code: string } }>(invalidCarrefour)).toMatchObject({
      error: { code: 'INVALID_LIMIT' },
    });
  });

  it('requires authorization and validates the supermarket filter', async () => {
    const { token } = await bootstrap();
    const unauthorized = await api('/api/offers');
    const invalid = await api('/api/offers?supermarket=unknown', { token });

    expect(unauthorized.status).toBe(401);
    expect(invalid.status).toBe(400);
    expect(await readJson<{ error: { code: string } }>(invalid)).toMatchObject({
      error: { code: 'INVALID_SUPERMARKET' },
    });
  });

  it('isolates fixture providers and filters by chain without coupling catalog to the list', async () => {
    const { token } = await bootstrap();
    await addItem(token, 'Leche');
    const all = await api('/api/offers', { token });
    const result = await readJson<{
      offers: {
        supermarketId: string;
        productName: string;
        relatedToList: boolean;
        matchedItemNames: string[];
        catalogAvailability: string;
        fixture: boolean;
      }[];
      partial: boolean;
    }>(all);
    const filtered = await api('/api/offers?supermarket=dia', { token });
    const dia = await readJson<{ offers: { supermarketId: string }[] }>(filtered);

    expect(all.status).toBe(200);
    expect(result.partial).toBe(false);
    expect(result.offers).toHaveLength(8);
    const lidlMilk = result.offers.find(
      (offer) => offer.supermarketId === 'lidl' && offer.productName === 'Leche entera 1 litro',
    );
    expect(lidlMilk).toMatchObject({
      supermarketId: 'lidl',
      productName: 'Leche entera 1 litro',
      relatedToList: false,
      matchedItemNames: [],
      catalogAvailability: 'PUBLISHED',
      fixture: true,
    });
    expect(dia.offers).toHaveLength(2);
    expect(dia.offers.every((offer) => offer.supermarketId === 'dia')).toBe(true);
  });

  it('protects list matching and learns a confirmed Lidl product without renaming the item', async () => {
    const { token, household } = await bootstrap();
    const milk = await addItem(token, 'Leche', { supermarketId: 'lidl' });
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO stores
           (id, supermarket_id, external_id, name, address, city, postal_code, active)
         VALUES ('lidl-region', 'lidl', 'region-badajoz', 'Ámbito Badajoz',
                 'Ámbito regional', 'Badajoz', '06000', 1)`,
      ),
      testEnv.DB.prepare(
        `INSERT INTO import_runs
           (id, provider, started_at, finished_at, status, products_seen, prices_seen, offers_seen)
         VALUES ('run-lidl', 'lidl', '2026-08-29T05:00:00.000Z',
                 '2026-08-29T05:00:10.000Z', 'SUCCESS', 1, 1, 1)`,
      ),
      testEnv.DB.prepare(
        `INSERT INTO external_products
           (id, supermarket_id, external_id, name, normalized_name, brand, category,
            visual_category, package_quantity, package_unit, last_seen_at)
         VALUES ('milk-semi', 'lidl', 'milk-semi', 'Leche semidesnatada Milbona',
                 'leche semidesnatada milbona', 'MILBONA', 'Lácteos/Leche y nata',
                 'DAIRY', 1, 'l', '2026-08-29T05:00:05.000Z')`,
      ),
      testEnv.DB.prepare(
        `INSERT INTO store_products (store_id, product_id, catalog_status, observed_at)
         VALUES ('lidl-region', 'milk-semi', 'PUBLISHED', '2026-08-29T05:00:05.000Z')`,
      ),
      testEnv.DB.prepare(
        `INSERT INTO product_prices
           (id, product_id, store_id, price_cents, observed_at, channel, geographic_scope)
         VALUES ('price-milk', 'milk-semi', 'lidl-region', 99,
                 '2026-08-29T05:00:05.000Z', 'STORE', 'REGIONAL')`,
      ),
      testEnv.DB.prepare(
        `INSERT INTO offers
           (id, product_id, store_id, normal_price_cents, offer_price_cents, promotion_type,
            valid_from, valid_until, source_url, requires_loyalty_card, observed_at,
            offer_type, channel, geographic_scope)
         VALUES ('offer-milk', 'milk-semi', 'lidl-region', 99, 89, 'Oferta semanal',
                 '2026-08-01', '2099-08-30', 'https://www.lidl.es/c/oferta', 0,
                 '2026-08-29T05:00:05.000Z', 'DIRECT_DISCOUNT', 'STORE', 'REGIONAL')`,
      ),
    ]);

    const unauthorized = await api('/api/offers/for-list');
    const suggestions = await api('/api/offers/for-list', { token });
    const suggestionBody = await readJson<{
      matchedItems: {
        shoppingItemId: string;
        automaticMatchExternalProductId: string | null;
        candidates: {
          externalProductId: string;
          confidence: string;
          activeOffers: unknown[];
          package: unknown;
          pricing: unknown;
        }[];
      }[];
    }>(suggestions);

    expect(unauthorized.status).toBe(401);
    expect(suggestions.status).toBe(200);
    expect(suggestionBody.matchedItems[0]).toMatchObject({
      shoppingItemId: milk.id,
      automaticMatchExternalProductId: null,
      candidates: [
        {
          externalProductId: 'milk-semi',
          confidence: 'MEDIUM',
          activeOffers: expect.any(Array),
          package: {
            fit: 'GOOD',
            packsNeeded: 1,
            requestedAmount: 1,
            purchasedAmount: 1,
            excessAmount: 0,
            unit: 'COUNT',
            approximate: false,
            descriptor: expect.objectContaining({ description: '1 l', totalAmount: 1000 }),
            costs: {
              regularCostCents: 99,
              generalOfferCostCents: 89,
              lidlPlusCostCents: null,
            },
          },
          pricing: {
            effectiveCostCents: 89,
            effectivePriceReason: 'GENERAL_OFFER',
            potentialLoyaltyCostCents: null,
            generalSavingCents: 10,
            additionalLoyaltySavingCents: null,
            totalSavingCents: 10,
          },
        },
      ],
    });

    const saved = await api(`/api/items/${milk.id}/product-match`, {
      method: 'PUT',
      token,
      body: { externalProductId: 'milk-semi' },
    });
    const learned = await api('/api/offers/for-list', { token });
    const learnedBody = await readJson<{
      matchedItems: {
        automaticMatchExternalProductId: string | null;
        candidates: { externalProductId: string; confidence: string; preferred: boolean }[];
      }[];
    }>(learned);
    const canonical = await api('/api/shopping-cycle/active', { token });

    expect(saved.status).toBe(200);
    expect(learnedBody.matchedItems[0]).toMatchObject({
      automaticMatchExternalProductId: 'milk-semi',
      candidates: [{ externalProductId: 'milk-semi', confidence: 'HIGH', preferred: true }],
    });
    expect((await readJson<CycleResponse>(canonical)).cycle).toMatchObject({
      householdId: household.id,
      items: [{ id: milk.id, name: 'Leche' }],
    });
  });
});

describe('household realtime channel', () => {
  it('rejects a WebSocket without a valid device credential', async () => {
    await bootstrap();
    const response = await connectWebSocket('invalid-token-long-enough-for-validation-123456789');

    expect(response.status).toBe(401);
  });

  it('broadcasts a household settings change to the other paired device', async () => {
    const primary = await bootstrap();
    const generated = await api('/api/pairings', { method: 'POST', token: primary.token });
    const pairing = await readJson<PairingResponse>(generated);
    const consumed = await api('/api/pairings/consume', {
      method: 'POST',
      body: { code: pairing.code, deviceName: 'Segundo móvil' },
    });
    const secondary = await readJson<{ token: string }>(consumed);
    const upgrade = await connectWebSocket(secondary.token);
    expect(upgrade.status).toBe(101);
    const socket = upgrade.webSocket!;
    socket.accept();
    const message = new Promise<MessageEvent>((resolve) =>
      socket.addEventListener('message', resolve, { once: true }),
    );

    const updated = await api('/api/settings/loyalty-programs/LIDL_PLUS', {
      method: 'PUT',
      token: primary.token,
      body: { status: 'ENABLED' },
    });
    expect(updated.status).toBe(200);
    expect(JSON.parse(String((await message).data))).toMatchObject({
      version: 1,
      type: 'SETTINGS_UPDATED',
      householdId: primary.household.id,
      payload: { program: 'LIDL_PLUS' },
    });
    const secondaryRead = await api('/api/settings/loyalty-programs', {
      token: secondary.token,
    });
    expect(await readJson(secondaryRead)).toEqual({
      loyaltyPrograms: [{ program: 'LIDL_PLUS', status: 'ENABLED' }],
    });
    socket.close(1000, 'test complete');
  });

  it('authorizes a paired device and broadcasts versioned events from another device', async () => {
    const primary = await bootstrap();
    const generated = await api('/api/pairings', { method: 'POST', token: primary.token });
    const pairing = await readJson<PairingResponse>(generated);
    const consumed = await api('/api/pairings/consume', {
      method: 'POST',
      body: { code: pairing.code, deviceName: 'Segundo móvil' },
    });
    const secondary = await readJson<{ token: string }>(consumed);
    const upgrade = await connectWebSocket(secondary.token);

    expect(upgrade.status).toBe(101);
    expect(upgrade.webSocket).toBeDefined();
    const socket = upgrade.webSocket!;
    socket.accept();
    const message = new Promise<MessageEvent>((resolve) =>
      socket.addEventListener('message', resolve, { once: true }),
    );

    const created = await addItem(primary.token, 'Café');
    const event = JSON.parse(String((await message).data)) as {
      version: number;
      type: string;
      householdId: string;
      revision: number;
      payload: { item: { id: string; category: string } };
    };

    expect(event).toMatchObject({
      version: 1,
      type: 'ITEM_CREATED',
      householdId: primary.household.id,
      revision: 1,
      payload: { item: { id: created.id, category: 'COFFEE_TEA' } },
    });

    const secondaryRead = await api('/api/shopping-cycle/active', { token: secondary.token });
    expect(secondaryRead.status).toBe(200);
    expect((await readJson<CycleResponse>(secondaryRead)).cycle.items[0].id).toBe(created.id);

    const updatedMessage = new Promise<MessageEvent>((resolve) =>
      socket.addEventListener('message', resolve, { once: true }),
    );
    const update = await api(`/api/items/${created.id}`, {
      method: 'PATCH',
      token: primary.token,
      body: { category: 'OTHER' },
    });
    expect(update.status).toBe(200);
    const updatedEvent = JSON.parse(String((await updatedMessage).data)) as {
      type: string;
      payload: { item: ShoppingItem };
    };
    expect(updatedEvent).toMatchObject({
      type: 'ITEM_UPDATED',
      payload: { item: { id: created.id, category: 'OTHER' } },
    });
    const secondaryAfterUpdate = await api('/api/shopping-cycle/active', {
      token: secondary.token,
    });
    expect((await readJson<CycleResponse>(secondaryAfterUpdate)).cycle.items[0].category).toBe(
      'OTHER',
    );

    const primaryUpgrade = await connectWebSocket(primary.token);
    expect(primaryUpgrade.status).toBe(101);
    const primarySocket = primaryUpgrade.webSocket!;
    primarySocket.accept();
    const checkedMessage = new Promise<MessageEvent>((resolve) =>
      primarySocket.addEventListener('message', resolve, { once: true }),
    );
    const second = await addItem(primary.token, 'Pan');
    const toggled = await toggleItem(secondary.token, created.id);
    const checkedEvent = JSON.parse(String((await checkedMessage).data)) as {
      type: string;
      payload: { item: ShoppingItem };
    };
    const canonical = await api('/api/shopping-cycle/active', { token: primary.token });

    expect(toggled.checked).toBe(true);
    expect(checkedEvent).toMatchObject({
      type: 'ITEM_CHECKED',
      payload: { item: { id: created.id, checked: true, sortOrder: created.sortOrder } },
    });
    expect((await readJson<CycleResponse>(canonical)).cycle.items.map((item) => item.id)).toEqual([
      created.id,
      second.id,
    ]);
    socket.close(1000, 'test complete');
    primarySocket.close(1000, 'test complete');
  });
});
