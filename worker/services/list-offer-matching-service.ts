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
import { normalizeProductName } from '../../src/shared/product-name';
import { calculatePackageFit, parsePackageDescription } from './package-matching';
import { scoreProductMatch } from './product-matching';
import { HouseholdLoyaltyRepository } from '../repositories/household-loyalty-repository';
import { calculateEffectivePrice } from './effective-price';

const packageLabel = (product: CatalogProductForMatching): string | null => {
  if (product.packageDescription) return product.packageDescription;
  if (product.packageQuantity === null) return product.packageUnit;
  return `${String(product.packageQuantity).replace('.', ',')} ${product.packageUnit ?? ''}`.trim();
};

const countableMultipack = (product: CatalogProductForMatching): boolean => {
  const label = packageLabel(product);
  const descriptor = parsePackageDescription(label);
  if ((descriptor.packCount ?? 1) <= 1) return false;
  if (descriptor.unit === 'COUNT') return true;
  if (descriptor.unit === 'ML') return true;
  const name = new Set(normalizeProductName(product.name).split(' '));
  return ['atun', 'pate', 'yogur'].some((token) => name.has(token));
};

const packagePricing = (product: CatalogProductForMatching, activeOffers: CatalogOffer[]) => {
  const general = activeOffers.find((offer) => !offer.requiresLoyaltyCard) ?? null;
  const normalPrices = activeOffers.flatMap((offer) =>
    offer.normalPriceCents === null ? [] : [offer.normalPriceCents],
  );
  return {
    regularUnitPriceCents:
      normalPrices.length > 0 ? Math.max(...normalPrices) : product.currentPriceCents,
    generalOffer:
      general === null
        ? null
        : {
            type: general.offerType,
            publishedOfferPriceCents: general.offerPriceCents,
            percentage: general.percentage,
            buyQuantity: general.buyQuantity,
            payQuantity: general.payQuantity,
          },
    lidlPlusUnitPriceCents: activeOffers.reduce<number | null>((lowest, offer) => {
      if (offer.lidlPlusPriceCents === null) return lowest;
      return lowest === null
        ? offer.lidlPlusPriceCents
        : Math.min(lowest, offer.lidlPlusPriceCents);
    }, null),
    unitPriceCents: product.unitPriceCents,
    unitPriceUnit: product.unitPriceUnit,
  };
};

const lidlAllowed = (item: ShoppingItem): boolean =>
  item.supermarketId === null || item.supermarketId === 'any' || item.supermarketId === 'lidl';

export class ListOfferMatchingService {
  constructor(
    private readonly shoppingRepository: D1Repository,
    private readonly matchRepository: ProductMatchRepository,
    private readonly offersProvider: LidlD1OffersProvider,
    private readonly loyaltyRepository?: HouseholdLoyaltyRepository,
  ) {}

  async list(device: Device): Promise<ListOfferMatchesResponse> {
    const [cycle, products, preferences, offers, lastUpdatedAt, lidlPlusStatus] = await Promise.all(
      [
        this.shoppingRepository.getActiveCycle(device.householdId),
        this.matchRepository.listCurrentLidlProducts(),
        this.matchRepository.listHouseholdPreferences(device.householdId),
        this.offersProvider.listPublishedOffers(),
        this.offersProvider.getLastSuccessfulUpdate(),
        this.loyaltyRepository?.getStatus(device.householdId, 'LIDL_PLUS') ??
          Promise.resolve('UNKNOWN' as const),
      ],
    );
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
          const productOffers = activeOffersByProduct.get(product.externalProductId) ?? [];
          const label = packageLabel(product);
          const generalOffer = productOffers.find((offer) => !offer.requiresLoyaltyCard) ?? null;
          const packageCalculation = calculatePackageFit(
            item.quantity,
            item.unit,
            parsePackageDescription(label),
            packagePricing(product, productOffers),
            countableMultipack(product),
          );
          return {
            externalProductId: product.externalProductId,
            productName: product.name,
            normalizedProductName: product.normalizedName,
            brand: product.brand,
            commercialCategory: product.commercialCategory,
            visualCategory: product.visualCategory,
            packageLabel: label,
            package: packageCalculation,
            pricing: calculateEffectivePrice({
              costs: packageCalculation.costs,
              loyaltyStatus: lidlPlusStatus,
              generalOfferType: generalOffer?.offerType,
            }),
            currentPriceCents: product.currentPriceCents,
            score: scored.score,
            confidence: scored.confidence,
            reasons: scored.reasons,
            preferred,
            activeOffers: productOffers,
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
