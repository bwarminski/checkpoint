# pg_stat_statements Counter Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the collector pipeline around cumulative `pg_stat_statements` snapshots, add reset-aware delta aggregation in ClickHouse, and keep the checkpoint agent's findings contract unchanged.

**Architecture:** The collector stays stateless and writes raw statement snapshots plus `pg_stat_statements_info` snapshots into ClickHouse. ClickHouse computes reset-aware interval deltas and aggregates them into the existing checkpoint-facing findings shape. Checkpoint fixture, smoke, and tool-query code are updated to consume the new internal tables without changing the agent-facing result schema.

**Tech Stack:** Ruby, Minitest, ClickHouse SQL DDLs/materialized views, TypeScript with `tsx`, Python `pytest`, Docker Compose

---

## File Map

### `/home/bjw/checkpoint-collector`

- Modify: `collector/lib/collector.rb`
  Reads widened `pg_stat_statements` counters, reads `pg_stat_statements_info`, and inserts raw snapshots into `query_events` and `collector_state`.
- Modify: `collector/test/collector_test.rb`
  Pins the widened SQL contract, raw payload shape, and baseline/state snapshot behavior.
- Modify: `collector/test/sql/clickhouse_schema_test.rb`
  Pins the new raw/state/delta/read-model DDL contracts.
- Modify: `collector/test/compose_stack_test.rb`
  Guards the runtime-visible table set and keeps the compose contract aligned with the new schema.
- Modify: `collector/db/clickhouse/001_query_events.sql`
  Defines the raw cumulative statement snapshot table.
- Create: `collector/db/clickhouse/002_collector_state.sql`
  Defines the raw `pg_stat_statements_info` snapshot table.
- Create: `collector/db/clickhouse/003_query_intervals.sql`
  Defines the delta-oriented interval table fed from raw snapshots.
- Move and modify: `collector/db/clickhouse/002_query_fingerprints.sql` -> `collector/db/clickhouse/004_query_fingerprints.sql`
  Defines the checkpoint-facing aggregate findings table.
- Move and modify: `collector/db/clickhouse/003_top_offenders_mv.sql` -> `collector/db/clickhouse/005_top_offenders_mv.sql`
  Feeds `query_fingerprints` from `query_intervals`.
- Move and modify: `collector/db/clickhouse/004_reset_query_fingerprints.sql` -> `collector/db/clickhouse/006_reset_query_analytics.sql`
  Rebuilds all analytics objects from raw snapshots during destructive reset.

### `/home/bjw/checkpoint`

- Modify: `src/tools/clickhouse_tool.ts`
  Reads recent findings from `query_intervals` with a freshness cap and keeps all-time queries on `query_fingerprints`.
- Modify: `test/tools/clickhouse_tool.test.ts`
  Pins the root-package query shape and table support changes.
- Modify: `agent/test/clickhouse_tool.test.ts`
  Pins the agent package query shape and table support changes.
- Modify: `scripts/validate.sh`
  Seeds the new ClickHouse tables for manual validation.
- Modify: `tests/smoke/test_clickhouse_schema.py`
  Proves the booted ClickHouse image exposes the raw/state/delta/findings tables.
- Modify: `JOURNAL.md`
  Records the redesign and any non-obvious implementation choices.

### Task 1: Pin The Collector Snapshot Contract

**Files:**
- Modify: `collector/test/collector_test.rb`
- Modify: `collector/lib/collector.rb`

- [ ] **Step 1: Write the failing tests**

