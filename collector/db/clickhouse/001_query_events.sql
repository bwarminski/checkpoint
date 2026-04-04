-- ABOUTME: Creates the raw query events table for collector inserts.
-- ABOUTME: Stores per-query timing and source metadata for later fingerprinting.
CREATE TABLE query_events (
  collected_at DateTime,
  fingerprint String,
  source_tag Nullable(String),
  source_file Nullable(String),
  sample_query Nullable(String),
  total_exec_count UInt64,
  mean_exec_time_ms Float64
) ENGINE = MergeTree
ORDER BY (fingerprint, collected_at);
