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
import { productsMatch } from './product-matching';

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
    const [cycle, providerResults] = await Promise.all([
      this.repository.getActiveCycle(device.householdId),
      Promise.allSettled(selected.map((provider) => provider.listPublishedOffers())),
    ]);
    const offers = providerResults.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );

    const presented = offers
      .map((offer): PresentedOffer => {
        const matchedItemNames = cycle.items
          .filter((item) => productsMatch(item.name, offer.productName))
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
    return {
      offers: presented,
      partial: providerResults.some((result) => result.status === 'rejected'),
      mode: this.mode,
      lastUpdatedAt:
        presented
          .map((offer) => offer.observedAt)
          .sort()
          .at(-1) ?? null,
    };
  }
}
