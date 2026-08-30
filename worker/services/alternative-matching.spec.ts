import { describe, expect, it } from 'vitest';
import type { ProductCategory } from '../../src/shared/product-category';
import { detectProductConcept, matchProductAlternative } from './alternative-matching';

describe('conservative product alternatives', () => {
  it.each([
    ['Nuggets', 'NUGGETS'],
    ['Fingers de pollo', 'CHICKEN_FINGERS'],
    ['Tiras de pollo empanadas', 'BREADED_CHICKEN_STRIPS'],
    ['Hamburguesas', 'BURGER'],
    ['Burger meat', 'BURGER_MEAT'],
    ['Mini burgers', 'MINI_BURGER'],
    ['Patatas fritas congeladas', 'FROZEN_FRIES'],
    ['Patatas gajo', 'POTATO_WEDGES'],
  ] as const)('detects %s as %s', (name, concept) => {
    expect(detectProductConcept(name)).toBe(concept);
  });

  const review: readonly [string, string, ProductCategory, boolean][] = [
    ['Nuggets', 'Fingers de pollo', 'MEAT', true],
    ['Nuggets', 'Tiras de pollo empanadas', 'MEAT', true],
    ['Fingers de pollo', 'Nuggets de pollo', 'MEAT', true],
    ['Tiras de pollo empanadas', 'Fingers de pollo', 'MEAT', true],
    ['Hamburguesas', 'Burger meat', 'MEAT', true],
    ['Hamburguesas', 'Mini burgers', 'MEAT', true],
    ['Burger meat', 'Hamburguesas de vacuno', 'MEAT', true],
    ['Mini burgers', 'Burger meat', 'MEAT', true],
    ['Patatas fritas congeladas', 'Patatas gajo', 'VEGETABLES', true],
    ['Patatas gajo', 'Patatas fritas congeladas', 'FROZEN', true],
    ['Nuggets', 'Croquetas de pollo', 'MEAT', false],
    ['Nuggets', 'Pechuga de pollo', 'MEAT', false],
    ['Leche', 'Batido de chocolate', 'DAIRY', false],
    ['Tomate', 'Salsa de tomate', 'PANTRY', false],
    ['Pollo', 'Croquetas de pollo', 'MEAT', false],
    ['Atún', 'Burger de atún', 'FISH', false],
    ['Hamburguesa', 'Albóndigas', 'MEAT', false],
    ['Pan', 'Empanada de atún', 'BAKERY', false],
    ['Nuggets', 'Fingers de pescado', 'FISH', false],
    ['Hamburguesas', 'Burger vegetal', 'VEGETABLES', false],
  ];

  it.each(review)('%s → %s is accepted=%s', (shoppingName, candidate, category, accepted) => {
    expect(matchProductAlternative(shoppingName, candidate, category) !== null).toBe(accepted);
  });

  it('explains a household-accepted concept without turning it into a match', () => {
    expect(
      matchProductAlternative('Nuggets', 'Fingers de pollo', 'MEAT', 'CHICKEN_FINGERS'),
    ).toEqual({
      sourceConcept: 'NUGGETS',
      targetConcept: 'CHICKEN_FINGERS',
      strength: 'STRONG_ALTERNATIVE',
      score: 100,
      reasons: ['HOUSEHOLD_ACCEPTED', 'EXPLICIT_RELATION'],
    });
  });
});
