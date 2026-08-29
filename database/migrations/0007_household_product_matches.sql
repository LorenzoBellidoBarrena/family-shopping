PRAGMA foreign_keys = OFF;

CREATE TABLE product_aliases_v2 (
  id TEXT PRIMARY KEY,
  normalized_alias TEXT NOT NULL,
  normalized_canonical_name TEXT NOT NULL,
  category TEXT,
  created_at TEXT NOT NULL,
  household_id TEXT REFERENCES households(id) ON DELETE CASCADE,
  supermarket_id TEXT REFERENCES supermarkets(id) ON DELETE CASCADE,
  external_product_id TEXT REFERENCES external_products(id) ON DELETE SET NULL,
  match_status TEXT CHECK (match_status IS NULL OR match_status IN ('CONFIRMED', 'DISMISSED')),
  updated_at TEXT,
  CHECK (
    (household_id IS NULL AND supermarket_id IS NULL AND match_status IS NULL)
    OR
    (household_id IS NOT NULL AND supermarket_id IS NOT NULL AND match_status IS NOT NULL)
  )
);

INSERT INTO product_aliases_v2 (
  id, normalized_alias, normalized_canonical_name, category, created_at
)
SELECT id, normalized_alias, normalized_canonical_name, category, created_at
FROM product_aliases;

DROP TABLE product_aliases;
ALTER TABLE product_aliases_v2 RENAME TO product_aliases;

CREATE UNIQUE INDEX product_aliases_lexical_unique_idx
  ON product_aliases(normalized_alias, normalized_canonical_name)
  WHERE household_id IS NULL;

CREATE UNIQUE INDEX product_aliases_household_match_unique_idx
  ON product_aliases(household_id, normalized_alias, supermarket_id)
  WHERE household_id IS NOT NULL;

CREATE INDEX product_aliases_canonical_idx ON product_aliases(normalized_canonical_name);
CREATE INDEX product_aliases_external_product_idx
  ON product_aliases(external_product_id)
  WHERE external_product_id IS NOT NULL;

PRAGMA foreign_keys = ON;
