CREATE TABLE IF NOT EXISTS findings (
  id BIGSERIAL PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  source_tag TEXT,
  source_file TEXT,
  finding_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suggestions (
  id BIGSERIAL PRIMARY KEY,
  finding_id BIGINT REFERENCES findings(id),
  fingerprint TEXT NOT NULL,
  fix_type TEXT NOT NULL,
  suggested_sql TEXT,
  pr_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'invalid')),
  validated BOOLEAN DEFAULT FALSE,
  validation_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pattern_log (
  id BIGSERIAL PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  event TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS suggestions_fingerprint_fix_type_status_idx ON suggestions (fingerprint, fix_type, status);
