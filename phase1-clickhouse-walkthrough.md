# Checkpoint ClickHouse Pipeline Walkthrough

*2026-04-10T12:24:46Z by Showboat 0.6.1*
<!-- showboat-id: 69b21b14-69b6-4db0-b177-22cebed344b7 -->

## Overview

This walkthrough traces how query performance data flows from a live Postgres instance into ClickHouse and surfaces as ranked findings for the DB specialist agent. The pipeline has three layers: a Ruby collector that polls Postgres, two ClickHouse storage tables, and a VIEW that derives per-interval deltas for the agent to query.

The core design challenge: Postgres `pg_stat_statements` reports *cumulative* counters (calls, total time, block hits, etc.) since the last stats reset. To answer "what queries were slowest in the last hour?" we need deltas — changes between consecutive snapshots — not raw totals. The pipeline stores raw snapshots and derives deltas at query time inside ClickHouse.

## 1. The Postgres Source

`pg_stat_statements` tracks execution statistics for every normalized query. Each row identifies a query by `queryid` (a hash of the normalized text) plus `dbid`, `userid`, and `toplevel`. All timing and counter columns are cumulative since the last `pg_stat_statements_reset()` call.

The companion view `pg_stat_statements_info` has a single row recording when the counters were last reset (`stats_reset`) and how many statements were evicted due to the shared memory budget (`dealloc`). The collector reads both on every poll cycle.

## 2. The Collector Entry Point

The `bin/collector` script is the only executable. It wires up three dependencies and calls `run_once`. In production it is invoked on a schedule (cron or a loop); each invocation is a single snapshot pass.

```bash
cat /home/bjw/checkpoint-collector/collector/bin/collector
```

```output
#!/usr/bin/env ruby
# ABOUTME: Provides the executable entry point for the Postgres stats collector.
# ABOUTME: Connects the collector to Postgres and ClickHouse for one polling pass.
require_relative "../lib/collector"
require_relative "../lib/clickhouse_connection"
require_relative "../lib/sample_query_lookup"
require "pg"

stats_connection = PG.connect(ENV.fetch("POSTGRES_URL"))
clickhouse_connection = ClickhouseConnection.new(base_url: ENV.fetch("CLICKHOUSE_URL"))
sample_query_lookup = SampleQueryLookup.new(stats_connection)

Collector.new(
  stats_connection: stats_connection,
  clickhouse_connection: clickhouse_connection,
  sample_query_lookup: sample_query_lookup
).run_once
```

Three dependencies:
- `stats_connection` — a PG connection used for both `pg_stat_statements` queries and live SQL sampling
- `clickhouse_connection` — HTTP client that inserts rows via JSONEachRow
- `sample_query_lookup` — uses the same PG connection to grab representative SQL text from `pg_stat_activity`

`POSTGRES_URL` and `CLICKHOUSE_URL` are the only runtime requirements.

## 3. The Collector's SQL Queries

`Collector` opens with two frozen SQL constants. `STATS_SQL` pulls every column we store from `pg_stat_statements`. `INFO_SQL` grabs the global reset metadata.

```bash
sed -n '/STATS_SQL/,/INFO_SQL.*freeze/p' /home/bjw/checkpoint-collector/collector/lib/collector.rb | head -35
```

```output
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
    stats_rows = Array(@stats_connection.exec(STATS_SQL))
    info_row = Array(@stats_connection.exec(INFO_SQL)).first
    if stats_rows.empty?
      if info_row
        collected_at = @clock.call
        @clickhouse_connection&.insert("collector_state", [build_state_row(info_row, collected_at)])
      end
      return []
    end

    collected_at = @clock.call
    rows = stats_rows.map do |stats_row|
      build_row(stats_row, collected_at)
```

Notice that `STATS_SQL` selects `calls` and `rows` (Postgres column names) while the ClickHouse table uses `total_exec_count` and `rows_returned_or_affected`. The renaming happens in `build_row` — more on that below.

Also worth noting: `INFO_SQL` is always executed, even when there are no stat rows. If pg_stat_statements is empty but the info row exists (for example, right after a `pg_stat_statements_reset()`), the collector still records a state snapshot so the interval view can detect the reset.

## 4. The run_once Loop and Row Building

`run_once` is the core of the collector. It issues both SQL queries, maps each stats row into a ClickHouse-shaped hash, and inserts two tables in one pass.

```bash
sed -n '/def run_once/,/^  end$/p' /home/bjw/checkpoint-collector/collector/lib/collector.rb | head -25
```

```output
  def run_once
    return [] unless @stats_connection

    stats_rows = Array(@stats_connection.exec(STATS_SQL))
    info_row = Array(@stats_connection.exec(INFO_SQL)).first
    if stats_rows.empty?
      if info_row
        collected_at = @clock.call
        @clickhouse_connection&.insert("collector_state", [build_state_row(info_row, collected_at)])
      end
      return []
    end

    collected_at = @clock.call
    rows = stats_rows.map do |stats_row|
      build_row(stats_row, collected_at)
    end

    @clickhouse_connection&.insert("query_events", rows)
    @clickhouse_connection&.insert("collector_state", [build_state_row(info_row, collected_at)]) if info_row
    rows
  end
```

The `collected_at` timestamp is captured once for the entire batch, so every row in a single poll pass shares the same timestamp. This is intentional: the interval view joins `query_events` to `collector_state` on `collected_at`, and that join only works when both tables have the exact same value.

Now let's look at `build_row` — the place where Postgres column names get translated and enrichment happens.

```bash
sed -n '/def build_row/,/^  end$/p' /home/bjw/checkpoint-collector/collector/lib/collector.rb
```

