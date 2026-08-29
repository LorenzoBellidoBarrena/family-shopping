import { describe, expect, it } from 'vitest';
import type { ProductCategory } from '../../src/shared/product-category';
import {
  productsMatch,
  scoreProductMatch,
  tokenizeProductName,
  type MatchableCatalogProduct,
} from './product-matching';

const product = (
  normalizedName: string,
  visualCategory: ProductCategory = 'OTHER',
  category: string | null = null,
): MatchableCatalogProduct => ({
  externalProductId: normalizedName,
  normalizedName,
  category,
  visualCategory,
});

const score = (
  listName: string,
  candidate: MatchableCatalogProduct,
  category: ProductCategory = 'OTHER',
  confirmed = false,
) =>
  scoreProductMatch(
    { normalizedName: listName, category, supermarketId: null },
    candidate,
    confirmed,
  );

describe('explainable product matching', () => {
  it('reuses normalized full tokens and ignores commercial format tokens', () => {
    expect(tokenizeProductName(' LÉCHE semidesnatada Milbona 1 L ')).toEqual([
      'leche',
      'semidesnatada',
      'milbona',
    ]);
  });

  it('treats a generic milk intent as an ambiguous medium suggestion', () => {
    expect(score('leche', product('leche semidesnatada milbona', 'DAIRY'), 'DAIRY')).toMatchObject({
      confidence: 'MEDIUM',
      reasons: expect.arrayContaining(['ALL_TOKENS_PRESENT', 'SAME_VISUAL_CATEGORY']),
    });
  });

  it('ranks the requested milk variant above a contradictory one', () => {
    const skimmed = score('leche desnatada', product('leche desnatada milbona', 'DAIRY'), 'DAIRY');
    const whole = score('leche desnatada', product('leche entera milbona', 'DAIRY'), 'DAIRY');

    expect(skimmed.confidence).toBe('HIGH');
    expect(whole).toMatchObject({
      confidence: 'LOW',
      reasons: expect.arrayContaining(['CONTRADICTORY_VARIANT']),
    });
  });

  it('handles small singular and plural aliases deterministically', () => {
    expect(score('yogures', product('yogur natural', 'DAIRY'), 'DAIRY').confidence).toBe('MEDIUM');
    expect(score('huevos', product('huevo fresco', 'EGGS'), 'EGGS').confidence).toBe('MEDIUM');
    expect(score('tomates', product('tomate pera', 'VEGETABLES'), 'VEGETABLES').confidence).toBe(
      'MEDIUM',
    );
  });

  it('supports the explicit papel wc and cola phrase aliases', () => {
    expect(score('papel wc', product('papel higienico', 'PAPER'), 'PAPER').confidence).toBe('HIGH');
    expect(score('coca cola', product('refresco cola', 'DRINKS'), 'DRINKS').confidence).toBe(
      'HIGH',
    );
  });

  it('rejects visual categories that contradict the family intent', () => {
    expect(score('leche', product('leche limpiador', 'CLEANING'), 'DAIRY').confidence).toBe('LOW');
    expect(score('leche', product('queso tierno', 'DAIRY'), 'DAIRY').confidence).toBe('LOW');
  });

  it('uses complete tokens instead of accidental substrings', () => {
    expect(productsMatch('Pan', 'Pantene champú')).toBe(false);
    expect(productsMatch('Pan', 'Pan bocadillo')).toBe(true);
  });

  it('does not promote a derived product when the family asked for the raw ingredient', () => {
    expect(
      score('tomate', product('salsa de tomate con cebolla', 'VEGETABLES'), 'VEGETABLES'),
    ).toMatchObject({
      confidence: 'LOW',
      reasons: expect.arrayContaining(['DERIVED_PRODUCT_NOT_REQUESTED']),
    });
  });

  it('treats exact normalized names as high confidence', () => {
    expect(score('detergente', product('detergente', 'CLEANING'), 'CLEANING')).toMatchObject({
      confidence: 'HIGH',
      reasons: expect.arrayContaining(['EXACT_NORMALIZED_NAME']),
    });
  });

  it('gives a current confirmed alias maximum explainable priority', () => {
    expect(score('leche', product('milbona semidesnatada', 'DAIRY'), 'DAIRY', true)).toEqual({
      score: 100,
      confidence: 'HIGH',
      reasons: ['CONFIRMED_ALIAS'],
    });
  });
});

