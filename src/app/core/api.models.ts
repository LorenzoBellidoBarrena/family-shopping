import type { ProductCategory } from '../../shared/product-category';
import type { OfferBrowseCategory } from '../../shared/offer-browse-category';

export type { ProductCategory } from '../../shared/product-category';
export type { OfferBrowseCategory } from '../../shared/offer-browse-category';

export const UNITS = [
  'unidad',
  'pack',
  'kg',
  'g',
  'litro',
  'ml',
  'caja',
  'botella',
  'otro',
] as const;

export type Unit = (typeof UNITS)[number];
export type ClearAction = 'CANCEL' | 'CLEAR_ALL' | 'CARRY_PENDING';

export interface ShoppingItem {
  id: string;
  shoppingCycleId: string;
  name: string;
  normalizedName: string;
  quantity: string;
  unit: Unit;
  supermarketId: string | null;
  category: ProductCategory;
  checked: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  checkedAt: string | null;
}

export interface ShoppingCycle {
  id: string;
  householdId: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CLEARED';
  createdAt: string;
  closedAt: string | null;
  closeReason: string | null;
  items: ShoppingItem[];
}

export interface Supermarket {
  id: string;
  code: string;
  name: string;
}

export interface ProductPreference {
  id: string;
  normalizedName: string;
  name: string;
  supermarketId: string | null;
  category: ProductCategory;
  unit: Unit;
  quantity: string;
  useCount: number;
  updatedAt: string;
}

export const OFFER_SUPERMARKET_IDS = ['lidl', 'mercadona', 'carrefour', 'dia'] as const;
export type OfferSupermarketId = (typeof OFFER_SUPERMARKET_IDS)[number];
export type LoyaltyProgramCode = 'LIDL_PLUS' | 'CLUB_DIA' | 'CLUB_CARREFOUR';
export type LoyaltyStatus = 'UNKNOWN' | 'ENABLED' | 'DISABLED';
export type EffectivePriceReason = 'REGULAR' | 'GENERAL_OFFER' | 'LOYALTY' | 'QUANTITY_PROMOTION';

export interface HouseholdLoyaltyProgram {
  program: LoyaltyProgramCode;
  status: LoyaltyStatus;
}

export interface EffectivePriceCalculation {
  effectiveCostCents: number | null;
  effectivePriceReason: EffectivePriceReason | null;
  potentialLoyaltyCostCents: number | null;
  generalSavingCents: number | null;
  additionalLoyaltySavingCents: number | null;
  totalSavingCents: number | null;
}

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
  offerBrowseCategory: OfferBrowseCategory;
  packageLabel: string | null;
  normalPriceCents: number | null;
  offerPriceCents: number;
  unitPriceCents: number | null;
  promotionType: string;
  offerType: OfferType;
  percentage: number | null;
  buyQuantity: number | null;
  payQuantity: number | null;
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
  relatedToList: boolean;
  matchedItemNames: string[];
  pricing: EffectivePriceCalculation;
}

export interface OffersResponse {
  offers: CatalogOffer[];
  partial: boolean;
  mode: 'DEMO' | 'REAL';
  lastUpdatedAt: string | null;
  categories: OfferBrowseCategorySummary[];
}

export interface OfferBrowseCategorySummary {
  code: OfferBrowseCategory;
  label: string;
  emoji: string;
  count: number;
}

export type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type OfferType =
  | 'DIRECT_DISCOUNT'
  | 'PERCENTAGE_DISCOUNT'
  | 'BUY_X_PAY_Y'
  | 'SECOND_UNIT_DISCOUNT'
  | 'CASHBACK'
  | 'LOYALTY_PRICE'
  | 'SPECIAL_PRICE';
export type PackageFit = 'EXACT' | 'GOOD' | 'OVERBUY' | 'UNKNOWN' | 'INCOMPATIBLE';

export interface PackageCalculation {
  descriptor: {
    description: string | null;
    type: 'MEASURED' | 'BULK' | 'UNKNOWN';
    packCount: number | null;
    amountPerPack: number | null;
    unit: 'G' | 'ML' | 'COUNT' | null;
    totalAmount: number | null;
    approximate: boolean;
  };
  fit: PackageFit;
  packsNeeded: number | null;
  requestedAmount: number | null;
  purchasedAmount: number | null;
  excessAmount: number | null;
  unit: 'G' | 'ML' | 'COUNT' | 'PACK' | null;
  approximate: boolean;
  costs: {
    regularCostCents: number | null;
    generalOfferCostCents: number | null;
    lidlPlusCostCents: number | null;
  };
}

export interface ListMatchCandidate {
  externalProductId: string;
  productName: string;
  normalizedProductName: string;
  brand: string | null;
  commercialCategory: string | null;
  visualCategory: ProductCategory;
  packageLabel: string | null;
  package: PackageCalculation;
  pricing: EffectivePriceCalculation;
  currentPriceCents: number | null;
  score: number;
  confidence: Exclude<MatchConfidence, 'LOW'>;
  reasons: string[];
  preferred: boolean;
  activeOffers: CatalogOffer[];
}

export interface ShoppingItemOfferMatch {
  shoppingItemId: string;
  shoppingItemName: string;
  category: ProductCategory;
  quantity: string;
  unit: Unit;
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

export interface ItemInput {
  name: string;
  quantity?: string;
  unit?: Unit;
  supermarketId?: string | null;
  category?: ProductCategory;
}

export interface BootstrapInput {
  accessKey: string;
  householdName?: string;
  deviceName?: string;
}

export interface BootstrapResponse {
  token: string;
  activeCycle: ShoppingCycle;
}

export interface PairingDetails {
  code: string;
  expiresAt: string;
  pairingUrl: string;
}

export interface PairingConsumeInput {
  code: string;
  deviceName?: string;
}

export interface PairingConsumeResponse {
  token: string;
}

export const SYNC_EVENT_TYPES = [
  'ITEM_CREATED',
  'ITEM_UPDATED',
  'ITEM_CHECKED',
  'ITEM_UNCHECKED',
  'ITEM_DELETED',
  'LIST_CLOSED',
  'LIST_REPLACED',
  'SETTINGS_UPDATED',
] as const;

export interface SyncEvent {
  version: 1;
  id: string;
  type: (typeof SYNC_EVENT_TYPES)[number];
  householdId: string;
  revision: number;
  occurredAt: string;
  payload: unknown;
}

export interface ApiErrorBody {
  error?: { code?: string; message?: string };
}
