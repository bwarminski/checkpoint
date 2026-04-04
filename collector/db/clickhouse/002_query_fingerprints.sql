-- ABOUTME: Creates the aggregated query fingerprint read model.
-- ABOUTME: Stores aggregate states consumed by the materialized view.
CREATE TABLE query_fingerprints (
  fingerprint String,
  representative_state AggregateFunction(argMax, Tuple(Nullable(String), Nullable(String), Nullable(String)), DateTime),
  total_exec_count_state AggregateFunction(sum, UInt64),
  p95_exec_time_state AggregateFunction(quantile(0.95), Float64)
) ENGINE = AggregatingMergeTree
ORDER BY fingerprint;
