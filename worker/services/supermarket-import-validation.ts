import {
  OFFER_CHANNELS,
  OFFER_TYPES,
  GEOGRAPHIC_SCOPES,
  type ImportedProduct,
} from '../domain/supermarket-import';

const validDate = (value: string | null): boolean => {
  if (value === null) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const validHttpsUrl = (value: string | null): boolean => {
  if (value === null) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
};
const validCents = (value: number | null): boolean =>
  value === null || (Number.isSafeInteger(value) && value >= 0);

export const validateImportedProduct = (product: ImportedProduct): ImportedProduct => {
  if (!/^[A-Za-z0-9._-]{1,120}$/u.test(product.externalId)) {
    throw new Error('IMPORT_INVALID_EXTERNAL_ID');
  }
  if (!product.name || product.name.length > 240 || !product.normalizedName) {
    throw new Error('IMPORT_INVALID_NAME');
  }
  if (!validCents(product.priceCents) || !validCents(product.unitPriceCents)) {
    throw new Error('IMPORT_INVALID_PRICE');
  }
  if (!validHttpsUrl(product.sourceUrl) || !validHttpsUrl(product.imageUrl)) {
    throw new Error('IMPORT_INVALID_URL');
  }
  if (
    product.packageQuantity !== null &&
    (!Number.isFinite(product.packageQuantity) || product.packageQuantity <= 0)
  ) {
    throw new Error('IMPORT_INVALID_PACKAGE');
  }
  if (product.packageDescription !== undefined && (product.packageDescription?.length ?? 0) > 120) {
    throw new Error('IMPORT_INVALID_PACKAGE');
  }
  if (
    !OFFER_CHANNELS.includes(product.channel) ||
    !GEOGRAPHIC_SCOPES.includes(product.geographicScope)
  ) {
    throw new Error('IMPORT_INVALID_SCOPE');
  }
  if (!Array.isArray(product.offers) || product.offers.length > 8) {
    throw new Error('IMPORT_INVALID_OFFERS');
  }
  for (const offer of product.offers) {
    if (
      !OFFER_TYPES.includes(offer.type) ||
      !offer.label ||
      offer.label.length > 160 ||
      !validCents(offer.normalPriceCents) ||
      !validCents(offer.offerPriceCents)
    ) {
      throw new Error('IMPORT_INVALID_OFFER');
    }
    if (
      !validDate(offer.validFrom) ||
      !validDate(offer.validUntil) ||
      (offer.validFrom !== null && offer.validUntil !== null && offer.validUntil < offer.validFrom)
    ) {
      throw new Error('IMPORT_INVALID_VALIDITY');
    }
    if (
      offer.percentage !== null &&
      (!Number.isInteger(offer.percentage) || offer.percentage < 1 || offer.percentage > 100)
    ) {
      throw new Error('IMPORT_INVALID_PERCENTAGE');
    }
    if (
      offer.type === 'BUY_X_PAY_Y' &&
      (!offer.buyQuantity || !offer.payQuantity || offer.payQuantity >= offer.buyQuantity)
    ) {
      throw new Error('IMPORT_INVALID_MULTIBUY');
    }
    if (
      (offer.type === 'PERCENTAGE_DISCOUNT' ||
        offer.type === 'SECOND_UNIT_DISCOUNT' ||
        offer.type === 'CASHBACK') &&
      offer.percentage === null
    ) {
      throw new Error('IMPORT_MISSING_PERCENTAGE');
    }
    if (offer.type === 'LOYALTY_PRICE' && (!offer.requiresLoyaltyCard || !offer.loyaltyProgram)) {
      throw new Error('IMPORT_INVALID_LOYALTY');
    }
  }
  return product;
};
