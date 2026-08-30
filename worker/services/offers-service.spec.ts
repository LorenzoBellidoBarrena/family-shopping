import { describe, expect, it } from 'vitest';
import type { CatalogOffer, SupermarketProvider } from '../domain/supermarkets';
import { LidlFixtureProvider } from '../providers/lidl-fixture-provider';
import { OffersService } from './offers-service';
import { productsMatch } from './product-matching';

const createdAt = '2026-08-28T00:00:00.000Z';

describe('offers providers and product matching', () => {
  it('keeps successful providers available when another provider fails', async () => {
    const failingProvider: SupermarketProvider = {
      supermarketId: 'dia',
      listPublishedOffers: () => Promise.reject(new Error('fixture provider unavailable')),
    };
    const service = new OffersService([new LidlFixtureProvider(), failingProvider]);

    const result = await service.list(
      {
        id: 'device-1',
        householdId: 'household-1',
        name: null,
        createdAt,
        lastSeenAt: createdAt,
      },
      new URL('https://example.test/api/offers'),
    );

    expect(result.partial).toBe(true);
    expect(result.offers).toHaveLength(2);
    expect(result.offers.every((offer: CatalogOffer) => offer.supermarketId === 'lidl')).toBe(true);
  });

  it('reports freshness from the last successful import instead of a failed attempt', async () => {
    const lastSuccessfulUpdate = '2026-08-28T05:00:10.000Z';
    const provider = new LidlFixtureProvider() as LidlFixtureProvider & SupermarketProvider;
    provider.getLastSuccessfulUpdate = async () => lastSuccessfulUpdate;
    const service = new OffersService([provider], 'REAL');

    const result = await service.list(
      {
        id: 'device-1',
        householdId: 'household-1',
        name: null,
        createdAt,
        lastSeenAt: createdAt,
      },
      new URL('https://example.test/api/offers'),
    );

    expect(result.lastUpdatedAt).toBe(lastSuccessfulUpdate);
  });

  it('browses offers without reading the active shopping cycle', async () => {
    const fixtures = await new LidlFixtureProvider().listPublishedOffers();
    const provider: SupermarketProvider = {
      supermarketId: 'lidl',
      listPublishedOffers: async () => [
        { ...fixtures[0], offerBrowseCategory: 'FOOD' },
        { ...fixtures[1], offerBrowseCategory: 'CLEANING' },
      ],
      listBrowseCategoryCounts: async () => ({ FOOD: 1, CLEANING: 1 }),
    };
    const result = await new OffersService([provider]).list(
      {
        id: 'device-1',
        householdId: 'household-1',
        name: null,
        createdAt,
        lastSeenAt: createdAt,
      },
      new URL('https://example.test/api/offers?category=FOOD'),
    );

    expect(result.offers).toHaveLength(1);
    expect(result.offers[0].offerBrowseCategory).toBe('FOOD');
    expect(result.offers.every((offer) => !offer.relatedToList)).toBe(true);
    expect(result.categories).toEqual([
      { code: 'FOOD', label: 'Comida', emoji: '🍎', count: 1 },
      { code: 'CLEANING', label: 'Limpieza', emoji: '🧹', count: 1 },
    ]);
  });

  it('matches aliases without relying only on exact strings', () => {
    expect(productsMatch('Huevos', 'Huevos frescos docena')).toBe(true);
    expect(productsMatch('Papas', 'Patata para freír 2 kg')).toBe(true);
    expect(productsMatch('Leche', 'Detergente para ropa')).toBe(false);
  });
});