```ruby
def test_inserts_counter_snapshots_into_query_events_and_collector_state
  stats_connection = StatsConnection.new(
    stats_rows: [
      {
        "dbid" => "5",
        "userid" => "9",
        "toplevel" => "t",
        "queryid" => "42",
        "calls" => "7",
        "total_exec_time" => "125.5",
        "min_exec_time" => "10.0",
        "max_exec_time" => "30.0",
        "mean_exec_time" => "17.9",
        "stddev_exec_time" => "8.4",
        "rows" => "20",
        "shared_blks_hit" => "100",
        "shared_blks_read" => "40",
        "local_blks_hit" => "3",
        "local_blks_read" => "2",
        "temp_blks_read" => "1",
        "temp_blks_written" => "4"
      }
    ],
    info_rows: [{ "dealloc" => "3", "stats_reset" => "2026-04-09 12:00:00+00" }],
  )
  clickhouse_connection = RecordingClickhouseConnection.new
  sample_query_lookup = SampleQueryLookupStub.new("42" => "SELECT 1 /*source_location:/app/models/todo.rb:7*/")
  collector = Collector.new(
    stats_connection: stats_connection,
    clickhouse_connection: clickhouse_connection,
    sample_query_lookup: sample_query_lookup,
    clock: -> { Time.utc(2026, 4, 9, 12, 5, 0) }
  )

  rows = collector.run_once

  assert_equal 1, rows.length
  assert_equal 5, rows.first[:dbid]
  assert_equal 9, rows.first[:userid]
  assert_equal true, rows.first[:toplevel]
  assert_equal "42", rows.first[:queryid]
  assert_equal 125.5, rows.first[:total_exec_time_ms]
  assert_equal 150, rows.first[:total_block_accesses]
  assert_equal [
    ["query_events", rows],
    ["collector_state", [{ collected_at: Time.utc(2026, 4, 9, 12, 5, 0), dealloc: 3, stats_reset: "2026-04-09 12:00:00+00" }]],
  ], clickhouse_connection.inserts
end

def test_run_once_uses_widened_stats_and_info_queries
  stats_connection = StatsConnection.new(stats_rows: [], info_rows: [])
  collector = Collector.new(stats_connection: stats_connection)

  collector.run_once

  assert_equal Collector::STATS_SQL, stats_connection.sql_calls.fetch(0)
  assert_equal Collector::INFO_SQL, stats_connection.sql_calls.fetch(1)
end
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /home/bjw/checkpoint-collector/collector && bundle exec ruby -Itest test/collector_test.rb`

Expected: FAIL because `Collector` does not define `INFO_SQL`, does not request `dbid` / `userid` / `toplevel` / `total_exec_time`, and does not insert into `collector_state`.

- [ ] **Step 3: Write the minimal implementation**

```ruby
class Collector
  STATS_SQL = <<~SQL.freeze
    SELECT
      dbid,
      userid,
      toplevel,
      queryid,
      calls,
      total_exec_time,
      min_exec_time,
      max_exec_time,
      mean_exec_time,
      stddev_exec_time,
      rows,
      shared_blks_hit,
      shared_blks_read,
      local_blks_hit,
      local_blks_read,
      temp_blks_read,
      temp_blks_written
    FROM pg_stat_statements
  SQL

  INFO_SQL = "SELECT dealloc, stats_reset FROM pg_stat_statements_info".freeze

  def run_once
    return [] unless @stats_connection

    stats_rows = Array(@stats_connection.exec(STATS_SQL))
    info_row = Array(@stats_connection.exec(INFO_SQL)).first
    return [] if stats_rows.empty?

    collected_at = @clock.call
    rows = stats_rows.map { |stats_row| build_row(stats_row, collected_at) }

    @clickhouse_connection&.insert("query_events", rows)
    @clickhouse_connection&.insert("collector_state", [build_state_row(info_row, collected_at)]) if info_row
    rows
  end
end
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /home/bjw/checkpoint-collector/collector && bundle exec ruby -Itest test/collector_test.rb`

Expected: PASS with the new counter snapshot tests green.

- [ ] **Step 5: Commit**

```bash
cd /home/bjw/checkpoint-collector
git add collector/lib/collector.rb collector/test/collector_test.rb
git commit -m "feat: collect pg stat statement counter snapshots"
```

### Task 2: Replace The ClickHouse Schema With Raw, State, Delta, And Findings Layers

**Files:**
- Modify: `collector/test/sql/clickhouse_schema_test.rb`
- Modify: `collector/db/clickhouse/001_query_events.sql`
- Create: `collector/db/clickhouse/002_collector_state.sql`
- Create: `collector/db/clickhouse/003_query_intervals.sql`
- Move and modify: `collector/db/clickhouse/002_query_fingerprints.sql` -> `collector/db/clickhouse/004_query_fingerprints.sql`
- Move and modify: `collector/db/clickhouse/003_top_offenders_mv.sql` -> `collector/db/clickhouse/005_top_offenders_mv.sql`
- Move and modify: `collector/db/clickhouse/004_reset_query_fingerprints.sql` -> `collector/db/clickhouse/006_reset_query_analytics.sql`

- [ ] **Step 1: Write the failing schema tests**