```output
  def build_row(stats_row, collected_at)
    queryid = stats_row.fetch("queryid").to_s
    sample_query = @sample_query_lookup&.find_for(queryid)
    parsed = QueryCommentParser.parse(extract_comment(sample_query))

    {
      collected_at: collected_at,
      dbid: stats_row.fetch("dbid", 0).to_i,
      userid: stats_row.fetch("userid", 0).to_i,
      toplevel: toplevel_value(stats_row.fetch("toplevel", nil)),
      queryid: queryid,
      fingerprint: queryid,
      source_file: presence(parsed[:source_file]),
      sample_query: sample_query,
      total_exec_count: stats_row.fetch("calls").to_i,
      total_exec_time_ms: stats_row.fetch("total_exec_time", 0).to_f,
      min_exec_time_ms: stats_row.fetch("min_exec_time", 0).to_f,
      max_exec_time_ms: stats_row.fetch("max_exec_time", 0).to_f,
      mean_exec_time_ms: stats_row.fetch("mean_exec_time").to_f,
      stddev_exec_time_ms: stats_row.fetch("stddev_exec_time", 0).to_f,
      # pg_stat_statements.rows reports rows returned or affected, not rows visited.
      rows_returned_or_affected: stats_row.fetch("rows", 0).to_i,
      shared_blks_hit: stat_value(stats_row, "shared_blks_hit"),
      shared_blks_read: stat_value(stats_row, "shared_blks_read"),
      local_blks_hit: stat_value(stats_row, "local_blks_hit"),
      local_blks_read: stat_value(stats_row, "local_blks_read"),
      temp_blks_read: stat_value(stats_row, "temp_blks_read"),
      temp_blks_written: stat_value(stats_row, "temp_blks_written"),
      total_block_accesses: total_block_accesses(stats_row)
    }
  end
```

Key translations in `build_row`:

- `calls` → `total_exec_count` (Postgres naming differs from the schema)
- `rows` → `rows_returned_or_affected` (the Postgres column name is ambiguous; this name makes the semantics explicit)
- `fingerprint` is set to `queryid` — at this stage they are the same value; the column exists as a hook for future normalization
- `total_block_accesses` is computed by summing all six block counter columns
- `source_file` comes from parsing SQL comment metadata, not from Postgres itself

The `sample_query_lookup&.find_for(queryid)` call is the live SQL capture step.

## 5. Capturing Live SQL and Source Locations

`SampleQueryLookup` queries `pg_stat_activity` for a live query that has the same `query_id` as the stats row. This is a best-effort sampling — if no session is currently executing the query, `find_for` returns nil and both `sample_query` and `source_file` will be null in ClickHouse.

```bash
cat /home/bjw/checkpoint-collector/collector/lib/sample_query_lookup.rb
```

```output
# ABOUTME: Retrieves representative SQL text for a pg_stat_statements query ID.
# ABOUTME: Uses pg_stat_activity to capture one live sample query when available.
class SampleQueryLookup
  def initialize(connection)
    @connection = connection
  end

  def find_for(queryid)
    @connection.exec_params("SELECT query FROM pg_stat_activity WHERE query_id = $1 LIMIT 1", [queryid]).first&.fetch("query", nil)
  end
end
```

When a sample query is captured, `QueryCommentParser` looks for a SQL comment block containing `source_location:` or `source_location=`. Rails applications instrumented with `marginalia` or `query_comment` gems automatically embed controller, action, and source file annotations in their SQL.

```bash
cat /home/bjw/checkpoint-collector/collector/lib/query_comment_parser.rb
```

```output
# ABOUTME: Parses Rails SQL comment tags into source metadata for collector rows.
# ABOUTME: Extracts source file locations from metadata comments.
class QueryCommentParser
  def self.parse(comment)
    pairs = comment.to_s.delete_prefix("/*").delete_suffix("*/").split(",").filter_map do |part|
      key, value =
        if part.include?(":")
          part.split(":", 2)
        elsif part.include?("=")
          part.split("=", 2)
        end

      next unless key && value

      [key.strip, normalize_value(value)]
    end.to_h

    {
      source_file: pairs["source_location"]
    }
  end

  def self.normalize_value(value)
    value.strip.delete_prefix("\\'").delete_suffix("\\'").delete_prefix("'").delete_suffix("'")
  end
end
```

The parser handles two comment styles Rails uses in practice:
- Colon-separated: `/*application:demo,source_location:/app/models/todo.rb:12*/`
- Equals-separated (escaped): `/*application=\'Demo\',source_location=\'/app/models/todo.rb:12\'*/`

The `extract_comment` method in `Collector` selects the *right* comment block when a query has multiple — it looks for the one containing `source_location:` or `source_location=` and ignores others like `/*hint:seqscan_off*/`.

```bash
sed -n '/def extract_comment/,/^  end$/p' /home/bjw/checkpoint-collector/collector/lib/collector.rb
```

```output
  def extract_comment(sample_query)
    sample_query.to_s.scan(COMMENT_BLOCK_PATTERN).find do |comment|
      COMMENT_METADATA_MARKERS.any? { |marker| comment.include?(marker) }
    end
  end
```

## 6. Writing to ClickHouse

`ClickhouseConnection` uses ClickHouse's HTTP interface with `FORMAT JSONEachRow` — one JSON object per line in the POST body. No extra gems are required beyond Ruby's standard `net/http`.

```bash
cat /home/bjw/checkpoint-collector/collector/lib/clickhouse_connection.rb
```

