-- ABOUTME: Creates the aggregated query fingerprint read model.
-- ABOUTME: Stores aggregate states consumed by the materialized view.
CREATE TABLE query_fingerprints (
  fingerprint String,
  source_tag Nullable(String),
  representative_state AggregateFunction(argMax, Tuple(Nullable(String), Nullable(String)), DateTime64(3)),
  total_exec_count_state AggregateFunction(sum, UInt64),
  total_exec_time_ms_state AggregateFunction(sum, Float64),
  rows_examined_state AggregateFunction(sum, UInt64),
  mean_rows_examined_state AggregateFunction(avg, Float64),
  p95_exec_time_state AggregateFunction(quantile(0.95), Float64)
) ENGINE = AggregatingMergeTree
ORDER BY (fingerprint, source_tag);
