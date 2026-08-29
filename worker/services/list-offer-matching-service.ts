import type {
  CatalogOffer,
  ListMatchCandidate,
  ListOfferMatchesResponse,
  ShoppingItemOfferMatch,
} from '../domain/supermarkets';
import type { Device, ShoppingItem } from '../domain/types';
import { badRequest, notFound } from '../errors';
import { LidlD1OffersProvider } from '../providers/lidl-d1-offers-provider';
import { D1Repository } from '../repositories/d1-repository';
import {
  ProductMatchRepository,
  type CatalogProductForMatching,
} from '../repositories/product-match-repository';
import { scoreProductMatch } from './product-matching';

const packageLabel = (product: CatalogProductForMatching): string | null => {
  if (product.packageQuantity === null) return product.packageUnit;
  return `${String(product.packageQuantity).replace('.', ',')} ${product.packageUnit ?? ''}`.trim();
};

const lidlAllowed = (item: ShoppingItem): boolean =>
  item.supermarketId === null || item.supermarketId === 'any' || item.supermarketId === 'lidl';

export class ListOfferMatchingService {
  constructor(
    private readonly shoppingRepository: D1Repository,
    private readonly matchRepository: ProductMatchRepository,
    private readonly offersProvider: LidlD1OffersProvider,
  ) {}

  async list(device: Device): Promise<ListOfferMatchesResponse> {
    const [cycle, products, preferences, offers, lastUpdatedAt] = await Promise.all([
      this.shoppingRepository.getActiveCycle(device.householdId),
      this.matchRepository.listCurrentLidlProducts(),
      this.matchRepository.listHouseholdPreferences(device.householdId),
      this.offersProvider.listPublishedOffers(),
      this.offersProvider.getLastSuccessfulUpdate(),
    ]);
    const preferenceByName = new Map(
      preferences.map((preference) => [preference.normalizedAlias, preference]),
    );
    const activeOffersByProduct = new Map<string, CatalogOffer[]>();
    for (const offer of offers) {
      if (offer.upcoming) continue;
      const productOffers = activeOffersByProduct.get(offer.externalProductId) ?? [];
      productOffers.push(offer);
      activeOffersByProduct.set(offer.externalProductId, productOffers);
    }

    const matchedItems: ShoppingItemOfferMatch[] = [];
    const unmatchedItems: ListOfferMatchesResponse['unmatchedItems'] = [];
    for (const item of cycle.items) {
      if (item.checked) continue;
      if (!lidlAllowed(item)) {
        unmatchedItems.push({
          shoppingItemId: item.id,
          shoppingItemName: item.name,
          reason: 'PREFERRED_OTHER_SUPERMARKET',
        });
        continue;
      }
      const preference = preferenceByName.get(item.normalizedName);
      const preferredProductId =
        preference?.status === 'CONFIRMED' ? preference.externalProductId : null;
      const candidates = products
        .map((product): ListMatchCandidate | null => {
          const preferred = preferredProductId === product.externalProductId;
          const scored = scoreProductMatch(
            {
              normalizedName: item.normalizedName,
              category: item.category,
              supermarketId: item.supermarketId,
            },
            {
              externalProductId: product.externalProductId,
              normalizedName: product.normalizedName,
              category: product.commercialCategory,
              visualCategory: product.visualCategory,
            },
            preferred,
          );
          if (scored.confidence === 'LOW') return null;
          return {
            externalProductId: product.externalProductId,
            productName: product.name,
            normalizedProductName: product.normalizedName,
            brand: product.brand,
            commercialCategory: product.commercialCategory,
            visualCategory: product.visualCategory,
            packageLabel: packageLabel(product),
            currentPriceCents: product.currentPriceCents,
            score: scored.score,
            confidence: scored.confidence,
            reasons: scored.reasons,
            preferred,
            activeOffers: activeOffersByProduct.get(product.externalProductId) ?? [],
          };
        })
        .filter((candidate): candidate is ListMatchCandidate => candidate !== null)
        .sort(
          (left, right) =>
            Number(right.preferred) - Number(left.preferred) ||
            Number(right.activeOffers.length > 0) - Number(left.activeOffers.length > 0) ||
            right.score - left.score ||
            left.productName.localeCompare(right.productName, 'es'),
        )
        .slice(0, 5);

      if (candidates.length === 0) {
        unmatchedItems.push({
          shoppingItemId: item.id,
          shoppingItemName: item.name,
          reason: 'NO_CANDIDATE',
        });
        continue;
      }
      const top = candidates[0];
      const runnerUp = candidates[1];
      const dismissed = preference?.status === 'DISMISSED';
      const automaticMatchExternalProductId = dismissed
        ? null
        : top.preferred ||
            (top.confidence === 'HIGH' && (!runnerUp || top.score - runnerUp.score >= 15))
          ? top.externalProductId
          : null;
      matchedItems.push({
        shoppingItemId: item.id,
        shoppingItemName: item.name,
        category: item.category,
        quantity: item.quantity,
        unit: item.unit,
        supermarketId: item.supermarketId,
        checked: item.checked,
        dismissed,
        automaticMatchExternalProductId,
        candidates,
      });
    }
    return { matchedItems, unmatchedItems, lastUpdatedAt };
  }

  async confirm(device: Device, itemId: string, externalProductId: string): Promise<void> {
    const item = await this.shoppingRepository.getActiveItem(device.householdId, itemId);
    if (!lidlAllowed(item)) {
      throw badRequest(
        'PREFERRED_SUPERMARKET_MISMATCH',
        'Este producto tiene otro supermercado preferido.',
      );
    }
    const product = await this.matchRepository.getCurrentLidlProduct(externalProductId);
    if (!product) {
      throw notFound('El producto Lidl ya no está publicado en el catálogo actual.');
    }
    await this.matchRepository.confirm(
      device.householdId,
      item.normalizedName,
      product,
      new Date().toISOString(),
    );
  }

  async dismiss(device: Device, itemId: string): Promise<void> {
    const item = await this.shoppingRepository.getActiveItem(device.householdId, itemId);
    await this.matchRepository.dismiss(
      device.householdId,
      item.normalizedName,
      new Date().toISOString(),
    );
  }
}
