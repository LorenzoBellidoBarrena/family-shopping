import type { ProductCategory } from './product-category';
import { normalizeProductName } from './product-name';

export const OFFER_BROWSE_CATEGORIES = [
  { code: 'FOOD', label: 'Comida', emoji: '🍎', order: 10 },
  { code: 'DRINKS', label: 'Bebidas', emoji: '🥤', order: 20 },
  { code: 'FRESH', label: 'Frescos', emoji: '🥬', order: 30 },
  { code: 'CLEANING', label: 'Limpieza', emoji: '🧹', order: 40 },
  { code: 'PERSONAL_CARE', label: 'Higiene', emoji: '🧴', order: 50 },
  { code: 'HOME', label: 'Hogar', emoji: '🏠', order: 60 },
  { code: 'GARDEN', label: 'Jardín', emoji: '🌱', order: 70 },
  { code: 'DIY', label: 'Bricolaje', emoji: '🔧', order: 80 },
  { code: 'CLOTHING', label: 'Ropa', emoji: '👕', order: 90 },
  { code: 'BABY', label: 'Bebé', emoji: '👶', order: 100 },
  { code: 'PETS', label: 'Mascotas', emoji: '🐾', order: 110 },
  { code: 'ELECTRONICS', label: 'Electrónica', emoji: '🔌', order: 120 },
  { code: 'OTHER', label: 'Otros', emoji: '🛒', order: 130 },
] as const;

export type OfferBrowseCategory = (typeof OFFER_BROWSE_CATEGORIES)[number]['code'];

const CATEGORY_CODES = new Set<string>(
  OFFER_BROWSE_CATEGORIES.map((definition) => definition.code),
);

export const isOfferBrowseCategory = (value: unknown): value is OfferBrowseCategory =>
  typeof value === 'string' && CATEGORY_CODES.has(value);

export const offerBrowseCategoryDefinition = (code: OfferBrowseCategory) =>
  OFFER_BROWSE_CATEGORIES.find((definition) => definition.code === code) ??
  OFFER_BROWSE_CATEGORIES.at(-1)!;

const PRODUCT_CATEGORY_MAPPING: Record<ProductCategory, OfferBrowseCategory> = {
  DAIRY: 'FOOD',
  BAKERY: 'FOOD',
  FRUIT: 'FRESH',
  VEGETABLES: 'FRESH',
  MEAT: 'FRESH',
  FISH: 'FRESH',
  EGGS: 'FOOD',
  DRINKS: 'DRINKS',
  WATER: 'DRINKS',
  COFFEE_TEA: 'DRINKS',
  PASTA_RICE: 'FOOD',
  PANTRY: 'FOOD',
  CANNED: 'FOOD',
  FROZEN: 'FOOD',
  SWEETS: 'FOOD',
  CLEANING: 'CLEANING',
  HYGIENE: 'PERSONAL_CARE',
  PAPER: 'CLEANING',
  PETS: 'PETS',
  OTHER: 'OTHER',
};

const CATEGORY_RULES: readonly [OfferBrowseCategory, readonly string[]][] = [
  ['GARDEN', ['jardin', 'jardineria', 'plantas', 'poda', 'riego', 'terraza']],
  ['DIY', ['bricolaje', 'herramientas', 'ferreteria', 'parkside', 'taladro']],
  [
    'CLEANING',
    [
      'limpieza',
      'detergente',
      'detergentes',
      'lavanderia',
      'cuidado de la ropa',
      'papel higienico',
      'productos de limpieza',
    ],
  ],
  ['PERSONAL_CARE', ['higiene', 'autocuidado', 'cuidado personal', 'belleza', 'cosmetica']],
  ['PETS', ['mascotas', 'perro', 'gato', 'animal']],
  ['BABY', ['bebe', 'infantil', 'puericultura']],
  ['CLOTHING', ['ropa', 'moda', 'calzado', 'textil']],
  ['ELECTRONICS', ['electronica', 'tecnologia', 'multimedia', 'informatica']],
  ['FOOD', ['food', 'platos precocinados', 'pasta fresca y masas']],
  ['HOME', ['hogar', 'cocina', 'bano', 'mueble', 'decoracion', 'iluminacion']],
  ['DRINKS', ['bebidas', 'refrescos', 'cerveza', 'vinos']],
  ['FRESH', ['frescos', 'fruta', 'verdura', 'carne', 'pescado']],
];

const includesPhrase = (evidence: string, phrase: string): boolean =>
  ` ${evidence} `.includes(` ${normalizeProductName(phrase)} `);

export interface OfferBrowseClassificationInput {
  officialCategory?: string | null;
  campaign?: string | null;
  visualCategory: ProductCategory;
  normalizedName?: string | null;
}

export const classifyOfferBrowseCategory = ({
  officialCategory,
  campaign,
  visualCategory,
  normalizedName,
}: OfferBrowseClassificationInput): OfferBrowseCategory => {
  const officialEvidence = normalizeProductName(`${officialCategory ?? ''} ${campaign ?? ''}`);
  for (const [category, keywords] of CATEGORY_RULES) {
    if (keywords.some((keyword) => includesPhrase(officialEvidence, keyword))) return category;
  }

  const mapped = PRODUCT_CATEGORY_MAPPING[visualCategory];
  if (mapped !== 'OTHER') return mapped;

  const nameEvidence = normalizeProductName(normalizedName ?? '');
  for (const [category, keywords] of CATEGORY_RULES) {
    if (keywords.some((keyword) => includesPhrase(nameEvidence, keyword))) return category;
  }
  if (officialEvidence.includes('alimentacion') || officialEvidence.includes('comida')) {
    return 'FOOD';
  }
  return 'OTHER';
};
