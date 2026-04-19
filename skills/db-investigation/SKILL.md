---
name: db-investigation
description: Investigate database performance issues in the demo app using Postgres and ClickHouse evidence.
---

# DB Investigation

Use this skill when asked to identify and fix a database performance issue in the demo app.

Workflow:
1. Inspect the repo checkout and the application code involved in the slow path before querying the databases.
2. Use the Postgres tools to list tables, inspect schema, and confirm how the app reads and writes the relevant data.
3. Use the ClickHouse tools to inspect the captured performance evidence for the same path.
4. Form one concrete hypothesis about the highest-value issue.
5. Validate that hypothesis with bounded queries before changing code.
6. Make the smallest reasonable local code change that addresses the confirmed issue.
7. Re-run the evidence queries and confirm the results still support the fix.
8. Create a local commit only after the evidence still supports the fix.

ClickHouse catalog:

**`query_events`** — append-only raw snapshots. One row per pg_stat_statements entry per poll cycle.
- `collected_at DateTime64(3)` — poll timestamp; every row in a single poll shares this value
- `queryid String` — pg_stat_statements identity key
- `statement_text Nullable(String)` — normalized SQL text from pg_stat_statements
- `comment_metadata Map(String, String)` — parsed SQL comment metadata
- `total_exec_count UInt64` — cumulative call count (monotonically increasing across the series)
- `total_exec_time_ms Float64` — cumulative wall-clock execution time in ms
- `mean_exec_time_ms Float64` — cumulative mean time per call
- `rows_returned_or_affected Int64` — cumulative rows produced or affected
- `shared_blks_hit / shared_blks_read UInt64` — cumulative buffer accesses and disk reads
- `total_block_accesses UInt64` — sum of all six block counter columns
- `temp_blks_written UInt64` — cumulative temp file writes; high values indicate sort spills

**`query_intervals`** — VIEW. Reset-aware delta between consecutive snapshots for the same statement.
- `interval_started_at DateTime64(3)` — start of the interval (previous collected_at)
- `interval_ended_at DateTime64(3)` — end of the interval (current collected_at)
- `interval_duration_ms Int64` — wall-clock length of the poll cycle in ms
- `queryid String` — query identity; use this to GROUP BY when aggregating
- `statement_text Nullable(String)` — latest statement text from the later snapshot in the pair
- `comment_metadata Map(String, String)` — latest comment metadata from the later snapshot in the pair
- `total_exec_count Int64` — calls that occurred during this interval
- `delta_exec_time_ms Float64` — execution time accumulated during this interval
- `shared_blks_hit / shared_blks_read Int64` — buffer accesses during this interval
- Only rows where `stats_reset = previous_stats_reset` are included; counter resets are excluded automatically

**`postgres_logs`** — raw Postgres JSON log rows keyed by `query_id`.
- `log_timestamp DateTime64(3)` — when the log entry was written
- `query_id String` — matches `query_intervals.queryid`
- `statement_text Nullable(String)` — statement text captured in the Postgres log
- `comment_metadata Map(String, String)` — parsed SQL comment metadata from the log entry

**Typical offender query pattern:**
```sql
SELECT
  queryid,
  argMax(query_intervals.statement_text, interval_ended_at) AS latest_statement_text,
  coalesce(
    nullIf(argMax(postgres_logs.comment_metadata['source_location'], postgres_logs.log_timestamp), ''),
    argMax(query_intervals.comment_metadata['source_location'], interval_ended_at)
  ) AS latest_source_location,
  sum(total_exec_count) AS call_count,
  round(sum(delta_exec_time_ms), 2) AS total_exec_time_ms,
  round(if(sum(total_exec_count) = 0, 0, sum(delta_exec_time_ms) / sum(total_exec_count)), 2) AS avg_exec_time_ms
FROM query_intervals
LEFT JOIN postgres_logs
  ON postgres_logs.query_id = query_intervals.queryid
  AND postgres_logs.log_timestamp >= query_intervals.interval_started_at
  AND postgres_logs.log_timestamp < query_intervals.interval_ended_at
WHERE interval_started_at > now() - INTERVAL 60 MINUTE
  AND interval_ended_at > now() - INTERVAL 60 MINUTE
  AND interval_duration_ms <= 3600000
GROUP BY queryid
ORDER BY total_exec_time_ms DESC
LIMIT 5
```
