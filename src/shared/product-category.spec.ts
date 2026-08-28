import { describe, expect, it } from 'vitest';
import { classifyNormalizedProductName, productCategoryDefinition } from './product-category';

describe('product category configuration and classifier', () => {
  it.each([
    ['leche', 'DAIRY'],
    ['yogures', 'DAIRY'],
    ['pan', 'BAKERY'],
    ['tomates', 'VEGETABLES'],
    ['huevos', 'EGGS'],
    ['cafe', 'COFFEE_TEA'],
    ['papel higienico', 'PAPER'],
    ['champu', 'HYGIENE'],
    ['producto desconocido', 'OTHER'],
  ] as const)('classifies %s as %s', (name, category) => {
    expect(classifyNormalizedProductName(name)).toBe(category);
  });

  it('matches complete words instead of fragments', () => {
    expect(classifyNormalizedProductName('panela')).toBe('OTHER');
  });

  it('resolves visual metadata from the central configuration', () => {
    expect(productCategoryDefinition('DAIRY')).toMatchObject({
      label: 'Lácteos',
      emoji: '🥛',
    });
  });
});
