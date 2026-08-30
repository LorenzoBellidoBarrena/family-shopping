import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Device } from '../domain/types';
import { HouseholdLoyaltyRepository } from '../repositories/household-loyalty-repository';
import { HouseholdLoyaltyService } from './household-loyalty-service';

interface LoyaltyTestEnv {
  DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as unknown as LoyaltyTestEnv;
const device = (householdId: string): Device => ({
  id: `device-${householdId}`,
  householdId,
  name: null,
  createdAt: '2026-08-30T00:00:00.000Z',
  lastSeenAt: '2026-08-30T00:00:00.000Z',
});

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare(`DELETE FROM households`).run();
  await testEnv.DB.batch(
    ['house-a', 'house-b'].map((id) =>
      testEnv.DB.prepare(
        `INSERT INTO households (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ).bind(id, id, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z'),
    ),
  );
});

describe('HouseholdLoyaltyService', () => {
  it('returns UNKNOWN for a household without a saved preference', async () => {
    const service = new HouseholdLoyaltyService(new HouseholdLoyaltyRepository(testEnv.DB));
    await expect(service.list(device('house-a'))).resolves.toEqual({
      loyaltyPrograms: [{ program: 'LIDL_PLUS', status: 'UNKNOWN' }],
    });
  });

  it('saves ENABLED and DISABLED states', async () => {
    const service = new HouseholdLoyaltyService(new HouseholdLoyaltyRepository(testEnv.DB));
    await service.set(device('house-a'), 'LIDL_PLUS', { status: 'ENABLED' });
    await expect(service.list(device('house-a'))).resolves.toEqual({
      loyaltyPrograms: [{ program: 'LIDL_PLUS', status: 'ENABLED' }],
    });
    await service.set(device('house-a'), 'LIDL_PLUS', { status: 'DISABLED' });
    await expect(service.list(device('house-a'))).resolves.toEqual({
      loyaltyPrograms: [{ program: 'LIDL_PLUS', status: 'DISABLED' }],
    });
  });

  it('keeps two households isolated', async () => {
    const service = new HouseholdLoyaltyService(new HouseholdLoyaltyRepository(testEnv.DB));
    await service.set(device('house-a'), 'LIDL_PLUS', { status: 'ENABLED' });
    await service.set(device('house-b'), 'LIDL_PLUS', { status: 'DISABLED' });
    const [houseA, houseB] = await Promise.all([
      service.list(device('house-a')),
      service.list(device('house-b')),
    ]);
    expect(houseA.loyaltyPrograms[0].status).toBe('ENABLED');
    expect(houseB.loyaltyPrograms[0].status).toBe('DISABLED');
  });

  it('rejects unsupported programs and invalid statuses at runtime', async () => {
    const service = new HouseholdLoyaltyService(new HouseholdLoyaltyRepository(testEnv.DB));
    await expect(service.set(device('house-a'), 'CLUB_DIA', { status: 'ENABLED' })).rejects.toThrow(
      'El programa de fidelización no es válido.',
    );
    await expect(service.set(device('house-a'), 'LIDL_PLUS', { status: 'YES' })).rejects.toThrow(
      'El estado de fidelización no es válido.',
    );
  });
});
