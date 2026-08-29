import type {
  ImportedProduct,
  ImportedStore,
  ImportRun,
  SupermarketImportProvider,
} from '../domain/supermarket-import';

type ProviderId = SupermarketImportProvider['providerId'];

interface ImportRunRow {
  id: string;
  provider: string;
  started_at: string;
  finished_at: string | null;
  status: ImportRun['status'];
  products_seen: number;
  prices_seen: number;
  offers_seen: number;
  rejected_items: number;
  error_code: string | null;
}

interface PriceRow {
  price_cents: number;
  unit_price_cents: number | null;
  unit_price_unit: string | null;
}

const mapRun = (row: ImportRunRow): ImportRun => ({
  id: row.id,
  provider: row.provider,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  status: row.status,
  productsSeen: row.products_seen,
  pricesSeen: row.prices_seen,
  offersSeen: row.offers_seen,
  rejectedItems: row.rejected_items,
  errorCode: row.error_code,
});

export class SupermarketImportRepository {
  constructor(private readonly db: D1Database) {}

  async startRun(id: string, providerId: ProviderId, now: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO import_runs (id, provider, started_at, status)
         VALUES (?, ?, ?, 'RUNNING')`,
      )
      .bind(id, providerId, now)
      .run();
  }

  async startRunIfAvailable(
    id: string,
    providerId: ProviderId,
    now: string,
    activeAfter: string,
  ): Promise<boolean> {
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE import_runs
           SET finished_at = ?, status = 'FAILED', error_code = 'IMPORT_STALE'
           WHERE provider = ? AND status = 'RUNNING' AND started_at < ?`,
        )
        .bind(now, providerId, activeAfter),
      this.db
        .prepare(
          `INSERT INTO import_runs (id, provider, started_at, status)
           SELECT ?, ?, ?, 'RUNNING'
           WHERE NOT EXISTS (
             SELECT 1 FROM import_runs
             WHERE provider = ? AND status = 'RUNNING' AND started_at >= ?
           )`,
        )
        .bind(id, providerId, now, providerId, activeAfter),
    ]);
    return (results[1]?.meta.changes ?? 0) > 0;
  }

  async finishRun(
    id: string,
    input: {
      status: Exclude<ImportRun['status'], 'RUNNING'>;
      now: string;
      productsSeen: number;
      pricesSeen: number;
      offersSeen: number;
      rejectedItems: number;
      errorCode: string | null;
    },
  ): Promise<ImportRun> {
    await this.db
      .prepare(
        `UPDATE import_runs
         SET finished_at = ?, status = ?, products_seen = ?, prices_seen = ?, offers_seen = ?,
             rejected_items = ?, error_code = ?
         WHERE id = ?`,
      )
      .bind(
        input.now,
        input.status,
        input.productsSeen,
        input.pricesSeen,
        input.offersSeen,
        input.rejectedItems,
        input.errorCode,
        id,
      )
      .run();
    const run = await this.getRun(id);
    if (!run) throw new Error('IMPORT_RUN_NOT_FOUND');
    return run;
  }

  async listRuns(limit = 20): Promise<ImportRun[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, provider, started_at, finished_at, status, products_seen, prices_seen,
                offers_seen, rejected_items, error_code
         FROM import_runs ORDER BY started_at DESC LIMIT ?`,
      )
      .bind(limit)
      .all<ImportRunRow>();
    return results.map(mapRun);
  }

  async getLastSuccessfulRun(providerId: ProviderId): Promise<ImportRun | null> {
    const row = await this.db
      .prepare(
        `SELECT id, provider, started_at, finished_at, status, products_seen, prices_seen,
                offers_seen, rejected_items, error_code
         FROM import_runs
         WHERE provider = ? AND status = 'SUCCESS'
         ORDER BY finished_at DESC, started_at DESC LIMIT 1`,
      )
      .bind(providerId)
      .first<ImportRunRow>();
    return row ? mapRun(row) : null;
  }

  async listActiveOffers(date: string): Promise<{ id: string; productId: string }[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, product_id
         FROM offers
         WHERE (valid_from IS NULL OR valid_from <= ?)
           AND (valid_until IS NULL OR valid_until >= ?)
         ORDER BY valid_until, id`,
      )
      .bind(date, date)
      .all<{ id: string; product_id: string }>();
    return results.map((row) => ({ id: row.id, productId: row.product_id }));
  }

  async persistProduct(
    providerId: ProviderId,
    catalogStore: ImportedStore,
    product: ImportedProduct,
    observedAt: string,
  ): Promise<{
    priceInserted: boolean;
    offersPersisted: number;
  }> {
    const storeId = await this.persistStore(providerId, catalogStore);
    const existing = await this.db
      .prepare(`SELECT id FROM external_products WHERE supermarket_id = ? AND external_id = ?`)
      .bind(providerId, product.externalId)
      .first<{ id: string }>();
    const productId = existing?.id ?? crypto.randomUUID();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO external_products
             (id, supermarket_id, external_id, ean, name, normalized_name, brand, category,
              image_url, package_quantity, package_unit, last_seen_at, source_url, visual_category)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(supermarket_id, external_id) DO UPDATE SET
             ean = excluded.ean, name = excluded.name, normalized_name = excluded.normalized_name,
             brand = excluded.brand, category = excluded.category, image_url = excluded.image_url,
             package_quantity = excluded.package_quantity, package_unit = excluded.package_unit,
             last_seen_at = excluded.last_seen_at, source_url = excluded.source_url,
             visual_category = excluded.visual_category`,
        )
        .bind(
          productId,
          providerId,
          product.externalId,
          product.ean,
          product.name,
          product.normalizedName,
          product.brand,
          product.commercialCategory,
          product.imageUrl,
          product.packageQuantity,
          product.packageUnit,
          observedAt,
          product.sourceUrl,
          product.visualCategory,
        ),
      this.db
        .prepare(
          `INSERT INTO store_products (store_id, product_id, catalog_status, observed_at)
           VALUES (?, ?, 'PUBLISHED', ?)
           ON CONFLICT(store_id, product_id) DO UPDATE SET
             catalog_status = 'PUBLISHED', observed_at = excluded.observed_at`,
        )
        .bind(storeId, productId, observedAt),
    ]);

    const latest = await this.db
      .prepare(
        `SELECT price_cents, unit_price_cents, unit_price_unit
         FROM product_prices WHERE product_id = ? AND store_id = ?
         ORDER BY observed_at DESC, id DESC LIMIT 1`,
      )
      .bind(productId, storeId)
      .first<PriceRow>();
    const priceInserted =
      !latest ||
      latest.price_cents !== product.priceCents ||
      latest.unit_price_cents !== product.unitPriceCents ||
      latest.unit_price_unit !== product.unitPriceUnit;
    if (priceInserted) {
      await this.db
        .prepare(
          `INSERT INTO product_prices
             (id, product_id, store_id, price_cents, unit_price_cents, observed_at,
              unit_price_unit, channel, geographic_scope)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          productId,
          storeId,
          product.priceCents,
          product.unitPriceCents,
          observedAt,
          product.unitPriceUnit,
          product.channel,
          product.geographicScope,
        )
        .run();
    }

    for (const offer of product.offers) {
      const existingOffer = await this.db
        .prepare(
          `SELECT id FROM offers
           WHERE product_id = ? AND store_id = ? AND promotion_type = ?
             AND valid_from IS ? AND valid_until IS ?`,
        )
        .bind(productId, storeId, offer.label, offer.validFrom, offer.validUntil)
        .first<{ id: string }>();
      if (existingOffer) {
        await this.db
          .prepare(
            `UPDATE offers SET
               normal_price_cents = ?, offer_price_cents = ?, source_url = ?,
               requires_loyalty_card = ?, observed_at = ?, offer_type = ?, percentage = ?,
               buy_quantity = ?, pay_quantity = ?, channel = ?, geographic_scope = ?,
               loyalty_program = ?
             WHERE id = ?`,
          )
          .bind(
            offer.normalPriceCents,
            offer.offerPriceCents,
            product.sourceUrl,
            offer.requiresLoyaltyCard ? 1 : 0,
            observedAt,
            offer.type,
            offer.percentage,
            offer.buyQuantity,
            offer.payQuantity,
            offer.channel,
            offer.geographicScope,
            offer.loyaltyProgram,
            existingOffer.id,
          )
          .run();
      } else {
        await this.db
          .prepare(
            `INSERT INTO offers
             (id, product_id, store_id, normal_price_cents, offer_price_cents, promotion_type,
              valid_from, valid_until, source_url, requires_loyalty_card, observed_at, offer_type,
              percentage, buy_quantity, pay_quantity, channel, geographic_scope, loyalty_program)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            productId,
            storeId,
            offer.normalPriceCents,
            offer.offerPriceCents,
            offer.label,
            offer.validFrom,
            offer.validUntil,
            product.sourceUrl,
            offer.requiresLoyaltyCard ? 1 : 0,
            observedAt,
            offer.type,
            offer.percentage,
            offer.buyQuantity,
            offer.payQuantity,
            offer.channel,
            offer.geographicScope,
            offer.loyaltyProgram,
          )
          .run();
      }
    }

    return { priceInserted, offersPersisted: product.offers.length };
  }

  async persistStore(providerId: ProviderId, store: ImportedStore): Promise<string> {
    const id = `${providerId}-${store.externalId}`;
    await this.db
      .prepare(
        `INSERT INTO stores
           (id, supermarket_id, external_id, name, address, city, postal_code,
            latitude, longitude, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(supermarket_id, external_id) DO UPDATE SET
           name = excluded.name, address = excluded.address, city = excluded.city,
           postal_code = excluded.postal_code, latitude = excluded.latitude,
           longitude = excluded.longitude, active = excluded.active`,
      )
      .bind(
        id,
        providerId,
        store.externalId,
        store.name,
        store.address,
        store.city,
        store.postalCode,
        store.latitude,
        store.longitude,
        store.active ? 1 : 0,
      )
      .run();
    return id;
  }

  private async getRun(id: string): Promise<ImportRun | null> {
    const row = await this.db
      .prepare(
        `SELECT id, provider, started_at, finished_at, status, products_seen, prices_seen,
                offers_seen, rejected_items, error_code FROM import_runs WHERE id = ?`,
      )
      .bind(id)
      .first<ImportRunRow>();
    return row ? mapRun(row) : null;
  }
}