```output
# ABOUTME: Sends collected query event rows to ClickHouse over its HTTP interface.
# ABOUTME: Encodes inserts as JSONEachRow so the collector can write without extra gems.
require "json"
require "net/http"
require "uri"

class ClickhouseConnection
  def initialize(base_url:, transport: nil)
    @base_url = base_url
    @transport = transport || method(:perform_request)
  end

  def insert(table, rows)
    return if rows.empty?

    uri = URI.parse("#{@base_url}/")
    uri.query = URI.encode_www_form(query: "INSERT INTO #{table} FORMAT JSONEachRow")

    request = Net::HTTP::Post.new(uri)
    request.body = rows.map { |row| JSON.generate(serialize_row(row)) }.join("\n") + "\n"

    response = @transport.call(uri, request)
    return if response.code.to_i < 400

    raise "ClickHouse insert failed: #{response.code} #{response.body}"
  end

  private

  def perform_request(uri, request)
    Net::HTTP.start(uri.host, uri.port) do |http|
      http.request(request)
    end
  end

  def serialize_row(row)
    row.to_h.transform_values do |value|
      serialize_value(value)
    end
  end

  def serialize_value(value)
    return value.utc.strftime("%Y-%m-%d %H:%M:%S.%L") if value.is_a?(Time)

    value
  end
end
```

The table name goes in the query string (`INSERT INTO query_events FORMAT JSONEachRow`), and the row data goes in the POST body as newline-delimited JSON. This is ClickHouse's preferred bulk insert format — it streams without loading the full payload into memory first.

The `serialize_value` method converts Ruby `Time` objects to `"YYYY-MM-DD HH:MM:SS.mmm"` strings, which ClickHouse's `DateTime64(3)` column accepts. Symbol keys in the row hash are automatically handled by `to_h`.

## 7. ClickHouse Schema: query_events

The raw snapshot table. Every poll cycle appends one row per `pg_stat_statements` entry. Nothing is aggregated, deduplicated, or deleted — this is append-only raw data.

```bash
grep -v '^-- ' /home/bjw/checkpoint-collector/collector/db/clickhouse/001_query_events.sql
```

```output
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
```

The `ORDER BY` key is the full row identity: `(dbid, userid, toplevel, queryid, collected_at)`. This matters for two reasons:

1. **MergeTree ordering determines physical layout** — ClickHouse sorts data on disk by this key. Queries that filter or partition on leading columns (dbid, userid, etc.) skip irrelevant data blocks entirely.

2. **The interval view windows on this key** — `query_intervals` uses `PARTITION BY e.dbid, e.userid, e.toplevel, e.queryid ORDER BY e.collected_at` to group consecutive snapshots for the same logical statement. If the ORDER BY key didn't include all of those columns, MergeTree could merge parts in ways that interleave rows from different statements.

All timing columns store cumulative totals — the raw Postgres values. Per-interval deltas are computed only in the view layer.

## 8. ClickHouse Schema: collector_state

One row per poll cycle recording the global Postgres stats state.

```bash
grep -v '^-- ' /home/bjw/checkpoint-collector/collector/db/clickhouse/002_collector_state.sql
```

```output
CREATE TABLE collector_state (
  collected_at DateTime64(3),
  dealloc UInt64,
  stats_reset DateTime
) ENGINE = MergeTree
ORDER BY (collected_at);
```

`stats_reset` is a `DateTime` (second precision), not `DateTime64`. Postgres returns `stats_reset` as a timestamptz string with microseconds and timezone offset — for example, `"2026-04-09 12:00:00.055815+00"`. ClickHouse's `DateTime` column rejects that format and will crash the insert.

The collector's `format_stats_reset` method normalizes it:

```bash
sed -n '/def format_stats_reset/,/^  end$/p' /home/bjw/checkpoint-collector/collector/lib/collector.rb
```

```output
  def format_stats_reset(value)
    return nil unless value
    # Postgres returns timestamptz with microseconds and tz offset.
    # ClickHouse DateTime column accepts "YYYY-MM-DD HH:MM:SS" only.
    Time.parse(value.to_s).utc.strftime("%Y-%m-%d %H:%M:%S")
  rescue ArgumentError
    nil
  end
```

`Time.parse` handles the offset and microseconds; `.utc` normalizes to UTC; `strftime` produces exactly the string ClickHouse accepts. An `ArgumentError` rescue prevents a malformed value from crashing the collector — the row is stored with a null `stats_reset` instead.

The `dealloc` counter records how many statements were evicted from the shared memory budget. A sudden spike in dealloc means the collector missed some queries that cycle — useful for detecting blind spots.

## 9. The Interval View: query_intervals

This is the most complex object in the schema. It derives per-interval delta metrics from consecutive raw snapshots, filtering out rows where a stats reset happened between them or where counters regressed (which would produce negative deltas).

```bash
grep -v '^-- ' /home/bjw/checkpoint-collector/collector/db/clickhouse/003_query_intervals.sql | grep -v '^SET '
```

```output
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
    row_number() OVER statement_window AS snapshot_position,
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
),
valid_intervals AS (
  SELECT *
  FROM interval_candidates
  WHERE snapshot_position > 1
    AND stats_reset = previous_stats_reset
    AND total_exec_count >= previous_total_exec_count
    AND total_exec_time_ms >= previous_total_exec_time_ms
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
  CAST(total_exec_count - previous_total_exec_count AS Int64) AS total_exec_count,
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
FROM valid_intervals;
```

### How interval_candidates works

The CTE joins `query_events` with `collector_state` on `collected_at` (the shared timestamp from the same poll cycle), then applies window functions over a partition keyed by the full statement identity.

`lagInFrame` is ClickHouse's ANSI-compatible lag function that respects explicit window frame boundaries. For each row, it returns the value from the previous row in the partition. The first row in each partition gets a default (zero or null), which is why we need `snapshot_position > 1` — the very first snapshot has no previous snapshot to compute a delta against.

`stats_reset` is brought in via the LEFT JOIN to `collector_state`. It travels through the same window so we can compare `stats_reset` vs `previous_stats_reset`.

### The valid_intervals filter

Three conditions must all hold for a row to become an interval:

