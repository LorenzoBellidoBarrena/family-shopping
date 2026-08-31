import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Device } from '../domain/types';
import { LidlD1OffersProvider } from '../providers/lidl-d1-offers-provider';
import { D1Repository } from '../repositories/d1-repository';
import { ProductMatchRepository } from '../repositories/product-match-repository';
import { HouseholdLoyaltyRepository } from '../repositories/household-loyalty-repository';
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
  item: {
    name: string;
    normalizedName: string;
    supermarketId?: string | null;
    category?: string;
  },
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
       VALUES (?, ?, ?, ?, 1000, 'unidad', ?, ?, 0, 1000, ?, ?)`,
    ).bind(
      `item-${householdId}`,
      cycleId,
      item.name,
      item.normalizedName,
      item.supermarketId ?? null,
      item.category ?? 'DAIRY',
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
  classification: {
    category?: string;
    visualCategory?: string;
    packageQuantity?: number;
    packageUnit?: string;
  } = {},
): Promise<void> => {
  const statements: D1PreparedStatement[] = [
    testEnv.DB.prepare(
      `INSERT INTO external_products
         (id, supermarket_id, external_id, name, normalized_name, brand, category,
          visual_category, package_quantity, package_unit, last_seen_at)
       VALUES (?, 'lidl', ?, ?, ?, 'MILBONA', ?, ?, ?, ?,
               '2026-08-28T05:00:05.000Z')`,
    ).bind(
      id,
      id,
      name,
      name.toLocaleLowerCase('es'),
      classification.category ?? 'Lácteos/Leche y nata',
      classification.visualCategory ?? 'DAIRY',
      classification.packageQuantity ?? 1,
      classification.packageUnit ?? 'l',
    ),
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
    new HouseholdLoyaltyRepository(testEnv.DB),
  );

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.batch([
    testEnv.DB.prepare(`DELETE FROM household_product_alternatives`),
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
    expect(semi?.pricing).toMatchObject({
      effectiveCostCents: 85,
      effectivePriceReason: 'GENERAL_OFFER',
      potentialLoyaltyCostCents: 75,
    });
  });

  it.each([
    ['ENABLED', 75, 'LOYALTY'],
    ['DISABLED', 85, 'GENERAL_OFFER'],
  ] as const)(
    'applies household Lidl Plus status %s to package pricing',
    async (status, cost, reason) => {
      await createHousehold('house-a', {
        name: 'Leche',
        normalizedName: 'leche',
        supermarketId: 'lidl',
      });
      await createProduct('milk-semi', 'Leche semidesnatada Milbona', 95, true);
      await testEnv.DB.prepare(
        `INSERT INTO household_loyalty_programs
         (household_id, program_code, status, created_at, updated_at)
       VALUES ('house-a', 'LIDL_PLUS', ?, ?, ?)`,
      )
        .bind(status, '2026-08-29T00:00:00.000Z', '2026-08-29T00:00:00.000Z')
        .run();

      const result = await service().list(device('house-a'));
      expect(result.matchedItems[0].candidates[0].pricing).toMatchObject({
        effectiveCostCents: cost,
        effectivePriceReason: reason,
        potentialLoyaltyCostCents: null,
      });
    },
  );

  it.each([
    ['expired', '2026-08-20', '2026-08-28'],
    ['future', '2026-08-30', '2026-09-05'],
  ])(
    'does not use an %s Lidl Plus offer as the current effective price',
    async (_label, from, until) => {
      await createHousehold('house-a', {
        name: 'Leche',
        normalizedName: 'leche',
        supermarketId: 'lidl',
      });
      await createProduct('milk-semi', 'Leche semidesnatada Milbona', 95, true);
      await testEnv.DB.prepare(
        `UPDATE offers SET valid_from = ?, valid_until = ? WHERE product_id = 'milk-semi'`,
      )
        .bind(from, until)
        .run();
      await testEnv.DB.prepare(
        `INSERT INTO household_loyalty_programs
         (household_id, program_code, status, created_at, updated_at)
       VALUES ('house-a', 'LIDL_PLUS', 'ENABLED', ?, ?)`,
      )
        .bind('2026-08-29T00:00:00.000Z', '2026-08-29T00:00:00.000Z')
        .run();

      const result = await service().list(device('house-a'));
      expect(result.matchedItems[0].candidates[0].pricing).toMatchObject({
        effectiveCostCents: 95,
        effectivePriceReason: 'REGULAR',
      });
    },
  );

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

  it('returns a green identity match and separate active orange alternatives', async () => {
    await createHousehold('house-a', {
      name: 'Nuggets',
      normalizedName: 'nuggets',
      category: 'MEAT',
    });
    const meat = { category: 'Congelados/Pollo empanado', visualCategory: 'MEAT' };
    await createProduct('nuggets', 'Nuggets de pollo', 299, true, meat);
    await createProduct('fingers', 'Fingers de pollo', 349, true, meat);
    await createProduct('strips', 'Tiras de pollo empanadas', 399, true, meat);
    await createProduct('croquettes', 'Croquetas de pollo', 279, true, meat);

    const result = await service().list(device('house-a'));

    expect(
      result.matchedItems[0].candidates.map((candidate) => candidate.externalProductId),
    ).toEqual(['nuggets']);
    expect(result.matchedItems[0].alternatives).toEqual([
      expect.objectContaining({
        externalProductId: 'fingers',
        relationship: 'ALTERNATIVE',
        targetConcept: 'CHICKEN_FINGERS',
      }),
      expect.objectContaining({
        externalProductId: 'strips',
        relationship: 'ALTERNATIVE',
        targetConcept: 'BREADED_CHICKEN_STRIPS',
      }),
    ]);
  });

  it('returns Plátano de Canarias as identity and Banana as a separate active alternative', async () => {
    await createHousehold('house-a', {
      name: 'Plátano',
      normalizedName: 'platano',
      category: 'FRUIT',
    });
    const fruit = { category: 'Frutas y hortalizas/Fruta', visualCategory: 'FRUIT' };
    await createProduct('canary-plantain', 'Plátano de Canarias', 249, true, fruit);
    await createProduct('banana', 'Banana granel', 199, true, fruit);
    await createProduct('apple', 'Manzana golden', 189, true, fruit);

    const result = await service().list(device('house-a'));

    expect(
      result.matchedItems[0].candidates.map((candidate) => candidate.externalProductId),
    ).toEqual(['canary-plantain']);
    expect(result.matchedItems[0].alternatives).toEqual([
      expect.objectContaining({
        externalProductId: 'banana',
        relationship: 'ALTERNATIVE',
        sourceConcept: 'PLATANO',
        targetConcept: 'BANANA',
      }),
    ]);
  });

  it('shows only the active Banana alternative when the Plátano identity has no offer', async () => {
    await createHousehold('house-a', {
      name: 'Plátanos',
      normalizedName: 'platanos',
      category: 'FRUIT',
    });
    const fruit = { category: 'Frutas y hortalizas/Fruta', visualCategory: 'FRUIT' };
    await createProduct('canary-plantain', 'Plátano de Canarias', 249, false, fruit);
    await createProduct('banana-active', 'Banana granel', 199, true, fruit);
    await createProduct('banana-no-offer', 'Bananas bio', 229, false, fruit);

    const result = await service().list(device('house-a'));

    expect(
      result.matchedItems[0].candidates.filter((candidate) => candidate.activeOffers.length > 0),
    ).toEqual([]);
    expect(
      result.matchedItems[0].alternatives.map((candidate) => candidate.externalProductId),
    ).toEqual(['banana-active']);
  });

  it('learns and dismisses Banana for Plátano by concept rather than by one SKU', async () => {
    await createHousehold('house-a', {
      name: 'Plátano',
      normalizedName: 'platano',
      category: 'FRUIT',
    });
    const fruit = { category: 'Frutas y hortalizas/Fruta', visualCategory: 'FRUIT' };
    await createProduct('banana-a', 'Banana granel', 199, true, fruit);
    await createProduct('banana-b', 'Bananas premium', 229, true, fruit);
    const matching = service();

    await matching.saveAlternative(device('house-a'), 'item-house-a', 'banana-a', 'ACCEPTED');
    let result = await matching.list(device('house-a'));
    expect(result.matchedItems[0].alternatives).toEqual([
      expect.objectContaining({ externalProductId: 'banana-a', learned: true, preferred: true }),
      expect.objectContaining({ externalProductId: 'banana-b', learned: true, preferred: false }),
    ]);

    await matching.saveAlternative(device('house-a'), 'item-house-a', 'banana-b', 'DISMISSED');
    result = await matching.list(device('house-a'));
    expect(result.matchedItems).toEqual([]);
    expect(result.unmatchedItems).toEqual([
      expect.objectContaining({ shoppingItemId: 'item-house-a', reason: 'NO_CANDIDATE' }),
    ]);
  });

  it('returns only an alternative when there is no identity offer and excludes products without offers', async () => {
    await createHousehold('house-a', {
      name: 'Nuggets',
      normalizedName: 'nuggets',
      category: 'MEAT',
    });
    const meat = { category: 'Congelados/Pollo empanado', visualCategory: 'MEAT' };
    await createProduct('fingers', 'Fingers de pollo', 349, true, meat);
    await createProduct('strips', 'Tiras de pollo empanadas', 399, false, meat);

    const result = await service().list(device('house-a'));

    expect(result.matchedItems[0].candidates).toEqual([]);
    expect(
      result.matchedItems[0].alternatives.map((candidate) => candidate.externalProductId),
    ).toEqual(['fingers']);
  });

  it('limits alternatives to three in the backend', async () => {
    await createHousehold('house-a', {
      name: 'Nuggets',
      normalizedName: 'nuggets',
      category: 'MEAT',
    });
    const meat = { category: 'Congelados/Pollo empanado', visualCategory: 'MEAT' };
    for (const [id, name] of [
      ['fingers-a', 'Fingers de pollo A'],
      ['fingers-b', 'Fingers de pollo B'],
      ['fingers-c', 'Fingers de pollo C'],
      ['strips-a', 'Tiras de pollo empanadas A'],
      ['strips-b', 'Tiras de pollo empanadas B'],
    ]) {
      await createProduct(id, name, 300, true, meat);
    }

    const result = await service().list(device('house-a'));
    expect(result.matchedItems[0].alternatives).toHaveLength(3);
  });

  it('learns and dismisses alternatives by concept without creating an identity match', async () => {
    await createHousehold('house-a', {
      name: 'Nuggets',
      normalizedName: 'nuggets',
      category: 'MEAT',
    });
    const meat = { category: 'Congelados/Pollo empanado', visualCategory: 'MEAT' };
    await createProduct('fingers', 'Fingers de pollo', 349, true, meat);
    await createProduct('strips', 'Tiras de pollo empanadas', 399, true, meat);
    const matching = service();

    await matching.saveAlternative(device('house-a'), 'item-house-a', 'fingers', 'ACCEPTED');
    let result = await matching.list(device('house-a'));
    expect(result.matchedItems[0].automaticMatchExternalProductId).toBeNull();
    expect(result.matchedItems[0].alternatives[0]).toMatchObject({
      externalProductId: 'fingers',
      learned: true,
      alternativeReasons: ['HOUSEHOLD_ACCEPTED', 'EXPLICIT_RELATION'],
    });

    await matching.saveAlternative(device('house-a'), 'item-house-a', 'strips', 'DISMISSED');
    result = await matching.list(device('house-a'));
    expect(
      result.matchedItems[0].alternatives.map((candidate) => candidate.externalProductId),
    ).toEqual(['fingers']);
  });

  it('keeps alternative learning isolated by household and reusable across SKUs', async () => {
    await createHousehold('house-a', {
      name: 'Nuggets',
      normalizedName: 'nuggets',
      category: 'MEAT',
    });
    await createHousehold('house-b', {
      name: 'Nuggets',
      normalizedName: 'nuggets',
      category: 'MEAT',
    });
    const meat = { category: 'Congelados/Pollo empanado', visualCategory: 'MEAT' };
    await createProduct('fingers-a', 'Fingers de pollo A', 349, true, meat);
    await createProduct('fingers-b', 'Fingers de pollo B', 329, true, meat);
    const matching = service();
    await matching.saveAlternative(device('house-a'), 'item-house-a', 'fingers-a', 'ACCEPTED');

    const [houseA, houseB] = await Promise.all([
      matching.list(device('house-a')),
      matching.list(device('house-b')),
    ]);
    expect(houseA.matchedItems[0].alternatives.every((candidate) => candidate.learned)).toBe(true);
    expect(houseA.matchedItems[0].alternatives[0].externalProductId).toBe('fingers-a');
    expect(houseB.matchedItems[0].alternatives.every((candidate) => !candidate.learned)).toBe(true);
  });
});