```ruby
def test_query_events_store_snapshot_identity_and_counter_columns
  sql = read_sql("001_query_events.sql")

  assert_match(/dbid\s+UInt64/, sql)
  assert_match(/userid\s+UInt64/, sql)
  assert_match(/toplevel\s+Bool/, sql)
  assert_match(/queryid\s+String/, sql)
  assert_match(/total_exec_time_ms\s+Float64/, sql)
  refute_match(/mean_block_accesses_per_call/, sql)
end

def test_collector_state_tracks_pg_stat_statements_info_snapshots
  sql = read_sql("002_collector_state.sql")

  assert_match(/dealloc\s+UInt64/, sql)
  assert_match(/stats_reset\s+DateTime/, sql)
end

def test_query_intervals_capture_reset_aware_deltas
  sql = read_sql("003_query_intervals.sql")

  assert_includes sql, "interval_started_at"
  assert_includes sql, "interval_ended_at"
  assert_includes sql, "interval_duration_ms"
  assert_includes sql, "lagInFrame(total_exec_count)"
end

def test_findings_view_aggregates_from_query_intervals
  sql = read_sql("005_top_offenders_mv.sql")

  assert_match(/FROM query_intervals/, sql)
  assert_match(/GROUP BY fingerprint/, sql)
  assert_includes sql, "quantileState(0.95)(delta_exec_time_ms)"
end
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /home/bjw/checkpoint-collector/collector && bundle exec ruby -Itest test/sql/clickhouse_schema_test.rb`

Expected: FAIL because the new SQL files do not exist and the old schema still uses `mean_exec_time_ms`-derived aggregation.

- [ ] **Step 3: Write the minimal DDL rewrite**

```sql
-- 001_query_events.sql
CREATE TABLE query_events (
  collected_at DateTime64(3),
  dbid UInt64,
  userid UInt64,
  toplevel Bool,
  queryid String,
  fingerprint String,
  source_file Nullable(String),
  sample_query Nullable(String),
  total_exec_count UInt64,
  total_exec_time_ms Float64,
  rows_returned_or_affected UInt64,
  shared_blks_hit UInt64,
  shared_blks_read UInt64,
  local_blks_hit UInt64,
  local_blks_read UInt64,
  temp_blks_read UInt64,
  temp_blks_written UInt64,
  total_block_accesses UInt64,
  min_exec_time_ms Float64,
  max_exec_time_ms Float64,
  mean_exec_time_ms Float64,
  stddev_exec_time_ms Float64
) ENGINE = MergeTree
ORDER BY (dbid, userid, toplevel, queryid, collected_at);

-- 002_collector_state.sql
CREATE TABLE collector_state (
  collected_at DateTime64(3),
  dealloc UInt64,
  stats_reset DateTime
) ENGINE = MergeTree
ORDER BY (collected_at);

-- 003_query_intervals.sql
CREATE TABLE query_intervals (
  interval_started_at DateTime64(3),
  interval_ended_at DateTime64(3),
  interval_duration_ms UInt64,
  dbid UInt64,
  userid UInt64,
  toplevel Bool,
  queryid String,
  fingerprint String,
  source_file Nullable(String),
  sample_query Nullable(String),
  total_exec_count UInt64,
  delta_exec_time_ms Float64,
  rows_returned_or_affected UInt64,
  shared_blks_hit UInt64,
  shared_blks_read UInt64,
  local_blks_hit UInt64,
  local_blks_read UInt64,
  temp_blks_read UInt64,
  temp_blks_written UInt64,
  total_block_accesses UInt64
) ENGINE = MergeTree
ORDER BY (fingerprint, interval_ended_at);
```

```sql
-- 005_top_offenders_mv.sql
CREATE MATERIALIZED VIEW top_offenders_mv
TO query_fingerprints AS
SELECT
  fingerprint,
  argMaxState((source_file, sample_query), interval_ended_at) AS representative_state,
  sumState(total_exec_count) AS total_exec_count_state,
  sumState(delta_exec_time_ms) AS total_exec_time_ms_state,
  sumState(rows_returned_or_affected) AS rows_returned_or_affected_state,
  sumState(shared_blks_hit) AS shared_blks_hit_state,
  sumState(shared_blks_read) AS shared_blks_read_state,
  sumState(local_blks_hit) AS local_blks_hit_state,
  sumState(local_blks_read) AS local_blks_read_state,
  sumState(temp_blks_read) AS temp_blks_read_state,
  sumState(temp_blks_written) AS temp_blks_written_state,
  sumState(total_block_accesses) AS total_block_accesses_state,
  quantileState(0.95)(delta_exec_time_ms) AS p95_exec_time_state
FROM query_intervals
GROUP BY fingerprint;
```

- [ ] **Step 4: Run the schema tests to verify they pass**

Run: `cd /home/bjw/checkpoint-collector/collector && bundle exec ruby -Itest test/sql/clickhouse_schema_test.rb`

Expected: PASS with the raw/state/delta/findings schema contract green.

