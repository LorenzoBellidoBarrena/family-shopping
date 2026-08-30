import type { OfferType } from './supermarket-import';

export type PackageMeasureUnit = 'G' | 'ML';
export type PackageDescriptorUnit = PackageMeasureUnit | 'COUNT';
export type PackageCalculationUnit = PackageMeasureUnit | 'COUNT' | 'PACK';
export type PackageType = 'MEASURED' | 'BULK' | 'UNKNOWN';
export type PackageFit = 'EXACT' | 'GOOD' | 'OVERBUY' | 'UNKNOWN' | 'INCOMPATIBLE';

export interface PackageDescriptor {
  description: string | null;
  type: PackageType;
  packCount: number | null;
  amountPerPack: number | null;
  unit: PackageDescriptorUnit | null;
  totalAmount: number | null;
  approximate: boolean;
}

export interface PromotionCostInput {
  type: OfferType;
  packsNeeded: number;
  regularUnitPriceCents: number;
  publishedOfferPriceCents?: number | null;
  percentage?: number | null;
  buyQuantity?: number | null;
  payQuantity?: number | null;
}

export interface PackageCostBreakdown {
  regularCostCents: number | null;
  generalOfferCostCents: number | null;
  lidlPlusCostCents: number | null;
}

export interface PackageCalculation {
  descriptor: PackageDescriptor;
  fit: PackageFit;
  packsNeeded: number | null;
  requestedAmount: number | null;
  purchasedAmount: number | null;
  excessAmount: number | null;
  unit: PackageCalculationUnit | null;
  approximate: boolean;
  costs: PackageCostBreakdown;
}

export interface PackagePricing {
  regularUnitPriceCents: number | null;
  generalOffer: Omit<PromotionCostInput, 'packsNeeded' | 'regularUnitPriceCents'> | null;
  lidlPlusUnitPriceCents: number | null;
  unitPriceCents: number | null;
  unitPriceUnit: string | null;
}
