-- Baseline migration: proves the migration tooling end-to-end.
-- Business tables start in Phase 2 (organizations + tenant-scoped schema).

CREATE TABLE IF NOT EXISTS "_dealflow_meta" (
    "key"   TEXT PRIMARY KEY,
    "value" TEXT NOT NULL
);

INSERT INTO "_dealflow_meta" ("key", "value")
VALUES ('schema_baseline', 'phase-1')
ON CONFLICT ("key") DO NOTHING;
