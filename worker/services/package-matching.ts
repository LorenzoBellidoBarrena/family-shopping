import type {
  PackageCalculation,
  PackageCalculationUnit,
  PackageCostBreakdown,
  PackageDescriptor,
  PackageDescriptorUnit,
  PackageFit,
  PackageMeasureUnit,
  PackagePricing,
  PromotionCostInput,
} from '../domain/package';
import type { Unit } from '../domain/types';

export type {
  PackageCalculation,
  PackageDescriptor,
  PackageFit,
  PackagePricing,
  PromotionCostInput,
} from '../domain/package';

const decimalMilli = (value: string): number | null => {
  const match = /^(\d+)(?:[.,](\d{1,3}))?$/u.exec(value.trim());
  if (!match) return null;
  const milli = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
  return Number.isSafeInteger(milli) && milli > 0 ? milli : null;
};

const convertedBaseAmount = (value: string, unit: string): number | null => {
  const milli = decimalMilli(value);
  if (milli === null) return null;
  const normalized = unit.toLocaleLowerCase('es');
  const milliBase =
    normalized === 'kg' || normalized === 'l'
      ? milli * 1000
      : normalized === 'cl'
        ? milli * 10
        : normalized === 'g' || normalized === 'ml'
          ? milli
          : null;
  if (milliBase === null || milliBase % 1000 !== 0) return null;
  return milliBase / 1000;
};

export const parsePackageDescription = (description: string | null): PackageDescriptor => {
  if (!description?.trim()) {
    return {
      description: description?.trim() || null,
      type: 'UNKNOWN',
      packCount: null,
      amountPerPack: null,
      unit: null,
      totalAmount: null,
      approximate: false,
    };
  }
  const raw = description.trim();
  const normalized = raw.toLocaleLowerCase('es').replace(/\s+/gu, ' ');
  if (/^a granel$/u.test(normalized)) {
    return {
      description: raw,
      type: 'BULK',
      packCount: null,
      amountPerPack: null,
      unit: null,
      totalAmount: null,
      approximate: true,
    };
  }
  const match = /^(aprox\.?\s*)?(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|cl)$/iu.exec(
    normalized,
  );
  const counted = /^(\d+)\s*(?:uds?|unidades?)$/iu.exec(normalized);
  if (counted) {
    const count = Number(counted[1]);
    return {
      description: raw,
      type: 'MEASURED',
      packCount: count,
      amountPerPack: 1,
      unit: 'COUNT',
      totalAmount: count,
      approximate: false,
    };
  }
  if (!match) {
    return {
      description: raw,
      type: 'UNKNOWN',
      packCount: null,
      amountPerPack: null,
      unit: null,
      totalAmount: null,
      approximate: false,
    };
  }
  const packCount = match[2] ? Number(match[2]) : 1;
  const amountPerPack = convertedBaseAmount(match[3], match[4]);
  const unit: PackageDescriptorUnit = /^(?:kg|g)$/u.test(match[4]) ? 'G' : 'ML';
  if (!Number.isSafeInteger(packCount) || packCount < 1 || amountPerPack === null) {
    return {
      description: raw,
      type: 'UNKNOWN',
      packCount: null,
      amountPerPack: null,
      unit: null,
      totalAmount: null,
      approximate: false,
    };
  }
  return {
    description: raw,
    type: 'MEASURED',
    packCount,
    amountPerPack,
    unit,
    totalAmount: packCount * amountPerPack,
    approximate: Boolean(match[1]),
  };
};

const requestedAmount = (
  quantity: string,
  unit: Unit,
): { amount: number; unit: PackageCalculationUnit } | null => {
  const milli = decimalMilli(quantity);
  if (milli === null) return null;
  if (unit === 'kg' || unit === 'litro') return { amount: milli, unit: unit === 'kg' ? 'G' : 'ML' };
  if (unit === 'g' || unit === 'ml') {
    return milli % 1000 === 0 ? { amount: milli / 1000, unit: unit === 'g' ? 'G' : 'ML' } : null;
  }
  if (unit === 'unidad' || unit === 'pack') {
    return milli % 1000 === 0
      ? { amount: milli / 1000, unit: unit === 'unidad' ? 'COUNT' : 'PACK' }
      : null;
  }
  return null;
};

const roundRatio = (numerator: number, denominator: number): number =>
  Math.floor((numerator + Math.floor(denominator / 2)) / denominator);

export const calculatePromotionCost = (input: PromotionCostInput): number | null => {
  const { packsNeeded, regularUnitPriceCents } = input;
  if (
    !Number.isSafeInteger(packsNeeded) ||
    packsNeeded < 1 ||
    !Number.isSafeInteger(regularUnitPriceCents) ||
    regularUnitPriceCents < 0
  ) {
    return null;
  }
  if (input.type === 'BUY_X_PAY_Y') {
    if (!input.buyQuantity || !input.payQuantity || input.payQuantity >= input.buyQuantity)
      return null;
    const fullGroups = Math.floor(packsNeeded / input.buyQuantity);
    const remainder = packsNeeded % input.buyQuantity;
    return (fullGroups * input.payQuantity + remainder) * regularUnitPriceCents;
  }
  if (input.type === 'SECOND_UNIT_DISCOUNT') {
    if (input.percentage === null || input.percentage === undefined) return null;
    const discounted = roundRatio(regularUnitPriceCents * (100 - input.percentage), 100);
    return (
      Math.floor(packsNeeded / 2) * (regularUnitPriceCents + discounted) +
      (packsNeeded % 2) * regularUnitPriceCents
    );
  }
  if (input.type === 'CASHBACK') return null;
  const unitPrice =
    input.publishedOfferPriceCents ??
    (input.type === 'PERCENTAGE_DISCOUNT' && input.percentage
      ? roundRatio(regularUnitPriceCents * (100 - input.percentage), 100)
      : null);
  return unitPrice === null ? null : packsNeeded * unitPrice;
};

