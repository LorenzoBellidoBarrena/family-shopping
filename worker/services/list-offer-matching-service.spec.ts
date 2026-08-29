import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Device } from '../domain/types';
import { LidlD1OffersProvider } from '../providers/lidl-d1-offers-provider';
import { D1Repository } from '../repositories/d1-repository';
import { ProductMatchRepository } from '../repositories/product-match-repository';
import { ListOfferMatchingService } from './list-offer-matching-service';

interface MatchTestEnv {
  DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as unknown as MatchTestEnv;
const today = '2026-08-29';

const device = (householdId: string): Device => ({
  id: `device-${householdId}`,
  householdId,
  name: null,
  createdAt: '2026-08-28T00:00:00.000Z',
  lastSeenAt: '2026-08-28T00:00:00.000Z',
});

const createHousehold = async (
  householdId: string,
  item: { name: string; normalizedName: string; supermarketId?: string | null },
): Promise<void> => {
  const cycleId = `cycle-${householdId}`;
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO households (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    ).bind(householdId, householdId, '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z'),
    testEnv.DB.prepare(
      `INSERT INTO shopping_cycles (id, household_id, status, created_at)
       VALUES (?, ?, 'ACTIVE', ?)`,
    ).bind(cycleId, householdId, '2026-08-28T00:00:00.000Z'),
    testEnv.DB.prepare(
      `INSERT INTO shopping_items
         (id, shopping_cycle_id, name, normalized_name, quantity_milli, unit,
          supermarket_id, category, checked, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1000, 'unidad', ?, 'DAIRY', 0, 1000, ?, ?)`,
    ).bind(
      `item-${householdId}`,
      cycleId,
      item.name,
      item.normalizedName,
      item.supermarketId ?? null,
      '2026-08-28T00:00:00.000Z',
      '2026-08-28T00:00:00.000Z',
    ),
  ]);
};

const createProduct = async (
  id: string,
  name: string,
  variantPrice: number,
  withOffer = false,
): Promise<void> => {
  const statements: D1PreparedStatement[] = [
    testEnv.DB.prepare(
      `INSERT INTO external_products
         (id, supermarket_id, external_id, name, normalized_name, brand, category,
          visual_category, package_quantity, package_unit, last_seen_at)
       VALUES (?, 'lidl', ?, ?, ?, 'MILBONA', 'Lácteos/Leche y nata',
               'DAIRY', 1, 'l', '2026-08-28T05:00:05.000Z')`,
    ).bind(id, id, name, name.toLocaleLowerCase('es')),
    testEnv.DB.prepare(
      `INSERT INTO store_products (store_id, product_id, catalog_status, observed_at)
       VALUES ('lidl-region', ?, 'PUBLISHED', '2026-08-28T05:00:05.000Z')`,
    ).bind(id),
    testEnv.DB.prepare(
      `INSERT INTO product_prices
         (id, product_id, store_id, price_cents, observed_at, channel, geographic_scope)
       VALUES (?, ?, 'lidl-region', ?, '2026-08-28T05:00:05.000Z', 'STORE', 'REGIONAL')`,
    ).bind(`price-${id}`, id, variantPrice),
  ];
  if (withOffer) {
    statements.push(
      testEnv.DB.prepare(
        `INSERT INTO offers
           (id, product_id, store_id, normal_price_cents, offer_price_cents, promotion_type,
            valid_from, valid_until, source_url, requires_loyalty_card, observed_at,
            offer_type, channel, geographic_scope)
         VALUES (?, ?, 'lidl-region', ?, ?, 'Oferta semanal', '2026-08-24', '2026-08-30',
                 'https://www.lidl.es/c/oferta', 0, '2026-08-28T05:00:05.000Z',
                 'DIRECT_DISCOUNT', 'STORE', 'REGIONAL')`,
      ).bind(`offer-${id}`, id, variantPrice, variantPrice - 10),
      testEnv.DB.prepare(
        `INSERT INTO offers
           (id, product_id, store_id, normal_price_cents, offer_price_cents, promotion_type,
            valid_from, valid_until, source_url, requires_loyalty_card, observed_at,
            offer_type, channel, geographic_scope, loyalty_program)
         VALUES (?, ?, 'lidl-region', ?, ?, 'Precio Lidl Plus', '2026-08-24', '2026-08-30',
                 'https://www.lidl.es/c/oferta', 1, '2026-08-28T05:00:05.000Z',
                 'LOYALTY_PRICE', 'STORE', 'REGIONAL', 'LIDL_PLUS')`,
      ).bind(`plus-${id}`, id, variantPrice, variantPrice - 20),
    );
  }
  await testEnv.DB.batch(statements);
};

