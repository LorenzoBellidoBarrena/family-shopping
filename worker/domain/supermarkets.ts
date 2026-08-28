export const OFFER_SUPERMARKETS = ['lidl', 'mercadona', 'carrefour', 'dia'] as const;

export type OfferSupermarketId = (typeof OFFER_SUPERMARKETS)[number];

export interface CatalogOffer {
  id: string;
  supermarketId: OfferSupermarketId;
  supermarketName: string;
  storeName: string;
  city: string;
  productName: string;
  normalizedProductName: string;
  brand: string | null;
  category: string | null;
  packageLabel: string | null;
  normalPriceCents: number | null;
  offerPriceCents: number;
  unitPriceCents: number | null;
  promotionType: string;
  validFrom: string;
  validUntil: string;
  sourceUrl: string;
  requiresLoyaltyCard: boolean;
  catalogAvailability: 'PUBLISHED';
  fixture: boolean;
}

export interface PresentedOffer extends CatalogOffer {
  relatedToList: boolean;
  matchedItemNames: string[];
}

export interface SupermarketProvider {
  readonly supermarketId: OfferSupermarketId;
  listPublishedOffers(): Promise<CatalogOffer[]>;
}