1. `snapshot_position > 1` — must have a previous snapshot to subtract from
2. `stats_reset = previous_stats_reset` — counters were never reset between the two snapshots
3. `total_exec_count >= previous_total_exec_count` AND `total_exec_time_ms >= previous_total_exec_time_ms` — counters are monotonically increasing (guards against subtle reset race conditions)

If a stats reset happens between two snapshots, both the count and time counters will drop. The filter catches this whether it shows up in the `stats_reset` timestamp or in a counter regression.

### The final SELECT

Delta columns are computed by subtracting previous from current and cast to signed integer/float types because ClickHouse unsigned subtraction would wrap around. The timing columns (`min`, `max`, `mean`, `stddev`) are point-in-time values from Postgres and are carried forward as-is — they cannot be meaningfully subtracted.

```bash
grep '^SET ' /home/bjw/checkpoint-collector/collector/db/clickhouse/003_query_intervals.sql
```

```output
SET allow_experimental_analyzer = 0;
```

The `SET allow_experimental_analyzer = 0` at the top disables ClickHouse's new query analyzer during CREATE VIEW. The experimental analyzer (introduced in ClickHouse 23.x) has different behavior for `lagInFrame` inside window functions and produces incorrect results for this query. Disabling it for the view definition makes the view use the stable legacy planner at query time.

## 10. The Agent's ClickHouse Tool

The DB specialist agent accesses ClickHouse through `ClickHouseTool` in `src/tools/clickhouse_tool.ts`. It exposes four operations: list tables, describe a table, execute a guarded query, and query findings.

```bash
sed -n '/^export class ClickHouseTool/,/^}/p' /home/bjw/checkpoint/src/tools/clickhouse_tool.ts | head -30
```

```output
export class ClickHouseTool {
  private readonly transport?: ClickHouseTransport;

  constructor(options: ClickHouseToolOptions = {}) {
    this.transport = options.transport ?? createHttpTransport();
  }

  async listTables(): Promise<Array<string>> {
    return [...SUPPORTED_TABLES];
  }

  async describeTable(table: string): Promise<string> {
    assertSupportedTable(table);

    return this.transport!.query(`DESCRIBE TABLE ${table} FORMAT TSV`);
  }

  async executeQuery(sql: string): Promise<string> {
    assertSupportedQuery(sql);

    return this.transport!.query(sql);
  }

  async queryFindings(scope?: unknown): Promise<Array<TopOffender>> {
    return parseOffenderRows(await this.executeQuery(buildOffenderQuery(scope)));
  }
}
```

### Query guards

`assertSupportedQuery` enforces three rules before any query reaches ClickHouse:
- Must start with SELECT
- Must not contain a semicolon (no statement chaining)
- Must reference only tables in the SUPPORTED_TABLES allowlist

This prevents the agent from running writes, drops, or queries against arbitrary tables.

```bash
sed -n '/^function assertSupportedQuery/,/^}/p' /home/bjw/checkpoint/src/tools/clickhouse_tool.ts
```

```output
function assertSupportedQuery(sql: string): void {
  const trimmed = sql.trim();

  if (!/^\s*select\b/i.test(trimmed)) {
    throw new Error("SELECT-only queries are allowed");
  }

  if (trimmed.includes(";")) {
    throw new Error("Only single statement SELECT queries are allowed");
  }

  const referencedTables = extractReferencedTables(trimmed);
  if (!referencedTables.length) {
    throw new Error("Raw queries must use supported ClickHouse tables");
  }

  const unsupportedTable = referencedTables.find((table) => !SUPPORTED_TABLES.has(table));
  if (unsupportedTable) {
    throw new Error(`Raw queries must use supported ClickHouse tables: ${unsupportedTable}`);
  }
}
```

```bash
grep '^const SUPPORTED_TABLES' /home/bjw/checkpoint/src/tools/clickhouse_tool.ts
```

```output
const SUPPORTED_TABLES = new Set(["query_events", "collector_state", "query_intervals"]);
```

### queryFindings and the offender query

`queryFindings` is the agent's main entry point for surfacing slow queries. It builds a SQL query against `query_intervals`, executes it through the guarded path, and returns structured `TopOffender` objects.

```bash
sed -n '/^function buildOffenderQuery/,/^}/p' /home/bjw/checkpoint/src/tools/clickhouse_tool.ts
```

```output
function buildOffenderQuery(scope?: unknown): string {
  const request = parseScope(scope);
  if (!request.allTime) {
    return buildWindowedQuery(request);
  }

  return [
    "SELECT",
    "  fingerprint,",
    "  tupleElement(argMax((source_file, sample_query), interval_ended_at), 1) AS source_file,",
    "  tupleElement(argMax((source_file, sample_query), interval_ended_at), 2) AS sample_query,",
    "  sum(total_exec_count) AS total_exec_count,",
    "  round(sum(delta_exec_time_ms), 2) AS total_exec_time_ms,",
    `  round(quantile(0.95)(${INTERVAL_MEAN_EXEC_TIME_SQL}), 2) AS p95_exec_time_ms`,
    "FROM query_intervals",
    "GROUP BY fingerprint",
    "ORDER BY total_exec_time_ms DESC",
    "LIMIT 5",
    "FORMAT TSVWithNames",
  ].join("\n");
}
```

```bash
sed -n '/^function buildWindowedQuery/,/^}/p' /home/bjw/checkpoint/src/tools/clickhouse_tool.ts
```

