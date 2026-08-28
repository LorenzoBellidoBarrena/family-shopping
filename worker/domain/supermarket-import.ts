import type { ProductCategory } from '../../src/shared/product-category';

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
  validFrom: string;
  validUntil: string;
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
  imageUrl: string | null;
  packageQuantity: number | null;
  packageUnit: string | null;
  priceCents: number;
  unitPriceCents: number | null;
  unitPriceUnit: string | null;
  sourceUrl: string;
  channel: OfferChannel;
  geographicScope: GeographicScope;
  offer: ImportedOffer | null;
}

export interface ParsedCarrefourProduct {
  externalId: string;
  name: string;
  brand?: string;
  ean?: string;
  commercialCategory?: string;
  imageUrl?: string;
  packageQuantity?: number;
  packageUnit?: string;
  priceText: string;
  normalPriceText?: string;
  unitPriceText?: string;
  promotionText?: string;
  validFrom?: string;
  validUntil?: string;
  sourceUrl: string;
}

export interface SupermarketImportProvider {
  readonly providerId: 'carrefour';
  discover(limit?: number): Promise<string[]>;
  fetch(sourceUrl: string): Promise<string>;
  parse(document: string, sourceUrl: string): ParsedCarrefourProduct[];
  normalize(product: ParsedCarrefourProduct): ImportedProduct;
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
