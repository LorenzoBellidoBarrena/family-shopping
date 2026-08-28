import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import directOffer from '../../tests/fixtures/carrefour/direct-offer.html?raw';
import normalPrice from '../../tests/fixtures/carrefour/normal-price.html?raw';
import type {
  ParsedCarrefourProduct,
  SupermarketImportProvider,
} from '../domain/supermarket-import';
import { CarrefourImportProvider } from '../providers/carrefour-import-provider';
import { SupermarketImportRepository } from '../repositories/supermarket-import-repository';
import { SupermarketImportService } from './supermarket-import-service';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as unknown as TestEnv;
const sourceOne = 'https://www.carrefour.es/supermercado/leche-pascual/R-521006986/p';
const sourceTwo = 'https://www.carrefour.es/supermercado/leche-cantara/R-700248/p';

class FixtureCarrefourProvider implements SupermarketImportProvider {
  readonly providerId = 'carrefour' as const;
  private readonly parser = new CarrefourImportProvider();

  constructor(private readonly includeInvalid = false) {}

  async discover(): Promise<string[]> {
    return this.includeInvalid
      ? [sourceOne, sourceTwo, sourceOne + '-invalid']
      : [sourceOne, sourceTwo];
  }

  async fetch(sourceUrl: string): Promise<string> {
    if (sourceUrl.endsWith('-invalid')) return '<html>unexpected</html>';
    return sourceUrl === sourceOne ? directOffer : normalPrice;
  }

  parse(document: string, sourceUrl: string): ParsedCarrefourProduct[] {
    if (sourceUrl.endsWith('-invalid')) return [];
    return this.parser.parse(document, sourceUrl);
  }

  normalize(product: ParsedCarrefourProduct) {
    return this.parser.normalize(product);
  }
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.batch([
    testEnv.DB.prepare(`DELETE FROM import_runs`),
    testEnv.DB.prepare(`DELETE FROM offers`),
    testEnv.DB.prepare(`DELETE FROM product_prices`),
    testEnv.DB.prepare(`DELETE FROM store_products`),
    testEnv.DB.prepare(`DELETE FROM external_products`),
    testEnv.DB.prepare(`DELETE FROM stores`),
  ]);
});

describe('SupermarketImportService', () => {
  it('imports products, prices and offers idempotently', async () => {
    const repository = new SupermarketImportRepository(testEnv.DB);
    const service = new SupermarketImportService(repository, new FixtureCarrefourProvider());

    const first = await service.importCarrefour();
    const second = await service.importCarrefour();

    expect(first).toMatchObject({
      status: 'SUCCESS',
      productsSeen: 2,
      pricesSeen: 2,
      offersSeen: 1,
      rejectedItems: 0,
    });
    expect(second).toMatchObject({
      status: 'SUCCESS',
      productsSeen: 2,
      pricesSeen: 2,
      offersSeen: 1,
    });
    const counts = await testEnv.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM external_products) AS products,
        (SELECT COUNT(*) FROM product_prices) AS prices,
        (SELECT COUNT(*) FROM offers) AS offers,
        (SELECT COUNT(*) FROM import_runs) AS runs`,
    ).first<{ products: number; prices: number; offers: number; runs: number }>();
    expect(counts).toEqual({ products: 2, prices: 2, offers: 1, runs: 2 });
    expect(await repository.listActiveOffers('2026-08-28')).toHaveLength(1);
    expect(await repository.listActiveOffers('2026-10-01')).toHaveLength(0);
  });

  it('continues safely and marks the run partial for one malformed page', async () => {
    const service = new SupermarketImportService(
      new SupermarketImportRepository(testEnv.DB),
      new FixtureCarrefourProvider(true),
    );

    expect(await service.importCarrefour()).toMatchObject({
      status: 'PARTIAL',
      productsSeen: 2,
      rejectedItems: 1,
      errorCode: 'CARREFOUR_NO_VALID_PRODUCT',
    });
  });
});
