import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import directOffer from '../../tests/fixtures/carrefour/direct-offer.html?raw';
import normalPrice from '../../tests/fixtures/carrefour/normal-price.html?raw';
import diaStores from '../../tests/fixtures/dia/stores.html?raw';
import diaMalformed from '../../tests/fixtures/dia/malformed.html?raw';
import diaOffersPage from '../../tests/fixtures/dia/offers-page.html?raw';
import diaWeeklyOffers from '../../tests/fixtures/dia/weekly-offers.html?raw';
import lidlCampaignCurrent from '../../tests/fixtures/lidl/campaigns/current-real.html?raw';
import lidlCampaignIndex from '../../tests/fixtures/lidl/campaigns/index-real.html?raw';
import lidlCampaignNext from '../../tests/fixtures/lidl/campaigns/next-real.html?raw';
import lidlStore from '../../tests/fixtures/lidl/store-zafra-real.html?raw';
import type {
  ParsedCarrefourProduct,
  SupermarketImportProvider,
} from '../domain/supermarket-import';
import { CarrefourImportProvider } from '../providers/carrefour-import-provider';
import { DiaProvider } from '../providers/dia-provider';
import { LidlProvider } from '../providers/lidl-provider';
import { LidlD1OffersProvider } from '../providers/lidl-d1-offers-provider';
import { SupermarketImportRepository } from '../repositories/supermarket-import-repository';
import { runScheduledLidlImport } from '../scheduled/lidl-schedule';
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
  readonly catalogStore = {
    externalId: 'online-es',
    name: 'Carrefour online España',
    address: 'Canal online público',
    city: 'España',
    postalCode: 'N/A',
    latitude: null,
    longitude: null,
    active: true,
  } as const;
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

const lidlFetcher = async (input: RequestInfo | URL): Promise<Response> => {
  const url = input.toString();
  const body = url.includes('/tiendas/')
    ? lidlStore
    : url === 'https://www.lidl.es/'
      ? lidlCampaignIndex
      : url.includes('/ofertas-proxima-semana/')
        ? lidlCampaignNext
        : lidlCampaignCurrent;
  return new Response(body, { status: 200 });
};

class SingleProductLidlProvider implements SupermarketImportProvider {
  readonly providerId = 'lidl' as const;
  private readonly delegate = new LidlProvider(lidlFetcher);
  readonly catalogStore = this.delegate.catalogStore;

  async discover(): Promise<string[]> {
    return (await this.delegate.discover(100)).slice(0, 1);
  }

  fetch(sourceUrl: string): Promise<string> {
    return this.delegate.fetch(sourceUrl);
  }

  parse(document: string, sourceUrl: string) {
    return this.delegate.parse(document, sourceUrl).slice(0, 1);
  }