```output
function buildWindowedQuery(request: ScopeRequest): string {
  return [
    "SELECT",
    "  fingerprint,",
    "  tupleElement(argMax((source_file, sample_query), interval_ended_at), 1) AS source_file,",
    "  tupleElement(argMax((source_file, sample_query), interval_ended_at), 2) AS sample_query,",
    "  sum(total_exec_count) AS total_exec_count,",
    "  round(sum(delta_exec_time_ms), 2) AS total_exec_time_ms,",
    `  round(quantile(0.95)(${INTERVAL_MEAN_EXEC_TIME_SQL}), 2) AS p95_exec_time_ms`,
    "FROM query_intervals",
    `WHERE interval_started_at > now() - INTERVAL ${request.timeWindowMinutes} MINUTE`,
    `  AND interval_ended_at > now() - INTERVAL ${request.timeWindowMinutes} MINUTE`,
    `  AND interval_duration_ms <= ${request.timeWindowMinutes * 60 * 1000}`,
    "GROUP BY fingerprint",
    "ORDER BY total_exec_time_ms DESC",
    "LIMIT 5",
    "FORMAT TSVWithNames",
  ].join("\n");
}
```

The offender query aggregates across all intervals for each fingerprint and returns the top 5 by total execution time. A few design choices worth noting:

- `argMax((source_file, sample_query), interval_ended_at)` picks the most recent non-null source file and sample query. This handles the case where early snapshots had no live SQL sampled but later ones did.
- `quantile(0.95)(mean_exec_time_ms)` computes P95 over the per-interval mean times, giving a sense of tail latency across polling cycles.
- `total_exec_time_ms` is the sum of `delta_exec_time_ms` across intervals — total wall-clock time spent in this query across the observation window.

The windowed query adds three WHERE conditions:
- Both `interval_started_at` and `interval_ended_at` must be within the time window (so partially-overlapping intervals are excluded)
- `interval_duration_ms` must be at most the window length (filters out intervals that span longer than the window, which would be anomalous)

```bash
sed -n '/^function parseScope/,/^}/p' /home/bjw/checkpoint/src/tools/clickhouse_tool.ts
```

```output
function parseScope(scope?: unknown): ScopeRequest {
  if (typeof scope !== "string") {
    return { allTime: false, tableName: null, timeWindowMinutes: 60 };
  }

  const tableMatch = scope.match(/^analyze_table\s+([a-z0-9_]+)/i);
  const minuteMatch = scope.match(/\b(\d+)\b/);

  return {
    allTime: /\ball\b/i.test(scope),
    tableName: tableMatch ? tableMatch[1].toLowerCase() : null,
    timeWindowMinutes: Number(minuteMatch?.[1] ?? 60),
  };
}
```

The agent can pass a natural-language scope string to `queryFindings`. `parseScope` extracts three signals from it:

- `all` anywhere in the string → use the all-time query (no WHERE on timestamps)
- A bare number → use that many minutes as the time window (default: 60)
- `analyze_table <name>` → record which table the agent is focused on (currently stored but not yet used as an additional filter)

So `scope: "last 30"` gives a 30-minute window, `scope: "all time"` removes the time filter, and no scope gives a 60-minute default.

## 11. End-to-End Data Flow

Here is how a single slow query in a Rails app becomes a finding the agent acts on:

1. **Rails executes SQL** with a query comment: `SELECT * FROM todos /*source_location:/app/controllers/todos_controller.rb:12*/`

2. **Postgres records it** in `pg_stat_statements` with a `queryid` hash, incrementing `calls`, `total_exec_time`, and block counters

3. **Collector polls** (every N minutes on cron):
   - Runs `STATS_SQL` against `pg_stat_statements` → gets cumulative counters for every tracked query
   - Runs `INFO_SQL` against `pg_stat_statements_info` → gets `stats_reset` timestamp
   - For each queryid, tries `pg_stat_activity` to grab a live copy of the SQL text
   - Parses the SQL comment to extract `source_location`
   - Inserts one row per query into `query_events` and one row into `collector_state`, both with the same `collected_at`

4. **ClickHouse stores** the raw cumulative snapshots

5. **query_intervals VIEW** joins consecutive snapshots on the same queryid, checks stats_reset didn't change, subtracts previous from current counters → one interval row per consecutive snapshot pair per query

6. **Agent calls `queryFindings`** → `buildOffenderQuery` aggregates intervals by fingerprint, sums `delta_exec_time_ms`, orders by total → returns top 5 offenders with source file and sample SQL

7. **Agent calls `locate_source`** with the source file → loads the Rails controller code

8. **Agent proposes a fix**, calls `apply_fix` to write the code change, then `open_pull_request` to submit it

## 12. The Reset Script

`004_reset_query_analytics.sql` drops and recreates all three objects in dependency order. It is used when schema migrations require a full rebuild — not during normal operation.

```bash
head -6 /home/bjw/checkpoint-collector/collector/db/clickhouse/004_reset_query_analytics.sql
```

```output
-- ABOUTME: Rebuilds the raw query events, collector state, and interval view schema.
-- ABOUTME: Drops and recreates raw tables plus the query intervals view.
DROP VIEW IF EXISTS query_intervals;
DROP TABLE IF EXISTS collector_state;
DROP TABLE IF EXISTS query_events;

```

The view must be dropped before the tables it reads. The tables can be dropped in any order since they have no dependencies on each other. After the drops, the script recreates everything in the same sequence as the numbered migrations (001 → 002 → 003).

## 13. Live Data: Three Snapshot Passes

The sections below capture real output from a running demo stack. Three collector passes were made against a Rails todo app running on Postgres with `pg_stat_statements` enabled. The results show the full transformation from cumulative Postgres counters to per-interval deltas in `query_intervals`.

The demo app runs three endpoints:
- `GET /todos` — `SELECT * FROM todos` (N+1 on users via includes)
- `GET /todos/status` — `SELECT * FROM todos WHERE status = ?`
- `GET /todos/stats` — `SELECT COUNT(*) GROUP BY user_id` + `SELECT * FROM users`