- [ ] **Step 5: Commit**

```bash
cd /home/bjw/checkpoint-collector
git add collector/test/sql/clickhouse_schema_test.rb collector/db/clickhouse
git commit -m "feat: add reset-aware clickhouse query analytics schema"
```

### Task 3: Pin And Implement Reset-Aware Delta Semantics

**Files:**
- Modify: `collector/test/sql/clickhouse_schema_test.rb`
- Modify: `collector/db/clickhouse/003_query_intervals.sql`
- Modify: `collector/db/clickhouse/006_reset_query_analytics.sql`

- [ ] **Step 1: Write the failing tests for baselines and resets**

```ruby
def test_first_snapshot_is_baseline_only_for_query_intervals
  sql = read_sql("003_query_intervals.sql")

  assert_includes sql, "previous_total_exec_count"
  assert_includes sql, "WHERE previous_total_exec_count IS NOT NULL"
end

def test_query_intervals_drop_reset_boundaries_instead_of_emitting_negative_deltas
  sql = read_sql("003_query_intervals.sql")

  assert_includes sql, "stats_reset = previous_stats_reset"
  assert_includes sql, "delta_exec_time_ms >= 0"
end

def test_reset_sql_rebuilds_query_intervals_before_query_fingerprints
  sql = read_sql("006_reset_query_analytics.sql")

  assert_match(/DROP TABLE IF EXISTS top_offenders_mv/, sql)
  assert_match(/DROP TABLE IF EXISTS query_fingerprints/, sql)
  assert_match(/DROP TABLE IF EXISTS query_intervals/, sql)
  assert_match(/INSERT INTO query_intervals/, sql)
  assert_match(/INSERT INTO query_fingerprints/, sql)
end
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /home/bjw/checkpoint-collector/collector && bundle exec ruby -Itest test/sql/clickhouse_schema_test.rb`

Expected: FAIL because the interval SQL does not yet describe baseline suppression or reset filtering.

- [ ] **Step 3: Write the minimal interval logic**

```sql
INSERT INTO query_intervals
WITH event_snapshots AS (
  SELECT
    e.collected_at,
    e.dbid,
    e.userid,
    e.toplevel,
    e.queryid,
    e.fingerprint,
    e.source_file,
    e.sample_query,
    e.total_exec_count,
    e.total_exec_time_ms,
    e.rows_returned_or_affected,
    e.shared_blks_hit,
    e.shared_blks_read,
    e.local_blks_hit,
    e.local_blks_read,
    e.temp_blks_read,
    e.temp_blks_written,
    e.total_block_accesses,
    s.stats_reset
  FROM query_events AS e
  INNER JOIN collector_state AS s ON s.collected_at = e.collected_at
), interval_candidates AS (
  SELECT
    collected_at,
    dbid,
    userid,
    toplevel,
    queryid,
    fingerprint,
    source_file,
    sample_query,
    total_exec_count,
    total_exec_time_ms,
    rows_returned_or_affected,
    shared_blks_hit,
    shared_blks_read,
    local_blks_hit,
    local_blks_read,
    temp_blks_read,
    temp_blks_written,
    total_block_accesses,
    stats_reset,
    lagInFrame(collected_at) OVER statement_window AS previous_collected_at,
    lagInFrame(total_exec_count) OVER statement_window AS previous_total_exec_count,
    lagInFrame(total_exec_time_ms) OVER statement_window AS previous_total_exec_time_ms,
    lagInFrame(rows_returned_or_affected) OVER statement_window AS previous_rows_returned_or_affected,
    lagInFrame(shared_blks_hit) OVER statement_window AS previous_shared_blks_hit,
    lagInFrame(shared_blks_read) OVER statement_window AS previous_shared_blks_read,
    lagInFrame(local_blks_hit) OVER statement_window AS previous_local_blks_hit,
    lagInFrame(local_blks_read) OVER statement_window AS previous_local_blks_read,
    lagInFrame(temp_blks_read) OVER statement_window AS previous_temp_blks_read,
    lagInFrame(temp_blks_written) OVER statement_window AS previous_temp_blks_written,
    lagInFrame(total_block_accesses) OVER statement_window AS previous_total_block_accesses,
    lagInFrame(stats_reset) OVER statement_window AS previous_stats_reset
  FROM event_snapshots
  WINDOW statement_window AS (PARTITION BY dbid, userid, toplevel, queryid ORDER BY collected_at)
)
SELECT
  previous_collected_at AS interval_started_at,
  collected_at AS interval_ended_at,
  dateDiff('millisecond', previous_collected_at, collected_at) AS interval_duration_ms,
  dbid,
  userid,
  toplevel,
  queryid,
  fingerprint,
  source_file,
  sample_query,
  total_exec_count - previous_total_exec_count AS total_exec_count,
  total_exec_time_ms - previous_total_exec_time_ms AS delta_exec_time_ms,
  rows_returned_or_affected - previous_rows_returned_or_affected AS rows_returned_or_affected,
  shared_blks_hit - previous_shared_blks_hit AS shared_blks_hit,
  shared_blks_read - previous_shared_blks_read AS shared_blks_read,
  local_blks_hit - previous_local_blks_hit AS local_blks_hit,
  local_blks_read - previous_local_blks_read AS local_blks_read,
  temp_blks_read - previous_temp_blks_read AS temp_blks_read,
  temp_blks_written - previous_temp_blks_written AS temp_blks_written,
  total_block_accesses - previous_total_block_accesses AS total_block_accesses
FROM interval_candidates
WHERE previous_collected_at IS NOT NULL
  AND stats_reset = previous_stats_reset
  AND total_exec_count >= previous_total_exec_count
  AND total_exec_time_ms >= previous_total_exec_time_ms;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /home/bjw/checkpoint-collector/collector && bundle exec ruby -Itest test/sql/clickhouse_schema_test.rb`

