import type { ProductCategory } from '../../src/shared/product-category';
import type { OfferType } from '../domain/supermarket-import';
import type { CatalogOffer, SupermarketProvider } from '../domain/supermarkets';

interface OfferRow {
  id: string;
  product_id: string;
  name: string;
  normalized_name: string;
  brand: string | null;
  category: string | null;
  visual_category: ProductCategory;
  package_quantity: number | null;
  package_unit: string | null;
  package_description: string | null;
  base_price_cents: number;
  unit_price_cents: number | null;
  normal_price_cents: number | null;
  offer_price_cents: number;
  promotion_type: string;
  offer_type: OfferType;
  percentage: number | null;
  buy_quantity: number | null;
  pay_quantity: number | null;
  valid_from: string | null;
  valid_until: string | null;
  source_url: string;
  requires_loyalty_card: number;
  loyalty_program: string | null;
  channel: CatalogOffer['channel'];
  geographic_scope: CatalogOffer['geographicScope'];
  observed_at: string;
}

const packageLabel = (
  description: string | null,
  quantity: number | null,
  unit: string | null,
): string | null => {
  if (description) return description;
  if (quantity === null) return unit;
  return `${String(quantity).replace('.', ',')} ${unit ?? ''}`.trim();
};

export class LidlD1OffersProvider implements SupermarketProvider {
  readonly supermarketId = 'lidl' as const;

  constructor(
    private readonly db: D1Database,
    private readonly today = new Date().toISOString().slice(0, 10),
  ) {}

  async listPublishedOffers(): Promise<CatalogOffer[]> {
    const { results } = await this.db
      .prepare(
        `SELECT o.id, o.product_id, ep.name, ep.normalized_name, ep.brand, ep.category,
                ep.visual_category, ep.package_quantity, ep.package_unit, ep.package_description,
                pp.price_cents AS base_price_cents, pp.unit_price_cents,
                o.normal_price_cents, o.offer_price_cents, o.promotion_type,
                o.offer_type, o.percentage, o.buy_quantity, o.pay_quantity,
                o.valid_from, o.valid_until, o.source_url, o.requires_loyalty_card,
                o.loyalty_program, o.channel, o.geographic_scope, o.observed_at
         FROM offers o
         JOIN external_products ep ON ep.id = o.product_id
         JOIN product_prices pp ON pp.id = (
           SELECT latest.id FROM product_prices latest
           WHERE latest.product_id = ep.id AND latest.store_id = o.store_id
           ORDER BY latest.observed_at DESC, latest.id DESC LIMIT 1
         )
         WHERE ep.supermarket_id = 'lidl'
           AND (o.valid_until IS NULL OR o.valid_until >= ?)
         ORDER BY ep.name, o.valid_from, o.requires_loyalty_card`,
      )
      .bind(this.today)
      .all<OfferRow>();

    const grouped = new Map<string, CatalogOffer>();
    for (const row of results) {
      const key = `${row.product_id}:${row.valid_from ?? ''}:${row.valid_until ?? ''}`;
      const existing = grouped.get(key);
      const isLidlPlus = row.requires_loyalty_card === 1 || row.loyalty_program === 'LIDL_PLUS';
      if (existing) {
        if (isLidlPlus) existing.lidlPlusPriceCents = row.offer_price_cents;
        else {
          existing.normalPriceCents = row.normal_price_cents;
          existing.offerPriceCents = row.offer_price_cents;
          existing.promotionType = row.promotion_type;
          existing.offerType = row.offer_type;
          existing.percentage = row.percentage;
          existing.buyQuantity = row.buy_quantity;
          existing.payQuantity = row.pay_quantity;
        }
        if (row.observed_at > existing.observedAt) existing.observedAt = row.observed_at;
        continue;
      }
      grouped.set(key, {
        id: key,
        externalProductId: row.product_id,
        supermarketId: 'lidl',
        supermarketName: 'Lidl',
        storeName: 'Ámbito regional',
        city: 'Badajoz',
        productName: row.name,
        normalizedProductName: row.normalized_name,
        brand: row.brand,
        category: row.category,
        visualCategory: row.visual_category,
        packageLabel: packageLabel(row.package_description, row.package_quantity, row.package_unit),
        normalPriceCents: row.normal_price_cents,
        offerPriceCents: isLidlPlus ? row.base_price_cents : row.offer_price_cents,
        unitPriceCents: row.unit_price_cents,
        promotionType: isLidlPlus ? 'Precio Lidl Plus' : row.promotion_type,
        offerType: row.offer_type,
        percentage: row.percentage,
        buyQuantity: row.buy_quantity,
        payQuantity: row.pay_quantity,
        validFrom: row.valid_from,
        validUntil: row.valid_until,
        sourceUrl: row.source_url,
        requiresLoyaltyCard: isLidlPlus,
        catalogAvailability: 'PUBLISHED',
        fixture: false,
        lidlPlusPriceCents: isLidlPlus ? row.offer_price_cents : null,
        upcoming: row.valid_from !== null && row.valid_from > this.today,
        geographicScope: row.geographic_scope,
        channel: row.channel,
        observedAt: row.observed_at,
      });
    }
    return [...grouped.values()];
  }

  async getLastSuccessfulUpdate(): Promise<string | null> {
    const row = await this.db
      .prepare(
        `SELECT finished_at FROM import_runs
         WHERE provider = 'lidl' AND status = 'SUCCESS' AND finished_at IS NOT NULL
         ORDER BY finished_at DESC, started_at DESC LIMIT 1`,
      )
      .first<{ finished_at: string }>();
    return row?.finished_at ?? null;
  }
}
