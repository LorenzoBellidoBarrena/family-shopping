import { describe, expect, it } from 'vitest';
import type { PackagePricing } from '../domain/package';
import {
  calculatePackageFit,
  calculatePromotionCost,
  parsePackageDescription,
} from './package-matching';

const pricing = (
  regularUnitPriceCents: number | null,
  options: Partial<PackagePricing> = {},
): PackagePricing => ({
  regularUnitPriceCents,
  generalOffer: null,
  lidlPlusUnitPriceCents: null,
  unitPriceCents: null,
  unitPriceUnit: null,
  ...options,
});

describe('Lidl package description parsing', () => {
  it.each([
    ['750 g', 1, 750, 'G', 750],
    ['1 kg', 1, 1000, 'G', 1000],
    ['970 g', 1, 970, 'G', 970],
    ['250 g', 1, 250, 'G', 250],
    ['240 g', 1, 240, 'G', 240],
    ['3x65 g', 3, 65, 'G', 195],
    ['2x200 g', 2, 200, 'G', 400],
    ['12x33 cl', 12, 330, 'ML', 3960],
    ['2 uds', 2, 1, 'COUNT', 2],
  ] as const)('parses %s', (description, packCount, amountPerPack, unit, totalAmount) => {
    expect(parsePackageDescription(description)).toMatchObject({
      type: 'MEASURED',
      packCount,
      amountPerPack,
      unit,
      totalAmount,
      approximate: false,
    });
  });

  it('marks approximate weights without claiming an exact total', () => {
    expect(parsePackageDescription('Aprox. 400 g')).toMatchObject({
      type: 'MEASURED',
      totalAmount: 400,
      unit: 'G',
      approximate: true,
    });
  });

  it('keeps bulk and unstructured packages explicit', () => {
    expect(parsePackageDescription('A granel')).toMatchObject({ type: 'BULK' });
    expect(parsePackageDescription('Paquete')).toMatchObject({
      type: 'UNKNOWN',
      description: 'Paquete',
    });
  });
});

describe('quantity and package fit', () => {
  it.each([
    ['1', 'kg', '500 g', 2, 1000, 0, 'EXACT'],
    ['1', 'kg', '750 g', 2, 1500, 500, 'OVERBUY'],
    ['6', 'litro', '1 l', 6, 6000, 0, 'EXACT'],
    ['6', 'litro', '6x1 l', 1, 6000, 0, 'EXACT'],
    ['1.5', 'kg', '500 g', 3, 1500, 0, 'EXACT'],
    ['1.5', 'litro', '750 ml', 2, 1500, 0, 'EXACT'],
  ] as const)('%s %s with %s', (quantity, unit, description, packs, purchased, excess, fit) => {
    expect(
      calculatePackageFit(quantity, unit, parsePackageDescription(description), pricing(129)),
    ).toMatchObject({ packsNeeded: packs, purchasedAmount: purchased, excessAmount: excess, fit });
  });

  it('treats an individual measured package as one shopping unit', () => {
    expect(
      calculatePackageFit('6', 'unidad', parsePackageDescription('1 l'), pricing(99)),
    ).toMatchObject({ fit: 'GOOD', packsNeeded: 6, purchasedAmount: 6, unit: 'COUNT' });
  });

  it('counts explicit internal units only after a conservative identity decision', () => {
    const descriptor = parsePackageDescription('3x65 g');
    expect(calculatePackageFit('6', 'unidad', descriptor, pricing(259), true)).toMatchObject({
      fit: 'GOOD',
      packsNeeded: 2,
      purchasedAmount: 6,
    });
    expect(calculatePackageFit('6', 'unidad', descriptor, pricing(259), false).fit).toBe('UNKNOWN');
  });

  it('recognizes an explicit package count as unambiguous units', () => {
    expect(
      calculatePackageFit('2', 'unidad', parsePackageDescription('2 uds'), pricing(244), true),
    ).toMatchObject({ fit: 'GOOD', packsNeeded: 1, purchasedAmount: 2, unit: 'COUNT' });
  });

  it('keeps packs distinct from internal product units', () => {
    expect(
      calculatePackageFit('2', 'pack', parsePackageDescription('3x65 g'), pricing(259)),
    ).toMatchObject({ fit: 'GOOD', packsNeeded: 2, unit: 'PACK' });
  });

  it('rejects incompatible physical dimensions and unknown shopping units', () => {
    expect(calculatePackageFit('1', 'kg', parsePackageDescription('1 l'), pricing(99)).fit).toBe(
      'INCOMPATIBLE',
    );
    expect(
      calculatePackageFit('1', 'otro', parsePackageDescription('500 g'), pricing(99)).fit,
    ).toBe('UNKNOWN');
  });

  it('marks approximate packs as GOOD and omits an exact excess', () => {
    expect(
      calculatePackageFit('1', 'kg', parsePackageDescription('Aprox. 400 g'), pricing(282)),
    ).toMatchObject({
      fit: 'GOOD',
      packsNeeded: 3,
      purchasedAmount: 1200,
      excessAmount: null,
      approximate: true,
    });
  });

  it('estimates bulk by unit price with integer half-up rounding', () => {
    expect(
      calculatePackageFit(
        '1.5',
        'kg',
        parsePackageDescription('A granel'),
        pricing(272, { unitPriceCents: 149, unitPriceUnit: '€/kg' }),
      ),
    ).toMatchObject({
      fit: 'GOOD',
      packsNeeded: null,
      requestedAmount: 1500,
      approximate: true,
      costs: { regularCostCents: 224 },
    });
  });

  it('does not invent a bulk estimate without a reliable unit price', () => {
    expect(
      calculatePackageFit('1.5', 'kg', parsePackageDescription('A granel'), pricing(272)).fit,
    ).toBe('UNKNOWN');
  });

  it('calculates regular, general and Lidl Plus scenarios separately', () => {
    const result = calculatePackageFit(
      '1',
      'kg',
      parsePackageDescription('500 g'),
      pricing(299, {
        generalOffer: {
          type: 'DIRECT_DISCOUNT',
          publishedOfferPriceCents: 235,
          percentage: null,
          buyQuantity: null,
          payQuantity: null,
        },
        lidlPlusUnitPriceCents: 189,
      }),
    );
    expect(result.costs).toEqual({
      regularCostCents: 598,
      generalOfferCostCents: 470,
      lidlPlusCostCents: 378,
    });
  });
});