Expected: PASS with baseline-only and reset-aware semantics pinned.

- [ ] **Step 5: Commit**

```bash
cd /home/bjw/checkpoint-collector
git add collector/test/sql/clickhouse_schema_test.rb collector/db/clickhouse/003_query_intervals.sql collector/db/clickhouse/006_reset_query_analytics.sql
git commit -m "feat: add reset-aware query interval rebuilds"
```

### Task 4: Verify The Collector Runtime Against The New Schema

**Files:**
- Modify: `collector/test/compose_stack_test.rb`
- Modify: `collector/lib/collector.rb`
- Modify: `collector/db/clickhouse/006_reset_query_analytics.sql`

- [ ] **Step 1: Write the failing runtime-facing tests**

```ruby
def test_clickhouse_bootstrap_mentions_interval_and_state_tables
  sql_files = Dir[File.expand_path("../../db/clickhouse/*.sql", __dir__)].map { |path| File.basename(path) }

  assert_includes sql_files, "002_collector_state.sql"
  assert_includes sql_files, "003_query_intervals.sql"
end

def test_compose_stack_schema_contract_mentions_collector_state_and_query_intervals
  reset_sql = File.read(File.expand_path("../db/clickhouse/006_reset_query_analytics.sql", __dir__))

  assert_includes reset_sql, "collector_state"
  assert_includes reset_sql, "query_intervals"
end
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /home/bjw/checkpoint-collector/collector && bundle exec ruby -Itest test/compose_stack_test.rb`

Expected: FAIL until the renamed SQL files and reset script are in place.

- [ ] **Step 3: Make the minimal runtime updates**

```ruby
def build_state_row(info_row, collected_at)
  {
    collected_at: collected_at,
    dealloc: info_row.fetch("dealloc").to_i,
    stats_reset: info_row.fetch("stats_reset"),
  }
end
```

