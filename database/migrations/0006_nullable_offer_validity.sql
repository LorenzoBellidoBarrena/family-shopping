PRAGMA foreign_keys = OFF;

CREATE TABLE offers_v2 (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES external_products(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  normal_price_cents INTEGER CHECK (normal_price_cents IS NULL OR normal_price_cents >= 0),
  offer_price_cents INTEGER NOT NULL CHECK (offer_price_cents >= 0),
  promotion_type TEXT NOT NULL CHECK (length(promotion_type) BETWEEN 1 AND 80),
  valid_from TEXT,
  valid_until TEXT,
  source_url TEXT NOT NULL,
  requires_loyalty_card INTEGER NOT NULL DEFAULT 0 CHECK (requires_loyalty_card IN (0, 1)),
  observed_at TEXT NOT NULL,
  offer_type TEXT NOT NULL DEFAULT 'SPECIAL_PRICE'
    CHECK (offer_type IN (
      'DIRECT_DISCOUNT', 'PERCENTAGE_DISCOUNT', 'BUY_X_PAY_Y', 'SECOND_UNIT_DISCOUNT',
      'CASHBACK', 'LOYALTY_PRICE', 'SPECIAL_PRICE'
    )),
  percentage INTEGER CHECK (percentage IS NULL OR percentage BETWEEN 1 AND 100),
  buy_quantity INTEGER CHECK (buy_quantity IS NULL OR buy_quantity > 0),
  pay_quantity INTEGER CHECK (pay_quantity IS NULL OR pay_quantity > 0),
  channel TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (channel IN ('STORE', 'ONLINE', 'BOTH', 'UNKNOWN')),
  geographic_scope TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (geographic_scope IN ('NATIONAL', 'REGIONAL', 'STORE', 'ONLINE', 'UNKNOWN')),
  loyalty_program TEXT,
  CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until >= valid_from),
  UNIQUE (product_id, store_id, promotion_type, valid_from, valid_until)
);

INSERT INTO offers_v2 (
  id, product_id, store_id, normal_price_cents, offer_price_cents, promotion_type,
  valid_from, valid_until, source_url, requires_loyalty_card, observed_at, offer_type,
  percentage, buy_quantity, pay_quantity, channel, geographic_scope, loyalty_program
)
SELECT
  id, product_id, store_id, normal_price_cents, offer_price_cents, promotion_type,
  valid_from, valid_until, source_url, requires_loyalty_card, observed_at, offer_type,
  percentage, buy_quantity, pay_quantity, channel, geographic_scope, loyalty_program
FROM offers;

DROP TABLE offers;
ALTER TABLE offers_v2 RENAME TO offers;
CREATE INDEX offers_active_store_idx ON offers(store_id, valid_from, valid_until);

PRAGMA foreign_keys = ON;
