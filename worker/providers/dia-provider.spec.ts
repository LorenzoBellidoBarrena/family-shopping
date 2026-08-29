import { describe, expect, it, vi } from 'vitest';
import clubDia from '../../tests/fixtures/dia/club-dia.html?raw';
import malformed from '../../tests/fixtures/dia/malformed.html?raw';
import offersPage from '../../tests/fixtures/dia/offers-page.html?raw';
import secondUnit from '../../tests/fixtures/dia/second-unit.html?raw';
import standardPrice from '../../tests/fixtures/dia/standard-price.html?raw';
import stores from '../../tests/fixtures/dia/stores.html?raw';
import { DiaProvider } from './dia-provider';

const catalogUrl = 'https://www.dia.es/';
const storesUrl = 'https://www.dia.es/tiendas/buscador-tiendas/badajoz/zafra/06300';

describe('DiaProvider', () => {
  it('parses a standard price and integer unit price', () => {
    const provider = new DiaProvider();
    const parsed = provider.parse(standardPrice, catalogUrl);
    const product = provider.normalize(parsed[0]);

    expect(product).toMatchObject({
      externalId: '303099',
      name: 'Queso cheddar Dia Selección Mundial 160 g',
      priceCents: 148,
      unitPriceCents: 925,
      unitPriceUnit: 'kilo',
      commercialCategory: 'quesos',
      visualCategory: 'DAIRY',
      channel: 'ONLINE',
      geographicScope: 'ONLINE',
      offers: [],
    });
  });

  it('distinguishes a CLUB DIA loyalty price and Madrid validity dates', () => {
    const provider = new DiaProvider();
    const product = provider.normalize(provider.parse(clubDia, catalogUrl)[0]);

    expect(product.offers[0]).toMatchObject({
      type: 'LOYALTY_PRICE',
      normalPriceCents: 349,
      offerPriceCents: 275,
      percentage: 21,
      requiresLoyaltyCard: true,
      loyaltyProgram: 'CLUB_DIA',
      validFrom: '2026-08-26',
      validUntil: '2026-09-01',
    });
  });

  it('parses the configured public offers page without inventing missing dates', () => {
    const provider = new DiaProvider();
    const product = provider.normalize(provider.parse(offersPage, 'https://www.dia.es/ofertas')[0]);

    expect(product).toMatchObject({
      externalId: '267132',
      priceCents: 79,
      unitPriceCents: 198,
      offers: [
        {
          type: 'LOYALTY_PRICE',
          normalPriceCents: 99,
          offerPriceCents: 79,
          requiresLoyaltyCard: true,
          validFrom: null,
          validUntil: null,
        },
      ],
    });
  });

  it('parses a second-unit CLUB DIA promotion without inventing an effective price', () => {
    const provider = new DiaProvider();
    const product = provider.normalize(provider.parse(secondUnit, catalogUrl)[0]);

    expect(product.offers[0]).toMatchObject({
      type: 'SECOND_UNIT_DISCOUNT',
      normalPriceCents: 435,
      offerPriceCents: 435,
      percentage: 50,
      requiresLoyaltyCard: true,
      loyaltyProgram: 'CLUB_DIA',
    });
  });

  it('discovers the three public Zafra stores without invented coordinates', () => {
    const provider = new DiaProvider();
    expect(provider.parseStores(stores, storesUrl)).toEqual([
      expect.objectContaining({ externalId: '454', address: 'CR SANTOS DE MAIMONA, S/N' }),
      expect.objectContaining({ externalId: '17052', address: 'AV ESTACION (PZ AMERICA), S/N' }),
      expect.objectContaining({ externalId: '17583', address: 'CL LOPEZ ASME, 7' }),
    ]);
    expect(provider.parseStores(stores, storesUrl).every((store) => store.latitude === null)).toBe(
      true,
    );
  });

  it('rejects malformed page context and non-allowlisted URLs', () => {
    const provider = new DiaProvider();
    expect(() => provider.parse(malformed, catalogUrl)).toThrow('DIA_PAGE_CONTEXT_INVALID');
    expect(() => provider.parse(standardPrice, 'https://example.com/')).toThrow(
      'DIA_SOURCE_NOT_ALLOWED',
    );
  });

  it('blocks redirects instead of following them to an arbitrary host', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'https://example.com/' } }),
      );
    const provider = new DiaProvider(fetcher);
    await expect(provider.fetch(catalogUrl)).rejects.toThrow('DIA_REDIRECT_BLOCKED');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
