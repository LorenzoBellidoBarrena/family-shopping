import { describe, expect, it } from 'vitest';
import type { ProductCategory } from '../../src/shared/product-category';
import {
  detectProductConcept,
  matchProductAlternative,
  PRODUCT_ALTERNATIVE_RELATIONS,
  type ProductConcept,
} from './alternative-matching';

describe('conservative product alternatives', () => {
  it('treats plátano and banana as different explicit alternatives', () => {
    expect(matchProductAlternative('Plátano', 'Banana granel', 'FRUIT')).toMatchObject({
      sourceConcept: 'PLATANO',
      targetConcept: 'BANANA',
      strength: 'STRONG_ALTERNATIVE',
      reasons: ['EXPLICIT_RELATION'],
    });
  });

  it.each([
    ['Plátano', 'PLATANO'],
    ['platano', 'PLATANO'],
    ['PLÁTANO', 'PLATANO'],
    ['plátanos', 'PLATANO'],
    ['Platanos de Canarias', 'PLATANO'],
    ['Plátano ecológico aprox. 1 kg', 'PLATANO'],
    ['Banana granel', 'BANANA'],
    ['bananas bio', 'BANANA'],
    ['Mandarinas', 'MANDARINA'],
    ['Clementina malla', 'CLEMENTINA'],
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

  it.each([
    'Batido de plátano',
    'Yogur de plátano',
    'Smoothie de banana',
    'Zumo de mandarina',
    'Helado de banana',
    'Salsa de banana',
    'Tarta de clementina',
  ])('does not classify the derived product %s as raw fruit', (name) => {
    expect(detectProductConcept(name)).toBeNull();
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
    ['Plátano', 'Banana', 'FRUIT', true],
    ['Plátanos', 'Banana granel', 'FRUIT', true],
    ['Platano', 'Bananas bio', 'FRUIT', true],
    ['Banana', 'Plátano de Canarias', 'FRUIT', true],
    ['Mandarina', 'Clementina malla', 'FRUIT', true],
    ['Clementinas', 'Mandarina granel', 'FRUIT', true],
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
    ['Plátano', 'Manzana', 'FRUIT', false],
    ['Plátano', 'Pera', 'FRUIT', false],
    ['Plátano', 'Mango', 'FRUIT', false],
    ['Banana', 'Piña', 'FRUIT', false],
    ['Plátano', 'Smoothie de banana', 'DRINKS', false],
    ['Mandarina', 'Naranja', 'FRUIT', false],
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

  it('keeps every global relation directional, unique, typed, and executable', () => {
    const names: Readonly<Record<ProductConcept, string>> = {
      PLATANO: 'Plátano de Canarias',
      BANANA: 'Banana granel',
      MANDARINA: 'Mandarina malla',
      CLEMENTINA: 'Clementina granel',
      NUGGETS: 'Nuggets de pollo',
      CHICKEN_FINGERS: 'Fingers de pollo',
      BREADED_CHICKEN_STRIPS: 'Tiras de pollo empanadas',
      BURGER: 'Hamburguesa de vacuno',
      BURGER_MEAT: 'Burger meat',
      MINI_BURGER: 'Mini burgers',
      FROZEN_FRIES: 'Patatas fritas congeladas',
      POTATO_WEDGES: 'Patatas gajo',
    };
    const keys = PRODUCT_ALTERNATIVE_RELATIONS.map(
      (relation) => `${relation.sourceConcept}:${relation.targetConcept}`,
    );

    expect(new Set(keys).size).toBe(keys.length);
    for (const relation of PRODUCT_ALTERNATIVE_RELATIONS) {
      expect(relation.sourceConcept).not.toBe(relation.targetConcept);
      expect(relation.reason.length).toBeGreaterThan(10);
      expect(
        matchProductAlternative(
          names[relation.sourceConcept],
          names[relation.targetConcept],
          relation.allowedTargetCategories[0],
        ),
      ).toMatchObject({
        sourceConcept: relation.sourceConcept,
        targetConcept: relation.targetConcept,
      });
    }
  });
});
