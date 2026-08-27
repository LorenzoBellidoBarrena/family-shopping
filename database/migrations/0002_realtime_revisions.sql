CREATE TABLE household_revisions (
  household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

INSERT INTO household_revisions (household_id, revision)
SELECT id, 0 FROM households;
