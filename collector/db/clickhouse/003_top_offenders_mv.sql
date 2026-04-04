-- ABOUTME: Builds the materialized view that aggregates raw query events.
-- ABOUTME: Feeds the query_fingerprints table from aggregated query events.
CREATE MATERIALIZED VIEW top_offenders_mv
TO query_fingerprints AS
SELECT
  fingerprint,
  anyState(source_tag) AS source_tag_state,
  anyState(source_file) AS source_file_state,
  anyState(sample_query) AS sample_query_state,
  sumState(total_exec_count) AS total_exec_count_state,
  quantileState(0.95)(mean_exec_time_ms) AS p95_exec_time_state
FROM query_events
GROUP BY fingerprint;
