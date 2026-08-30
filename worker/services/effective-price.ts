import type {
  EffectivePriceCalculation,
  EffectivePriceInput,
  EffectivePriceReason,
} from '../domain/loyalty';

const positiveSaving = (higher: number | null, lower: number | null): number | null =>
  higher !== null && lower !== null && higher > lower ? higher - lower : null;

const quantityPromotion = new Set(['BUY_X_PAY_Y', 'SECOND_UNIT_DISCOUNT']);

export const calculateEffectivePrice = ({
  costs,
  loyaltyStatus,
  generalOfferType,
}: EffectivePriceInput): EffectivePriceCalculation => {
  const regular = costs.regularCostCents;
  const general = costs.generalOfferCostCents;
  const loyalty = costs.lidlPlusCostCents;
  let nonLoyaltyCost = regular;
  let reason: EffectivePriceReason | null = regular === null ? null : 'REGULAR';
  if (general !== null && (nonLoyaltyCost === null || general < nonLoyaltyCost)) {
    nonLoyaltyCost = general;
    reason =
      generalOfferType && quantityPromotion.has(generalOfferType)
        ? 'QUANTITY_PROMOTION'
        : 'GENERAL_OFFER';
  }

  let effectiveCost = nonLoyaltyCost;
  if (
    loyaltyStatus === 'ENABLED' &&
    loyalty !== null &&
    (effectiveCost === null || loyalty < effectiveCost)
  ) {
    effectiveCost = loyalty;
    reason = 'LOYALTY';
  }

  return {
    effectiveCostCents: effectiveCost,
    effectivePriceReason: reason,
    potentialLoyaltyCostCents:
      loyaltyStatus === 'UNKNOWN' &&
      loyalty !== null &&
      (nonLoyaltyCost === null || loyalty < nonLoyaltyCost)
        ? loyalty
        : null,
    generalSavingCents: positiveSaving(regular, nonLoyaltyCost),
    additionalLoyaltySavingCents: positiveSaving(nonLoyaltyCost, loyalty),
    totalSavingCents: positiveSaving(regular, effectiveCost),
  };
};
