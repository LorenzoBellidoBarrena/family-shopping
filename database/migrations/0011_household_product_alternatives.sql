CREATE TABLE household_product_alternatives (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  normalized_name TEXT NOT NULL,
  supermarket_id TEXT NOT NULL REFERENCES supermarkets(id) ON DELETE CASCADE,
  source_concept TEXT NOT NULL,
  target_concept TEXT NOT NULL,
  preferred_external_product_id TEXT REFERENCES external_products(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('ACCEPTED', 'DISMISSED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (household_id, normalized_name, supermarket_id, target_concept)
);

CREATE INDEX household_product_alternatives_lookup_idx
  ON household_product_alternatives(household_id, supermarket_id, normalized_name);
