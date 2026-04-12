# Implementor Instructions: Counter Redesign Eng Review Fixes

Three fixes from the 2026-04-10 eng review of the pg_stat_statements counter redesign.

---

## Fix 1: query_events ORDER BY — add full row identity

**What:** Change the ORDER BY in `query_events` to include the full Postgres row identity.

**Why:** The spec defines the row key as `(dbid, userid, toplevel, queryid)`. The current
`ORDER BY (fingerprint, collected_at)` omits `(dbid, userid, toplevel)`. In a multi-user
or multi-database setup, different statement identities with the same queryid interleave
in storage, hurting window function read locality.

**Files to change:** Both files must stay in sync.

### `collector/db/clickhouse/001_query_events.sql`

Change:
```sql
) ENGINE = MergeTree
ORDER BY (fingerprint, collected_at);
```

To:
```sql
) ENGINE = MergeTree
ORDER BY (dbid, userid, toplevel, queryid, collected_at);
```

### `collector/db/clickhouse/004_reset_query_analytics.sql`

Apply the same ORDER BY change to the `CREATE TABLE query_events` block inside the reset script.

**Test:** `clickhouse_schema_test.rb` already asserts that `query_events` stores the
identity columns. Add one assertion to verify the ORDER BY:

In `test_query_events_store_snapshot_identity_and_counter_columns`:
```ruby
assert_match(/ORDER BY \(dbid, userid, toplevel, queryid, collected_at\)/, sql)
```

Also add this assertion for the reset SQL (in `test_reset_sql_matches_query_events_definition`,
the exact-match assertion already handles this if the canonical SQL matches).

---

## Fix 2: Remove stale TODO from TODOS.md

**What:** Delete the entry titled "ClickHouse time window: query query_events directly".

**Why:** The redesign now queries `query_intervals` with time window filters in
`buildWindowedQuery`. The TODO described querying `query_events` directly — that was
the right fix for the old AggregatingMergeTree schema. It's now obsolete and actively
misleading.

**File:** `/home/bjw/checkpoint/TODOS.md`

Delete the entire block from `## ClickHouse time window: query query_events directly`
through the closing `---` separator.

---

## Fix 3: Interval view correctness tests (critical)

**What:** Add three ClickHouse integration tests verifying the `query_intervals` view
filters correctly. These are the three filtering paths the spec required and that have
no execution coverage.

**Why:** The WHERE clause in `003_query_intervals.sql` is the entire correctness
mechanism of the redesign. The current `clickhouse_schema_test.rb` only checks that
the WHERE clause exists as text. None of the three filtering behaviors are exercised
against a running ClickHouse instance.

**Approach:** Add a new test file `collector/test/sql/clickhouse_interval_view_test.rb`.
Use the existing Docker-based ClickHouse (`checkpoint-clickhouse:local`) the same way
the Python smoke test does it, OR run directly against the compose ClickHouse.

The test pattern mirrors the existing `ClickhouseConnectionTest` style but extends it
to exercise the view. Since the test needs a running ClickHouse, mark it as an
integration test with a guard:

