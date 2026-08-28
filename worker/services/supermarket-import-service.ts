import type { ImportRun, SupermarketImportProvider } from '../domain/supermarket-import';
import { CarrefourProvider } from '../providers/carrefour-provider';
import { DiaProvider } from '../providers/dia-provider';
import { SupermarketImportRepository } from '../repositories/supermarket-import-repository';
import { validateImportedProduct } from './supermarket-import-validation';

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
    return this.importProvider(provider, limit);
  }

  async importDia(limit = 20): Promise<ImportRun> {
    const provider = this.provider.providerId === 'dia' ? this.provider : new DiaProvider();
    return this.importProvider(provider, limit);
  }

  private async importProvider(
    provider: SupermarketImportProvider,
    limit: number,
  ): Promise<ImportRun> {
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    await this.repository.startRun(runId, provider.providerId, startedAt);
    let productsSeen = 0;
    let pricesSeen = 0;
    let offersSeen = 0;
    let rejectedItems = 0;
    let firstError: string | null = null;
    const importedIds = new Set<string>();

    try {
      if (provider.discoverStores && provider.parseStores) {
        for (const sourceUrl of await provider.discoverStores()) {
          try {
            const document = await provider.fetch(sourceUrl);
            for (const store of provider.parseStores(document, sourceUrl)) {
              await this.repository.persistStore(provider.providerId, store);
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
      for (const sourceUrl of sources) {
        try {
          const document = await provider.fetch(sourceUrl);
          const parsed = provider.parse(document, sourceUrl);
          if (parsed.length === 0) {
            rejectedItems += 1;
            firstError ??= `${provider.providerId.toUpperCase()}_NO_VALID_PRODUCT`;
            continue;
          }
          for (const candidate of parsed) {
            try {
              const product = validateImportedProduct(provider.normalize(candidate));
              if (importedIds.has(product.externalId)) continue;
              importedIds.add(product.externalId);
              const persisted = await this.repository.persistProduct(
                provider.providerId,
                provider.catalogStore,
                product,
                new Date().toISOString(),
              );
              productsSeen += 1;
              pricesSeen += 1;
              if (persisted.offerPersisted) offersSeen += 1;
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
        errorCode: safeErrorCode(error),
      });
    }
  }
}
