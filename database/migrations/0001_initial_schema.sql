CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE app_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  household_id TEXT NOT NULL UNIQUE REFERENCES households(id) ON DELETE RESTRICT
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  name TEXT CHECK (name IS NULL OR length(name) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX devices_household_id_idx ON devices(household_id);

CREATE TABLE shopping_cycles (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED', 'CLEARED')),
  created_at TEXT NOT NULL,
  closed_at TEXT,
  close_reason TEXT,
  CHECK (
    (status = 'ACTIVE' AND closed_at IS NULL AND close_reason IS NULL)
    OR (status <> 'ACTIVE' AND closed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX one_active_cycle_per_household_idx
  ON shopping_cycles(household_id)
  WHERE status = 'ACTIVE';

CREATE INDEX shopping_cycles_household_created_idx
  ON shopping_cycles(household_id, created_at DESC);

CREATE TABLE supermarkets (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

INSERT INTO supermarkets (id, code, name, sort_order) VALUES
  ('lidl', 'LIDL', 'Lidl', 10),
  ('mercadona', 'MERCADONA', 'Mercadona', 20),
  ('carrefour', 'CARREFOUR', 'Carrefour', 30),
  ('dia', 'DIA', 'DIA', 40),
  ('any', 'ANY', 'Da igual', 50);

CREATE TABLE shopping_items (
  id TEXT PRIMARY KEY,
  shopping_cycle_id TEXT NOT NULL REFERENCES shopping_cycles(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  normalized_name TEXT NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 120),
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit TEXT NOT NULL CHECK (
    unit IN ('unidad', 'pack', 'kg', 'g', 'litro', 'ml', 'caja', 'botella', 'otro')
  ),
  supermarket_id TEXT REFERENCES supermarkets(id) ON DELETE SET NULL,
  checked INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0, 1)),
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  checked_at TEXT,
  CHECK (
    (checked = 0 AND checked_at IS NULL)
    OR (checked = 1 AND checked_at IS NOT NULL)
  )
);

CREATE INDEX shopping_items_cycle_order_idx
  ON shopping_items(shopping_cycle_id, sort_order, created_at);

CREATE TABLE product_preferences (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  normalized_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  last_supermarket_id TEXT REFERENCES supermarkets(id) ON DELETE SET NULL,
  last_unit TEXT NOT NULL CHECK (
    last_unit IN ('unidad', 'pack', 'kg', 'g', 'litro', 'ml', 'caja', 'botella', 'otro')
  ),
  last_quantity_milli INTEGER NOT NULL CHECK (last_quantity_milli > 0),
  use_count INTEGER NOT NULL DEFAULT 1 CHECK (use_count > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (household_id, normalized_name)
);

CREATE INDEX product_preferences_household_usage_idx
  ON product_preferences(household_id, use_count DESC, updated_at DESC);

CREATE TABLE pairing_codes (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE CHECK (length(code_hash) = 64),
  created_by_device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX pairing_codes_expiry_idx ON pairing_codes(expires_at);
