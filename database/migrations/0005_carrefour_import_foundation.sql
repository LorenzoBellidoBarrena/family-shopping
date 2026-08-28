ALTER TABLE external_products ADD COLUMN source_url TEXT;
ALTER TABLE external_products ADD COLUMN visual_category TEXT NOT NULL DEFAULT 'OTHER'
CHECK (visual_category IN (
  'DAIRY', 'BAKERY', 'FRUIT', 'VEGETABLES', 'MEAT', 'FISH', 'EGGS', 'DRINKS', 'WATER',
  'COFFEE_TEA', 'PASTA_RICE', 'PANTRY', 'CANNED', 'FROZEN', 'SWEETS', 'CLEANING',
  'HYGIENE', 'PAPER', 'PETS', 'OTHER'
));

ALTER TABLE product_prices ADD COLUMN unit_price_unit TEXT;
ALTER TABLE product_prices ADD COLUMN channel TEXT NOT NULL DEFAULT 'UNKNOWN'
CHECK (channel IN ('STORE', 'ONLINE', 'BOTH', 'UNKNOWN'));
ALTER TABLE product_prices ADD COLUMN geographic_scope TEXT NOT NULL DEFAULT 'UNKNOWN'
CHECK (geographic_scope IN ('NATIONAL', 'REGIONAL', 'STORE', 'ONLINE', 'UNKNOWN'));

ALTER TABLE offers ADD COLUMN offer_type TEXT NOT NULL DEFAULT 'SPECIAL_PRICE'
CHECK (offer_type IN (
  'DIRECT_DISCOUNT', 'PERCENTAGE_DISCOUNT', 'BUY_X_PAY_Y', 'SECOND_UNIT_DISCOUNT',
  'CASHBACK', 'LOYALTY_PRICE', 'SPECIAL_PRICE'
));
ALTER TABLE offers ADD COLUMN percentage INTEGER
CHECK (percentage IS NULL OR percentage BETWEEN 1 AND 100);
ALTER TABLE offers ADD COLUMN buy_quantity INTEGER
CHECK (buy_quantity IS NULL OR buy_quantity > 0);
ALTER TABLE offers ADD COLUMN pay_quantity INTEGER
CHECK (pay_quantity IS NULL OR pay_quantity > 0);
ALTER TABLE offers ADD COLUMN channel TEXT NOT NULL DEFAULT 'UNKNOWN'
CHECK (channel IN ('STORE', 'ONLINE', 'BOTH', 'UNKNOWN'));
ALTER TABLE offers ADD COLUMN geographic_scope TEXT NOT NULL DEFAULT 'UNKNOWN'
CHECK (geographic_scope IN ('NATIONAL', 'REGIONAL', 'STORE', 'ONLINE', 'UNKNOWN'));
ALTER TABLE offers ADD COLUMN loyalty_program TEXT;

CREATE TABLE import_runs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 40),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED')),
  products_seen INTEGER NOT NULL DEFAULT 0 CHECK (products_seen >= 0),
  prices_seen INTEGER NOT NULL DEFAULT 0 CHECK (prices_seen >= 0),
  offers_seen INTEGER NOT NULL DEFAULT 0 CHECK (offers_seen >= 0),
  rejected_items INTEGER NOT NULL DEFAULT 0 CHECK (rejected_items >= 0),
  error_code TEXT CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 80)
);

CREATE INDEX import_runs_provider_started_idx ON import_runs(provider, started_at DESC);
