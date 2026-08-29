export const normalizeProductName = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es-ES')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