describe('false-positive review against current Lidl product names', () => {
  const review: readonly {
    list: string;
    category: ProductCategory;
    candidate: MatchableCatalogProduct;
    expected: 'HIGH' | 'MEDIUM' | 'LOW';
  }[] = [
    {
      list: 'Leche',
      category: 'DAIRY',
      candidate: product('milbona batido de chocolate', 'DAIRY'),
      expected: 'LOW',
    },
    {
      list: 'Leche',
      category: 'DAIRY',
      candidate: product('roncero queso tierno pieza de vaca', 'DAIRY'),
      expected: 'LOW',
    },
    {
      list: 'Pan',
      category: 'BAKERY',
      candidate: product('pan bocadillo', 'BAKERY'),
      expected: 'MEDIUM',
    },
    {
      list: 'Pan',
      category: 'BAKERY',
      candidate: product('sol mar es palmeritas'),
      expected: 'LOW',
    },
    {
      list: 'Tomate',
      category: 'VEGETABLES',
      candidate: product('sol mar salsa de tomate con cebolla', 'VEGETABLES'),
      expected: 'LOW',
    },
    {
      list: 'Pollo',
      category: 'MEAT',
      candidate: product('monissa croquetas de pollo', 'MEAT'),
      expected: 'LOW',
    },
    {
      list: 'Pollo',
      category: 'MEAT',
      candidate: product('realvalle solomillo de pollo', 'MEAT'),
      expected: 'MEDIUM',
    },
    {
      list: 'Atún',
      category: 'FISH',
      candidate: product('burger de atun', 'FISH'),
      expected: 'LOW',
    },
    {
      list: 'Atún',
      category: 'FISH',
      candidate: product('nixe atun claro en aceite de oliva', 'FISH'),
      expected: 'MEDIUM',
    },
    {
      list: 'Detergente',
      category: 'CLEANING',
      candidate: product('detergente', 'CLEANING'),
      expected: 'HIGH',
    },
    {
      list: 'Champú',
      category: 'HYGIENE',
      candidate: product('cien champu frutal proteccion y brillo', 'HYGIENE'),
      expected: 'MEDIUM',
    },
    {
      list: 'Mantequilla light',
      category: 'DAIRY',
      candidate: product('milbona mantequilla light', 'DAIRY'),
      expected: 'HIGH',
    },
    {
      list: 'Papel higiénico',
      category: 'PAPER',
      candidate: product('cien panuelos de papel aloe vera', 'PAPER'),
      expected: 'LOW',
    },
    {
      list: 'Cebolla',
      category: 'VEGETABLES',
      candidate: product('cebolla 1 kg malla', 'VEGETABLES'),
      expected: 'MEDIUM',
    },
    {
      list: 'Uva',
      category: 'FRUIT',
      candidate: product('uva blanca sin semilla', 'FRUIT'),
      expected: 'MEDIUM',
    },
    {
      list: 'Queso',
      category: 'DAIRY',
      candidate: product('roncero queso tierno pieza de vaca', 'DAIRY'),
      expected: 'MEDIUM',
    },
    {
      list: 'Queso',
      category: 'DAIRY',
      candidate: product('milbona lonchas gouda tierno'),
      expected: 'LOW',
    },
    {
      list: 'Limón',
      category: 'FRUIT',
      candidate: product('mejillon cocido al limon', 'FRUIT', 'Pescado y marisco'),
      expected: 'LOW',
    },
    {
      list: 'Agua',
      category: 'WATER',
      candidate: product('chef select croquetas de jamon', 'MEAT', 'Bebidas/Agua'),
      expected: 'LOW',
    },
    {
      list: 'Papel',
      category: 'PAPER',
      candidate: product('cien panuelos de papel aloe vera', 'PAPER'),
      expected: 'MEDIUM',
    },
  ];

  it.each(review)(
    '$list vs $candidate.normalizedName -> $expected',
    ({ list, category, candidate, expected }) => {
      expect(score(list, candidate, category).confidence).toBe(expected);
    },
  );
});
