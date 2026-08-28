import {
  OFFER_SUPERMARKETS,
  type PresentedOffer,
  type SupermarketProvider,
} from '../domain/supermarkets';
import type { Device } from '../domain/types';
import { badRequest } from '../errors';
import { CarrefourProvider } from '../providers/carrefour-provider';
import { DiaProvider } from '../providers/dia-provider';
import { LidlProvider } from '../providers/lidl-provider';
import { MercadonaProvider } from '../providers/mercadona-provider';
import { D1Repository } from '../repositories/d1-repository';
import { productsMatch } from './product-matching';

interface OffersRepository {
  getActiveCycle(householdId: string): ReturnType<D1Repository['getActiveCycle']>;
}

const defaultProviders = (): SupermarketProvider[] => [
  new LidlProvider(),
  new MercadonaProvider(),
  new CarrefourProvider(),
  new DiaProvider(),
];

export class OffersService {
  constructor(
    private readonly repository: OffersRepository,
    private readonly providers: readonly SupermarketProvider[] = defaultProviders(),
  ) {}

  async list(device: Device, url: URL): Promise<{ offers: PresentedOffer[]; partial: boolean }> {
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

    return {
      offers: offers
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
        ),
      partial: providerResults.some((result) => result.status === 'rejected'),
    };
  }
}
