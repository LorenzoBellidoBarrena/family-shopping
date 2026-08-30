import { describe, expect, it } from 'vitest';
import type { PackageCostBreakdown } from '../domain/package';
import { calculateEffectivePrice } from './effective-price';

const costs = (
  regularCostCents: number | null,
  generalOfferCostCents: number | null,
  lidlPlusCostCents: number | null,
): PackageCostBreakdown => ({ regularCostCents, generalOfferCostCents, lidlPlusCostCents });

describe('EffectivePriceCalculator', () => {
  it('uses the general offer and only exposes Lidl Plus as potential while UNKNOWN', () => {
    expect(
      calculateEffectivePrice({ costs: costs(299, 235, 189), loyaltyStatus: 'UNKNOWN' }),
    ).toEqual({
      effectiveCostCents: 235,
      effectivePriceReason: 'GENERAL_OFFER',
      potentialLoyaltyCostCents: 189,
      generalSavingCents: 64,
      additionalLoyaltySavingCents: 46,
      totalSavingCents: 64,
    });
  });

  it('does not apply Lidl Plus while DISABLED', () => {
    expect(
      calculateEffectivePrice({ costs: costs(299, 235, 189), loyaltyStatus: 'DISABLED' }),
    ).toMatchObject({
      effectiveCostCents: 235,
      effectivePriceReason: 'GENERAL_OFFER',
      potentialLoyaltyCostCents: null,
    });
  });

  it('uses Lidl Plus while ENABLED', () => {
    expect(
      calculateEffectivePrice({ costs: costs(299, 235, 189), loyaltyStatus: 'ENABLED' }),
    ).toEqual({
      effectiveCostCents: 189,
      effectivePriceReason: 'LOYALTY',
      potentialLoyaltyCostCents: null,
      generalSavingCents: 64,
      additionalLoyaltySavingCents: 46,
      totalSavingCents: 110,
    });
  });

  it.each([
    ['UNKNOWN', 259, 179],
    ['DISABLED', 259, null],
    ['ENABLED', 179, null],
  ] as const)(
    'handles a loyalty price without a general offer for %s',
    (status, effective, potential) => {
      expect(
        calculateEffectivePrice({ costs: costs(259, null, 179), loyaltyStatus: status }),
      ).toMatchObject({ effectiveCostCents: effective, potentialLoyaltyCostCents: potential });
    },
  );

  it('calculates an applicable two-pack Lidl Plus total', () => {
    expect(
      calculateEffectivePrice({ costs: costs(598, 470, 378), loyaltyStatus: 'ENABLED' }),
    ).toMatchObject({
      effectiveCostCents: 378,
      effectivePriceReason: 'LOYALTY',
      generalSavingCents: 128,
      additionalLoyaltySavingCents: 92,
      totalSavingCents: 220,
    });
  });

  it('labels 3x2 and second-unit rules as quantity promotions', () => {
    for (const type of ['BUY_X_PAY_Y', 'SECOND_UNIT_DISCOUNT'] as const) {
      expect(
        calculateEffectivePrice({
          costs: costs(1794, 1196, null),
          loyaltyStatus: 'DISABLED',
          generalOfferType: type,
        }).effectivePriceReason,
      ).toBe('QUANTITY_PROMOTION');
    }
  });

  it('never treats an absent cashback cost as an immediate discount', () => {
    expect(
      calculateEffectivePrice({
        costs: costs(1000, null, null),
        loyaltyStatus: 'ENABLED',
        generalOfferType: 'CASHBACK',
      }),
    ).toMatchObject({ effectiveCostCents: 1000, effectivePriceReason: 'REGULAR' });
  });

  it('keeps regular price when an offer is more expensive', () => {
    expect(
      calculateEffectivePrice({ costs: costs(200, 250, 220), loyaltyStatus: 'ENABLED' }),
    ).toMatchObject({ effectiveCostCents: 200, effectivePriceReason: 'REGULAR' });
  });
});
