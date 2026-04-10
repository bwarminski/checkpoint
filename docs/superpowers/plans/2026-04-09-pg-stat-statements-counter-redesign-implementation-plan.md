# pg_stat_statements Counter Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the collector pipeline around cumulative `pg_stat_statements` snapshots, use reset-aware read-time interval queries in ClickHouse, and keep the checkpoint agent's findings contract unchanged.

**Architecture:** The collector stays stateless and writes raw statement snapshots plus `pg_stat_statements_info` snapshots into ClickHouse. ClickHouse computes reset-aware interval deltas at query time from raw snapshots instead of maintaining a live `AggregatingMergeTree` rollup in this slice. Checkpoint fixture, smoke, and tool-query code are updated to consume the raw/state/interval layout without changing the agent-facing result schema.

**Tech Stack:** Ruby, Minitest, ClickHouse SQL/views, TypeScript with `tsx`, Python `pytest`, Docker Compose

---

## File Map

### `/home/bjw/checkpoint-collector`

- Modify: `collector/lib/collector.rb`
  Reads widened `pg_stat_statements` counters, reads `pg_stat_statements_info`, and inserts raw snapshots into `query_events` and `collector_state`.
- Modify: `collector/test/collector_test.rb`
  Pins the widened SQL contract, raw payload shape, and state snapshot behavior.
- Modify: `collector/test/sql/clickhouse_schema_test.rb`
  Pins the raw/state/interval schema contracts and executable DDL expectations.
- Modify: `collector/test/compose_stack_test.rb`
  Guards the runtime-visible table set and reset SQL contract.
- Modify: `collector/db/clickhouse/001_query_events.sql`
  Defines the raw cumulative statement snapshot table.
- Create: `collector/db/clickhouse/002_collector_state.sql`
  Defines the raw `pg_stat_statements_info` snapshot table.
- Create: `collector/db/clickhouse/003_query_intervals.sql`
  Defines the read-time interval view over raw snapshots.
- Create: `collector/db/clickhouse/004_reset_query_analytics.sql`
  Rebuilds the raw/state/interval objects during destructive reset.
- Delete: `collector/db/clickhouse/002_query_fingerprints.sql`
  Removes the stale live aggregate table definition.
- Delete: `collector/db/clickhouse/003_top_offenders_mv.sql`
  Removes the stale live aggregate materialized view.
- Delete: `collector/db/clickhouse/004_reset_query_fingerprints.sql`
  Removes the stale aggregate-only reset script.

### `/home/bjw/checkpoint`

- Modify: `src/tools/clickhouse_tool.ts`
  Reads recent and all-time findings directly from `query_intervals` with a freshness cap.
- Modify: `test/tools/clickhouse_tool.test.ts`
  Pins the root-package query shape and supported-table list.
- Modify: `agent/test/clickhouse_tool.test.ts`
  Pins the agent package query shape and supported-table list.
- Modify: `scripts/validate.sh`
  Seeds the raw/state/interval tables for manual validation.
- Modify: `tests/smoke/test_clickhouse_schema.py`
  Proves the booted ClickHouse image exposes the raw/state/interval tables.
- Modify: `JOURNAL.md`
  Records the redesign outcome and the architectural correction.

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

def test_inserts_collector_state_when_info_row_exists_without_stats_rows
  stats_connection = StatsConnection.new(stats_rows: [], info_rows: [{ "dealloc" => "4", "stats_reset" => "2026-04-09 12:10:00+00" }])
  clickhouse_connection = RecordingClickhouseConnection.new
  collector = Collector.new(
    stats_connection: stats_connection,
    clickhouse_connection: clickhouse_connection,
    clock: -> { Time.utc(2026, 4, 9, 12, 15, 0) }
  )

  assert_equal [], collector.run_once
  assert_equal [["collector_state", [{ collected_at: Time.utc(2026, 4, 9, 12, 15, 0), dealloc: 4, stats_reset: "2026-04-09 12:10:00+00" }]]], clickhouse_connection.inserts
