import {
  OFFER_SUPERMARKETS,
  type PresentedOffer,
  type SupermarketProvider,
} from '../domain/supermarkets';
import type { Device } from '../domain/types';
import { badRequest } from '../errors';
import { CarrefourFixtureProvider } from '../providers/carrefour-fixture-provider';
import { DiaFixtureProvider } from '../providers/dia-fixture-provider';
import { LidlFixtureProvider } from '../providers/lidl-fixture-provider';
import { MercadonaProvider } from '../providers/mercadona-provider';
import { D1Repository } from '../repositories/d1-repository';
import { scoreProductMatch } from './product-matching';

interface OffersRepository {
  getActiveCycle(householdId: string): ReturnType<D1Repository['getActiveCycle']>;
}

const defaultProviders = (): SupermarketProvider[] => [
  new LidlFixtureProvider(),
  new MercadonaProvider(),
  new CarrefourFixtureProvider(),
  new DiaFixtureProvider(),
];

export class OffersService {
  constructor(
    private readonly repository: OffersRepository,
    private readonly providers: readonly SupermarketProvider[] = defaultProviders(),
    private readonly mode: 'DEMO' | 'REAL' = 'DEMO',
  ) {}

  async list(
    device: Device,
    url: URL,
  ): Promise<{
    offers: PresentedOffer[];
    partial: boolean;
    mode: 'DEMO' | 'REAL';
    lastUpdatedAt: string | null;
  }> {
    const supermarket = url.searchParams.get('supermarket');
    if (supermarket && !OFFER_SUPERMARKETS.some((id) => id === supermarket)) {
      throw badRequest('INVALID_SUPERMARKET', 'El filtro de supermercado no es válido.');
    }

    const selected = supermarket
      ? this.providers.filter((provider) => provider.supermarketId === supermarket)
      : this.providers;
    const [cycle, providerResults, updateResults] = await Promise.all([
      this.repository.getActiveCycle(device.householdId),
      Promise.allSettled(selected.map((provider) => provider.listPublishedOffers())),
      Promise.allSettled(
        selected.map((provider) => provider.getLastSuccessfulUpdate?.() ?? Promise.resolve(null)),
      ),
    ]);
    const offers = providerResults.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );

    const presented = offers
      .map((offer): PresentedOffer => {
        const matchedItemNames = cycle.items
          .filter(
            (item) =>
              !item.checked &&
              (item.supermarketId === null ||
                item.supermarketId === 'any' ||
                item.supermarketId === offer.supermarketId) &&
              scoreProductMatch(
                {
                  normalizedName: item.normalizedName,
                  category: item.category,
                  supermarketId: item.supermarketId,
                },
                {
                  externalProductId: offer.externalProductId,
                  normalizedName: offer.normalizedProductName,
                  category: offer.category,
                  visualCategory: offer.visualCategory,
                },
              ).confidence !== 'LOW',
          )
          .map((item) => item.name);
        return {
          ...offer,
          relatedToList: matchedItemNames.length > 0,
          matchedItemNames,
        };
      })
      .sort((left, right) =>
        left.relatedToList === right.relatedToList
          ? left.supermarketName.localeCompare(right.supermarketName, 'es')
          : left.relatedToList
            ? -1
            : 1,
      );
    const successfulUpdates = updateResults.flatMap((result) =>
      result.status === 'fulfilled' && result.value ? [result.value] : [],
    );
    const hasExplicitFreshness = selected.some(
      (provider) => provider.getLastSuccessfulUpdate !== undefined,
    );
    return {
      offers: presented,
      partial:
        providerResults.some((result) => result.status === 'rejected') ||
        updateResults.some((result) => result.status === 'rejected'),
      mode: this.mode,
      lastUpdatedAt: hasExplicitFreshness
        ? (successfulUpdates.sort().at(-1) ?? null)
        : (presented
            .map((offer) => offer.observedAt)
            .sort()
            .at(-1) ?? null),
    };
  }
}
