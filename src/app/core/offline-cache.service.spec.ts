import { describe, expect, it } from 'vitest';
import type { ShoppingCycle } from './api.models';
import { OfflineCacheService } from './offline-cache.service';

const cachedCycle: ShoppingCycle = {
  id: 'cycle-1',
  householdId: 'household-1',
  status: 'ACTIVE',
  createdAt: '2026-08-28T00:00:00.000Z',
  closedAt: null,
  closeReason: null,
  items: [
    {
      id: 'milk',
      shoppingCycleId: 'cycle-1',
      name: 'Leche',
      normalizedName: 'leche',
      quantity: '6',
      unit: 'unidad',
      supermarketId: 'lidl',
      category: 'DAIRY',
      checked: false,
      sortOrder: 1000,
      createdAt: '2026-08-28T00:00:00.000Z',
      updatedAt: '2026-08-28T00:00:00.000Z',
      checkedAt: null,
    },
  ],
};

describe('OfflineCacheService product categories', () => {
  it('persists a shopping item category in the offline cycle', async () => {
    const cache = new OfflineCacheService();
    await cache.clear();
    await cache.saveCycle(cachedCycle);

    const restored = await cache.loadCycle();

    expect(restored?.items[0]).toMatchObject({ name: 'Leche', category: 'DAIRY' });
    await cache.clear();
  });
});