```sql
-- 006_reset_query_analytics.sql
DROP TABLE IF EXISTS top_offenders_mv;
DROP TABLE IF EXISTS query_fingerprints;
DROP TABLE IF EXISTS query_intervals;

CREATE TABLE query_intervals (
  interval_started_at DateTime64(3),
  interval_ended_at DateTime64(3),
  interval_duration_ms UInt64,
  dbid UInt64,
  userid UInt64,
  toplevel Bool,
  queryid String,
  fingerprint String,
  source_file Nullable(String),
  sample_query Nullable(String),
  total_exec_count UInt64,
  delta_exec_time_ms Float64,
  rows_returned_or_affected UInt64,
  shared_blks_hit UInt64,
  shared_blks_read UInt64,
  local_blks_hit UInt64,
  local_blks_read UInt64,
  temp_blks_read UInt64,
  temp_blks_written UInt64,
  total_block_accesses UInt64
) ENGINE = MergeTree
ORDER BY (fingerprint, interval_ended_at);

INSERT INTO query_intervals
WITH event_snapshots AS (
  SELECT e.collected_at, e.dbid, e.userid, e.toplevel, e.queryid, e.fingerprint, e.source_file, e.sample_query, e.total_exec_count, e.total_exec_time_ms, e.rows_returned_or_affected, e.shared_blks_hit, e.shared_blks_read, e.local_blks_hit, e.local_blks_read, e.temp_blks_read, e.temp_blks_written, e.total_block_accesses, s.stats_reset
  FROM query_events AS e
  INNER JOIN collector_state AS s ON s.collected_at = e.collected_at
)
SELECT
  lagInFrame(collected_at) OVER statement_window AS interval_started_at,
  collected_at AS interval_ended_at,
  dateDiff('millisecond', lagInFrame(collected_at) OVER statement_window, collected_at) AS interval_duration_ms,
  dbid,
  userid,
  toplevel,
  queryid,
  fingerprint,
  source_file,
  sample_query,
  total_exec_count - lagInFrame(total_exec_count) OVER statement_window AS total_exec_count,
  total_exec_time_ms - lagInFrame(total_exec_time_ms) OVER statement_window AS delta_exec_time_ms,
  rows_returned_or_affected - lagInFrame(rows_returned_or_affected) OVER statement_window AS rows_returned_or_affected,
  shared_blks_hit - lagInFrame(shared_blks_hit) OVER statement_window AS shared_blks_hit,
  shared_blks_read - lagInFrame(shared_blks_read) OVER statement_window AS shared_blks_read,
  local_blks_hit - lagInFrame(local_blks_hit) OVER statement_window AS local_blks_hit,
  local_blks_read - lagInFrame(local_blks_read) OVER statement_window AS local_blks_read,
  temp_blks_read - lagInFrame(temp_blks_read) OVER statement_window AS temp_blks_read,
  temp_blks_written - lagInFrame(temp_blks_written) OVER statement_window AS temp_blks_written,
  total_block_accesses - lagInFrame(total_block_accesses) OVER statement_window AS total_block_accesses
FROM event_snapshots
WINDOW statement_window AS (PARTITION BY dbid, userid, toplevel, queryid ORDER BY collected_at);

CREATE TABLE query_fingerprints (
  fingerprint String,
  representative_state AggregateFunction(argMax, Tuple(Nullable(String), Nullable(String)), DateTime64(3)),
  total_exec_count_state AggregateFunction(sum, UInt64),
  total_exec_time_ms_state AggregateFunction(sum, Float64),
  rows_returned_or_affected_state AggregateFunction(sum, UInt64),
  shared_blks_hit_state AggregateFunction(sum, UInt64),
  shared_blks_read_state AggregateFunction(sum, UInt64),
  local_blks_hit_state AggregateFunction(sum, UInt64),
  local_blks_read_state AggregateFunction(sum, UInt64),
  temp_blks_read_state AggregateFunction(sum, UInt64),
  temp_blks_written_state AggregateFunction(sum, UInt64),
  total_block_accesses_state AggregateFunction(sum, UInt64),
  p95_exec_time_state AggregateFunction(quantile(0.95), Float64)
) ENGINE = AggregatingMergeTree
ORDER BY (fingerprint);

INSERT INTO query_fingerprints
SELECT
  fingerprint,
  argMaxState((source_file, sample_query), interval_ended_at) AS representative_state,
  sumState(total_exec_count) AS total_exec_count_state,
  sumState(delta_exec_time_ms) AS total_exec_time_ms_state,
  sumState(rows_returned_or_affected) AS rows_returned_or_affected_state,
  sumState(shared_blks_hit) AS shared_blks_hit_state,
  sumState(shared_blks_read) AS shared_blks_read_state,
  sumState(local_blks_hit) AS local_blks_hit_state,
  sumState(local_blks_read) AS local_blks_read_state,
  sumState(temp_blks_read) AS temp_blks_read_state,
  sumState(temp_blks_written) AS temp_blks_written_state,
  sumState(total_block_accesses) AS total_block_accesses_state,
  quantileState(0.95)(delta_exec_time_ms) AS p95_exec_time_state
FROM query_intervals
GROUP BY fingerprint;

CREATE MATERIALIZED VIEW top_offenders_mv TO query_fingerprints AS
SELECT
  fingerprint,
  argMaxState((source_file, sample_query), interval_ended_at) AS representative_state,
  sumState(total_exec_count) AS total_exec_count_state,
  sumState(delta_exec_time_ms) AS total_exec_time_ms_state,
  sumState(rows_returned_or_affected) AS rows_returned_or_affected_state,
  sumState(shared_blks_hit) AS shared_blks_hit_state,
  sumState(shared_blks_read) AS shared_blks_read_state,
  sumState(local_blks_hit) AS local_blks_hit_state,
  sumState(local_blks_read) AS local_blks_read_state,
  sumState(temp_blks_read) AS temp_blks_read_state,
  sumState(temp_blks_written) AS temp_blks_written_state,
  sumState(total_block_accesses) AS total_block_accesses_state,
  quantileState(0.95)(delta_exec_time_ms) AS p95_exec_time_state
FROM query_intervals
GROUP BY fingerprint;
```