  normalize(product: ReturnType<LidlProvider['parse']>[number]) {
    return this.delegate.normalize(product);
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

  it('imports DIA stores, products and price history idempotently', async () => {
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();
      return new Response(url.includes('/tiendas/') ? diaStores : diaWeeklyOffers, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    };
    const repository = new SupermarketImportRepository(testEnv.DB);
    const service = new SupermarketImportService(repository, new DiaProvider(fetcher));

    const first = await service.importDia(20);
    const second = await service.importDia(20);

    expect(first).toMatchObject({
      provider: 'dia',
      status: 'SUCCESS',
      productsSeen: 10,
      pricesSeen: 10,
      offersSeen: 3,
      rejectedItems: 0,
    });
    expect(second).toMatchObject({ status: 'SUCCESS', productsSeen: 10, offersSeen: 3 });
    const counts = await testEnv.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM stores WHERE supermarket_id = 'dia') AS stores,
        (SELECT COUNT(*) FROM external_products WHERE supermarket_id = 'dia') AS products,
        (SELECT COUNT(*) FROM product_prices) AS prices,
        (SELECT COUNT(*) FROM offers) AS offers,
        (SELECT COUNT(*) FROM import_runs WHERE provider = 'dia') AS runs`,
    ).first<{ stores: number; products: number; prices: number; offers: number; runs: number }>();
    expect(counts).toEqual({ stores: 4, products: 10, prices: 10, offers: 3, runs: 2 });
  });

  it('keeps DIA offers without published dates idempotent', async () => {
    const fetcher = async (input: RequestInfo | URL): Promise<Response> =>
      new Response(input.toString().includes('/tiendas/') ? diaStores : diaOffersPage);
    const repository = new SupermarketImportRepository(testEnv.DB);
    const service = new SupermarketImportService(repository, new DiaProvider(fetcher));

    expect(await service.importDia()).toMatchObject({ status: 'SUCCESS', offersSeen: 1 });
    expect(await service.importDia()).toMatchObject({ status: 'SUCCESS', offersSeen: 1 });
    expect(
      await testEnv.DB.prepare(`SELECT COUNT(*) AS count FROM offers`).first<{ count: number }>(),
    ).toEqual({ count: 1 });
  });

  it('marks an unexpected DIA document as failed without affecting other modules', async () => {
    const fetcher = async (input: RequestInfo | URL): Promise<Response> =>
      new Response(input.toString().includes('/tiendas/') ? diaStores : diaMalformed);
    const service = new SupermarketImportService(
      new SupermarketImportRepository(testEnv.DB),
      new DiaProvider(fetcher),
    );

    expect(await service.importDia()).toMatchObject({
      status: 'FAILED',
      productsSeen: 0,
      rejectedItems: 1,
      errorCode: 'DIA_PAGE_CONTEXT_INVALID',
    });
  });

  it('persists structured Lidl fixtures idempotently through the common model', async () => {
    const repository = new SupermarketImportRepository(testEnv.DB);
    const service = new SupermarketImportService(repository, new LidlProvider(lidlFetcher));

    const first = await service.importLidl(20);
    const second = await service.importLidl(20);

    expect(first).toMatchObject({
      provider: 'lidl',
      status: 'SUCCESS',
      productsSeen: 3,
      pricesSeen: 3,
      offersSeen: 5,
      rejectedItems: 0,
    });
    expect(second).toMatchObject({ status: 'SUCCESS', productsSeen: 3, offersSeen: 5 });
    const counts = await testEnv.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM stores WHERE supermarket_id = 'lidl') AS stores,
        (SELECT COUNT(*) FROM external_products WHERE supermarket_id = 'lidl') AS products,
        (SELECT COUNT(*) FROM product_prices) AS prices,
        (SELECT COUNT(*) FROM offers) AS offers,
        (SELECT COUNT(*) FROM import_runs WHERE provider = 'lidl') AS runs`,
    ).first<{ stores: number; products: number; prices: number; offers: number; runs: number }>();
    expect(counts).toEqual({ stores: 2, products: 3, prices: 3, offers: 5, runs: 2 });

    const published = await new LidlD1OffersProvider(
      testEnv.DB,
      '2026-08-28',
    ).listPublishedOffers();
    const grapes = published.find((offer) => offer.productName === 'Uva blanca sin semilla');
    const shandy = published.find((offer) => offer.productName === 'Argus Shandy');
    expect(published).toHaveLength(3);
    expect(grapes).toMatchObject({
      fixture: false,
      city: 'Badajoz',
      normalPriceCents: 299,
      offerPriceCents: 235,
      lidlPlusPriceCents: 189,
      upcoming: false,
    });
    expect(shandy).toMatchObject({ offerPriceCents: 420, lidlPlusPriceCents: 329, upcoming: true });
  });

  it('runs one controlled scheduled import and skips the second UTC trigger', async () => {
    const repository = new SupermarketImportRepository(testEnv.DB);
    const service = new SupermarketImportService(repository, new LidlProvider(lidlFetcher));
    const logger = { info: () => undefined };

    await expect(
      runScheduledLidlImport(Date.parse('2026-07-15T03:00:00.000Z'), service, logger),
    ).resolves.toMatchObject({
      status: 'SUCCESS',
      run: { productsSeen: 3, pricesSeen: 3, offersSeen: 5, rejectedItems: 0 },
    });
    await expect(
      runScheduledLidlImport(Date.parse('2026-07-15T04:00:00.000Z'), service, logger),
    ).resolves.toEqual({ status: 'SKIPPED_TIME' });
    expect(
      await testEnv.DB.prepare(
        `SELECT COUNT(*) AS count FROM import_runs WHERE provider = 'lidl'`,
      ).first<{ count: number }>(),
    ).toEqual({ count: 1 });
    expect(
      await testEnv.DB.prepare(
        `SELECT COUNT(*) AS count FROM offers WHERE requires_loyalty_card = 1`,
      ).first<{ count: number }>(),
    ).toEqual({ count: 3 });
  });

  it('fails a Lidl campaign safely when it has no structured products', async () => {
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();
      return new Response(
        url.includes('/tiendas/')
          ? lidlStore
          : url === 'https://www.lidl.es/'
            ? lidlCampaignIndex
            : '<html>campaign without product cards</html>',
      );
    };
    const service = new SupermarketImportService(
      new SupermarketImportRepository(testEnv.DB),
      new LidlProvider(fetcher),
    );

    expect(await service.importLidl()).toMatchObject({
      provider: 'lidl',
      status: 'FAILED',
      productsSeen: 0,
      pricesSeen: 0,
      offersSeen: 0,
      rejectedItems: 6,
      errorCode: 'LIDL_NO_VALID_PRODUCT',
    });
  });

  it('preserves the last valid Lidl dataset and freshness after a failed zero-result import', async () => {
    const repository = new SupermarketImportRepository(testEnv.DB);
    const validService = new SupermarketImportService(repository, new LidlProvider(lidlFetcher));
    const valid = await validService.importLidl(20);
    const validUpdate = await new LidlD1OffersProvider(testEnv.DB).getLastSuccessfulUpdate();
    const countsBefore = await testEnv.DB.prepare(
      `SELECT
          (SELECT COUNT(*) FROM external_products WHERE supermarket_id = 'lidl') AS products,
          (SELECT COUNT(*) FROM product_prices) AS prices,
          (SELECT COUNT(*) FROM offers) AS offers`,
    ).first<{ products: number; prices: number; offers: number }>();
    const failedFetcher = async (input: RequestInfo | URL): Promise<Response> =>
      new Response(input.toString().includes('/tiendas/') ? lidlStore : '<html>invalid</html>');

    const failed = await new SupermarketImportService(
      repository,
      new LidlProvider(failedFetcher),
    ).importLidl(20);
    const countsAfter = await testEnv.DB.prepare(
      `SELECT
          (SELECT COUNT(*) FROM external_products WHERE supermarket_id = 'lidl') AS products,
          (SELECT COUNT(*) FROM product_prices) AS prices,
          (SELECT COUNT(*) FROM offers) AS offers`,
    ).first<{ products: number; prices: number; offers: number }>();

    expect(valid.status).toBe('SUCCESS');
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: 'LIDL_CAMPAIGNS_MISSING' });
    expect(countsAfter).toEqual(countsBefore);
    expect(await new LidlD1OffersProvider(testEnv.DB).getLastSuccessfulUpdate()).toBe(validUpdate);
  });

  it('skips a recent Lidl import and replaces a stale lock', async () => {
    const repository = new SupermarketImportRepository(testEnv.DB);
    const now = Date.now();
    await repository.startRun('fresh-lock', 'lidl', new Date(now).toISOString());
    const service = new SupermarketImportService(repository, new LidlProvider(lidlFetcher));

    await expect(service.tryImportLidl(20)).resolves.toBeNull();
    await testEnv.DB.prepare(`DELETE FROM import_runs WHERE id = 'fresh-lock'`).run();
    await repository.startRun('stale-lock', 'lidl', new Date(now - 16 * 60 * 1000).toISOString());
    await expect(service.tryImportLidl(20)).resolves.toMatchObject({ status: 'SUCCESS' });
    expect(
      await testEnv.DB.prepare(
        `SELECT status, error_code FROM import_runs WHERE id = 'stale-lock'`,
      ).first<{ status: string; error_code: string | null }>(),
    ).toEqual({ status: 'FAILED', error_code: 'IMPORT_STALE' });
  });

  it('rejects an extreme Lidl product drop before persisting it', async () => {
    const repository = new SupermarketImportRepository(testEnv.DB);
    await repository.startRun('historical-run', 'lidl', '2026-08-28T03:00:00.000Z');
    await repository.finishRun('historical-run', {
      status: 'SUCCESS',
      now: '2026-08-28T03:00:10.000Z',
      productsSeen: 20,
      pricesSeen: 20,
      offersSeen: 20,
      rejectedItems: 0,
      errorCode: null,
    });

    await expect(
      new SupermarketImportService(repository, new SingleProductLidlProvider()).importLidl(100),
    ).resolves.toMatchObject({
      status: 'FAILED',
      productsSeen: 0,
      errorCode: 'LIDL_SUSPICIOUS_PRODUCT_DROP',
    });
    expect(
      await testEnv.DB.prepare(
        `SELECT COUNT(*) AS count FROM external_products WHERE supermarket_id = 'lidl'`,
      ).first<{ count: number }>(),
    ).toEqual({ count: 0 });
  });
});