end
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /home/bjw/checkpoint-collector/collector && bundle exec ruby -Itest test/collector_test.rb`

Expected: FAIL because `Collector` does not yet define `INFO_SQL`, does not request the widened fields, and does not insert `collector_state`.

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
end
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /home/bjw/checkpoint-collector/collector && bundle exec ruby -Itest test/collector_test.rb`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/bjw/checkpoint-collector
git add collector/lib/collector.rb collector/test/collector_test.rb
git commit -m "feat: collect pg stat statement counter snapshots"
```

### Task 2: Replace The ClickHouse Schema With Raw, State, And Interval Layers

**Files:**
- Modify: `collector/test/sql/clickhouse_schema_test.rb`
- Modify: `collector/db/clickhouse/001_query_events.sql`
- Create: `collector/db/clickhouse/002_collector_state.sql`
- Create: `collector/db/clickhouse/003_query_intervals.sql`
- Create: `collector/db/clickhouse/004_reset_query_analytics.sql`
- Delete: `collector/db/clickhouse/002_query_fingerprints.sql`
- Delete: `collector/db/clickhouse/003_top_offenders_mv.sql`
- Delete: `collector/db/clickhouse/004_reset_query_fingerprints.sql`

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

def test_query_intervals_is_a_view_over_raw_snapshots
  sql = read_sql("003_query_intervals.sql")

  assert_match(/CREATE VIEW query_intervals AS/, sql)
  assert_includes sql, "interval_started_at"
  assert_includes sql, "interval_ended_at"
  assert_includes sql, "interval_duration_ms"
  assert_includes sql, "lagInFrame(total_exec_count)"
end

def test_reset_sql_rebuilds_raw_state_and_interval_objects
  sql = read_sql("004_reset_query_analytics.sql")

  assert_includes sql, "DROP VIEW IF EXISTS query_intervals"
  assert_includes sql, "DROP TABLE IF EXISTS collector_state"
  assert_includes sql, "DROP TABLE IF EXISTS query_events"
  assert_includes sql, "CREATE TABLE query_events"
  assert_includes sql, "CREATE TABLE collector_state"
  assert_includes sql, "CREATE VIEW query_intervals"
end
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /home/bjw/checkpoint-collector/collector && bundle exec ruby -Itest test/sql/clickhouse_schema_test.rb`

Expected: FAIL because the new files do not exist and the old aggregate-layer schema is still present.

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
```

- [ ] **Step 4: Run the schema tests to verify they pass**

Run: `cd /home/bjw/checkpoint-collector/collector && bundle exec ruby -Itest test/sql/clickhouse_schema_test.rb`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/bjw/checkpoint-collector
git add collector/test/sql/clickhouse_schema_test.rb collector/db/clickhouse
git commit -m "feat: add read-time clickhouse interval schema"
```

### Task 3: Make The Interval Layer Reset-Aware And ClickHouse-24.3-Compatible

**Files:**
- Modify: `collector/test/sql/clickhouse_schema_test.rb`
- Modify: `collector/db/clickhouse/003_query_intervals.sql`
- Modify: `collector/db/clickhouse/004_reset_query_analytics.sql`
- Modify: `collector/test/collector_test.rb`
- Modify: `collector/lib/collector.rb`

- [ ] **Step 1: Write the failing tests**

```ruby
def test_query_intervals_casts_delta_columns_to_clickhouse_24_compatible_types
  sql = read_sql("003_query_intervals.sql")

  assert_includes sql, "CAST(total_exec_time_ms - previous_total_exec_time_ms AS Float64)"
  assert_includes sql, "CAST(shared_blks_hit - previous_shared_blks_hit AS Int64)"
end

def test_query_events_store_exec_shape_columns_emitted_by_collector
  stats_connection = StatsConnection.new(
    stats_rows: [{ "queryid" => "42", "calls" => "7", "total_exec_time" => "10.0", "min_exec_time" => "1.0", "max_exec_time" => "4.0", "mean_exec_time" => "2.0", "stddev_exec_time" => "0.5" }],
    info_rows: []
  )
  row = Collector.new(stats_connection: stats_connection, clock: -> { Time.utc(2026, 4, 9, 12, 0, 0) }).run_once.first

  assert_equal 1.0, row[:min_exec_time_ms]
  assert_equal 4.0, row[:max_exec_time_ms]
  assert_equal 0.5, row[:stddev_exec_time_ms]
end
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd /home/bjw/checkpoint-collector/collector
bundle exec ruby -Itest test/collector_test.rb test/sql/clickhouse_schema_test.rb
```

Expected: FAIL because the current interval SQL still mixes signed and unsigned types and the collector does not yet emit all exec-shape columns.