- [ ] **Step 4: Run the collector repo verification**

Run:

```bash
cd /home/bjw/checkpoint-collector/collector
bundle exec ruby -Itest test/collector_test.rb test/sql/clickhouse_schema_test.rb test/compose_stack_test.rb
```

Expected: PASS with the collector contract, schema contract, and compose contract all green.

- [ ] **Step 5: Commit**

```bash
cd /home/bjw/checkpoint-collector
git add collector/lib/collector.rb collector/test/compose_stack_test.rb collector/db/clickhouse
git commit -m "test: verify collector runtime against counter schema"
```

### Task 5: Pin The Checkpoint Consumer Changes

**Files:**
- Modify: `test/tools/clickhouse_tool.test.ts`
- Modify: `agent/test/clickhouse_tool.test.ts`
- Modify: `tests/smoke/test_clickhouse_schema.py`
- Modify: `scripts/validate.sh`

- [ ] **Step 1: Write the failing checkpoint-side tests**

```ts
test("queryFindings reads recent findings from query_intervals with a freshness cap", async () => {
  const queries: Array<string> = [];
  const tool = new ClickHouseTool({
    transport: {
      query: async (sql: string) => {
        queries.push(sql);
        return [
          "fingerprint\tsource_file\tsample_query\ttotal_exec_count\ttotal_exec_time_ms\tp95_exec_time_ms",
          "fp-1\t/app/controllers/todos_controller.rb:12\tSELECT 1\t7\t50.5\t12",
        ].join("\n");
      },
    },
  });

  await tool.queryFindings("analyze_db 60");

  assert.match(queries[0] ?? "", /FROM query_intervals/);
  assert.match(queries[0] ?? "", /interval_duration_ms <= 3600000/);
});
```

```python
def test_clickhouse_image_boots_and_loads_counter_schema():
    root = Path(__file__).resolve().parents[2]

    subprocess.run(["docker", "compose", "up", "-d", "clickhouse"], cwd=root, check=True)
    try:
        tables = subprocess.run(
            ["docker", "compose", "exec", "-T", "clickhouse", "clickhouse-client", "--query", "SHOW TABLES"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.splitlines()
    finally:
        subprocess.run(["docker", "compose", "down"], cwd=root, check=True)

    assert "query_events" in tables
    assert "collector_state" in tables
    assert "query_intervals" in tables
    assert "query_fingerprints" in tables
```

```bash
seed_clickhouse_fixture() {
  run_clickhouse_query "TRUNCATE TABLE query_intervals"
  run_clickhouse_query "TRUNCATE TABLE query_fingerprints"
  run_clickhouse_query "INSERT INTO query_intervals (interval_started_at, interval_ended_at, interval_duration_ms, dbid, userid, toplevel, queryid, fingerprint, source_file, sample_query, total_exec_count, delta_exec_time_ms, rows_returned_or_affected, shared_blks_hit, shared_blks_read, local_blks_hit, local_blks_read, temp_blks_read, temp_blks_written, total_block_accesses) VALUES ('2026-04-09 12:00:00.000', '2026-04-09 12:01:00.000', 60000, 5, 9, true, '42', 'fp-live-provider', '/app/controllers/todos_controller.rb:12', 'SELECT * FROM todos', 7, 125.5, 20, 100, 40, 0, 0, 3, 2, 145)"
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd /home/bjw/checkpoint
node --import tsx --test test/tools/clickhouse_tool.test.ts
cd /home/bjw/checkpoint/agent
node --import tsx --test test/clickhouse_tool.test.ts
cd /home/bjw/checkpoint
python3 -m pytest tests/smoke/test_clickhouse_schema.py -v
```

Expected: FAIL because `ClickHouseTool` still queries `query_events`, the supported table list omits `query_intervals`, and the smoke test only expects the old two-table schema.

- [ ] **Step 3: Write the minimal consumer/test fixture updates**

