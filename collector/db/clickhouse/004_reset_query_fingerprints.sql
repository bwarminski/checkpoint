-- ABOUTME: Resets the fingerprint read model after schema changes.
-- ABOUTME: Rebuilds the aggregate table and materialized view from raw query events.
ALTER TABLE query_fingerprints ADD COLUMN IF NOT EXISTS total_exec_time_ms_state AggregateFunction(sum, Float64) AFTER total_exec_count_state;

DROP TABLE IF EXISTS top_offenders_mv;

TRUNCATE TABLE query_fingerprints;

INSERT INTO query_fingerprints (
  fingerprint,
  representative_state,
  total_exec_count_state,
  total_exec_time_ms_state,
  p95_exec_time_state
)
SELECT
  fingerprint,
  argMaxState((source_tag, source_file, sample_query), collected_at) AS representative_state,
  sumState(total_exec_count) AS total_exec_count_state,
  sumState(total_exec_count * mean_exec_time_ms) AS total_exec_time_ms_state,
  quantileState(0.95)(mean_exec_time_ms) AS p95_exec_time_state
FROM query_events
GROUP BY fingerprint;

CREATE MATERIALIZED VIEW top_offenders_mv
TO query_fingerprints AS
SELECT
  fingerprint,
  argMaxState((source_tag, source_file, sample_query), collected_at) AS representative_state,
  sumState(total_exec_count) AS total_exec_count_state,
  sumState(total_exec_count * mean_exec_time_ms) AS total_exec_time_ms_state,
  quantileState(0.95)(mean_exec_time_ms) AS p95_exec_time_state
FROM query_events
GROUP BY fingerprint;