const unknownCalculation = (
  descriptor: PackageDescriptor,
  fit: Extract<PackageFit, 'UNKNOWN' | 'INCOMPATIBLE'>,
): PackageCalculation => ({
  descriptor,
  fit,
  packsNeeded: null,
  requestedAmount: null,
  purchasedAmount: null,
  excessAmount: null,
  unit: null,
  approximate: descriptor.approximate,
  costs: { regularCostCents: null, generalOfferCostCents: null, lidlPlusCostCents: null },
});

const packageCosts = (packsNeeded: number, pricing: PackagePricing): PackageCostBreakdown => ({
  regularCostCents:
    pricing.regularUnitPriceCents === null ? null : packsNeeded * pricing.regularUnitPriceCents,
  generalOfferCostCents:
    pricing.generalOffer === null || pricing.regularUnitPriceCents === null
      ? null
      : calculatePromotionCost({
          ...pricing.generalOffer,
          packsNeeded,
          regularUnitPriceCents: pricing.regularUnitPriceCents,
        }),
  lidlPlusCostCents:
    pricing.lidlPlusUnitPriceCents === null ? null : packsNeeded * pricing.lidlPlusUnitPriceCents,
});

const normalizedUnitPrice = (
  cents: number | null,
  unit: string | null,
): { cents: number; amount: number; unit: PackageMeasureUnit } | null => {
  if (cents === null || !Number.isSafeInteger(cents) || cents < 0 || !unit) return null;
  const normalized = unit.toLocaleLowerCase('es').replace(/[€\s/]/gu, '');
  if (normalized === 'kg') return { cents, amount: 1000, unit: 'G' };
  if (normalized === 'g') return { cents, amount: 1, unit: 'G' };
  if (normalized === 'l' || normalized === 'litro') return { cents, amount: 1000, unit: 'ML' };
  if (normalized === 'ml') return { cents, amount: 1, unit: 'ML' };
  return null;
};

export const calculatePackageFit = (
  quantity: string,
  shoppingUnit: Unit,
  descriptor: PackageDescriptor,
  pricing: PackagePricing,
  countableMultipack = false,
): PackageCalculation => {
  const requested = requestedAmount(quantity, shoppingUnit);
  if (!requested || descriptor.type === 'UNKNOWN') return unknownCalculation(descriptor, 'UNKNOWN');
  if (descriptor.type === 'BULK') {
    const unitPrice = normalizedUnitPrice(pricing.unitPriceCents, pricing.unitPriceUnit);
    if (!unitPrice) return unknownCalculation(descriptor, 'UNKNOWN');
    if (requested.unit !== unitPrice.unit) return unknownCalculation(descriptor, 'INCOMPATIBLE');
    const cost = roundRatio(requested.amount * unitPrice.cents, unitPrice.amount);
    return {
      descriptor,
      fit: 'GOOD',
      packsNeeded: null,
      requestedAmount: requested.amount,
      purchasedAmount: requested.amount,
      excessAmount: null,
      unit: requested.unit,
      approximate: true,
      costs: { regularCostCents: cost, generalOfferCostCents: null, lidlPlusCostCents: null },
    };
  }
  if (shoppingUnit === 'pack') {
    const packsNeeded = requested.amount;
    return {
      descriptor,
      fit: 'GOOD',
      packsNeeded,
      requestedAmount: packsNeeded,
      purchasedAmount: packsNeeded,
      excessAmount: null,
      unit: 'PACK',
      approximate: descriptor.approximate,
      costs: packageCosts(packsNeeded, pricing),
    };
  }
  if (shoppingUnit === 'unidad') {
    const canCount = descriptor.packCount === 1 || countableMultipack;
    if (!canCount || descriptor.packCount === null)
      return unknownCalculation(descriptor, 'UNKNOWN');
    const packsNeeded = Math.ceil(requested.amount / descriptor.packCount);
    return {
      descriptor,
      fit: 'GOOD',
      packsNeeded,
      requestedAmount: requested.amount,
      purchasedAmount: packsNeeded * descriptor.packCount,
      excessAmount: packsNeeded * descriptor.packCount - requested.amount,
      unit: 'COUNT',
      approximate: descriptor.approximate,
      costs: packageCosts(packsNeeded, pricing),
    };
  }
  if (requested.unit !== descriptor.unit || descriptor.totalAmount === null) {
    return unknownCalculation(descriptor, 'INCOMPATIBLE');
  }
  const packsNeeded = Math.ceil(requested.amount / descriptor.totalAmount);
  const purchasedAmount = packsNeeded * descriptor.totalAmount;
  const excess = purchasedAmount - requested.amount;
  return {
    descriptor,
    fit: descriptor.approximate ? 'GOOD' : excess === 0 ? 'EXACT' : 'OVERBUY',
    packsNeeded,
    requestedAmount: requested.amount,
    purchasedAmount,
    excessAmount: descriptor.approximate ? null : excess,
    unit: requested.unit,
    approximate: descriptor.approximate,
    costs: packageCosts(packsNeeded, pricing),
  };
};
