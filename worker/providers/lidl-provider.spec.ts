import { describe, expect, it, vi } from 'vitest';
import campaignIndex from '../../tests/fixtures/lidl/campaigns/index-real.html?raw';
import campaignCurrent from '../../tests/fixtures/lidl/campaigns/current-real.html?raw';
import campaignMalformed from '../../tests/fixtures/lidl/campaigns/malformed.html?raw';
import campaignNext from '../../tests/fixtures/lidl/campaigns/next-real.html?raw';
import overview from '../../tests/fixtures/lidl/overview-real.html?raw';
import storeZafra from '../../tests/fixtures/lidl/store-zafra-real.html?raw';
import { LidlProvider } from './lidl-provider';

const currentUrl = 'https://www.lidl.es/c/ofertas-semanales/a10089449';
const nextUrl = 'https://www.lidl.es/c/ofertas-proxima-semana/a10088432';
const storeUrl = 'https://www.lidl.es/s/es-ES/tiendas/zafra/c-torre-san-francisco-2a/';

describe('LidlProvider', () => {
  it('discovers current, next and fresh food campaigns without bazaar links', () => {
    const sources = new LidlProvider().parseCampaignDiscovery(campaignIndex);
    expect(sources).toHaveLength(5);
    expect(sources[0]).toBe(currentUrl);
    expect(sources[1]).toBe(nextUrl);
    expect(sources.join(' ')).not.toContain('/bazar/');
  });

  it('keeps the legacy public leaflet discovery only as metadata support', () => {
    const sources = new LidlProvider().parseDiscovery(overview);
    expect(sources).toHaveLength(2);
    expect(sources.every((source) => source.includes('endpoints.leaflets.schwarz'))).toBe(true);
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

  it('uses the explicitly published Badajoz price and preserves general plus Lidl Plus offers', () => {
    const provider = new LidlProvider();
    const products = provider
      .parse(campaignCurrent, currentUrl)
      .map((item) => provider.normalize(item));
    expect(products[0]).toMatchObject({
      externalId: '11029919',
      name: 'Uva blanca sin semilla',
      priceCents: 235,
      packageQuantity: 750,
      packageUnit: 'g',
      channel: 'STORE',
      geographicScope: 'REGIONAL',
      offers: [
        {
          type: 'PERCENTAGE_DISCOUNT',
          normalPriceCents: 299,
          offerPriceCents: 235,
          percentage: 21,
        },
        {
          type: 'LOYALTY_PRICE',
          normalPriceCents: 299,
          offerPriceCents: 189,
          percentage: 36,
          loyaltyProgram: 'LIDL_PLUS',
        },
      ],
    });
    expect(products[0].offers[0]).toMatchObject({
      validFrom: '2026-08-24',
      validUntil: '2026-08-30',
    });
  });

  it('keeps a Lidl Plus-only future campaign price separate from its published base price', () => {
    const provider = new LidlProvider();
    const product = provider.normalize(provider.parse(campaignNext, nextUrl)[0]);
    expect(product).toMatchObject({
      externalId: '11003777',
      name: 'Argus Shandy',
      brand: 'Argus',
      priceCents: 420,
      packageQuantity: null,
      packageUnit: '12x33 cl',
      offers: [{ type: 'LOYALTY_PRICE', offerPriceCents: 329, normalPriceCents: 420 }],
    });
    expect(product.offers[0]).toMatchObject({ validFrom: '2026-08-31', validUntil: '2026-09-06' });
  });

  it('does not calculate a unit price from the package description', () => {
    const provider = new LidlProvider();
    const product = provider.normalize(provider.parse(campaignNext, nextUrl)[0]);
    expect(product.unitPriceCents).toBeNull();
    expect(product.unitPriceUnit).toBeNull();
  });

  it('skips malformed cards and rejects non-allowlisted sources', () => {
    const provider = new LidlProvider();
    expect(provider.parse(campaignMalformed, currentUrl)).toEqual([]);
    expect(() => provider.parse(campaignCurrent, 'https://example.com/campaign')).toThrow(
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
