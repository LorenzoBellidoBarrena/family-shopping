import type { ProductCategory } from '../../src/shared/product-category';
import { normalizeProductName } from '../../src/shared/product-name';

export const PRODUCT_CONCEPTS = [
  'PLATANO',
  'BANANA',
  'MANDARINA',
  'CLEMENTINA',
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
export type AlternativeRelationType =
  'CLOSE_SUBSTITUTE' | 'PREPARATION_SUBSTITUTE' | 'VARIANT_SUBSTITUTE';

export interface ProductAlternativeRelation {
  sourceConcept: ProductConcept;
  targetConcept: ProductConcept;
  type: AlternativeRelationType;
  reason: string;
  allowedTargetCategories: readonly ProductCategory[];
}

export interface AlternativeMatchResult {
  sourceConcept: ProductConcept;
  targetConcept: ProductConcept;
  strength: 'STRONG_ALTERNATIVE';
  score: number;
  reasons: AlternativeReason[];
}

const conceptTokenAliases: Readonly<Record<string, string>> = {
  bananas: 'banana',
  burgers: 'burger',
  clementinas: 'clementina',
  empanadas: 'empanada',
  empanados: 'empanado',
  fingers: 'finger',
  hamburguesas: 'hamburguesa',
  mandarinas: 'mandarina',
  minis: 'mini',
  nuggets: 'nugget',
  patatas: 'patata',
  platanos: 'platano',
  rusticas: 'rustica',
  tiras: 'tira',
};

const tokensOf = (value: string): Set<string> =>
  new Set(
    normalizeProductName(value)
      .split(' ')
      .filter(Boolean)
      .map((token) => conceptTokenAliases[token] ?? token),
  );

const hasOne = (tokens: Set<string>, values: readonly string[]): boolean =>
  values.some((value) => tokens.has(value));

const derivedFruitTerms = [
  'batido',
  'helado',
  'salsa',
  'smoothie',
  'tarta',
  'yogur',
  'zumo',
] as const;

const rawFruitConcept = (tokens: Set<string>): ProductConcept | null => {
  if (hasOne(tokens, derivedFruitTerms)) return null;
  if (tokens.has('platano')) return 'PLATANO';
  if (tokens.has('banana')) return 'BANANA';
  if (tokens.has('mandarina')) return 'MANDARINA';
  if (tokens.has('clementina')) return 'CLEMENTINA';
  return null;
};

export const detectProductConcept = (normalizedName: string): ProductConcept | null => {
  const tokens = tokensOf(normalizedName);
  const fruit = rawFruitConcept(tokens);
  if (fruit) return fruit;
  if (tokens.has('nugget')) return 'NUGGETS';
  if (tokens.has('finger') && hasOne(tokens, ['pollo', 'chicken'])) {
    return 'CHICKEN_FINGERS';
  }
  if (tokens.has('tira') && tokens.has('pollo') && hasOne(tokens, ['empanada', 'empanado'])) {
    return 'BREADED_CHICKEN_STRIPS';
  }
  if (tokens.has('burger') && tokens.has('meat')) return 'BURGER_MEAT';
  if (tokens.has('mini') && hasOne(tokens, ['burger', 'hamburguesa'])) {
    return 'MINI_BURGER';
  }
  if (tokens.has('patata') && hasOne(tokens, ['gajo', 'gajos', 'rustica'])) {
    return 'POTATO_WEDGES';
  }
  if (
    tokens.has('patata') &&
    hasOne(tokens, ['frita', 'fritas']) &&
    hasOne(tokens, ['congelada', 'congeladas', 'congelado', 'congelados'])
  ) {
    return 'FROZEN_FRIES';
  }
  if (
    hasOne(tokens, ['hamburguesa', 'burger']) &&
    !hasOne(tokens, ['atun', 'pescado', 'vegetal', 'vegana', 'vegano'])
  ) {
    return 'BURGER';
  }
  return null;
};

const relation = (
  sourceConcept: ProductConcept,
  targetConcept: ProductConcept,
  type: AlternativeRelationType,
  reason: string,
  allowedTargetCategories: readonly ProductCategory[],
): ProductAlternativeRelation => ({
  sourceConcept,
  targetConcept,
  type,
  reason,
  allowedTargetCategories,
});

const directions = (
  left: ProductConcept,
  right: ProductConcept,
  type: AlternativeRelationType,
  reason: string,
  allowedTargetCategories: readonly ProductCategory[],
): ProductAlternativeRelation[] => [
  relation(left, right, type, reason, allowedTargetCategories),
  relation(right, left, type, reason, allowedTargetCategories),
];

const preparedMeatCategories = ['MEAT', 'FROZEN', 'OTHER'] as const;
const preparedPotatoCategories = ['VEGETABLES', 'FROZEN', 'OTHER'] as const;
const fruitCategories = ['FRUIT'] as const;

export const PRODUCT_ALTERNATIVE_RELATIONS: readonly ProductAlternativeRelation[] = [
  ...directions(
    'PLATANO',
    'BANANA',
    'CLOSE_SUBSTITUTE',
    'Frutas frescas próximas, deliberadamente no idénticas.',
    fruitCategories,
  ),
  ...directions(
    'MANDARINA',
    'CLEMENTINA',
    'CLOSE_SUBSTITUTE',
    'Cítricos frescos cotidianos próximos, deliberadamente no idénticos.',
    fruitCategories,
  ),
  ...directions(
    'NUGGETS',
    'CHICKEN_FINGERS',
    'PREPARATION_SUBSTITUTE',
    'Preparados empanados de pollo de uso equivalente.',
    preparedMeatCategories,
  ),
  ...directions(
    'NUGGETS',
    'BREADED_CHICKEN_STRIPS',
    'PREPARATION_SUBSTITUTE',
    'Preparados empanados de pollo de uso equivalente.',
    preparedMeatCategories,
  ),
  ...directions(
    'CHICKEN_FINGERS',
    'BREADED_CHICKEN_STRIPS',
    'PREPARATION_SUBSTITUTE',
    'Preparados empanados de pollo de uso equivalente.',
    preparedMeatCategories,
  ),
  ...directions(
    'BURGER',
    'BURGER_MEAT',
    'VARIANT_SUBSTITUTE',
    'Formatos próximos de carne para hamburguesa.',
    preparedMeatCategories,
  ),
  ...directions(
    'BURGER',
    'MINI_BURGER',
    'VARIANT_SUBSTITUTE',
    'Formatos próximos de hamburguesa.',
    preparedMeatCategories,
  ),
  ...directions(
    'BURGER_MEAT',
    'MINI_BURGER',
    'VARIANT_SUBSTITUTE',
    'Formatos próximos de carne para hamburguesa.',
    preparedMeatCategories,
  ),
  ...directions(
    'FROZEN_FRIES',
    'POTATO_WEDGES',
    'VARIANT_SUBSTITUTE',
    'Guarniciones congeladas de patata de formato próximo.',
    preparedPotatoCategories,
  ),
];

export const matchProductAlternative = (
  shoppingName: string,
  candidateName: string,
  candidateCategory: ProductCategory,
  acceptedTargetConcept?: ProductConcept,
): AlternativeMatchResult | null => {
  const sourceConcept = detectProductConcept(shoppingName);
  const targetConcept = detectProductConcept(candidateName);
  if (!sourceConcept || !targetConcept || sourceConcept === targetConcept) return null;
  const configuredRelation = PRODUCT_ALTERNATIVE_RELATIONS.find(
    (candidate) =>
      candidate.sourceConcept === sourceConcept && candidate.targetConcept === targetConcept,
  );
  if (!configuredRelation) return null;
  if (!configuredRelation.allowedTargetCategories.includes(candidateCategory)) return null;

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