```ruby
# ABOUTME: Verifies query_intervals view correctness against a live ClickHouse instance.
# ABOUTME: Guards the three interval filter behaviors: baseline, reset, counter regression.
require "minitest/autorun"
require_relative "../../lib/clickhouse_connection"

class ClickhouseIntervalViewTest < Minitest::Test
  CLICKHOUSE_URL = (ENV["CLICKHOUSE_URL"] || "http://localhost:8123").freeze

  def setup
    skip "CLICKHOUSE_URL not reachable" unless clickhouse_alive?
    exec_sql("DROP TABLE IF EXISTS query_events")
    exec_sql("DROP TABLE IF EXISTS collector_state")
    exec_sql("DROP VIEW IF EXISTS query_intervals")
    exec_sql(File.read(sql_path("001_query_events.sql")).sub(/^--.*\n--.*\n/, ""))
    exec_sql(File.read(sql_path("002_collector_state.sql")).sub(/^--.*\n--.*\n/, ""))
    exec_sql(File.read(sql_path("003_query_intervals.sql")).sub(/^--.*\n--.*\n/, ""))
  end

  def teardown
    exec_sql("DROP VIEW IF EXISTS query_intervals")
    exec_sql("DROP TABLE IF EXISTS collector_state")
    exec_sql("DROP TABLE IF EXISTS query_events")
  end

  def test_first_snapshot_emits_no_interval_row
    # First observation for a statement key: baseline-only, no delta
    insert_event(queryid: "q1", collected_at: "2026-04-10 12:00:00.000",
                 total_exec_count: 10, total_exec_time_ms: 100.0)
    insert_state(collected_at: "2026-04-10 12:00:00.000", stats_reset: "2026-04-10 11:00:00")

    rows = query_intervals
    assert_equal 0, rows.length, "First snapshot should produce no interval row"
  end

  def test_second_snapshot_emits_delta_interval_row
    # Two consecutive snapshots: second should produce a valid interval delta
    insert_event(queryid: "q1", collected_at: "2026-04-10 12:00:00.000",
                 total_exec_count: 10, total_exec_time_ms: 100.0)
    insert_event(queryid: "q1", collected_at: "2026-04-10 12:05:00.000",
                 total_exec_count: 15, total_exec_time_ms: 150.0)
    insert_state(collected_at: "2026-04-10 12:00:00.000", stats_reset: "2026-04-10 11:00:00")
    insert_state(collected_at: "2026-04-10 12:05:00.000", stats_reset: "2026-04-10 11:00:00")

    rows = query_intervals
    assert_equal 1, rows.length
    assert_equal "5", rows.first["total_exec_count"]
  end

  def test_stats_reset_change_emits_no_interval_row
    # When stats_reset changes between snapshots, no interval is emitted
    insert_event(queryid: "q1", collected_at: "2026-04-10 12:00:00.000",
                 total_exec_count: 10, total_exec_time_ms: 100.0)
    insert_event(queryid: "q1", collected_at: "2026-04-10 12:05:00.000",
                 total_exec_count: 3, total_exec_time_ms: 30.0)
    insert_state(collected_at: "2026-04-10 12:00:00.000", stats_reset: "2026-04-10 11:00:00")
    insert_state(collected_at: "2026-04-10 12:05:00.000", stats_reset: "2026-04-10 12:04:00")

    rows = query_intervals
    assert_equal 0, rows.length, "stats_reset change should produce no interval row"
  end

  def test_counter_regression_emits_no_interval_row
    # When total_exec_count moves backward, no interval is emitted
    insert_event(queryid: "q1", collected_at: "2026-04-10 12:00:00.000",
                 total_exec_count: 10, total_exec_time_ms: 100.0)
    insert_event(queryid: "q1", collected_at: "2026-04-10 12:05:00.000",
                 total_exec_count: 5, total_exec_time_ms: 50.0)
    insert_state(collected_at: "2026-04-10 12:00:00.000", stats_reset: "2026-04-10 11:00:00")
    insert_state(collected_at: "2026-04-10 12:05:00.000", stats_reset: "2026-04-10 11:00:00")

    rows = query_intervals
    assert_equal 0, rows.length, "Counter regression should produce no interval row"
  end

  private

  def insert_event(queryid:, collected_at:, total_exec_count:, total_exec_time_ms:, dbid: 1, userid: 1, toplevel: true)
    exec_sql(<<~SQL)
      INSERT INTO query_events (collected_at, dbid, userid, toplevel, queryid, fingerprint,
        total_exec_count, total_exec_time_ms, rows_returned_or_affected,
        shared_blks_hit, shared_blks_read, local_blks_hit, local_blks_read,
        temp_blks_read, temp_blks_written, total_block_accesses,
        min_exec_time_ms, max_exec_time_ms, mean_exec_time_ms, stddev_exec_time_ms)
      VALUES ('#{collected_at}', #{dbid}, #{userid}, #{toplevel}, '#{queryid}', '#{queryid}',
              #{total_exec_count}, #{total_exec_time_ms}, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    SQL
  end

  def insert_state(collected_at:, stats_reset:, dealloc: 0)
    exec_sql(<<~SQL)
      INSERT INTO collector_state (collected_at, dealloc, stats_reset)
      VALUES ('#{collected_at}', #{dealloc}, '#{stats_reset}')
    SQL
  end

  def query_intervals
    result = Net::HTTP.get(URI("#{CLICKHOUSE_URL}/?query=#{URI.encode_www_form_component("SELECT * FROM query_intervals FORMAT JSONEachRow")}"))
    result.strip.split("\n").reject(&:empty?).map { |line| JSON.parse(line) }
  end

  def exec_sql(sql)
    uri = URI(CLICKHOUSE_URL)
    Net::HTTP.post(uri, sql)
  end

  def clickhouse_alive?
    Net::HTTP.get(URI("#{CLICKHOUSE_URL}/?query=SELECT+1"))
    true
  rescue
    false
  end

  def sql_path(name)
    File.expand_path("../../db/clickhouse/#{name}", __dir__)
  end
end
```

**Run condition:** These tests require `CLICKHOUSE_URL` to be set and reachable. The
compose stack provides this. Gate them with an environment check as shown above.

**Wire into the test run:** The existing test runner in `bin/collector` doesn't run
integration tests. Either:
- Document in README that `CLICKHOUSE_URL=http://localhost:8123 bundle exec ruby ...` is needed
- Or add to the compose-level smoke test suite alongside the Python test

The simplest path: add a note to the test file that it requires `docker compose up clickhouse`
first, and verify it manually during the compose-level QA step.

---

## Verification

After all three fixes, run:

```bash
# Collector repo
cd /home/bjw/checkpoint-collector/collector
bundle exec ruby -Itest -Ilib test/collector_test.rb
bundle exec ruby -Itest -Ilib test/compose_stack_test.rb
bundle exec ruby -Itest -Ilib test/sql/clickhouse_schema_test.rb

# Integration tests (requires running stack)
cd /home/bjw/checkpoint-collector
docker compose up -d --build
CLICKHOUSE_URL=http://localhost:8123 bundle exec ruby -Itest -Ilib test/sql/clickhouse_interval_view_test.rb

# Checkpoint repo
cd /home/bjw/checkpoint
npm test
cd agent && npm test
python3 -m pytest tests/
```

All suites must be green before the branch is considered ready.