- [ ] **Step 3: Write the minimal implementation**

```sql
CREATE VIEW query_intervals AS
WITH interval_candidates AS (
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
    e.min_exec_time_ms,
    e.max_exec_time_ms,
    e.mean_exec_time_ms,
    e.stddev_exec_time_ms,
    s.stats_reset,
    lagInFrame(e.collected_at) OVER statement_window AS previous_collected_at,
    lagInFrame(e.total_exec_count) OVER statement_window AS previous_total_exec_count,
    lagInFrame(e.total_exec_time_ms) OVER statement_window AS previous_total_exec_time_ms,
    lagInFrame(e.rows_returned_or_affected) OVER statement_window AS previous_rows_returned_or_affected,
    lagInFrame(e.shared_blks_hit) OVER statement_window AS previous_shared_blks_hit,
    lagInFrame(e.shared_blks_read) OVER statement_window AS previous_shared_blks_read,
    lagInFrame(e.local_blks_hit) OVER statement_window AS previous_local_blks_hit,
    lagInFrame(e.local_blks_read) OVER statement_window AS previous_local_blks_read,
    lagInFrame(e.temp_blks_read) OVER statement_window AS previous_temp_blks_read,
    lagInFrame(e.temp_blks_written) OVER statement_window AS previous_temp_blks_written,
    lagInFrame(e.total_block_accesses) OVER statement_window AS previous_total_block_accesses,
    lagInFrame(s.stats_reset) OVER statement_window AS previous_stats_reset
  FROM query_events AS e
  LEFT JOIN collector_state AS s USING (collected_at)
  WINDOW statement_window AS (PARTITION BY e.dbid, e.userid, e.toplevel, e.queryid ORDER BY e.collected_at)
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
  CAST(total_exec_time_ms - previous_total_exec_time_ms AS Float64) AS delta_exec_time_ms,
  CAST(rows_returned_or_affected - previous_rows_returned_or_affected AS Int64) AS rows_returned_or_affected,
  CAST(shared_blks_hit - previous_shared_blks_hit AS Int64) AS shared_blks_hit,
  CAST(shared_blks_read - previous_shared_blks_read AS Int64) AS shared_blks_read,
  CAST(local_blks_hit - previous_local_blks_hit AS Int64) AS local_blks_hit,
  CAST(local_blks_read - previous_local_blks_read AS Int64) AS local_blks_read,
  CAST(temp_blks_read - previous_temp_blks_read AS Int64) AS temp_blks_read,
  CAST(temp_blks_written - previous_temp_blks_written AS Int64) AS temp_blks_written,
  CAST(total_block_accesses - previous_total_block_accesses AS Int64) AS total_block_accesses,
  min_exec_time_ms,
  max_exec_time_ms,
  mean_exec_time_ms,
  stddev_exec_time_ms
FROM interval_candidates
WHERE previous_collected_at IS NOT NULL
  AND stats_reset = previous_stats_reset
  AND total_exec_count >= previous_total_exec_count
  AND total_exec_time_ms >= previous_total_exec_time_ms;
```

```ruby
{
  min_exec_time_ms: stats_row.fetch("min_exec_time", 0).to_f,
  max_exec_time_ms: stats_row.fetch("max_exec_time", 0).to_f,
  mean_exec_time_ms: stats_row.fetch("mean_exec_time", 0).to_f,
  stddev_exec_time_ms: stats_row.fetch("stddev_exec_time", 0).to_f,
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
cd /home/bjw/checkpoint-collector/collector
bundle exec ruby -Itest test/collector_test.rb test/sql/clickhouse_schema_test.rb
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/bjw/checkpoint-collector
git add collector/lib/collector.rb collector/test/collector_test.rb collector/test/sql/clickhouse_schema_test.rb collector/db/clickhouse/003_query_intervals.sql collector/db/clickhouse/004_reset_query_analytics.sql
git commit -m "feat: add clickhouse-compatible reset-aware interval view"
```

### Task 4: Verify The Collector Runtime Against The New Schema

**Files:**
- Modify: `collector/test/compose_stack_test.rb`

- [ ] **Step 1: Write the failing tests**

