import {
  OFFER_CHANNELS,
  OFFER_TYPES,
  GEOGRAPHIC_SCOPES,
  type ImportedProduct,
} from '../domain/supermarket-import';

const validDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/u.test(value);
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
  if (
    !OFFER_CHANNELS.includes(product.channel) ||
    !GEOGRAPHIC_SCOPES.includes(product.geographicScope)
  ) {
    throw new Error('IMPORT_INVALID_SCOPE');
  }
  if (product.offer) {
    const offer = product.offer;
    if (
      !OFFER_TYPES.includes(offer.type) ||
      !validCents(offer.normalPriceCents) ||
      !validCents(offer.offerPriceCents)
    ) {
      throw new Error('IMPORT_INVALID_OFFER');
    }
    if (
      !validDate(offer.validFrom) ||
      !validDate(offer.validUntil) ||
      offer.validUntil < offer.validFrom
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
