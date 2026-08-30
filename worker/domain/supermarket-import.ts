import type { ProductCategory } from '../../src/shared/product-category';
import type { OfferBrowseCategory } from '../../src/shared/offer-browse-category';

export const OFFER_TYPES = [
  'DIRECT_DISCOUNT',
  'PERCENTAGE_DISCOUNT',
  'BUY_X_PAY_Y',
  'SECOND_UNIT_DISCOUNT',
  'CASHBACK',
  'LOYALTY_PRICE',
  'SPECIAL_PRICE',
] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

export const OFFER_CHANNELS = ['STORE', 'ONLINE', 'BOTH', 'UNKNOWN'] as const;
export type OfferChannel = (typeof OFFER_CHANNELS)[number];

export const GEOGRAPHIC_SCOPES = ['NATIONAL', 'REGIONAL', 'STORE', 'ONLINE', 'UNKNOWN'] as const;
export type GeographicScope = (typeof GEOGRAPHIC_SCOPES)[number];

export interface ImportedOffer {
  type: OfferType;
  label: string;
  normalPriceCents: number | null;
  offerPriceCents: number;
  percentage: number | null;
  buyQuantity: number | null;
  payQuantity: number | null;
  validFrom: string | null;
  validUntil: string | null;
  channel: OfferChannel;
  geographicScope: GeographicScope;
  requiresLoyaltyCard: boolean;
  loyaltyProgram: string | null;
}

export interface ImportedProduct {
  externalId: string;
  ean: string | null;
  name: string;
  normalizedName: string;
  brand: string | null;
  commercialCategory: string | null;
  visualCategory: ProductCategory;
  offerBrowseCategory: OfferBrowseCategory;
  imageUrl: string | null;
  packageQuantity: number | null;
  packageUnit: string | null;
  packageDescription?: string | null;
  priceCents: number;
  unitPriceCents: number | null;
  unitPriceUnit: string | null;
  sourceUrl: string;
  channel: OfferChannel;
  geographicScope: GeographicScope;
  offers: ImportedOffer[];
}

export interface ParsedSupermarketProduct {
  externalId: string;
  name: string;
  brand?: string;
  ean?: string;
  commercialCategory?: string;
  imageUrl?: string;
  packageQuantity?: number;
  packageUnit?: string;
  packageDescription?: string;
  priceText: string;
  normalPriceText?: string;
  unitPriceText?: string;
  promotionText?: string;
  validFrom?: string;
  validUntil?: string;
  sourceUrl: string;
  promotionRequiresLoyalty?: boolean;
  promotionTypeHint?: OfferType;
  channel?: OfferChannel;
  geographicScope?: GeographicScope;
  offers?: ImportedOffer[];
  parsedPriceCents?: number;
  parsedUnitPriceCents?: number | null;
  parsedUnitPriceUnit?: string | null;
}

export type ParsedCarrefourProduct = ParsedSupermarketProduct;

export interface ImportedStore {
  externalId: string;
  name: string;
  address: string;
  city: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
}

export interface SupermarketImportProvider {
  readonly providerId: 'carrefour' | 'dia' | 'lidl';
  readonly catalogStore: ImportedStore;
  discover(limit?: number): Promise<string[]>;
  fetch(sourceUrl: string): Promise<string>;
  parse(document: string, sourceUrl: string): ParsedSupermarketProduct[];
  normalize(product: ParsedSupermarketProduct): ImportedProduct;
  discoverStores?(): Promise<string[]>;
  parseStores?(document: string, sourceUrl: string): ImportedStore[];
}

export interface ImportRun {
  id: string;
  provider: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
  productsSeen: number;
  pricesSeen: number;
  offersSeen: number;
  rejectedItems: number;
  errorCode: string | null;
}
