ALTER TABLE external_products
ADD COLUMN offer_browse_category TEXT NOT NULL DEFAULT 'OTHER'
CHECK (offer_browse_category IN (
  'FOOD', 'DRINKS', 'FRESH', 'CLEANING', 'PERSONAL_CARE', 'HOME', 'GARDEN', 'DIY',
  'CLOTHING', 'BABY', 'PETS', 'ELECTRONICS', 'OTHER'
));

UPDATE external_products
SET offer_browse_category = CASE visual_category
  WHEN 'FRUIT' THEN 'FRESH'
  WHEN 'VEGETABLES' THEN 'FRESH'
  WHEN 'MEAT' THEN 'FRESH'
  WHEN 'FISH' THEN 'FRESH'
  WHEN 'DRINKS' THEN 'DRINKS'
  WHEN 'WATER' THEN 'DRINKS'
  WHEN 'COFFEE_TEA' THEN 'DRINKS'
  WHEN 'CLEANING' THEN 'CLEANING'
  WHEN 'PAPER' THEN 'CLEANING'
  WHEN 'HYGIENE' THEN 'PERSONAL_CARE'
  WHEN 'PETS' THEN 'PETS'
  WHEN 'OTHER' THEN 'OTHER'
  ELSE 'FOOD'
END;

CREATE INDEX external_products_supermarket_browse_idx
  ON external_products(supermarket_id, offer_browse_category, normalized_name, id);

CREATE INDEX product_prices_latest_store_idx
  ON product_prices(product_id, store_id, observed_at DESC, id DESC);

CREATE INDEX product_prices_latest_product_idx
  ON product_prices(product_id, observed_at DESC, id DESC);

CREATE INDEX import_runs_success_finished_idx
  ON import_runs(provider, status, finished_at DESC, started_at DESC);
