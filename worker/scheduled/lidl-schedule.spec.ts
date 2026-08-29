import { describe, expect, it, vi } from 'vitest';
import type { ImportRun } from '../domain/supermarket-import';
import {
  LIDL_SCHEDULE_IMPORT_LIMIT,
  runScheduledLidlImport,
  shouldRunScheduledLidlImport,
} from './lidl-schedule';

const timestamp = (value: string): number => Date.parse(value);

const successfulRun: ImportRun = {
  id: 'run-lidl',
  provider: 'lidl',
  startedAt: '2026-07-15T03:00:00.000Z',
  finishedAt: '2026-07-15T03:00:10.000Z',
  status: 'SUCCESS',
  productsSeen: 53,
  pricesSeen: 53,
  offersSeen: 84,
  rejectedItems: 0,
  errorCode: null,
};

const failedRun: ImportRun = {
  ...successfulRun,
  id: 'run-lidl-failed',
  status: 'FAILED',
  productsSeen: 0,
  pricesSeen: 0,
  offersSeen: 0,
  errorCode: 'LIDL_NO_VALID_PRODUCT',
};

describe('daily Lidl schedule', () => {
  it('runs only the 03:00 UTC trigger during CEST', () => {
    expect(shouldRunScheduledLidlImport(timestamp('2026-07-15T03:00:00.000Z'))).toBe(true);
    expect(shouldRunScheduledLidlImport(timestamp('2026-07-15T04:00:00.000Z'))).toBe(false);
  });

  it('runs only the 04:00 UTC trigger during CET', () => {
    expect(shouldRunScheduledLidlImport(timestamp('2026-01-15T03:00:00.000Z'))).toBe(false);
    expect(shouldRunScheduledLidlImport(timestamp('2026-01-15T04:00:00.000Z'))).toBe(true);
  });

  it('keeps exactly one valid trigger around both DST transitions', () => {
    expect(
      [timestamp('2026-03-29T03:00:00.000Z'), timestamp('2026-03-29T04:00:00.000Z')].filter(
        shouldRunScheduledLidlImport,
      ),
    ).toHaveLength(1);
    expect(
      [timestamp('2026-10-25T03:00:00.000Z'), timestamp('2026-10-25T04:00:00.000Z')].filter(
        shouldRunScheduledLidlImport,
      ),
    ).toHaveLength(1);
  });

  it('skips the non-matching trigger without starting an import', async () => {
    const importer = { tryImportLidl: vi.fn(async () => successfulRun) };
    const logger = { info: vi.fn() };

    await expect(
      runScheduledLidlImport(timestamp('2026-07-15T04:00:00.000Z'), importer, logger),
    ).resolves.toEqual({ status: 'SKIPPED_TIME' });
    expect(importer.tryImportLidl).not.toHaveBeenCalled();
  });

  it('runs Lidl with the production-safe limit at 05:00 Madrid', async () => {
    const importer = { tryImportLidl: vi.fn(async () => successfulRun) };
    const logger = { info: vi.fn() };

    await expect(
      runScheduledLidlImport(timestamp('2026-07-15T03:00:00.000Z'), importer, logger),
    ).resolves.toEqual({ status: 'SUCCESS', run: successfulRun });
    expect(importer.tryImportLidl).toHaveBeenCalledWith(LIDL_SCHEDULE_IMPORT_LIMIT);
    expect(logger.info).toHaveBeenCalledWith(
      'lidl_scheduled_import',
      expect.objectContaining({ provider: 'LIDL', trigger: 'SCHEDULED', status: 'SUCCESS' }),
    );
  });

  it('skips cleanly when another Lidl import owns the lock', async () => {
    const importer = { tryImportLidl: vi.fn(async () => null) };
    const logger = { info: vi.fn() };

    await expect(
      runScheduledLidlImport(timestamp('2026-01-15T04:00:00.000Z'), importer, logger),
    ).resolves.toEqual({ status: 'SKIPPED_ALREADY_RUNNING' });
  });

  it('reports a failed zero-result run without converting it into a success', async () => {
    const importer = { tryImportLidl: vi.fn(async () => failedRun) };
    const logger = { info: vi.fn() };

    await expect(
      runScheduledLidlImport(timestamp('2026-01-15T04:00:00.000Z'), importer, logger),
    ).resolves.toEqual({ status: 'FAILED', run: failedRun });
    expect(logger.info).toHaveBeenCalledWith(
      'lidl_scheduled_import',
      expect.objectContaining({ status: 'FAILED', products: 0, prices: 0, offers: 0 }),
    );
  });
});
