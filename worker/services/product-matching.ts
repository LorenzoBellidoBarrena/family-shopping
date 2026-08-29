import type { ProductCategory } from '../../src/shared/product-category';
import { classifyNormalizedProductName } from '../../src/shared/product-category';
import { normalizeProductName } from '../../src/shared/product-name';

export type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export const MATCH_STOP_WORDS = new Set([
  'aprox',
  'botella',
  'botellas',
  'de',
  'del',
  'el',
  'formato',
  'g',
  'kg',
  'la',
  'las',
  'litro',
  'litros',
  'los',
  'marca',
  'ml',
  'pack',
  'producto',
  'ud',
  'uds',
  'unidad',
  'unidades',
]);

const tokenAliases: Readonly<Record<string, string>> = {
  bananas: 'platano',
  cebollas: 'cebolla',
  croquetas: 'croqueta',
  huevos: 'huevo',
  papas: 'patata',
  patatas: 'patata',
  platanos: 'platano',
  tomates: 'tomate',
  yogures: 'yogur',
};

const phraseAliases: readonly [RegExp, string][] = [
  [/\bpapel wc\b/gu, 'papel higienico'],
  [/\bcoca cola\b/gu, 'refresco cola'],
];

const contradictoryGroups: readonly (readonly string[])[] = [
  ['entera', 'semidesnatada', 'desnatada'],
  ['normal', 'light'],
  ['natural', 'azucarado'],
];

const derivedProductTerms = new Set(['batido', 'burger', 'croqueta', 'fingers', 'helado', 'salsa']);

export interface MatchIntent {
  normalizedName: string;
  category: ProductCategory;
  supermarketId: string | null;
}

export interface MatchableCatalogProduct {
  externalProductId: string;
  normalizedName: string;
  category: string | null;
  visualCategory: ProductCategory;
}

export interface MatchScore {
  score: number;
  confidence: MatchConfidence;
  reasons: string[];
}

export const normalizeCatalogText = normalizeProductName;

const canonicalMatchingText = (value: string): string => {
  let normalized = normalizeProductName(value);
  for (const [pattern, replacement] of phraseAliases) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
};

export const tokenizeProductName = (value: string): string[] =>
  canonicalMatchingText(value)
    .split(' ')
    .filter(
      (token) =>
        token.length > 1 && !/^\d+(?:[.,]\d+)?$/u.test(token) && !MATCH_STOP_WORDS.has(token),
    )
    .map((token) => tokenAliases[token] ?? token);

const tokenSet = (value: string): Set<string> => new Set(tokenizeProductName(value));

const hasLactoseContradiction = (list: Set<string>, product: Set<string>): boolean => {
  const listHasLactose = list.has('lactosa');
  if (!listHasLactose) return false;
  const listIsWithout = list.has('sin');
  const productHasLactose = product.has('lactosa');
  const productIsWithout = product.has('sin');
  return !productHasLactose || listIsWithout !== productIsWithout;
};

const hasVariantContradiction = (list: Set<string>, product: Set<string>): boolean =>
  contradictoryGroups.some((group) => {
    const requested = group.find((term) => list.has(term));
    return requested !== undefined && group.some((term) => term !== requested && product.has(term));
  }) || hasLactoseContradiction(list, product);

const commercialCategory = (value: string | null): ProductCategory =>
  value ? classifyNormalizedProductName(normalizeProductName(value)) : 'OTHER';

export const scoreProductMatch = (
  intent: MatchIntent,
  product: MatchableCatalogProduct,
  confirmed = false,
): MatchScore => {
  if (confirmed) {
    return { score: 100, confidence: 'HIGH', reasons: ['CONFIRMED_ALIAS'] };
  }

  const listTokens = tokenSet(intent.normalizedName);
  const productTokens = tokenSet(product.normalizedName);
  if (listTokens.size === 0 || productTokens.size === 0) {
    return { score: 0, confidence: 'LOW', reasons: ['NO_INFORMATIVE_TOKENS'] };
  }
  const overlap = [...listTokens].filter((token) => productTokens.has(token));
  if (overlap.length === 0) return { score: 0, confidence: 'LOW', reasons: ['NO_TOKEN_OVERLAP'] };

  const reasons: string[] = ['TOKEN_OVERLAP'];
  let score = Math.round((overlap.length / listTokens.size) * 20);
  const allTokensPresent = overlap.length === listTokens.size;
  if (allTokensPresent) {
    score += 25;
    reasons.push('ALL_TOKENS_PRESENT');
  }
  if (
    canonicalMatchingText(intent.normalizedName) === canonicalMatchingText(product.normalizedName)
  ) {
    score += 40;
    reasons.push('EXACT_NORMALIZED_NAME');
  }
  if (allTokensPresent && listTokens.size >= 2) {
    score += 15;
    reasons.push('SPECIFIC_INTENT');
  }

  const externalCommercialCategory = commercialCategory(product.category);
  if (intent.category !== 'OTHER' && product.visualCategory !== 'OTHER') {
    if (intent.category === product.visualCategory) {
      score += 15;
      reasons.push('SAME_VISUAL_CATEGORY');
    } else {
      score -= 60;
      reasons.push('INCOMPATIBLE_VISUAL_CATEGORY');
    }
  }
  if (intent.category !== 'OTHER' && externalCommercialCategory !== 'OTHER') {
    if (externalCommercialCategory === intent.category) {
      score += 5;
      reasons.push('COMPATIBLE_COMMERCIAL_CATEGORY');
    } else {
      score -= 35;
      reasons.push('INCOMPATIBLE_COMMERCIAL_CATEGORY');
    }
  }
  if (intent.supermarketId === 'lidl') {
    score += 5;
    reasons.push('PREFERRED_SUPERMARKET');
  }
  if (hasVariantContradiction(listTokens, productTokens)) {
    score -= 60;
    reasons.push('CONTRADICTORY_VARIANT');
  }
  if ([...derivedProductTerms].some((term) => productTokens.has(term) && !listTokens.has(term))) {
    score -= 35;
    reasons.push('DERIVED_PRODUCT_NOT_REQUESTED');
  }

  const boundedScore = Math.max(0, Math.min(100, score));
  return {
    score: boundedScore,
    confidence: boundedScore >= 75 ? 'HIGH' : boundedScore >= 45 ? 'MEDIUM' : 'LOW',
    reasons,
  };
};

export const productsMatch = (listName: string, catalogName: string): boolean =>
  scoreProductMatch(
    { normalizedName: normalizeProductName(listName), category: 'OTHER', supermarketId: null },
    {
      externalProductId: 'compatibility-check',
      normalizedName: normalizeProductName(catalogName),
      category: null,
      visualCategory: 'OTHER',
    },
  ).confidence !== 'LOW';
