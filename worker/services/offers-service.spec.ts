import { describe, expect, it } from 'vitest';
import type { CatalogOffer, SupermarketProvider } from '../domain/supermarkets';
import type { ShoppingCycle } from '../domain/types';
import { LidlFixtureProvider } from '../providers/lidl-fixture-provider';
import { OffersService } from './offers-service';
import { productsMatch } from './product-matching';

const cycle: ShoppingCycle = {
  id: 'cycle-1',
  householdId: 'household-1',
  status: 'ACTIVE',
  createdAt: '2026-08-28T00:00:00.000Z',
  closedAt: null,
  closeReason: null,
  items: [
    {
      id: 'item-1',
      shoppingCycleId: 'cycle-1',
      name: 'Huevos',
      normalizedName: 'huevos',
      category: 'EGGS',
      quantity: '1',
      unit: 'caja',
      supermarketId: null,
      checked: false,
      sortOrder: 1000,
      createdAt: '2026-08-28T00:00:00.000Z',
      updatedAt: '2026-08-28T00:00:00.000Z',
      checkedAt: null,
    },
  ],
};

describe('offers providers and product matching', () => {
  it('keeps successful providers available when another provider fails', async () => {
    const failingProvider: SupermarketProvider = {
      supermarketId: 'dia',
      listPublishedOffers: () => Promise.reject(new Error('fixture provider unavailable')),
    };
    const service = new OffersService({ getActiveCycle: async () => cycle }, [
      new LidlFixtureProvider(),
      failingProvider,
    ]);

    const result = await service.list(
      {
        id: 'device-1',
        householdId: 'household-1',
        name: null,
        createdAt: cycle.createdAt,
        lastSeenAt: cycle.createdAt,
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
    const service = new OffersService({ getActiveCycle: async () => cycle }, [provider], 'REAL');

    const result = await service.list(
      {
        id: 'device-1',
        householdId: 'household-1',
        name: null,
        createdAt: cycle.createdAt,
        lastSeenAt: cycle.createdAt,
      },
      new URL('https://example.test/api/offers'),
    );

    expect(result.lastUpdatedAt).toBe(lastSuccessfulUpdate);
  });

  it('matches aliases without relying only on exact strings', () => {
    expect(productsMatch('Huevos', 'Huevos frescos docena')).toBe(true);
    expect(productsMatch('Papas', 'Patata para freír 2 kg')).toBe(true);
    expect(productsMatch('Leche', 'Detergente para ropa')).toBe(false);
  });
});
