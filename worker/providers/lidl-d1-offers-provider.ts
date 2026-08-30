import type { ProductCategory } from '../../src/shared/product-category';
import type { OfferBrowseCategory } from '../../src/shared/offer-browse-category';
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
  offer_browse_category: OfferBrowseCategory;
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

interface ProviderCache {
  lastUpdate: { expiresAt: number; value: Promise<string | null> } | null;
  offers: Map<string, Promise<CatalogOffer[]>>;
  counts: Map<string, Promise<Partial<Record<OfferBrowseCategory, number>>>>;
}

const providerCaches = new WeakMap<D1Database, ProviderCache>();
const LAST_UPDATE_CACHE_MS = 5_000;

const cacheFor = (db: D1Database): ProviderCache => {
  const existing = providerCaches.get(db);
  if (existing) return existing;
  const created: ProviderCache = { lastUpdate: null, offers: new Map(), counts: new Map() };
  providerCaches.set(db, created);
  return created;
};

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

  async listPublishedOffers(category?: OfferBrowseCategory): Promise<CatalogOffer[]> {
    const version = (await this.getLastSuccessfulUpdate()) ?? 'none';
    const cache = cacheFor(this.db);
    const key = `${this.today}:${version}:${category ?? 'ALL'}`;
    const cached = cache.offers.get(key);
    if (cached) return cached;
    const loading = this.queryPublishedOffers(category).finally(() => cache.offers.delete(key));
    cache.offers.set(key, loading);
    return loading;
  }

  async listBrowseCategoryCounts(): Promise<Partial<Record<OfferBrowseCategory, number>>> {
    const version = (await this.getLastSuccessfulUpdate()) ?? 'none';
    const cache = cacheFor(this.db);
    const key = `${this.today}:${version}`;
    const cached = cache.counts.get(key);
    if (cached) return cached;
    const loading = this.queryBrowseCategoryCounts().finally(() => cache.counts.delete(key));
    cache.counts.set(key, loading);
    return loading;
  }

  async getLastSuccessfulUpdate(): Promise<string | null> {
    const cache = cacheFor(this.db);
    if (cache.lastUpdate && cache.lastUpdate.expiresAt > Date.now()) {
      return cache.lastUpdate.value;
    }
    const value = this.db
      .prepare(
        `SELECT finished_at FROM import_runs
         WHERE provider = 'lidl' AND status = 'SUCCESS' AND finished_at IS NOT NULL
         ORDER BY finished_at DESC, started_at DESC LIMIT 1`,
      )
      .first<{ finished_at: string }>()
      .then((row) => row?.finished_at ?? null);
    cache.lastUpdate = { expiresAt: Date.now() + LAST_UPDATE_CACHE_MS, value };
    return value;
  }

  private async queryPublishedOffers(category?: OfferBrowseCategory): Promise<CatalogOffer[]> {
    const categoryClause = category ? 'AND ep.offer_browse_category = ?' : '';
    const prepared = this.db.prepare(
      `SELECT o.id, o.product_id, ep.name, ep.normalized_name, ep.brand, ep.category,
                ep.visual_category, ep.offer_browse_category, ep.package_quantity,
                ep.package_unit, ep.package_description,
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
           ${categoryClause}
         ORDER BY ep.name, o.valid_from, o.requires_loyalty_card`,
    );
    const { results } = await (
      category ? prepared.bind(this.today, category) : prepared.bind(this.today)
    ).all<OfferRow>();

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
        offerBrowseCategory: row.offer_browse_category,
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

  private async queryBrowseCategoryCounts(): Promise<Partial<Record<OfferBrowseCategory, number>>> {
    const { results } = await this.db
      .prepare(
        `SELECT offer_browse_category, COUNT(*) AS count
         FROM (
           SELECT ep.offer_browse_category, o.product_id, o.valid_from, o.valid_until
           FROM offers o
           JOIN external_products ep ON ep.id = o.product_id
           WHERE ep.supermarket_id = 'lidl'
             AND (o.valid_until IS NULL OR o.valid_until >= ?)
           GROUP BY ep.offer_browse_category, o.product_id, o.valid_from, o.valid_until
         ) grouped_offers
         GROUP BY offer_browse_category`,
      )
      .bind(this.today)
      .all<{ offer_browse_category: OfferBrowseCategory; count: number }>();
    return Object.fromEntries(results.map((row) => [row.offer_browse_category, row.count]));
  }
}