### Step 1: Postgres after three rounds of load

Before any collector run, here is what `pg_stat_statements` shows for the four application queries. These are cumulative totals since the last `pg_stat_statements_reset()` call.

```bash
docker exec checkpoint-postgres-1 psql -U postgres -d checkpoint_demo -t -A -F $'\t' -c "
SELECT
  queryid,
  calls,
  round(mean_exec_time::numeric, 4) AS mean_ms,
  left(query, 80) AS query_snippet
FROM pg_stat_statements
WHERE query LIKE '%todos%' OR query LIKE '%users%'
ORDER BY calls DESC
LIMIT 5
" 2>&1
```

```output
8809102542184958349	121	0.0031	SELECT "todos".* FROM "todos" /*action='index',application='Demo',controller='to
5274116089881997307	85	0.0028	SELECT "todos".* FROM "todos" WHERE "todos"."status" = $1 /*action='status',appl
-2218168421473161013	60	0.0017	SELECT "users".* FROM "users" /*action='stats',application='Demo',controller='to
-1891428409369833436	60	0.0044	SELECT COUNT(*) AS "count_all", "todos"."user_id" AS "todos_user_id" FROM "todos
-3384221525701929072	30	0.0029	SELECT "todos".* FROM "todos" WHERE (title LIKE $1) /*action='index',application
```

The counter for `SELECT * FROM todos` shows 121 total calls — the sum across all three load rounds. This is the raw cumulative number. The collector ran three times and each time recorded a snapshot of these cumulative values.

### Step 2: collector_state — the reset anchor

The collector wrote one `collector_state` row per pass. All three share the same `stats_reset` timestamp, confirming no reset happened between passes.

```bash
curl -s 'http://localhost:8123/' --data 'SELECT toString(collected_at) AS collected_at, dealloc, stats_reset FROM collector_state ORDER BY collected_at FORMAT TSVWithNames'
```

```output
collected_at	dealloc	stats_reset
2026-04-10 12:44:42.839	0	2026-04-10 12:44:07
2026-04-10 12:47:15.796	0	2026-04-10 12:44:07
2026-04-10 12:47:29.849	0	2026-04-10 12:44:07
```

`stats_reset` is `2026-04-10 12:44:07` in all three rows. The interval view's reset filter (`stats_reset = previous_stats_reset`) will pass for all consecutive pairs, meaning their deltas are valid.

### Step 3: query_events — growing cumulative counters

Here are the three snapshots for the four application queries, ordered by query and time. Watch `total_exec_count` climb from pass to pass.

```bash
curl -s 'http://localhost:8123/' --data "
SELECT
  toString(collected_at) AS collected_at,
  queryid,
  total_exec_count,
  round(total_exec_time_ms, 2) AS total_exec_time_ms,
  round(mean_exec_time_ms, 4) AS mean_ms
FROM query_events
WHERE queryid IN ('8809102542184958349', '-1891428409369833436', '5274116089881997307', '-3384221525701929072')
ORDER BY queryid, collected_at
FORMAT TSVWithNames"
```

```output
collected_at	queryid	total_exec_count	total_exec_time_ms	mean_ms
2026-04-10 12:44:42.839	-1891428409369833436	15	0.07	0.0046
2026-04-10 12:47:15.796	-1891428409369833436	40	0.18	0.0045
2026-04-10 12:47:29.849	-1891428409369833436	60	0.26	0.0044
2026-04-10 12:44:42.839	-3384221525701929072	10	0.03	0.0028
2026-04-10 12:47:15.796	-3384221525701929072	30	0.09	0.0029
2026-04-10 12:47:29.849	-3384221525701929072	30	0.09	0.0029
2026-04-10 12:44:42.839	5274116089881997307	20	0.06	0.0031
2026-04-10 12:47:15.796	5274116089881997307	55	0.16	0.0029
2026-04-10 12:47:29.849	5274116089881997307	85	0.24	0.0028
2026-04-10 12:44:42.839	8809102542184958349	30	0.11	0.0035
2026-04-10 12:47:15.796	8809102542184958349	80	0.25	0.0031
2026-04-10 12:47:29.849	8809102542184958349	120	0.37	0.0031
```

Take queryid `8809102542184958349` (the `SELECT * FROM todos` all-rows query) as the running example:

- Pass 1 (12:44:42): 30 cumulative calls, 0.11 ms total
- Pass 2 (12:47:15): 80 cumulative calls, 0.25 ms total  — 50 new calls in this interval
- Pass 3 (12:47:29): 120 cumulative calls, 0.37 ms total — 40 new calls in this interval

The view will compute those 50 and 40 call deltas by subtraction.

Note queryid `-3384221525701929072` (the LIKE search): it shows 30 calls in both pass 2 and pass 3. No load was generated for that query in round 3, so the counter did not increment. The interval view will emit a row with `total_exec_count = 0` for that pair — valid but zero activity.

### Step 4: query_intervals — deltas from the VIEW

The interval view pairs each snapshot with the previous one, subtracts the counters, and filters out invalid rows. Three snapshots produce two intervals per query.

```bash
curl -s 'http://localhost:8123/' --data "
SELECT
  toString(interval_started_at) AS started_at,
  toString(interval_ended_at) AS ended_at,
  interval_duration_ms,
  queryid,
  total_exec_count AS calls_in_interval,
  round(delta_exec_time_ms, 2) AS delta_ms
FROM query_intervals
WHERE queryid IN ('8809102542184958349', '-1891428409369833436', '5274116089881997307', '-3384221525701929072')
ORDER BY queryid, started_at
FORMAT TSVWithNames"
```

