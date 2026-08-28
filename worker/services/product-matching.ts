const aliases: Readonly<Record<string, string>> = {
  huevos: 'huevo',
  yogures: 'yogur',
  patatas: 'patata',
  papas: 'patata',
  tomates: 'tomate',
  platanos: 'platano',
  bananas: 'platano',
};

const ignoredTerms = new Set([
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'pack',
  'botella',
  'botellas',
  'unidad',
  'unidades',
  'litro',
  'litros',
  'kg',
  'g',
  'ml',
]);

export const normalizeCatalogText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');

const matchingTerms = (value: string): Set<string> =>
  new Set(
    normalizeCatalogText(value)
      .split(' ')
      .filter((term) => term.length > 1 && !ignoredTerms.has(term))
      .map((term) => aliases[term] ?? term),
  );

export const productsMatch = (listName: string, catalogName: string): boolean => {
  const listTerms = matchingTerms(listName);
  const catalogTerms = matchingTerms(catalogName);
  if (listTerms.size === 0 || catalogTerms.size === 0) return false;
  return [...listTerms].every((term) => catalogTerms.has(term));
};