```ruby
def test_clickhouse_bootstrap_mentions_interval_and_state_tables
  sql_files = Dir[File.expand_path("../../db/clickhouse/*.sql", __dir__)].map { |path| File.basename(path) }

  assert_includes sql_files, "002_collector_state.sql"
  assert_includes sql_files, "003_query_intervals.sql"
  assert_includes sql_files, "004_reset_query_analytics.sql"
  refute_includes sql_files, "002_query_fingerprints.sql"
  refute_includes sql_files, "003_top_offenders_mv.sql"
  refute_includes sql_files, "004_reset_query_fingerprints.sql"
end
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /home/bjw/checkpoint-collector/collector && bundle exec ruby -Itest test/compose_stack_test.rb`

Expected: FAIL until the DDL set matches the corrected raw/state/interval layout.

- [ ] **Step 3: Make the minimal test/runtime updates**

```ruby
def test_compose_stack_schema_contract_mentions_collector_state_and_query_intervals
  reset_sql = File.read(File.expand_path("../db/clickhouse/004_reset_query_analytics.sql", __dir__))

  assert_includes reset_sql, "collector_state"
  assert_includes reset_sql, "query_intervals"
end
```

- [ ] **Step 4: Run the collector repo verification**

Run:

```bash
cd /home/bjw/checkpoint-collector/collector
bundle exec ruby -Itest test/collector_test.rb test/sql/clickhouse_schema_test.rb test/compose_stack_test.rb
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/bjw/checkpoint-collector
git add collector/test/compose_stack_test.rb
git commit -m "test: verify collector runtime against interval schema"
```

### Task 5: Pin The Checkpoint Consumer Changes

**Files:**
- Modify: `src/tools/clickhouse_tool.ts`
- Modify: `test/tools/clickhouse_tool.test.ts`
- Modify: `agent/test/clickhouse_tool.test.ts`
- Modify: `scripts/validate.sh`
- Modify: `tests/smoke/test_clickhouse_schema.py`

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
    ...
    assert "query_events" in tables
    assert "collector_state" in tables
    assert "query_intervals" in tables
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

Expected: FAIL because the tool and smoke tests still assume the older aggregate-layer contract.

- [ ] **Step 3: Write the minimal implementation**

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
  ].join(\"\\n\");
}

const SUPPORTED_TABLES = new Set([\"query_events\", \"collector_state\", \"query_intervals\"]);
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

Expected: PASS with recent and all-time findings sourced from `query_intervals`.

- [ ] **Step 5: Commit**

```bash
cd /home/bjw/checkpoint
git add src/tools/clickhouse_tool.ts test/tools/clickhouse_tool.test.ts agent/test/clickhouse_tool.test.ts scripts/validate.sh tests/smoke/test_clickhouse_schema.py
git commit -m "feat: consume read-time clickhouse interval findings"
```

### Task 6: Run Full Cross-Repo Verification And Record The Outcome

**Files:**
- Modify: `JOURNAL.md`

- [ ] **Step 1: Run the full verification suite before recording success**

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

- [ ] **Step 2: Record the passing outcome**

```md
- 2026-04-09: Completed the `pg_stat_statements` counter-model redesign across `checkpoint-collector`
  and `checkpoint`. The collector now stores cumulative statement snapshots plus
  `pg_stat_statements_info` snapshots, ClickHouse derives reset-aware query intervals at
  read time with a freshness cap, and checkpoint still consumes the same findings shape
  while reading rankings from `query_intervals`.
```

- [ ] **Step 3: Re-run a minimal smoke check after journaling**

Run: `cd /home/bjw/checkpoint && python3 -m pytest tests/smoke/test_clickhouse_schema.py -v`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /home/bjw/checkpoint
git add JOURNAL.md
git commit -m "docs: record counter-model redesign verification"
```

## Self-Review Checklist

- Spec coverage:
  - raw counter snapshots: Task 1
  - `collector_state`: Tasks 1 and 2
  - interval-layer redesign: Tasks 2 and 3
  - freshness cap and reset handling: Tasks 3 and 5
  - checkpoint contract stability: Task 5
  - cross-repo verification: Task 6
- Placeholder scan:
  - no `TODO`, `TBD`, or “similar to Task N” shortcuts are left in the task steps.
- Type consistency:
  - raw rows use `total_exec_time_ms`
  - interval rows use `delta_exec_time_ms`
  - checkpoint findings still expose `total_exec_count`, `total_exec_time_ms`, and `p95_exec_time_ms`
