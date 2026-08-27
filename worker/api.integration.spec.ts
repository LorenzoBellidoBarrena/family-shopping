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
}

const testEnv = env as unknown as TestEnv;

const api = async (
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<Response> => {
  const headers = new Headers();
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
  const response = await api('/api/bootstrap/household', {
    method: 'POST',
    body: {
      accessKey: 'integration-test-access-key',
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
    const response = await api('/api/bootstrap/household', {
      method: 'POST',
      body: { accessKey: 'integration-test-access-key' },
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

describe('shopping list domain', () => {
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
      quantity: '1.5',
      unit: 'litro',
      supermarketId: 'lidl',
      checked: false,
      sortOrder: 1000,
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
      useCount: 2,
      quantity: '2',
      unit: 'botella',
    });
  });
});

describe('device pairing', () => {
  it('rejects an expired pairing code', async () => {
    const { token } = await bootstrap();
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
    const { token } = await bootstrap();
    const generated = await api('/api/pairings', { method: 'POST', token });
    const pairing = await readJson<PairingResponse>(generated);
    expect(new Date(pairing.expiresAt).getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000);

    const first = await api('/api/pairings/consume', {
      method: 'POST',
      body: { code: pairing.code, deviceName: 'Segundo móvil' },
    });
    const firstResult = await readJson<{ device: { id: string }; token: string }>(first);
    const second = await api('/api/pairings/consume', {
      method: 'POST',
      body: { code: pairing.code, deviceName: 'Tercer móvil' },
    });

    expect(first.status).toBe(201);
    expect(firstResult.token).toMatch(/^[A-Za-z0-9_-]{40,100}$/u);
    expect(second.status).toBe(410);
    const stored = await testEnv.DB.prepare(`SELECT token_hash FROM devices WHERE id = ?`)
      .bind(firstResult.device.id)
      .first<{ token_hash: string }>();
    expect(stored?.token_hash).toHaveLength(64);
    expect(stored?.token_hash).not.toBe(firstResult.token);
  });
});

describe('household realtime channel', () => {
  it('rejects a WebSocket without a valid device credential', async () => {
    await bootstrap();
    const response = await connectWebSocket('invalid-token-long-enough-for-validation-123456789');

    expect(response.status).toBe(401);
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
      payload: { item: { id: string } };
    };

    expect(event).toMatchObject({
      version: 1,
      type: 'ITEM_CREATED',
      householdId: primary.household.id,
      revision: 1,
      payload: { item: { id: created.id } },
    });
    socket.close(1000, 'test complete');
  });
});