```output
started_at	ended_at	interval_duration_ms	queryid	calls_in_interval	delta_ms
2026-04-10 12:44:42.839	2026-04-10 12:47:15.796	152957	-1891428409369833436	25	0.11
2026-04-10 12:47:15.796	2026-04-10 12:47:29.849	14053	-1891428409369833436	20	0.09
2026-04-10 12:44:42.839	2026-04-10 12:47:15.796	152957	-3384221525701929072	20	0.06
2026-04-10 12:47:15.796	2026-04-10 12:47:29.849	14053	-3384221525701929072	0	0
2026-04-10 12:44:42.839	2026-04-10 12:47:15.796	152957	5274116089881997307	35	0.1
2026-04-10 12:47:15.796	2026-04-10 12:47:29.849	14053	5274116089881997307	30	0.08
2026-04-10 12:44:42.839	2026-04-10 12:47:15.796	152957	8809102542184958349	50	0.14
2026-04-10 12:47:15.796	2026-04-10 12:47:29.849	14053	8809102542184958349	40	0.12
```

The math checks out for queryid `8809102542184958349`:

- Interval 1 (12:44:42 → 12:47:15, 152,957 ms): `80 - 30 = 50` calls, `0.25 - 0.11 = 0.14` ms
- Interval 2 (12:47:15 → 12:47:29, 14,053 ms): `120 - 80 = 40` calls, `0.37 - 0.25 = 0.12` ms

The LIKE search query (`-3384221525701929072`) shows `calls_in_interval = 0` for the second interval — the counter was unchanged because no matching load was sent in round 3. The row still appears because the filter only rejects counter *regressions*, not zero deltas.

### Step 5: buildOffenderQuery — from scope string to SQL

When the agent calls `queryFindings`, the first thing that happens is `buildOffenderQuery(scope)` builds the SQL string. There are two variants: all-time (no time filter) and windowed (default 60 minutes). Here is the exact SQL each produces.

```bash
npx tsx /tmp/show_sql.mts
```

```output
-- all-time variant (scope = 'all'):
SELECT
  fingerprint,
  tupleElement(argMax((source_file, sample_query), interval_ended_at), 1) AS top_source_file,
  tupleElement(argMax((source_file, sample_query), interval_ended_at), 2) AS top_sample_query,
  sum(total_exec_count) AS call_count,
  round(sum(delta_exec_time_ms), 2) AS total_exec_time_ms,
  round(quantile(0.95)(if(total_exec_count = 0, 0, delta_exec_time_ms / total_exec_count)), 2) AS p95_exec_time_ms
FROM query_intervals
GROUP BY fingerprint
ORDER BY total_exec_time_ms DESC
LIMIT 5
FORMAT TSVWithNames

-- windowed variant (scope = undefined, default 60 minutes):
SELECT
  fingerprint,
  tupleElement(argMax((source_file, sample_query), interval_ended_at), 1) AS top_source_file,
  tupleElement(argMax((source_file, sample_query), interval_ended_at), 2) AS top_sample_query,
  sum(total_exec_count) AS call_count,
  round(sum(delta_exec_time_ms), 2) AS total_exec_time_ms,
  round(quantile(0.95)(if(total_exec_count = 0, 0, delta_exec_time_ms / total_exec_count)), 2) AS p95_exec_time_ms
FROM query_intervals
WHERE interval_started_at > now() - INTERVAL 60 MINUTE
  AND interval_ended_at > now() - INTERVAL 60 MINUTE
  AND interval_duration_ms <= 3600000
GROUP BY fingerprint
ORDER BY total_exec_time_ms DESC
LIMIT 5
FORMAT TSVWithNames
```

The two variants differ only in the WHERE clause. The windowed query adds three conditions — both interval endpoints must fall within the window, and the interval duration must not exceed the window length (which would indicate a stale or anomalous interval).

