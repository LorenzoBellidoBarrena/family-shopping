CREATE TABLE stores (
  id TEXT PRIMARY KEY,
  supermarket_id TEXT NOT NULL REFERENCES supermarkets(id) ON DELETE CASCADE,
  external_id TEXT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  address TEXT NOT NULL CHECK (length(address) BETWEEN 1 AND 240),
  city TEXT NOT NULL CHECK (length(city) BETWEEN 1 AND 100),
  postal_code TEXT NOT NULL CHECK (length(postal_code) BETWEEN 3 AND 12),
  latitude REAL,
  longitude REAL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  UNIQUE (supermarket_id, external_id)
);

CREATE INDEX stores_location_idx ON stores(city, postal_code, supermarket_id);

CREATE TABLE external_products (
  id TEXT PRIMARY KEY,
  supermarket_id TEXT NOT NULL REFERENCES supermarkets(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  ean TEXT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 240),
  normalized_name TEXT NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 240),
  brand TEXT,
  category TEXT,
  image_url TEXT,
  package_quantity INTEGER CHECK (package_quantity IS NULL OR package_quantity > 0),
  package_unit TEXT,
  last_seen_at TEXT NOT NULL,
  UNIQUE (supermarket_id, external_id)
);

CREATE UNIQUE INDEX external_products_ean_idx
  ON external_products(ean)
  WHERE ean IS NOT NULL;
CREATE INDEX external_products_normalized_name_idx
  ON external_products(normalized_name, supermarket_id);

CREATE TABLE product_aliases (
  id TEXT PRIMARY KEY,
  normalized_alias TEXT NOT NULL,
  normalized_canonical_name TEXT NOT NULL,
  category TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (normalized_alias, normalized_canonical_name)
);

CREATE INDEX product_aliases_canonical_idx ON product_aliases(normalized_canonical_name);

CREATE TABLE store_products (
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES external_products(id) ON DELETE CASCADE,
  catalog_status TEXT NOT NULL DEFAULT 'PUBLISHED'
    CHECK (catalog_status IN ('PUBLISHED', 'NOT_PUBLISHED', 'UNKNOWN')),
  observed_at TEXT NOT NULL,
  PRIMARY KEY (store_id, product_id)
);

CREATE INDEX store_products_product_idx ON store_products(product_id, observed_at DESC);

CREATE TABLE product_prices (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES external_products(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  unit_price_cents INTEGER CHECK (unit_price_cents IS NULL OR unit_price_cents >= 0),
  observed_at TEXT NOT NULL
);

CREATE INDEX product_prices_history_idx
  ON product_prices(product_id, store_id, observed_at DESC);

CREATE TABLE offers (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES external_products(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  normal_price_cents INTEGER CHECK (normal_price_cents IS NULL OR normal_price_cents >= 0),
  offer_price_cents INTEGER NOT NULL CHECK (offer_price_cents >= 0),
  promotion_type TEXT NOT NULL CHECK (length(promotion_type) BETWEEN 1 AND 80),
  valid_from TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  source_url TEXT NOT NULL,
  requires_loyalty_card INTEGER NOT NULL DEFAULT 0 CHECK (requires_loyalty_card IN (0, 1)),
  observed_at TEXT NOT NULL,
  CHECK (valid_until >= valid_from),
  UNIQUE (product_id, store_id, promotion_type, valid_from, valid_until)
);

CREATE INDEX offers_active_store_idx ON offers(store_id, valid_from, valid_until);