describe('PromotionCalculator', () => {
  it('calculates BUY_X_PAY_Y by complete groups and remaining packs', () => {
    expect(
      calculatePromotionCost({
        type: 'BUY_X_PAY_Y',
        packsNeeded: 6,
        regularUnitPriceCents: 299,
        buyQuantity: 3,
        payQuantity: 2,
      }),
    ).toBe(1196);
  });

  it('discounts only each second unit', () => {
    expect(
      calculatePromotionCost({
        type: 'SECOND_UNIT_DISCOUNT',
        packsNeeded: 3,
        regularUnitPriceCents: 400,
        percentage: 50,
      }),
    ).toBe(1000);
  });

  it('uses a published percentage price and can derive it when absent', () => {
    expect(
      calculatePromotionCost({
        type: 'PERCENTAGE_DISCOUNT',
        packsNeeded: 2,
        regularUnitPriceCents: 250,
        publishedOfferPriceCents: 200,
        percentage: 20,
      }),
    ).toBe(400);
    expect(
      calculatePromotionCost({
        type: 'PERCENTAGE_DISCOUNT',
        packsNeeded: 2,
        regularUnitPriceCents: 250,
        percentage: 20,
      }),
    ).toBe(400);
  });

  it('keeps loyalty prices separate and does not treat cashback as immediate savings', () => {
    expect(
      calculatePromotionCost({
        type: 'LOYALTY_PRICE',
        packsNeeded: 2,
        regularUnitPriceCents: 299,
        publishedOfferPriceCents: 189,
      }),
    ).toBe(378);
    expect(
      calculatePromotionCost({
        type: 'CASHBACK',
        packsNeeded: 2,
        regularUnitPriceCents: 299,
        percentage: 50,
      }),
    ).toBeNull();
  });
});

describe('review with current real Lidl package formats', () => {
  it.each([
    ['1 kg', 'Uva blanca sin semilla', '750 g', 235, 2, 470, 'OVERBUY'],
    ['1 kg', 'CROWNFIELD Copos de avena', '1 kg', 123, 1, 123, 'EXACT'],
    ['2 kg', 'Cebolla 1 kg malla', '1 kg', 159, 2, 318, 'EXACT'],
    ['500 g', 'Higo', '250 g', 239, 2, 478, 'EXACT'],
    ['500 g', 'Burger de atún', '240 g', 295, 3, 885, 'OVERBUY'],
    ['6 unidad', 'NIXE Atún claro', '3x65 g', 259, 2, 518, 'GOOD'],
    ['6 litro', 'Freeway Cola', '18x33 cl', 489, 2, 978, 'OVERBUY'],
    ['1.5 litro', 'CIEN Champú frutal', '1 l', 116, 2, 232, 'OVERBUY'],
    ['6 litro', 'Detergente', '3 l', 305, 2, 610, 'EXACT'],
    ['1 kg', 'Solomillo de pollo', 'Aprox. 400 g', 282, 3, 846, 'GOOD'],
  ] as const)(
    '%s of %s using %s',
    (request, _product, packageDescription, price, packs, cost, fit) => {
      const [quantity, unit] = request.split(' ') as [string, 'kg' | 'g' | 'litro' | 'unidad'];
      const countable = packageDescription === '3x65 g';
      const result = calculatePackageFit(
        quantity,
        unit,
        parsePackageDescription(packageDescription),
        pricing(price),
        countable,
      );
      expect(result).toMatchObject({ fit, packsNeeded: packs });
      expect(result.costs.regularCostCents).toBe(cost);
    },
  );
});
