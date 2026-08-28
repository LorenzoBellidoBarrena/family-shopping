import { describe, expect, it, vi } from 'vitest';
import currentFood from '../../tests/fixtures/lidl/current-food-real.json?raw';
import malformed from '../../tests/fixtures/lidl/malformed.json?raw';
import nextFood from '../../tests/fixtures/lidl/next-food-real.json?raw';
import overview from '../../tests/fixtures/lidl/overview-real.html?raw';
import storeZafra from '../../tests/fixtures/lidl/store-zafra-real.html?raw';
import structuredProducts from '../../tests/fixtures/lidl/structured-products.synthetic.json?raw';
import { LidlProvider } from './lidl-provider';

const currentUrl =
  'https://endpoints.leaflets.schwarz/v4/flyer?flyer_identifier=019fef9e-46f1-7ecb-a1f6-39de23b7eb58&region_id=0';
const storeUrl = 'https://www.lidl.es/s/es-ES/tiendas/zafra/c-torre-san-francisco-2a/';

describe('LidlProvider', () => {
  it('discovers only the current and next food leaflets, never bazaar', () => {
    const sources = new LidlProvider().parseDiscovery(overview);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toContain('019fef9e-46f1-7ecb-a1f6-39de23b7eb58');
    expect(sources[1]).toContain('01a01412-0b5e-741e-8095-ee9c52230117');
    expect(sources.join(' ')).not.toContain('019fef91-8a34-7e63-bac7-e989ff57c7b7');
  });

  it('parses the official Zafra store without inventing its public identifier', () => {
    expect(new LidlProvider().parseStores(storeZafra, storeUrl)).toEqual([
      {
        externalId: 'zafra-c-torre-san-francisco-2a',
        name: 'Lidl - Zafra, C. Torre San Francisco 2A',
        address: 'C. Torre San Francisco 2A',
        city: 'Zafra',
        postalCode: '06300',
        latitude: 38.43055,
        longitude: -6.41476,
        active: true,
      },
    ]);
  });

  it('does not turn ambiguous OCR keywords from either real leaflet into prices', () => {
    const provider = new LidlProvider();
    expect(provider.parse(currentFood, currentUrl)).toEqual([]);
    expect(
      provider.parse(
        nextFood,
        'https://endpoints.leaflets.schwarz/v4/flyer?flyer_identifier=01a01412-0b5e-741e-8095-ee9c52230117&region_id=0',
      ),
    ).toEqual([]);
  });

  it('normalizes explicit structured euro and unit prices conservatively', () => {
    const provider = new LidlProvider();
    const products = provider
      .parse(structuredProducts, currentUrl)
      .map((item) => provider.normalize(item));
    expect(products[0]).toMatchObject({
      externalId: 'synthetic-leche-1l',
      priceCents: 80,
      unitPriceCents: 80,
      unitPriceUnit: 'l',
      visualCategory: 'DAIRY',
      geographicScope: 'UNKNOWN',
      offer: { type: 'DIRECT_DISCOUNT', normalPriceCents: 84, offerPriceCents: 80 },
    });
  });

  it('distinguishes synthetic Lidl Plus, 3x2 and second-unit parser cases', () => {
    const provider = new LidlProvider();
    const products = provider
      .parse(structuredProducts, currentUrl)
      .map((item) => provider.normalize(item));
    expect(products[1].offer).toMatchObject({
      type: 'LOYALTY_PRICE',
      percentage: 40,
      requiresLoyaltyCard: true,
      loyaltyProgram: 'LIDL_PLUS',
    });
    expect(products[2].offer).toMatchObject({
      type: 'BUY_X_PAY_Y',
      buyQuantity: 3,
      payQuantity: 2,
    });
    expect(products[3].offer).toMatchObject({
      type: 'SECOND_UNIT_DISCOUNT',
      percentage: 50,
    });
  });

  it('rejects malformed JSON and non-allowlisted sources', () => {
    const provider = new LidlProvider();
    expect(() => provider.parse('{', currentUrl)).toThrow('LIDL_FLYER_JSON_INVALID');
    expect(provider.parse(malformed, currentUrl)).toEqual([]);
    expect(() => provider.parse(currentFood, 'https://example.com/flyer')).toThrow(
      'LIDL_SOURCE_NOT_ALLOWED',
    );
  });

  it('blocks redirects to arbitrary hosts', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'https://example.com/' } }),
      );
    await expect(new LidlProvider(fetcher).fetch(currentUrl)).rejects.toThrow(
      'LIDL_REDIRECT_BLOCKED',
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
