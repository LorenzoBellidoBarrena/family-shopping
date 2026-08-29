import { describe, expect, it, vi } from 'vitest';
import buyThreePayTwo from '../../tests/fixtures/carrefour/buy-3-pay-2.html?raw';
import cashback from '../../tests/fixtures/carrefour/cashback.html?raw';
import directOffer from '../../tests/fixtures/carrefour/direct-offer.html?raw';
import normalPrice from '../../tests/fixtures/carrefour/normal-price.html?raw';
import pagination from '../../tests/fixtures/carrefour/pagination.xml?raw';
import secondUnit from '../../tests/fixtures/carrefour/second-unit.html?raw';
import { CarrefourImportProvider } from './carrefour-import-provider';

const source = (id: string): string =>
  `https://www.carrefour.es/supermercado/producto-de-prueba/${id}/p`;

describe('CarrefourImportProvider', () => {
  it('parses a normal comma-decimal price and unit price', () => {
    const provider = new CarrefourImportProvider();
    const parsed = provider.parse(normalPrice, source('R-700248'))[0];
    const product = provider.normalize(parsed);

    expect(product).toMatchObject({
      externalId: 'R-700248',
      name: 'Leche semidesnatada La Cántara brik 1 l.',
      priceCents: 86,
      unitPriceCents: 86,
      unitPriceUnit: 'l',
      commercialCategory: 'Lácteos > Leche',
      visualCategory: 'DAIRY',
      geographicScope: 'ONLINE',
      offers: [],
    });
  });

  it('parses a direct price reduction and validity dates', () => {
    const provider = new CarrefourImportProvider();
    const product = provider.normalize(provider.parse(directOffer, source('R-521006986'))[0]);

    expect(product.offers[0]).toMatchObject({
      type: 'DIRECT_DISCOUNT',
      normalPriceCents: 143,
      offerPriceCents: 129,
      validFrom: '2026-08-26',
      validUntil: '2026-09-09',
    });
  });

  it.each([
    [buyThreePayTwo, 'R-FIXTURE-3X2', { type: 'BUY_X_PAY_Y', buyQuantity: 3, payQuantity: 2 }],
    [secondUnit, 'R-FIXTURE-SECOND', { type: 'SECOND_UNIT_DISCOUNT', percentage: 70 }],
    [cashback, 'R-FIXTURE-CASHBACK', { type: 'CASHBACK', percentage: 50 }],
  ] as const)('models structured promotion rules', (fixture, id, expected) => {
    const provider = new CarrefourImportProvider();
    const product = provider.normalize(provider.parse(fixture, source(id))[0]);

    expect(product.offers[0]).toMatchObject(expected);
    if (expected.type === 'CASHBACK') expect(product.offers[0]?.offerPriceCents).toBe(349);
  });

  it('rejects incomplete and unexpected HTML without throwing', () => {
    const provider = new CarrefourImportProvider();
    expect(provider.parse('<html><h1>Unexpected</h1></html>', source('R-EMPTY'))).toEqual([]);
  });

  it('discovers only allowlisted public product URLs from the official food sitemap', async () => {
    const index = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://www.carrefour.es/crs/cdn-static/sitemap-food/products-1.xml</loc></sitemap></sitemapindex>`;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(index, { status: 200 }))
      .mockResolvedValueOnce(new Response(pagination, { status: 200 }));
    const provider = new CarrefourImportProvider(fetcher as typeof fetch);

    expect(await provider.discover(10)).toEqual([
      'https://www.carrefour.es/supermercado/leche-entera-pascual-brik-1-l/R-521006986/p',
      'https://www.carrefour.es/supermercado/leche-semidesnatada-la-cantara-brik-1-l/R-700248/p',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('blocks arbitrary hosts before performing a request', async () => {
    const fetcher = vi.fn();
    const provider = new CarrefourImportProvider(fetcher as typeof fetch);

    await expect(provider.fetch('https://example.org/product/R-1/p')).rejects.toThrow(
      'CARREFOUR_SOURCE_NOT_ALLOWED',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('stops reading responses above the configured size limit', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('x'.repeat(2 * 1024 * 1024 + 1)));
    const provider = new CarrefourImportProvider(fetcher as typeof fetch);

    await expect(provider.fetch(source('R-LARGE'))).rejects.toThrow('CARREFOUR_RESPONSE_TOO_LARGE');
  });
});
