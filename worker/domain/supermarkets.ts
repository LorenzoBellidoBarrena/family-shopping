import type { ProductCategory } from '../../src/shared/product-category';

export const OFFER_SUPERMARKETS = ['lidl', 'mercadona', 'carrefour', 'dia'] as const;

export type OfferSupermarketId = (typeof OFFER_SUPERMARKETS)[number];

export interface CatalogOffer {
  id: string;
  externalProductId: string;
  supermarketId: OfferSupermarketId;
  supermarketName: string;
  storeName: string;
  city: string;
  productName: string;
  normalizedProductName: string;
  brand: string | null;
  category: string | null;
  visualCategory: ProductCategory;
  packageLabel: string | null;
  normalPriceCents: number | null;
  offerPriceCents: number;
  unitPriceCents: number | null;
  promotionType: string;
  validFrom: string | null;
  validUntil: string | null;
  sourceUrl: string;
  requiresLoyaltyCard: boolean;
  catalogAvailability: 'PUBLISHED';
  fixture: boolean;
  lidlPlusPriceCents: number | null;
  upcoming: boolean;
  geographicScope: 'NATIONAL' | 'REGIONAL' | 'STORE' | 'ONLINE' | 'UNKNOWN';
  channel: 'STORE' | 'ONLINE' | 'BOTH' | 'UNKNOWN';
  observedAt: string;
}

export interface PresentedOffer extends CatalogOffer {
  relatedToList: boolean;
  matchedItemNames: string[];
}

export interface SupermarketProvider {
  readonly supermarketId: OfferSupermarketId;
  listPublishedOffers(): Promise<CatalogOffer[]>;
  getLastSuccessfulUpdate?(): Promise<string | null>;
}

export interface ListMatchCandidate {
  externalProductId: string;
  productName: string;
  normalizedProductName: string;
  brand: string | null;
  commercialCategory: string | null;
  visualCategory: ProductCategory;
  packageLabel: string | null;
  currentPriceCents: number | null;
  score: number;
  confidence: 'HIGH' | 'MEDIUM';
  reasons: string[];
  preferred: boolean;
  activeOffers: CatalogOffer[];
}

export interface ShoppingItemOfferMatch {
  shoppingItemId: string;
  shoppingItemName: string;
  category: ProductCategory;
  quantity: string;
  unit: string;
  supermarketId: string | null;
  checked: boolean;
  dismissed: boolean;
  automaticMatchExternalProductId: string | null;
  candidates: ListMatchCandidate[];
}

export interface ListOfferMatchesResponse {
  matchedItems: ShoppingItemOfferMatch[];
  unmatchedItems: {
    shoppingItemId: string;
    shoppingItemName: string;
    reason: 'NO_CANDIDATE' | 'PREFERRED_OTHER_SUPERMARKET' | 'DISMISSED';
  }[];
  lastUpdatedAt: string | null;
}
