import type { ProductCategory } from '../../src/shared/product-category';
import type { ProductConcept } from '../services/alternative-matching';

export interface CatalogProductForMatching {
  externalProductId: string;
  name: string;
  normalizedName: string;
  brand: string | null;
  commercialCategory: string | null;
  visualCategory: ProductCategory;
  packageQuantity: number | null;
  packageUnit: string | null;
  packageDescription: string | null;
  currentPriceCents: number | null;
  unitPriceCents: number | null;
  unitPriceUnit: string | null;
}

export interface HouseholdProductMatchPreference {
  normalizedAlias: string;
  externalProductId: string | null;
  status: 'CONFIRMED' | 'DISMISSED';
}

export interface HouseholdAlternativePreference {
  normalizedName: string;
  sourceConcept: ProductConcept;
  targetConcept: ProductConcept;
  preferredExternalProductId: string | null;
  status: 'ACCEPTED' | 'DISMISSED';
}

interface ProductRow {
  id: string;
  name: string;
  normalized_name: string;
  brand: string | null;
  category: string | null;
  visual_category: ProductCategory;
  package_quantity: number | null;
  package_unit: string | null;
  package_description: string | null;
  current_price_cents: number | null;
  unit_price_cents: number | null;
  unit_price_unit: string | null;
}

const mapProduct = (row: ProductRow): CatalogProductForMatching => ({
  externalProductId: row.id,
  name: row.name,
  normalizedName: row.normalized_name,
  brand: row.brand,
  commercialCategory: row.category,
  visualCategory: row.visual_category,
  packageQuantity: row.package_quantity,
  packageUnit: row.package_unit,
  packageDescription: row.package_description,
  currentPriceCents: row.current_price_cents,
  unitPriceCents: row.unit_price_cents,
  unitPriceUnit: row.unit_price_unit,
});

const currentLidlCatalogWhere = `
  ep.supermarket_id = 'lidl'
  AND EXISTS (
    SELECT 1 FROM store_products sp
    WHERE sp.product_id = ep.id AND sp.catalog_status = 'PUBLISHED'
  )
  AND ep.last_seen_at >= COALESCE(
    (SELECT started_at FROM import_runs
     WHERE provider = 'lidl' AND status = 'SUCCESS'
     ORDER BY finished_at DESC, started_at DESC LIMIT 1),
    ep.last_seen_at
  )`;

export class ProductMatchRepository {
  constructor(private readonly db: D1Database) {}

  async listCurrentLidlProducts(): Promise<CatalogProductForMatching[]> {
    const { results } = await this.db
      .prepare(
        `SELECT ep.id, ep.name, ep.normalized_name, ep.brand, ep.category, ep.visual_category,
                ep.package_quantity, ep.package_unit, ep.package_description,
                (SELECT pp.price_cents FROM product_prices pp
                 WHERE pp.product_id = ep.id
                 ORDER BY pp.observed_at DESC, pp.id DESC LIMIT 1) AS current_price_cents,
                (SELECT pp.unit_price_cents FROM product_prices pp
                 WHERE pp.product_id = ep.id
                 ORDER BY pp.observed_at DESC, pp.id DESC LIMIT 1) AS unit_price_cents,
                (SELECT pp.unit_price_unit FROM product_prices pp
                 WHERE pp.product_id = ep.id
                 ORDER BY pp.observed_at DESC, pp.id DESC LIMIT 1) AS unit_price_unit
         FROM external_products ep
         WHERE ${currentLidlCatalogWhere}
         ORDER BY ep.normalized_name, ep.id`,
      )
      .all<ProductRow>();
    return results.map(mapProduct);
  }

  async getCurrentLidlProduct(
    externalProductId: string,
  ): Promise<CatalogProductForMatching | null> {
    const row = await this.db
      .prepare(
        `SELECT ep.id, ep.name, ep.normalized_name, ep.brand, ep.category, ep.visual_category,
                ep.package_quantity, ep.package_unit, ep.package_description,
                (SELECT pp.price_cents FROM product_prices pp
                 WHERE pp.product_id = ep.id
                 ORDER BY pp.observed_at DESC, pp.id DESC LIMIT 1) AS current_price_cents,
                (SELECT pp.unit_price_cents FROM product_prices pp
                 WHERE pp.product_id = ep.id
                 ORDER BY pp.observed_at DESC, pp.id DESC LIMIT 1) AS unit_price_cents,
                (SELECT pp.unit_price_unit FROM product_prices pp
                 WHERE pp.product_id = ep.id
                 ORDER BY pp.observed_at DESC, pp.id DESC LIMIT 1) AS unit_price_unit
         FROM external_products ep
         WHERE ep.id = ? AND ${currentLidlCatalogWhere}`,
      )
      .bind(externalProductId)
      .first<ProductRow>();
    return row ? mapProduct(row) : null;
  }

