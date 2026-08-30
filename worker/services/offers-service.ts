import {
  OFFER_SUPERMARKETS,
  type PresentedOffer,
  type SupermarketProvider,
} from '../domain/supermarkets';
import type { Device } from '../domain/types';
import { badRequest } from '../errors';
import {
  OFFER_BROWSE_CATEGORIES,
  isOfferBrowseCategory,
  type OfferBrowseCategory,
} from '../../src/shared/offer-browse-category';
import { CarrefourFixtureProvider } from '../providers/carrefour-fixture-provider';
import { DiaFixtureProvider } from '../providers/dia-fixture-provider';
import { LidlFixtureProvider } from '../providers/lidl-fixture-provider';
import { MercadonaProvider } from '../providers/mercadona-provider';
import { HouseholdLoyaltyRepository } from '../repositories/household-loyalty-repository';
import { calculatePromotionCost } from './package-matching';
import { calculateEffectivePrice } from './effective-price';

const defaultProviders = (): SupermarketProvider[] => [
  new LidlFixtureProvider(),
  new MercadonaProvider(),
  new CarrefourFixtureProvider(),
  new DiaFixtureProvider(),
];

export class OffersService {
  constructor(
    private readonly providers: readonly SupermarketProvider[] = defaultProviders(),
    private readonly mode: 'DEMO' | 'REAL' = 'DEMO',
    private readonly loyaltyRepository?: HouseholdLoyaltyRepository,
  ) {}

  async list(
    device: Device,
    url: URL,
  ): Promise<{
    offers: PresentedOffer[];
    partial: boolean;
    mode: 'DEMO' | 'REAL';
    lastUpdatedAt: string | null;
    categories: { code: OfferBrowseCategory; label: string; emoji: string; count: number }[];
  }> {
    const supermarket = url.searchParams.get('supermarket');
    if (supermarket && !OFFER_SUPERMARKETS.some((id) => id === supermarket)) {
      throw badRequest('INVALID_SUPERMARKET', 'El filtro de supermercado no es válido.');
    }
    const categoryValue = url.searchParams.get('category');
    if (categoryValue && !isOfferBrowseCategory(categoryValue)) {
      throw badRequest('INVALID_OFFER_CATEGORY', 'La categoría de ofertas no es válida.');
    }
    const category = categoryValue as OfferBrowseCategory | null;

    const selected = supermarket
      ? this.providers.filter((provider) => provider.supermarketId === supermarket)
      : this.providers;
    const [providerResults, countResults, updateResults, lidlPlusStatus] = await Promise.all([
      Promise.allSettled(
        selected.map((provider) => provider.listPublishedOffers(category ?? undefined)),
      ),
      Promise.allSettled(
        selected.map((provider) => provider.listBrowseCategoryCounts?.() ?? Promise.resolve(null)),
      ),
      Promise.allSettled(
        selected.map((provider) => provider.getLastSuccessfulUpdate?.() ?? Promise.resolve(null)),
      ),
      this.loyaltyRepository?.getStatus(device.householdId, 'LIDL_PLUS') ??
        Promise.resolve('UNKNOWN' as const),
    ]);
    const offers = providerResults
      .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
      .filter((offer) => !category || offer.offerBrowseCategory === category);

    const presented = offers
      .map((offer): PresentedOffer => {
        return {
          ...offer,
          // List matching has its own lazy endpoint. Catalog browsing must never read
          // the active family cycle or enter the critical shopping-list path.
          relatedToList: false,
          matchedItemNames: [],
          pricing: (() => {
            if (offer.upcoming) {
              return calculateEffectivePrice({
                costs: {
                  regularCostCents: null,
                  generalOfferCostCents: null,
                  lidlPlusCostCents: null,
                },
                loyaltyStatus: lidlPlusStatus,
              });
            }
            const regularUnitPrice = offer.normalPriceCents ?? offer.offerPriceCents;
            const generalOfferCost = offer.requiresLoyaltyCard
              ? null
              : calculatePromotionCost({
                  type: offer.offerType,
                  packsNeeded: 1,
                  regularUnitPriceCents: regularUnitPrice,
                  publishedOfferPriceCents: offer.offerPriceCents,
                  percentage: offer.percentage,
                  buyQuantity: offer.buyQuantity,
                  payQuantity: offer.payQuantity,
                });
            return calculateEffectivePrice({
              costs: {
                regularCostCents: regularUnitPrice,
                generalOfferCostCents: generalOfferCost,
                lidlPlusCostCents: offer.lidlPlusPriceCents,
              },
              loyaltyStatus: offer.supermarketId === 'lidl' ? lidlPlusStatus : 'UNKNOWN',
              generalOfferType: offer.offerType,
            });
          })(),
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
    const categoryCounts = new Map<OfferBrowseCategory, number>();
    for (const result of countResults) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      for (const [code, count] of Object.entries(result.value)) {
        if (isOfferBrowseCategory(code) && typeof count === 'number') {
          categoryCounts.set(code, (categoryCounts.get(code) ?? 0) + count);
        }
      }
    }
    if (categoryCounts.size === 0 && !category) {
      for (const offer of offers) {
        categoryCounts.set(
          offer.offerBrowseCategory,
          (categoryCounts.get(offer.offerBrowseCategory) ?? 0) + 1,
        );
      }
    }
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
      categories: OFFER_BROWSE_CATEGORIES.filter(
        (definition) => (categoryCounts.get(definition.code) ?? 0) > 0,
      ).map((definition) => ({
        code: definition.code,
        label: definition.label,
        emoji: definition.emoji,
        count: categoryCounts.get(definition.code) ?? 0,
      })),
    };
  }
}
