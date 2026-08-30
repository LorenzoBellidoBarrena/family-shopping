CREATE TABLE household_loyalty_programs (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  program_code TEXT NOT NULL CHECK (
    program_code IN ('LIDL_PLUS', 'CLUB_DIA', 'CLUB_CARREFOUR')
  ),
  status TEXT NOT NULL CHECK (status IN ('UNKNOWN', 'ENABLED', 'DISABLED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (household_id, program_code)
);

CREATE INDEX household_loyalty_programs_status_idx
  ON household_loyalty_programs(program_code, status);
