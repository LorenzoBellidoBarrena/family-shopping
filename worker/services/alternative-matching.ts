import type { ProductCategory } from '../../src/shared/product-category';
import { normalizeProductName } from '../../src/shared/product-name';

export const PRODUCT_CONCEPTS = [
  'NUGGETS',
  'CHICKEN_FINGERS',
  'BREADED_CHICKEN_STRIPS',
  'BURGER',
  'BURGER_MEAT',
  'MINI_BURGER',
  'FROZEN_FRIES',
  'POTATO_WEDGES',
] as const;

export type ProductConcept = (typeof PRODUCT_CONCEPTS)[number];
export type AlternativeReason = 'HOUSEHOLD_ACCEPTED' | 'EXPLICIT_RELATION';

export interface AlternativeMatchResult {
  sourceConcept: ProductConcept;
  targetConcept: ProductConcept;
  strength: 'STRONG_ALTERNATIVE';
  score: number;
  reasons: AlternativeReason[];
}

const tokensOf = (value: string): Set<string> =>
  new Set(normalizeProductName(value).split(' ').filter(Boolean));

const hasOne = (tokens: Set<string>, values: readonly string[]): boolean =>
  values.some((value) => tokens.has(value));

export const detectProductConcept = (normalizedName: string): ProductConcept | null => {
  const tokens = tokensOf(normalizedName);
  if (hasOne(tokens, ['nugget', 'nuggets'])) return 'NUGGETS';
  if (hasOne(tokens, ['finger', 'fingers']) && hasOne(tokens, ['pollo', 'chicken'])) {
    return 'CHICKEN_FINGERS';
  }
  if (
    hasOne(tokens, ['tira', 'tiras']) &&
    tokens.has('pollo') &&
    hasOne(tokens, ['empanada', 'empanadas', 'empanado', 'empanados'])
  ) {
    return 'BREADED_CHICKEN_STRIPS';
  }
  if (tokens.has('burger') && tokens.has('meat')) return 'BURGER_MEAT';
  if (
    hasOne(tokens, ['mini', 'minis']) &&
    hasOne(tokens, ['burger', 'burgers', 'hamburguesa', 'hamburguesas'])
  ) {
    return 'MINI_BURGER';
  }
  if (
    hasOne(tokens, ['patata', 'patatas']) &&
    hasOne(tokens, ['gajo', 'gajos', 'rustica', 'rusticas'])
  ) {
    return 'POTATO_WEDGES';
  }
  if (
    hasOne(tokens, ['patata', 'patatas']) &&
    hasOne(tokens, ['frita', 'fritas']) &&
    hasOne(tokens, ['congelada', 'congeladas', 'congelado', 'congelados'])
  ) {
    return 'FROZEN_FRIES';
  }
  if (
    hasOne(tokens, ['hamburguesa', 'hamburguesas', 'burger', 'burgers']) &&
    !hasOne(tokens, ['atun', 'pescado', 'vegetal', 'vegana', 'vegano'])
  ) {
    return 'BURGER';
  }
  return null;
};

const ALTERNATIVE_RELATIONS: Readonly<Partial<Record<ProductConcept, readonly ProductConcept[]>>> =
  {
    NUGGETS: ['CHICKEN_FINGERS', 'BREADED_CHICKEN_STRIPS'],
    CHICKEN_FINGERS: ['NUGGETS', 'BREADED_CHICKEN_STRIPS'],
    BREADED_CHICKEN_STRIPS: ['NUGGETS', 'CHICKEN_FINGERS'],
    BURGER: ['BURGER_MEAT', 'MINI_BURGER'],
    BURGER_MEAT: ['BURGER', 'MINI_BURGER'],
    MINI_BURGER: ['BURGER', 'BURGER_MEAT'],
    FROZEN_FRIES: ['POTATO_WEDGES'],
    POTATO_WEDGES: ['FROZEN_FRIES'],
  };

const incompatibleVisualCategories = new Set<ProductCategory>([
  'DAIRY',
  'FISH',
  'DRINKS',
  'WATER',
  'COFFEE_TEA',
  'SWEETS',
  'CLEANING',
  'HYGIENE',
  'PAPER',
  'PETS',
]);

export const matchProductAlternative = (
  shoppingName: string,
  candidateName: string,
  candidateCategory: ProductCategory,
  acceptedTargetConcept?: ProductConcept,
): AlternativeMatchResult | null => {
  const sourceConcept = detectProductConcept(shoppingName);
  const targetConcept = detectProductConcept(candidateName);
  if (!sourceConcept || !targetConcept || sourceConcept === targetConcept) return null;
  if (!(ALTERNATIVE_RELATIONS[sourceConcept] ?? []).includes(targetConcept)) return null;
  if (incompatibleVisualCategories.has(candidateCategory)) return null;

  const accepted = acceptedTargetConcept === targetConcept;
  return {
    sourceConcept,
    targetConcept,
    strength: 'STRONG_ALTERNATIVE',
    score: accepted ? 100 : 80,
    reasons: accepted ? ['HOUSEHOLD_ACCEPTED', 'EXPLICIT_RELATION'] : ['EXPLICIT_RELATION'],
  };
};

export const isProductConcept = (value: unknown): value is ProductConcept =>
  typeof value === 'string' && (PRODUCT_CONCEPTS as readonly string[]).includes(value);
