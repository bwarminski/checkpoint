-- ABOUTME: Creates the aggregated query fingerprint read model.
-- ABOUTME: Stores aggregate states consumed by the materialized view.
CREATE TABLE query_fingerprints (
  fingerprint String,
  source_tag_state AggregateFunction(any, Nullable(String)),
  source_file_state AggregateFunction(any, Nullable(String)),
  sample_query_state AggregateFunction(any, Nullable(String)),
  total_exec_count_state AggregateFunction(sum, UInt64),
  p95_exec_time_state AggregateFunction(quantile(0.95), Float64)
) ENGINE = AggregatingMergeTree
ORDER BY fingerprint;