  async listHouseholdPreferences(householdId: string): Promise<HouseholdProductMatchPreference[]> {
    const { results } = await this.db
      .prepare(
        `SELECT normalized_alias, external_product_id, match_status
         FROM product_aliases
         WHERE household_id = ? AND supermarket_id = 'lidl'
           AND match_status IN ('CONFIRMED', 'DISMISSED')`,
      )
      .bind(householdId)
      .all<{
        normalized_alias: string;
        external_product_id: string | null;
        match_status: 'CONFIRMED' | 'DISMISSED';
      }>();
    return results.map((row) => ({
      normalizedAlias: row.normalized_alias,
      externalProductId: row.external_product_id,
      status: row.match_status,
    }));
  }

  async listHouseholdAlternativePreferences(
    householdId: string,
  ): Promise<HouseholdAlternativePreference[]> {
    const { results } = await this.db
      .prepare(
        `SELECT normalized_name, source_concept, target_concept,
                preferred_external_product_id, status
         FROM household_product_alternatives
         WHERE household_id = ? AND supermarket_id = 'lidl'`,
      )
      .bind(householdId)
      .all<{
        normalized_name: string;
        source_concept: ProductConcept;
        target_concept: ProductConcept;
        preferred_external_product_id: string | null;
        status: 'ACCEPTED' | 'DISMISSED';
      }>();
    return results.map((row) => ({
      normalizedName: row.normalized_name,
      sourceConcept: row.source_concept,
      targetConcept: row.target_concept,
      preferredExternalProductId: row.preferred_external_product_id,
      status: row.status,
    }));
  }

  async confirm(
    householdId: string,
    normalizedAlias: string,
    product: CatalogProductForMatching,
    now: string,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO product_aliases
           (id, normalized_alias, normalized_canonical_name, category, created_at,
            household_id, supermarket_id, external_product_id, match_status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'lidl', ?, 'CONFIRMED', ?)
         ON CONFLICT DO UPDATE SET
           normalized_canonical_name = excluded.normalized_canonical_name,
           category = excluded.category,
           external_product_id = excluded.external_product_id,
           match_status = 'CONFIRMED',
           updated_at = excluded.updated_at`,
      )
      .bind(
        crypto.randomUUID(),
        normalizedAlias,
        product.normalizedName,
        product.visualCategory,
        now,
        householdId,
        product.externalProductId,
        now,
      )
      .run();
  }

  async dismiss(householdId: string, normalizedAlias: string, now: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO product_aliases
           (id, normalized_alias, normalized_canonical_name, created_at, household_id,
            supermarket_id, external_product_id, match_status, updated_at)
         VALUES (?, ?, ?, ?, ?, 'lidl', NULL, 'DISMISSED', ?)
         ON CONFLICT DO UPDATE SET
           external_product_id = NULL,
           match_status = 'DISMISSED',
           updated_at = excluded.updated_at`,
      )
      .bind(crypto.randomUUID(), normalizedAlias, normalizedAlias, now, householdId, now)
      .run();
  }

  async saveAlternative(
    householdId: string,
    normalizedName: string,
    sourceConcept: ProductConcept,
    targetConcept: ProductConcept,
    externalProductId: string,
    status: 'ACCEPTED' | 'DISMISSED',
    now: string,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO household_product_alternatives
           (id, household_id, normalized_name, supermarket_id, source_concept, target_concept,
            preferred_external_product_id, status, created_at, updated_at)
         VALUES (?, ?, ?, 'lidl', ?, ?, ?, ?, ?, ?)
         ON CONFLICT (household_id, normalized_name, supermarket_id, target_concept)
         DO UPDATE SET
           source_concept = excluded.source_concept,
           preferred_external_product_id = excluded.preferred_external_product_id,
           status = excluded.status,
           updated_at = excluded.updated_at`,
      )
      .bind(
        crypto.randomUUID(),
        householdId,
        normalizedName,
        sourceConcept,
        targetConcept,
        externalProductId,
        status,
        now,
        now,
      )
      .run();
  }
}
