import type { CatalogOffer, OfferSupermarketId, SupermarketProvider } from '../domain/supermarkets';
import { normalizeCatalogText } from '../services/product-matching';

export interface FixtureOfferInput {
  id: string;
  productName: string;
  brand?: string;
  category: string;
  packageLabel: string;
  normalPriceCents?: number;
  offerPriceCents: number;
  unitPriceCents?: number;
  promotionType: string;
  requiresLoyaltyCard?: boolean;
}

export abstract class FixtureProvider implements SupermarketProvider {
  abstract readonly supermarketId: OfferSupermarketId;
  protected abstract readonly supermarketName: string;
  protected abstract readonly storeName: string;
  protected abstract readonly sourceUrl: string;
  protected abstract readonly offers: readonly FixtureOfferInput[];

  async listPublishedOffers(): Promise<CatalogOffer[]> {
    return this.offers.map((offer) => ({
      id: `${this.supermarketId}-${offer.id}`,
      supermarketId: this.supermarketId,
      supermarketName: this.supermarketName,
      storeName: this.storeName,
      city: 'Zafra',
      productName: offer.productName,
      normalizedProductName: normalizeCatalogText(offer.productName),
      brand: offer.brand ?? null,
      category: offer.category,
      visualCategory: 'OTHER',
      packageLabel: offer.packageLabel,
      normalPriceCents: offer.normalPriceCents ?? null,
      offerPriceCents: offer.offerPriceCents,
      unitPriceCents: offer.unitPriceCents ?? null,
      promotionType: offer.promotionType,
      validFrom: '2026-08-24',
      validUntil: '2026-09-01',
      sourceUrl: this.sourceUrl,
      requiresLoyaltyCard: offer.requiresLoyaltyCard ?? false,
      catalogAvailability: 'PUBLISHED',
      fixture: true,
      lidlPlusPriceCents: null,
      upcoming: false,
      geographicScope: 'STORE',
      channel: 'STORE',
      observedAt: '2026-08-28T00:00:00.000Z',
    }));
  }
}
