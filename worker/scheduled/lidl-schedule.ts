import type { ImportRun } from '../domain/supermarket-import';
import type { SupermarketImportService } from '../services/supermarket-import-service';

export const LIDL_SCHEDULE_TIME_ZONE = 'Europe/Madrid';
export const LIDL_SCHEDULE_LOCAL_HOUR = 5;
export const LIDL_SCHEDULE_IMPORT_LIMIT = 100;

interface ScheduledLogger {
  info(message: string, details: Record<string, unknown>): void;
}

export type ScheduledLidlResult =
  | { status: 'SKIPPED_TIME' }
  | { status: 'SKIPPED_ALREADY_RUNNING' }
  | { status: ImportRun['status']; run: ImportRun };

const madridTime = (scheduledTime: number): { hour: number; minute: number } => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LIDL_SCHEDULE_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(scheduledTime));
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number.parseInt(parts.find((part) => part.type === type)?.value ?? '-1', 10);
  return { hour: value('hour'), minute: value('minute') };
};

export const shouldRunScheduledLidlImport = (scheduledTime: number): boolean => {
  const local = madridTime(scheduledTime);
  return local.hour === LIDL_SCHEDULE_LOCAL_HOUR && local.minute === 0;
};

export const runScheduledLidlImport = async (
  scheduledTime: number,
  service: Pick<SupermarketImportService, 'tryImportLidl'>,
  logger: ScheduledLogger = console,
): Promise<ScheduledLidlResult> => {
  if (!shouldRunScheduledLidlImport(scheduledTime)) {
    logger.info('lidl_scheduled_import', {
      provider: 'LIDL',
      trigger: 'SCHEDULED',
      status: 'SKIPPED_TIME',
    });
    return { status: 'SKIPPED_TIME' };
  }

  const started = Date.now();
  const run = await service.tryImportLidl(LIDL_SCHEDULE_IMPORT_LIMIT);
  if (!run) {
    logger.info('lidl_scheduled_import', {
      provider: 'LIDL',
      trigger: 'SCHEDULED',
      status: 'SKIPPED_ALREADY_RUNNING',
    });
    return { status: 'SKIPPED_ALREADY_RUNNING' };
  }

  logger.info('lidl_scheduled_import', {
    provider: 'LIDL',
    trigger: 'SCHEDULED',
    status: run.status,
    products: run.productsSeen,
    prices: run.pricesSeen,
    offers: run.offersSeen,
    durationMs: Date.now() - started,
  });
  return { status: run.status, run };
};
