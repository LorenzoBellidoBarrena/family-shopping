export const PRODUCT_CATEGORIES = [
  { code: 'DAIRY', label: 'Lácteos', emoji: '🥛', order: 10 },
  { code: 'BAKERY', label: 'Panadería', emoji: '🥖', order: 20 },
  { code: 'FRUIT', label: 'Fruta', emoji: '🍎', order: 30 },
  { code: 'VEGETABLES', label: 'Verduras', emoji: '🥬', order: 40 },
  { code: 'MEAT', label: 'Carne', emoji: '🥩', order: 50 },
  { code: 'FISH', label: 'Pescado', emoji: '🐟', order: 60 },
  { code: 'EGGS', label: 'Huevos', emoji: '🥚', order: 70 },
  { code: 'DRINKS', label: 'Bebidas', emoji: '🥤', order: 80 },
  { code: 'WATER', label: 'Agua', emoji: '💧', order: 90 },
  { code: 'COFFEE_TEA', label: 'Café e infusiones', emoji: '☕', order: 100 },
  { code: 'PASTA_RICE', label: 'Pasta y arroz', emoji: '🍝', order: 110 },
  { code: 'PANTRY', label: 'Despensa', emoji: '🛒', order: 120 },
  { code: 'CANNED', label: 'Conservas', emoji: '🥫', order: 130 },
  { code: 'FROZEN', label: 'Congelados', emoji: '❄️', order: 140 },
  { code: 'SWEETS', label: 'Dulces', emoji: '🍫', order: 150 },
  { code: 'CLEANING', label: 'Limpieza', emoji: '🧽', order: 160 },
  { code: 'HYGIENE', label: 'Higiene', emoji: '🧴', order: 170 },
  { code: 'PAPER', label: 'Papel', emoji: '🧻', order: 180 },
  { code: 'PETS', label: 'Mascotas', emoji: '🐾', order: 190 },
  { code: 'OTHER', label: 'Otros', emoji: '🛒', order: 200 },
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]['code'];
export type ProductCategoryDefinition = (typeof PRODUCT_CATEGORIES)[number];

const OTHER_CATEGORY = PRODUCT_CATEGORIES[PRODUCT_CATEGORIES.length - 1];

const categoryByCode = new Map<ProductCategory, ProductCategoryDefinition>(
  PRODUCT_CATEGORIES.map((category) => [category.code, category]),
);

const keywordRules: readonly {
  category: ProductCategory;
  keywords: readonly string[];
}[] = [
  {
    category: 'DAIRY',
    keywords: [
      'leche',
      'yogur',
      'yogures',
      'queso',
      'nata',
      'mantequilla',
      'kefir',
      'batido',
      'actimel',
    ],
  },
  {
    category: 'BAKERY',
    keywords: ['pan', 'barra', 'baguette', 'mollete', 'tostadas', 'bollo', 'bollos', 'croissant'],
  },
  {
    category: 'FRUIT',
    keywords: [
      'manzana',
      'pera',
      'platano',
      'naranja',
      'mandarina',
      'limon',
      'melon',
      'sandia',
      'uva',
      'fresa',
      'kiwi',
      'melocoton',
    ],
  },
  {
    category: 'VEGETABLES',
    keywords: [
      'tomate',
      'tomates',
      'lechuga',
      'cebolla',
      'cebollas',
      'pimiento',
      'pimientos',
      'patata',
      'patatas',
      'zanahoria',
      'pepino',
      'calabacin',
      'brocoli',
    ],
  },
  {
    category: 'MEAT',
    keywords: [
      'pollo',
      'cerdo',
      'ternera',
      'carne',
      'hamburguesa',
      'filete',
      'chorizo',
      'jamon',
      'pavo',
    ],
  },
  {
    category: 'FISH',
    keywords: ['pescado', 'merluza', 'salmon', 'bacalao', 'atun', 'sardina', 'sardinas', 'marisco'],
  },
  { category: 'EGGS', keywords: ['huevo', 'huevos'] },
  { category: 'WATER', keywords: ['agua'] },
  {
    category: 'COFFEE_TEA',
    keywords: ['cafe', 'te', 'infusion', 'infusiones', 'manzanilla'],
  },
  {
    category: 'DRINKS',
    keywords: ['refresco', 'zumo', 'cerveza', 'vino', 'limonada', 'cola', 'tonica'],
  },
  {
    category: 'PASTA_RICE',
    keywords: ['pasta', 'macarron', 'macarrones', 'espagueti', 'espaguetis', 'arroz', 'fideo'],
  },
  {
    category: 'CANNED',
    keywords: ['conserva', 'conservas', 'lata', 'latas', 'esparragos en conserva'],
  },
  {
    category: 'FROZEN',
    keywords: ['congelado', 'congelados', 'congelada', 'congeladas', 'helado', 'helados'],
  },
  {
    category: 'SWEETS',
    keywords: [
      'chocolate',
      'galleta',
      'galletas',
      'caramelo',
      'caramelos',
      'chuche',
      'chuches',
      'turron',
    ],
  },
  {
    category: 'PAPER',
    keywords: [
      'papel higienico',
      'papel cocina',
      'servilleta',
      'servilletas',
      'panuelo',
      'panuelos',
    ],
  },
  {
    category: 'CLEANING',
    keywords: [
      'lejia',
      'detergente',
      'lavavajillas',
      'suavizante',
      'limpiador',
      'fregasuelos',
      'esponja',
      'bayeta',
    ],
  },
  {
    category: 'HYGIENE',
    keywords: [
      'champu',
      'gel',
      'desodorante',
      'pasta dientes',
      'cepillo dientes',
      'crema',
      'jabon',
    ],
  },
  {
    category: 'PETS',
    keywords: ['pienso', 'comida gato', 'comida perro', 'arena gato', 'mascota', 'mascotas'],
  },
  {
    category: 'PANTRY',
    keywords: [
      'aceite',
      'vinagre',
      'sal',
      'azucar',
      'harina',
      'lenteja',
      'lentejas',
      'garbanzo',
      'garbanzos',
      'alubia',
      'alubias',
      'salsa',
    ],
  },
];

export const isProductCategory = (value: unknown): value is ProductCategory =>
  typeof value === 'string' && categoryByCode.has(value as ProductCategory);

export const productCategoryDefinition = (category: ProductCategory): ProductCategoryDefinition =>
  categoryByCode.get(category) ?? OTHER_CATEGORY;

const containsKeyword = (normalizedName: string, keyword: string): boolean =>
  ` ${normalizedName} `.includes(` ${keyword} `);

export const classifyNormalizedProductName = (normalizedName: string): ProductCategory => {
  for (const rule of keywordRules) {
    if (rule.keywords.some((keyword) => containsKeyword(normalizedName, keyword))) {
      return rule.category;
    }
  }
  return 'OTHER';
};