```ts
function buildWindowedQuery(request: ScopeRequest): string {
  return [
    "SELECT",
    "  fingerprint,",
    "  tupleElement(argMax((source_file, sample_query), interval_ended_at), 1) AS source_file,",
    "  tupleElement(argMax((source_file, sample_query), interval_ended_at), 2) AS sample_query,",
    "  sum(total_exec_count) AS total_exec_count,",
    "  round(sum(delta_exec_time_ms), 2) AS total_exec_time_ms,",
    "  round(quantile(0.95)(delta_exec_time_ms), 2) AS p95_exec_time_ms",
    "FROM query_intervals",
    `WHERE interval_ended_at > now() - INTERVAL ${request.timeWindowMinutes} MINUTE`,
    `  AND interval_duration_ms <= ${request.timeWindowMinutes * 60 * 1000}`,
    "GROUP BY fingerprint",
    "ORDER BY total_exec_time_ms DESC",
    "LIMIT 5",
    "FORMAT TSVWithNames",
  ].join("\n");
}

const SUPPORTED_TABLES = new Set(["query_events", "query_intervals", "query_fingerprints"]);
```

- [ ] **Step 4: Run the checkpoint-focused tests to verify they pass**

Run:

```bash
cd /home/bjw/checkpoint
node --import tsx --test test/tools/clickhouse_tool.test.ts
cd /home/bjw/checkpoint/agent
node --import tsx --test test/clickhouse_tool.test.ts
cd /home/bjw/checkpoint
python3 -m pytest tests/smoke/test_clickhouse_schema.py -v
```

Expected: PASS with recent findings sourced from `query_intervals` and the smoke test proving the booted schema exposes all four tables.

- [ ] **Step 5: Commit**

```bash
cd /home/bjw/checkpoint
git add src/tools/clickhouse_tool.ts test/tools/clickhouse_tool.test.ts agent/test/clickhouse_tool.test.ts scripts/validate.sh tests/smoke/test_clickhouse_schema.py
git commit -m "feat: consume reset-aware clickhouse interval findings"
```

### Task 6: Run Full Cross-Repo Verification And Record The Outcome

**Files:**
- Modify: `JOURNAL.md`

- [ ] **Step 1: Write the failing verification note first**

```md
- 2026-04-09: The counter-model redesign is not complete until both repos pass:
  collector Ruby tests, checkpoint root and agent ClickHouse tests, checkpoint smoke tests,
  and a compose-level ClickHouse boot check exposing `query_events`, `collector_state`,
  `query_intervals`, and `query_fingerprints`.
```

- [ ] **Step 2: Run the full verification suite before recording success**

Run:

```bash
cd /home/bjw/checkpoint-collector/collector
bundle exec ruby -Itest test/collector_test.rb test/clickhouse_connection_test.rb test/query_comment_parser_test.rb test/sample_query_lookup_test.rb test/sql/clickhouse_schema_test.rb test/compose_stack_test.rb

cd /home/bjw/checkpoint
node --import tsx --test test/tools/clickhouse_tool.test.ts test/extensions/db_specialist.test.ts test/a2a_bridge/session_registry.test.ts test/a2a_bridge/server.test.ts

cd /home/bjw/checkpoint/agent
npm test

cd /home/bjw/checkpoint
python3 -m pytest tests/ -v
```

Expected: PASS across both repos. If any suite fails, stop and fix the root cause before changing `JOURNAL.md`.

- [ ] **Step 3: Record the passing outcome**

```md
- 2026-04-09: Completed the `pg_stat_statements` counter-model redesign across `checkpoint-collector`
  and `checkpoint`. The collector now stores cumulative statement snapshots plus
  `pg_stat_statements_info` snapshots, ClickHouse derives reset-aware query intervals with a
  freshness cap, and checkpoint still consumes the same findings shape while reading recent
  rankings from `query_intervals`.
```

- [ ] **Step 4: Re-run a minimal smoke check after journaling**

Run: `cd /home/bjw/checkpoint && python3 -m pytest tests/smoke/test_clickhouse_schema.py -v`

Expected: PASS, proving the final journal-only change did not disturb the working tree.

- [ ] **Step 5: Commit**

```bash
cd /home/bjw/checkpoint
git add JOURNAL.md
git commit -m "docs: record counter-model redesign verification"
```

## Self-Review Checklist

- Spec coverage:
  - raw counter snapshots: Task 1
  - `collector_state`: Tasks 1 and 2
  - delta/read-model redesign: Tasks 2 and 3
  - freshness cap and reset handling: Tasks 3 and 5
  - checkpoint contract stability: Task 5
  - cross-repo verification: Task 6
- Placeholder scan:
  - no `TODO`, `TBD`, or “similar to Task N” shortcuts are left in the task steps.
- Type consistency:
  - raw rows use `total_exec_time_ms`
  - interval rows use `delta_exec_time_ms`
  - checkpoint findings still expose `total_exec_count`, `total_exec_time_ms`, and `p95_exec_time_ms`