const service = (): ListOfferMatchingService =>
  new ListOfferMatchingService(
    new D1Repository(testEnv.DB),
    new ProductMatchRepository(testEnv.DB),
    new LidlD1OffersProvider(testEnv.DB, today),
  );

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.batch([
    testEnv.DB.prepare(`DELETE FROM product_aliases`),
    testEnv.DB.prepare(`DELETE FROM offers`),
    testEnv.DB.prepare(`DELETE FROM product_prices`),
    testEnv.DB.prepare(`DELETE FROM store_products`),
    testEnv.DB.prepare(`DELETE FROM external_products`),
    testEnv.DB.prepare(`DELETE FROM stores`),
    testEnv.DB.prepare(`DELETE FROM import_runs`),
    testEnv.DB.prepare(`DELETE FROM shopping_items`),
    testEnv.DB.prepare(`DELETE FROM shopping_cycles`),
    testEnv.DB.prepare(`DELETE FROM households`),
  ]);
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
       VALUES ('run-current', 'lidl', '2026-08-28T05:00:00.000Z',
               '2026-08-28T05:00:10.000Z', 'SUCCESS', 3, 3, 2)`,
    ),
  ]);
});

describe('ListOfferMatchingService', () => {
  it('returns ambiguous milk candidates and keeps general plus Lidl Plus prices together', async () => {
    await createHousehold('house-a', {
      name: 'Leche',
      normalizedName: 'leche',
      supermarketId: 'lidl',
    });
    await createProduct('milk-whole', 'Leche entera Milbona', 99);
    await createProduct('milk-semi', 'Leche semidesnatada Milbona', 95, true);
    await createProduct('milk-skimmed', 'Leche desnatada Milbona', 92);

    const result = await service().list(device('house-a'));

    expect(result.unmatchedItems).toEqual([]);
    expect(result.matchedItems[0]).toMatchObject({
      automaticMatchExternalProductId: null,
      dismissed: false,
    });
    expect(result.matchedItems[0].candidates).toHaveLength(3);
    expect(
      result.matchedItems[0].candidates.every((candidate) => candidate.confidence === 'MEDIUM'),
    ).toBe(true);
    const semi = result.matchedItems[0].candidates.find(
      (candidate) => candidate.externalProductId === 'milk-semi',
    );
    expect(semi?.activeOffers[0]).toMatchObject({
      offerPriceCents: 85,
      lidlPlusPriceCents: 75,
    });
  });

  it('learns a manual selection by household and normalized name across cycles', async () => {
    await createHousehold('house-a', { name: 'Leche', normalizedName: 'leche' });
    await createProduct('milk-whole', 'Leche entera Milbona', 99);
    await createProduct('milk-semi', 'Leche semidesnatada Milbona', 95);
    const matching = service();

    await matching.confirm(device('house-a'), 'item-house-a', 'milk-semi');
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `UPDATE shopping_cycles SET status = 'CLEARED', closed_at = ?, close_reason = 'CLEAR_ALL'
         WHERE id = 'cycle-house-a'`,
      ).bind('2026-08-29T00:00:00.000Z'),
      testEnv.DB.prepare(
        `INSERT INTO shopping_cycles (id, household_id, status, created_at)
         VALUES ('cycle-house-a-next', 'house-a', 'ACTIVE', '2026-08-29T00:00:00.000Z')`,
      ),
      testEnv.DB.prepare(
        `INSERT INTO shopping_items
           (id, shopping_cycle_id, name, normalized_name, quantity_milli, unit, category,
            checked, sort_order, created_at, updated_at)
         VALUES ('item-house-a-next', 'cycle-house-a-next', 'LECHE', 'leche', 1000,
                 'unidad', 'DAIRY', 0, 1000, ?, ?)`,
      ).bind('2026-08-29T00:00:00.000Z', '2026-08-29T00:00:00.000Z'),
    ]);

    const learned = await matching.list(device('house-a'));
    expect(learned.matchedItems[0]).toMatchObject({
      shoppingItemId: 'item-house-a-next',
      automaticMatchExternalProductId: 'milk-semi',
    });
    expect(learned.matchedItems[0].candidates[0]).toMatchObject({
      externalProductId: 'milk-semi',
      confidence: 'HIGH',
      score: 100,
      preferred: true,
      reasons: ['CONFIRMED_ALIAS'],
    });

    await matching.confirm(device('house-a'), 'item-house-a-next', 'milk-whole');
    const corrected = await matching.list(device('house-a'));
    expect(corrected.matchedItems[0].automaticMatchExternalProductId).toBe('milk-whole');
    expect(corrected.matchedItems[0].candidates[0]).toMatchObject({
      externalProductId: 'milk-whole',
      preferred: true,
      confidence: 'HIGH',
    });
  });

  it('keeps learned choices isolated between households', async () => {
    await createHousehold('house-a', { name: 'Leche', normalizedName: 'leche' });
    await createHousehold('house-b', { name: 'Leche', normalizedName: 'leche' });
    await createProduct('milk-whole', 'Leche entera Milbona', 99);
    await createProduct('milk-semi', 'Leche semidesnatada Milbona', 95);
    const matching = service();

    await matching.confirm(device('house-a'), 'item-house-a', 'milk-semi');
    await matching.confirm(device('house-b'), 'item-house-b', 'milk-whole');

    const [houseA, houseB] = await Promise.all([
      matching.list(device('house-a')),
      matching.list(device('house-b')),
    ]);
    expect(houseA.matchedItems[0].automaticMatchExternalProductId).toBe('milk-semi');
    expect(houseB.matchedItems[0].automaticMatchExternalProductId).toBe('milk-whole');
  });

  it('falls back to current candidates when the preferred product disappears', async () => {
    await createHousehold('house-a', { name: 'Leche', normalizedName: 'leche' });
    await createProduct('milk-whole', 'Leche entera Milbona', 99);
    await createProduct('milk-semi', 'Leche semidesnatada Milbona', 95);
    const matching = service();
    await matching.confirm(device('house-a'), 'item-house-a', 'milk-semi');
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO import_runs
           (id, provider, started_at, finished_at, status, products_seen, prices_seen, offers_seen)
         VALUES ('run-next', 'lidl', '2026-08-29T05:00:00.000Z',
                 '2026-08-29T05:00:10.000Z', 'SUCCESS', 1, 1, 0)`,
      ),
      testEnv.DB.prepare(
        `UPDATE external_products SET last_seen_at = '2026-08-29T05:00:05.000Z'
         WHERE id = 'milk-whole'`,
      ),
    ]);

    const result = await matching.list(device('house-a'));
    expect(result.matchedItems[0].automaticMatchExternalProductId).toBeNull();
    expect(
      result.matchedItems[0].candidates.map((candidate) => candidate.externalProductId),
    ).toEqual(['milk-whole']);
  });

  it('allows an automatic preference to be dismissed without deleting its suggestions', async () => {
    await createHousehold('house-a', { name: 'Leche', normalizedName: 'leche' });
    await createProduct('milk-semi', 'Leche semidesnatada Milbona', 95);
    const matching = service();
    await matching.confirm(device('house-a'), 'item-house-a', 'milk-semi');

    await matching.dismiss(device('house-a'), 'item-house-a');
    const result = await matching.list(device('house-a'));

    expect(result.matchedItems[0]).toMatchObject({
      dismissed: true,
      automaticMatchExternalProductId: null,
    });
    expect(result.matchedItems[0].candidates).toEqual([
      expect.objectContaining({
        externalProductId: 'milk-semi',
        confidence: 'MEDIUM',
        preferred: false,
      }),
    ]);
  });

  it('does not suggest Lidl for an item assigned to another supermarket', async () => {
    await createHousehold('house-a', {
      name: 'Leche',
      normalizedName: 'leche',
      supermarketId: 'mercadona',
    });
    await createProduct('milk-semi', 'Leche semidesnatada Milbona', 95);

    const result = await service().list(device('house-a'));
    expect(result.matchedItems).toEqual([]);
    expect(result.unmatchedItems).toEqual([
      {
        shoppingItemId: 'item-house-a',
        shoppingItemName: 'Leche',
        reason: 'PREFERRED_OTHER_SUPERMARKET',
      },
    ]);
  });

  it('allows Lidl candidates when the family selected ANY', async () => {
    await createHousehold('house-a', {
      name: 'Leche',
      normalizedName: 'leche',
      supermarketId: 'any',
    });
    await createProduct('milk-semi', 'Leche semidesnatada Milbona', 95);

    const result = await service().list(device('house-a'));
    expect(result.unmatchedItems).toEqual([]);
    expect(result.matchedItems[0].candidates).toEqual([
      expect.objectContaining({
        externalProductId: 'milk-semi',
        confidence: 'MEDIUM',
      }),
    ]);
  });

  it('does not prioritize already checked shopping items', async () => {
    await createHousehold('house-a', { name: 'Leche', normalizedName: 'leche' });
    await createProduct('milk-semi', 'Leche semidesnatada Milbona', 95);
    await testEnv.DB.prepare(
      `UPDATE shopping_items SET checked = 1, checked_at = '2026-08-29T00:00:00.000Z'
       WHERE id = 'item-house-a'`,
    ).run();

    const result = await service().list(device('house-a'));
    expect(result).toMatchObject({ matchedItems: [], unmatchedItems: [] });
  });
});
