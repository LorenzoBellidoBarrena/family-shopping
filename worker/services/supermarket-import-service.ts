import type {
  ImportedProduct,
  ImportedStore,
  ImportRun,
  SupermarketImportProvider,
} from '../domain/supermarket-import';
import { CarrefourProvider } from '../providers/carrefour-provider';
import { DiaProvider } from '../providers/dia-provider';
import { LidlProvider } from '../providers/lidl-provider';
import { SupermarketImportRepository } from '../repositories/supermarket-import-repository';
import { conflict } from '../errors';
import { validateImportedProduct } from './supermarket-import-validation';

const ACTIVE_IMPORT_WINDOW_MS = 15 * 60 * 1000;
const LIDL_MINIMUM_HISTORICAL_RATIO = 0.2;

const safeErrorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'IMPORT_FAILED';
  const normalized = message
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/gu, '_')
    .slice(0, 80);
  return normalized || 'IMPORT_FAILED';
};

export class SupermarketImportService {
  constructor(
    private readonly repository: SupermarketImportRepository,
    private readonly provider: SupermarketImportProvider = new CarrefourProvider(),
  ) {}

  listRuns(limit = 20): Promise<ImportRun[]> {
    return this.repository.listRuns(limit);
  }

  async importCarrefour(limit = 20): Promise<ImportRun> {
    const provider =
      this.provider.providerId === 'carrefour' ? this.provider : new CarrefourProvider();
    const run = await this.importProvider(provider, limit);
    if (!run) throw new Error('CARREFOUR_IMPORT_NOT_STARTED');
    return run;
  }

  async importDia(limit = 20): Promise<ImportRun> {
    const provider = this.provider.providerId === 'dia' ? this.provider : new DiaProvider();
    const run = await this.importProvider(provider, limit);
    if (!run) throw new Error('DIA_IMPORT_NOT_STARTED');
    return run;
  }

  async importLidl(limit = 20): Promise<ImportRun> {
    const run = await this.tryImportLidl(limit);
    if (!run) {
      throw conflict('IMPORT_ALREADY_RUNNING', 'Ya existe una importación Lidl en curso.');
    }
    return run;
  }

  async tryImportLidl(limit = 20): Promise<ImportRun | null> {
    const provider = this.provider.providerId === 'lidl' ? this.provider : new LidlProvider();
    return this.importProvider(provider, limit, true);
  }

  private async importProvider(
    provider: SupermarketImportProvider,
    limit: number,
    preventOverlap = false,
  ): Promise<ImportRun | null> {
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    if (preventOverlap) {
      const activeAfter = new Date(Date.parse(startedAt) - ACTIVE_IMPORT_WINDOW_MS).toISOString();
      if (
        !(await this.repository.startRunIfAvailable(
          runId,
          provider.providerId,
          startedAt,
          activeAfter,
        ))
      ) {
        return null;
      }
    } else {
      await this.repository.startRun(runId, provider.providerId, startedAt);
    }
    let productsSeen = 0;
    let pricesSeen = 0;
    let offersSeen = 0;
    let rejectedItems = 0;
    let firstError: string | null = null;
    const importedIds = new Set<string>();
    const stores: ImportedStore[] = [];
    const products: ImportedProduct[] = [];

    try {
      if (provider.discoverStores && provider.parseStores) {
        for (const sourceUrl of await provider.discoverStores()) {
          try {
            const document = await provider.fetch(sourceUrl);
            for (const store of provider.parseStores(document, sourceUrl)) {
              stores.push(store);
            }
          } catch (error) {
            rejectedItems += 1;
            firstError ??= safeErrorCode(error);
          }
        }
      }
      const sources = await provider.discover(limit);
      if (sources.length === 0)
        throw new Error(`${provider.providerId.toUpperCase()}_DISCOVERY_EMPTY`);
      sourceLoop: for (const sourceUrl of sources) {
        try {
          const document = await provider.fetch(sourceUrl);
          const parsed = provider.parse(document, sourceUrl);
          if (parsed.length === 0) {
            rejectedItems += 1;
            firstError ??= `${provider.providerId.toUpperCase()}_NO_VALID_PRODUCT`;
            continue;
          }
          for (const candidate of parsed) {
            if (products.length >= limit) break sourceLoop;
            try {
              const product = validateImportedProduct(provider.normalize(candidate));
              if (importedIds.has(product.externalId)) continue;
              importedIds.add(product.externalId);
              products.push(product);
            } catch (error) {
              rejectedItems += 1;
              firstError ??= safeErrorCode(error);
            }
          }
        } catch (error) {
          rejectedItems += 1;
          firstError ??= safeErrorCode(error);
        }
      }

      if (products.length === 0) {
        const noProductCode = `${provider.providerId.toUpperCase()}_NO_VALID_PRODUCT`;
        if (provider.providerId === 'lidl') firstError = noProductCode;
        throw new Error(noProductCode);
      }
      if (provider.providerId === 'lidl') {
        const previous = await this.repository.getLastSuccessfulRun('lidl');
        const historicalTarget = previous ? Math.min(previous.productsSeen, limit) : 0;
        const minimumProducts =
          historicalTarget >= 10
            ? Math.max(2, Math.floor(historicalTarget * LIDL_MINIMUM_HISTORICAL_RATIO))
            : 1;
        if (products.length < minimumProducts) {
          firstError = 'LIDL_SUSPICIOUS_PRODUCT_DROP';
          throw new Error(firstError);
        }
      }

      for (const store of stores) {
        await this.repository.persistStore(provider.providerId, store);
      }
      for (const product of products) {
        try {
          const persisted = await this.repository.persistProduct(
            provider.providerId,
            provider.catalogStore,
            product,
            new Date().toISOString(),
          );
          productsSeen += 1;
          pricesSeen += 1;
          offersSeen += persisted.offersPersisted;
        } catch (error) {
          rejectedItems += 1;
          firstError ??= safeErrorCode(error);
        }
      }
      const status = productsSeen === 0 ? 'FAILED' : rejectedItems > 0 ? 'PARTIAL' : 'SUCCESS';
      return this.repository.finishRun(runId, {
        status,
        now: new Date().toISOString(),
        productsSeen,
        pricesSeen,
        offersSeen,
        rejectedItems,
        errorCode: status === 'SUCCESS' ? null : firstError,
      });
    } catch (error) {
      return this.repository.finishRun(runId, {
        status: 'FAILED',
        now: new Date().toISOString(),
        productsSeen,
        pricesSeen,
        offersSeen,
        rejectedItems,
        errorCode: firstError ?? safeErrorCode(error),
      });
    }
  }
}
