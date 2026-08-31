import type {
  CatalogOffer,
  ListAlternativeCandidate,
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
import {
  detectProductConcept,
  matchProductAlternative,
  type ProductConcept,
} from './alternative-matching';

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

const candidateDetails = (
  item: ShoppingItem,
  product: CatalogProductForMatching,
  productOffers: CatalogOffer[],
  lidlPlusStatus: 'UNKNOWN' | 'ENABLED' | 'DISABLED',
) => {
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
    imageUrl: product.imageUrl,
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
    activeOffers: productOffers,
  };
};

export class ListOfferMatchingService {
  constructor(
    private readonly shoppingRepository: D1Repository,
    private readonly matchRepository: ProductMatchRepository,
    private readonly offersProvider: LidlD1OffersProvider,
    private readonly loyaltyRepository?: HouseholdLoyaltyRepository,
  ) {}

  async list(device: Device): Promise<ListOfferMatchesResponse> {
    const [
      cycle,
      products,
      preferences,
      alternativePreferences,
      offers,
      lastUpdatedAt,
      lidlPlusStatus,
    ] = await Promise.all([
      this.shoppingRepository.getActiveCycle(device.householdId),
      this.matchRepository.listCurrentLidlProducts(),
      this.matchRepository.listHouseholdPreferences(device.householdId),
      this.matchRepository.listHouseholdAlternativePreferences(device.householdId),
      this.offersProvider.listPublishedOffers(),
      this.offersProvider.getLastSuccessfulUpdate(),
      this.loyaltyRepository?.getStatus(device.householdId, 'LIDL_PLUS') ??
        Promise.resolve('UNKNOWN' as const),
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
    const alternativePreferencesByName = new Map<
      string,
      Map<ProductConcept, (typeof alternativePreferences)[number]>
    >();
    for (const preference of alternativePreferences) {
      const preferencesForName =
        alternativePreferencesByName.get(preference.normalizedName) ?? new Map();
      preferencesForName.set(preference.targetConcept, preference);
      alternativePreferencesByName.set(preference.normalizedName, preferencesForName);
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
          return {
            ...candidateDetails(item, product, productOffers, lidlPlusStatus),
            score: scored.score,
            confidence: scored.confidence,
            reasons: scored.reasons,
            preferred,
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

      const identityProductIds = new Set(
        candidates.map((candidate) => candidate.externalProductId),
      );
      const alternativePreferencesForName = alternativePreferencesByName.get(item.normalizedName);
      const alternatives = products
        .map((product): ListAlternativeCandidate | null => {
          const productOffers = activeOffersByProduct.get(product.externalProductId) ?? [];
          if (productOffers.length === 0 || identityProductIds.has(product.externalProductId)) {
            return null;
          }
          const targetConcept = detectProductConcept(product.normalizedName);
          if (!targetConcept) return null;
          const alternativePreference = alternativePreferencesForName?.get(targetConcept);
          if (alternativePreference?.status === 'DISMISSED') return null;
          const learned = alternativePreference?.status === 'ACCEPTED';
          const alternative = matchProductAlternative(
            item.normalizedName,
            product.normalizedName,
            product.visualCategory,
            learned ? targetConcept : undefined,
          );
          if (!alternative) return null;
          const preferredSku =
            learned &&
            alternativePreference?.preferredExternalProductId === product.externalProductId;
          return {
            ...candidateDetails(item, product, productOffers, lidlPlusStatus),
            score: alternative.score + (preferredSku ? 5 : 0),
            confidence: 'MEDIUM',
            reasons: alternative.reasons,
            preferred: preferredSku,
            relationship: 'ALTERNATIVE',
            alternativeStrength: alternative.strength,
            sourceConcept: alternative.sourceConcept,
            targetConcept: alternative.targetConcept,
            alternativeReasons: alternative.reasons,
            learned,
          };
        })
        .filter((candidate): candidate is ListAlternativeCandidate => candidate !== null)
        .sort(
          (left, right) =>
            Number(right.learned) - Number(left.learned) ||
            Number(right.preferred) - Number(left.preferred) ||
            right.score - left.score ||
            left.productName.localeCompare(right.productName, 'es'),
        )
        .slice(0, 3);

      if (candidates.length === 0 && alternatives.length === 0) {
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
      const automaticMatchExternalProductId =
        dismissed || !top
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
        alternatives,
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

  async saveAlternative(
    device: Device,
    itemId: string,
    externalProductId: string,
    status: 'ACCEPTED' | 'DISMISSED',
  ): Promise<void> {
    const item = await this.shoppingRepository.getActiveItem(device.householdId, itemId);
    if (!lidlAllowed(item)) {
      throw badRequest(
        'PREFERRED_SUPERMARKET_MISMATCH',
        'Este producto tiene otro supermercado preferido.',
      );
    }
    const product = await this.matchRepository.getCurrentLidlProduct(externalProductId);
    if (!product) throw notFound('El producto Lidl ya no está publicado en el catálogo actual.');
    const relation = matchProductAlternative(
      item.normalizedName,
      product.normalizedName,
      product.visualCategory,
    );
    if (!relation) {
      throw badRequest('INVALID_ALTERNATIVE', 'El producto no es una alternativa permitida.');
    }
    await this.matchRepository.saveAlternative(
      device.householdId,
      item.normalizedName,
      relation.sourceConcept,
      relation.targetConcept,
      product.externalProductId,
      status,
      new Date().toISOString(),
    );
  }
}
