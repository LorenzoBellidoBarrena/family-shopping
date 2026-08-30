import type { OfferType } from './supermarket-import';
import type { PackageCostBreakdown } from './package';

export const LOYALTY_PROGRAM_CODES = ['LIDL_PLUS', 'CLUB_DIA', 'CLUB_CARREFOUR'] as const;
export type LoyaltyProgramCode = (typeof LOYALTY_PROGRAM_CODES)[number];

export const LOYALTY_STATUSES = ['UNKNOWN', 'ENABLED', 'DISABLED'] as const;
export type LoyaltyStatus = (typeof LOYALTY_STATUSES)[number];

export interface HouseholdLoyaltyProgram {
  program: LoyaltyProgramCode;
  status: LoyaltyStatus;
}

export type EffectivePriceReason = 'REGULAR' | 'GENERAL_OFFER' | 'LOYALTY' | 'QUANTITY_PROMOTION';

export interface EffectivePriceCalculation {
  effectiveCostCents: number | null;
  effectivePriceReason: EffectivePriceReason | null;
  potentialLoyaltyCostCents: number | null;
  generalSavingCents: number | null;
  additionalLoyaltySavingCents: number | null;
  totalSavingCents: number | null;
}

export interface EffectivePriceInput {
  costs: PackageCostBreakdown;
  loyaltyStatus: LoyaltyStatus;
  generalOfferType?: OfferType | null;
}