Key columns in the SELECT:
- `tupleElement(argMax(...), 1)` — picks `source_file` from the interval with the latest `interval_ended_at`, so newer (potentially enriched) samples win over older ones
- `sum(total_exec_count) AS call_count` — total calls across all intervals (alias avoids ClickHouse cyclic alias with the view's own `total_exec_count` column)
- `quantile(0.95)(if(...))` — P95 of per-interval mean exec time; the `if(... = 0, 0, ...)\ guard avoids divide-by-zero on zero-call intervals

### Step 6: Raw ClickHouse TSV response

Before `parseOffenderRows` processes it, ClickHouse returns a raw TSV string. Here is what the wire format looks like for both variants.

```bash
curl -s 'http://localhost:8123/?allow_experimental_analyzer=0' --data 'SELECT
  fingerprint,
  tupleElement(argMax((source_file, sample_query), interval_ended_at), 1) AS top_source_file,
  tupleElement(argMax((source_file, sample_query), interval_ended_at), 2) AS top_sample_query,
  sum(total_exec_count) AS call_count,
  round(sum(delta_exec_time_ms), 2) AS total_exec_time_ms,
  round(quantile(0.95)(if(total_exec_count = 0, 0, delta_exec_time_ms / total_exec_count)), 2) AS p95_exec_time_ms
FROM query_intervals
GROUP BY fingerprint
ORDER BY total_exec_time_ms DESC
LIMIT 5
FORMAT TSVWithNames'
```

```output
fingerprint	top_source_file	top_sample_query	call_count	total_exec_time_ms	p95_exec_time_ms
-4675886988266314286	\N	SELECT query FROM pg_stat_activity WHERE query_id = $1 LIMIT 1	12	0.47	0.04
8809102542184958349	\N	\N	90	0.26	0
-1891428409369833436	\N	\N	45	0.2	0
5274116089881997307	\N	\N	65	0.18	0
4552656009507366904	\N	\N	1	0.15	0.15
```

The first line is always the header. `\N` is ClickHouse's representation of NULL. The windowed variant produces the same rows since this data was collected within the last hour — the WHERE clause on `interval_started_at > now() - INTERVAL 60 MINUTE` passes.

```bash
curl -s 'http://localhost:8123/?allow_experimental_analyzer=0' --data "SELECT
  fingerprint,
  tupleElement(argMax((source_file, sample_query), interval_ended_at), 1) AS top_source_file,
  tupleElement(argMax((source_file, sample_query), interval_ended_at), 2) AS top_sample_query,
  sum(total_exec_count) AS call_count,
  round(sum(delta_exec_time_ms), 2) AS total_exec_time_ms,
  round(quantile(0.95)(if(total_exec_count = 0, 0, delta_exec_time_ms / total_exec_count)), 2) AS p95_exec_time_ms
FROM query_intervals
WHERE interval_started_at > now() - INTERVAL 60 MINUTE
  AND interval_ended_at > now() - INTERVAL 60 MINUTE
  AND interval_duration_ms <= 3600000
GROUP BY fingerprint
ORDER BY total_exec_time_ms DESC
LIMIT 5
FORMAT TSVWithNames"
```

```output
fingerprint	top_source_file	top_sample_query	call_count	total_exec_time_ms	p95_exec_time_ms
-4675886988266314286	\N	SELECT query FROM pg_stat_activity WHERE query_id = $1 LIMIT 1	12	0.47	0.04
8809102542184958349	\N	\N	90	0.26	0
-1891428409369833436	\N	\N	45	0.2	0
5274116089881997307	\N	\N	65	0.18	0
4552656009507366904	\N	\N	1	0.15	0.15
```

### Step 7: parseOffenderRows — TSV to TopOffender objects

`parseOffenderRows` splits the TSV header and data lines, maps each row to a `TopOffender` object, and assigns severity based on P95 exec time.

```bash
sed -n '/^function parseOffenderRows/,/^}/p' /home/bjw/checkpoint/src/tools/clickhouse_tool.ts
```

```output
function parseOffenderRows(payload: string): Array<TopOffender> {
  const [headerLine, ...dataLines] = payload.trim().split("\n").filter(Boolean);
  if (!headerLine) {
    return [];
  }

  const headers = headerLine.split("\t");
  return dataLines.map((line) => {
    const values = line.split("\t");
    const row = Object.fromEntries(
      headers.map((header, index) => [header, normalizeValue(header, values[index])]),
    );
    const totalExecCount = Number(row.call_count ?? row.total_exec_count ?? 0);
    const p95ExecTimeMs = Number(row.p95_exec_time_ms ?? 0);
    const totalExecTimeMs = Number(row.total_exec_time_ms ?? 0);

    return {
      fingerprint: String(row.fingerprint ?? ""),
      p95_exec_time_ms: p95ExecTimeMs,
      sample_query: row.top_sample_query ?? row.sample_query,
      severity: p95ExecTimeMs >= 100 ? "high" : "medium",
      source_file: row.top_source_file ?? row.source_file,
      total_exec_count: totalExecCount,
      total_exec_time_ms: totalExecTimeMs,
    };
  });
}
```

The parsing steps:

1. Split on `\n`, drop empty lines — guards against trailing newlines in ClickHouse output
2. First line is the header; remaining are data rows
3. `normalizeValue` converts `\N` to null, coerces numeric-looking strings to numbers (except `fingerprint`, which must stay a string even though it looks like an integer)
4. `call_count ?? total_exec_count` — handles both the new column alias and the old one for backward compat
5. `severity: p95ExecTimeMs >= 100 ? 'high' : 'medium'` — the agent's threshold for triggering automated fix attempts

### Step 8: Final queryFindings output

Here is the complete end-to-end call through the TypeScript layer, running against the live data.

```bash
CLICKHOUSE_URL=http://localhost:8123 npx tsx /tmp/demo_query.mts
```

```output
[
  {
    "fingerprint": "-4675886988266314286",
    "p95_exec_time_ms": 0.04,
    "sample_query": "SELECT query FROM pg_stat_activity WHERE query_id = $1 LIMIT 1",
    "severity": "medium",
    "total_exec_count": 12,
    "total_exec_time_ms": 0.47
  },
  {
    "fingerprint": "8809102542184958349",
    "p95_exec_time_ms": 0,
    "severity": "medium",
    "total_exec_count": 90,
    "total_exec_time_ms": 0.26
  },
  {
    "fingerprint": "-1891428409369833436",
    "p95_exec_time_ms": 0,
    "severity": "medium",
    "total_exec_count": 45,
    "total_exec_time_ms": 0.2
  },
  {
    "fingerprint": "5274116089881997307",
    "p95_exec_time_ms": 0,
    "severity": "medium",
    "total_exec_count": 65,
    "total_exec_time_ms": 0.18
  },
  {
    "fingerprint": "4552656009507366904",
    "p95_exec_time_ms": 0.15,
    "severity": "medium",
    "total_exec_count": 1,
    "total_exec_time_ms": 0.15
  }
]
```

Reading the findings:

- **Fingerprint `-4675886988266314286`** (collector's own `SampleQueryLookup` query): 12 calls, 0.47 ms total. Has a `sample_query` because this query runs longer than the others and gets captured live in `pg_stat_activity` occasionally.
- **Fingerprint `8809102542184958349`** (`SELECT * FROM todos`): 90 calls across the two intervals, 0.26 ms total — the busiest application query by call volume but fast.
- **Fingerprints `-1891428409369833436` and `5274116089881997307`** (group-by stats, status filter): both `null` for `source_file` and `sample_query` — these finished too quickly to be captured in `pg_stat_activity` during any collector pass.

In a production workload with slower queries (even a few milliseconds), `source_file` would populate reliably and P95 would surface genuine outliers. The severity threshold of 100 ms is calibrated for production tail latency, not a demo on an idle local database.
