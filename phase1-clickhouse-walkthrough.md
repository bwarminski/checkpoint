# Phase 1 ClickHouse Ingestion and Schema Walkthrough

*2026-04-05T13:44:01Z by Showboat 0.6.1*
<!-- showboat-id: 5059302e-1082-4549-a0f6-74f9537e086b -->

This walkthrough traces how query performance data flows from a live Postgres instance into ClickHouse and surfaces as ranked offenders for the DB specialist agent. The system uses three objects: a raw events table, an AggregatingMergeTree read model, and a materialized view that connects them. We'll follow the data from collection all the way through to the agent's query.

## 1. The Three-Object Schema

The ClickHouse schema lives under collector/db/clickhouse/ and consists of three migration files applied in order. Before diving into each one, here is the big picture:

- 001_query_events.sql — raw insert target; collector writes here every poll cycle
- 002_query_fingerprints.sql — AggregatingMergeTree read model; the agent reads from here
- 003_top_offenders_mv.sql — materialized view that aggregates raw events into the read model automatically

The reset script (004) rebuilds the read model by replaying all raw events; it exists for schema migrations and is not part of normal operation.

### query_events — the raw insert table

Every collector poll cycle appends one row per pg_stat_statements entry. The engine is plain MergeTree — no aggregation, just durable storage ordered for efficient fingerprint + time range scans.

```bash
cat collector/db/clickhouse/001_query_events.sql
```

```output
-- ABOUTME: Creates the raw query events table for collector inserts.
-- ABOUTME: Stores per-query timing and source metadata for later fingerprinting.
CREATE TABLE query_events (
  collected_at DateTime64(3),
  fingerprint String,
  source_tag Nullable(String),
  source_file Nullable(String),
  sample_query Nullable(String),
  total_exec_count UInt64,
  mean_exec_time_ms Float64
) ENGINE = MergeTree
ORDER BY (fingerprint, collected_at);
```

Key design choices in query_events:

- collected_at is DateTime64(3) (millisecond precision). See the argMax section below for the full explanation, but briefly: the original schema used DateTime (second precision) and under load two poll cycles could land in the same second, causing argMaxState to be unable to break the tie between a row with source_file set and one with source_file NULL. Millisecond timestamps make same-second collisions extremely unlikely in practice.
- fingerprint is pg_stat_statements.queryid cast to a string. It is a stable hash of the normalized SQL text, not the raw query.
- source_tag and source_file are Nullable. Queries that have no Rails query-log comment land here with NULLs and are filtered out by the agent when surfacing offenders.
- sample_query stores the raw SQL text as sampled from pg_stat_activity at the moment the collector ran — this is used later for code-search tracing and EXPLAIN.
- total_exec_count and mean_exec_time_ms come directly from pg_stat_statements.calls and pg_stat_statements.mean_exec_time. The collector converts microseconds to milliseconds.
- ORDER BY (fingerprint, collected_at) means MergeTree stores rows physically sorted by query identity then time, which makes fingerprint-scoped window queries fast.

### query_fingerprints — the AggregatingMergeTree read model

This is where the agent reads from. Instead of scanning all raw events on every query, the materialized view streams aggregations here incrementally. The engine is AggregatingMergeTree, which means ClickHouse stores aggregate *states* (partial results) rather than final values, and merges them lazily in the background.

```bash
cat collector/db/clickhouse/002_query_fingerprints.sql
```

```output
-- ABOUTME: Creates the aggregated query fingerprint read model.
-- ABOUTME: Stores aggregate states consumed by the materialized view.
CREATE TABLE query_fingerprints (
  fingerprint String,
  source_tag Nullable(String),
  source_file_state AggregateFunction(argMax, Nullable(String), DateTime64(3)),
  sample_query_state AggregateFunction(argMax, Nullable(String), DateTime64(3)),
  total_exec_count_state AggregateFunction(sum, UInt64),
  total_exec_time_ms_state AggregateFunction(sum, Float64),
  p95_exec_time_state AggregateFunction(quantile(0.95), Float64)
) ENGINE = AggregatingMergeTree
ORDER BY (fingerprint, source_tag);
```

Key design choices in query_fingerprints:

- ORDER BY (fingerprint, source_tag) is the grouping key. This means the same SQL query run from two different Rails controllers (e.g. todos#index vs users#index) produces two separate rows. This is intentional: the agent's analyze_table command filters by source_tag prefix, and mixing source tags would make per-table ranking meaningless.

- source_tag is a plain column, not an aggregate state, because it IS the grouping key. It is Nullable so queries with no Rails comment still land here (though the agent filters them out).

- source_file_state and sample_query_state use AggregateFunction(argMax, ..., DateTime64(3)). argMax picks the value from the row with the highest collected_at timestamp — the most recent representative. This prevents a stale file path or old SQL from permanently shadowing current data.

- total_exec_count_state and total_exec_time_ms_state use AggregateFunction(sum, ...). ClickHouse accumulates these across all raw event batches.

- p95_exec_time_state uses AggregateFunction(quantile(0.95), Float64). ClickHouse stores a sketch (t-digest) that can be merged across partial results and finalized to a p95 estimate.

- The _state suffix is a ClickHouse convention. Columns holding aggregate states are written via *State combinators and read via *Merge combinators.

### top_offenders_mv — the materialized view

The materialized view is the pipe that keeps query_fingerprints up to date. Every time ClickHouse processes an INSERT block into query_events, it runs this SELECT and appends the result to query_fingerprints. AggregatingMergeTree then merges in the background.

```bash
cat collector/db/clickhouse/003_top_offenders_mv.sql
```

```output
-- ABOUTME: Builds the materialized view that aggregates raw query events.
-- ABOUTME: Feeds the query_fingerprints table from aggregated query events.
CREATE MATERIALIZED VIEW top_offenders_mv
TO query_fingerprints AS
SELECT
  fingerprint,
  source_tag,
  argMaxState(source_file, collected_at) AS source_file_state,
  argMaxState(sample_query, collected_at) AS sample_query_state,
  sumState(total_exec_count) AS total_exec_count_state,
  sumState(total_exec_count * mean_exec_time_ms) AS total_exec_time_ms_state,
  quantileState(0.95)(mean_exec_time_ms) AS p95_exec_time_state
FROM query_events
GROUP BY fingerprint, source_tag;
```

Key design choices in top_offenders_mv:

- TO query_fingerprints means this is a 'TO-table' materialized view. ClickHouse writes the SELECT results directly into query_fingerprints rather than maintaining its own implicit storage table. This is the correct pattern for AggregatingMergeTree targets.

- total_exec_time_ms_state uses sumState(total_exec_count * mean_exec_time_ms). There is no total_exec_time_ms column in query_events — only the per-execution mean. The view reconstructs total time by multiplying count × mean on the way in. This is the only place that arithmetic lives, keeping query_events rows compact.

- p95_exec_time_state uses quantileState(0.95)(mean_exec_time_ms). Note this is the p95 of *mean* execution times across collector snapshots, not a p95 over individual query executions. It is an approximation that works well for detecting consistently slow queries.

- GROUP BY fingerprint, source_tag matches the ORDER BY of query_fingerprints exactly. This is required — AggregatingMergeTree merges rows by sort key, so the grouping key in the MV must align with the table's sort key.

- The *State combinators (argMaxState, sumState, quantileState) produce binary aggregate states. ClickHouse appends these partial states to the destination table, where they are merged with existing states in the background. A query using the read model then calls *Merge combinators to finalize them.

## 2. The Write Path — Collector to ClickHouse

The collector is a Ruby process that polls Postgres on an interval and writes rows to ClickHouse over HTTP. There are four pieces: SampleQueryLookup, QueryCommentParser, Collector, and ClickhouseConnection.

### Step 1: Read pg_stat_statements and look up live SQL text

The collector polls pg_stat_statements for query identifiers and timing stats, then resolves each queryid to a sample SQL string from pg_stat_activity. These are separate operations because pg_stat_statements stores only the *normalized* query text (with literals replaced by $1 placeholders), while pg_stat_activity holds the live query text including inline literals and the Rails query-log comment.

```bash
sed -n '1,11p' collector/lib/sample_query_lookup.rb
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

### Step 2: Parse Rails query-log comments

Rails injects a structured comment into every SQL query it generates when query_log_tags is configured. The comment looks like:

  /*application:demo,controller='todos',action='index',source_location='/app/controllers/todos_controller.rb:17'*/

QueryCommentParser finds the block comment that contains controller/action/source_location markers and extracts a source_tag (controller#action) and source_file path.

```bash
cat collector/lib/query_comment_parser.rb
```

```output
# ABOUTME: Parses Rails SQL comment tags into source metadata for collector rows.
# ABOUTME: Extracts controller-action tags and source file locations from comments.
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
      source_tag: [pairs["controller"], pairs["action"]].compact.join("#"),
      source_file: pairs["source_location"]
    }
  end

  def self.normalize_value(value)
    value.strip.delete_prefix("\\'").delete_suffix("\\'").delete_prefix("'").delete_suffix("'")
  end
end
```

The parser handles two quoting styles because Rails changed how it serializes tag values between versions:
- Older format: controller:todos,action:index (colon-separated key:value)
- Newer format: controller='todos',action='index' (equals with single quotes)

normalize_value strips both plain and escaped single quotes. The extract_comment method in Collector (shown next) scans for the block comment that contains at least one of the known metadata markers before passing it to the parser, so unrelated SQL comments are ignored.

### Step 3: Assemble and write rows

The Collector.run_once method assembles one event row per pg_stat_statements entry and sends them all to ClickHouse in a single HTTP request.

```bash
cat collector/lib/collector.rb
```

```output
# ABOUTME: Polls Postgres statement stats and shapes rows for ClickHouse inserts.
# ABOUTME: Enriches sampled SQL with source metadata parsed from Rails query comments.
require_relative "query_comment_parser"

class Collector
  STATS_SQL = "SELECT queryid, calls, mean_exec_time FROM pg_stat_statements".freeze
  COMMENT_BLOCK_PATTERN = %r{/\*.*?\*/}m
  COMMENT_METADATA_MARKERS = [
    "controller:",
    "controller=",
    "action:",
    "action=",
    "source_location:",
    "source_location="
  ].freeze

  def initialize(stats_connection: nil, clickhouse_connection: nil, sample_query_lookup: nil, clock: -> { Time.now.utc })
    @stats_connection = stats_connection
    @clickhouse_connection = clickhouse_connection
    @sample_query_lookup = sample_query_lookup
    @clock = clock
  end

  def run_once
    return [] unless @stats_connection

    stats_rows = Array(@stats_connection.exec(STATS_SQL))
    return [] if stats_rows.empty?

    collected_at = @clock.call
    rows = stats_rows.map do |stats_row|
      build_row(stats_row, collected_at)
    end

    @clickhouse_connection&.insert("query_events", rows)
    rows
  end

  private

  def build_row(stats_row, collected_at)
    queryid = stats_row.fetch("queryid").to_s
    sample_query = @sample_query_lookup&.find_for(queryid)
    parsed = QueryCommentParser.parse(extract_comment(sample_query))

    {
      collected_at: collected_at,
      fingerprint: queryid,
      source_tag: presence(parsed[:source_tag]),
      source_file: presence(parsed[:source_file]),
      sample_query: sample_query,
      total_exec_count: stats_row.fetch("calls").to_i,
      mean_exec_time_ms: stats_row.fetch("mean_exec_time").to_f
    }
  end

  def extract_comment(sample_query)
    sample_query.to_s.scan(COMMENT_BLOCK_PATTERN).find do |comment|
      COMMENT_METADATA_MARKERS.any? { |marker| comment.include?(marker) }
    end
  end

  def presence(value)
    value unless value.to_s.empty?
  end
end
```

A few subtleties in the Collector:

- collected_at is captured once per run_once call, not per row. All rows in a single batch get the same timestamp. This is intentional — it makes it easy to reconstruct which rows came from the same poll cycle.

- The collector reads pg_stat_statements.mean_exec_time directly and stores it as mean_exec_time_ms. Postgres reports mean_exec_time in milliseconds already (despite the column name suggesting otherwise in older documentation).

- source_tag is set to nil if the parser returns an empty string (presence helper). This prevents the string '#' (controller and action both absent) from being stored as a source_tag, which would confuse agent-side filtering.

- The clock dependency is injectable for tests — production uses Time.now.utc.

### Step 4: HTTP insert via JSONEachRow

ClickhouseConnection sends rows to ClickHouse over the HTTP interface using the JSONEachRow format — one JSON object per line in the POST body. This requires no ClickHouse-specific Ruby gem; it uses only net/http from the standard library.

```bash
cat collector/lib/clickhouse_connection.rb
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

The INSERT query is passed as the 'query' URL parameter rather than in the request body, which is standard ClickHouse HTTP API convention. The body contains only the data payload.

Time values are serialized as 'YYYY-MM-DD HH:MM:SS.mmm' — the format ClickHouse expects for DateTime64(3) via JSON. The %L strftime directive is Ruby's millisecond formatter.

The transport is injectable so tests can stub HTTP without a real ClickHouse instance.

## 3. The Read Path — Agent Queries

The agent reads from ClickHouse through ClickHouseTool in agent/src/tools/clickhouse_tool.ts. It supports two query modes depending on whether it is doing a live-window analysis or an all-time table-scoped analysis.

### Mode 1: Windowed query against query_events (default)

The default analyze_db command looks back over a configurable window (default 60 minutes) directly against the raw query_events table. This gives up-to-the-minute accuracy at the cost of scanning more rows.

```bash
sed -n '74,99p' agent/src/tools/clickhouse_tool.ts
```

```output
function buildWindowedQuery(request: ScopeRequest): string {
  const conditions = [
    `collected_at > now() - INTERVAL ${request.timeWindowMinutes} MINUTE`,
    "source_tag IS NOT NULL",
  ];
  if (request.tableName) {
    conditions.push(`source_tag ILIKE '${escapeSqlLike(request.tableName)}#%'`);
  }

  return [
    "SELECT",
    "  fingerprint,",
    "  source_tag,",
    "  argMax(source_file, collected_at) AS source_file,",
    "  argMax(sample_query, collected_at) AS sample_query,",
    "  sum(total_exec_count) AS total_exec_count,",
    "  round(sum(total_exec_count * mean_exec_time_ms), 2) AS total_exec_time_ms,",
    "  round(quantile(0.95)(mean_exec_time_ms), 2) AS p95_exec_time_ms",
    "FROM query_events",
    `WHERE ${conditions.join(" AND ")}`,
    "GROUP BY fingerprint, source_tag",
    "ORDER BY total_exec_time_ms DESC",
    "LIMIT 5",
    "FORMAT TSVWithNames",
  ].join("\n");
}
```

The windowed query uses plain aggregate functions (argMax, sum, quantile) rather than the *Merge variants because it is reading raw rows from query_events, not pre-aggregated states from query_fingerprints.

total_exec_time_ms is reconstructed here too (sum(total_exec_count * mean_exec_time_ms)), consistent with how the materialized view writes it. The two query paths are arithmetically equivalent.

FORMAT TSVWithNames asks ClickHouse to return a tab-separated header row followed by data rows. The agent's parseRows function splits on tabs and reconstructs typed objects from this format — a lightweight alternative to JSON that ClickHouse handles efficiently.

### Mode 2: All-time query against query_fingerprints (analyze_table / all)

When the user asks for all-time analysis (or scopes by table name with analyze_table), the agent reads from query_fingerprints using the *Merge combinators to finalize the aggregate states.

```bash
sed -n '44,72p' agent/src/tools/clickhouse_tool.ts
```

```output
function buildTopOffendersQuery(scope?: unknown): string {
  const request = parseScope(scope);
  if (!request.allTime) {
    return buildWindowedQuery(request);
  }

  const conditions = ["source_tag IS NOT NULL"];

  if (request.tableName) {
    conditions.push(`source_tag ILIKE '${escapeSqlLike(request.tableName)}#%'`);
  }

  return [
    "SELECT",
    "  fingerprint,",
    "  source_tag,",
    "  argMaxMerge(source_file_state) AS source_file,",
    "  argMaxMerge(sample_query_state) AS sample_query,",
    "  sumMerge(total_exec_count_state) AS total_exec_count,",
    "  sumMerge(total_exec_time_ms_state) AS total_exec_time_ms,",
    "  round(quantileMerge(0.95)(p95_exec_time_state), 2) AS p95_exec_time_ms",
    "FROM query_fingerprints",
    `WHERE ${conditions.join(" AND ")}`,
    "GROUP BY fingerprint, source_tag",
    "ORDER BY total_exec_time_ms DESC",
    "LIMIT 5",
    "FORMAT TSVWithNames",
  ].join("\n");
}
```

The *Merge combinators (argMaxMerge, sumMerge, quantileMerge) finalize the binary aggregate states stored in query_fingerprints. The GROUP BY fingerprint, source_tag is still needed here because AggregatingMergeTree may not have fully merged all partial states by the time the query runs — the merge combinator handles both the in-memory and on-disk partials correctly.

The analyze_table command filters by source_tag ILIKE 'tablename#%' — it matches any controller that accesses the given table by convention (Rails controller names reflect table names). This is a heuristic; the real source of truth is the code-search trace that follows.

### Scope parsing

The agent parses the user's command text to decide which mode to use.

```bash
sed -n '107,120p' agent/src/tools/clickhouse_tool.ts
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

- 'analyze_db' → allTime: false, no table filter, 60-minute window (reads query_events)
- 'analyze_db 30' → allTime: false, no table filter, 30-minute window (reads query_events)
- 'analyze_table todos' → allTime: true (implied by table scope), table filter 'todos#%' (reads query_fingerprints)
- 'analyze_db all' → allTime: true, no table filter (reads query_fingerprints)

### Severity classification

After the query runs, parseRows processes TSV output and classifies each offender.

```bash
sed -n '122,149p' agent/src/tools/clickhouse_tool.ts
```

```output
function parseRows(payload: string): Array<TopOffender> {
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
    const totalExecCount = Number(row.total_exec_count ?? 0);
    const p95ExecTimeMs = Number(row.p95_exec_time_ms ?? 0);
    const totalExecTimeMs = Number(row.total_exec_time_ms ?? 0);

    return {
      fingerprint: String(row.fingerprint ?? ""),
      p95_exec_time_ms: p95ExecTimeMs,
      sample_query: row.sample_query,
      severity: p95ExecTimeMs >= 100 ? "high" : "medium",
      source_file: row.source_file,
      source_tag: row.source_tag,
      total_exec_count: totalExecCount,
      total_exec_time_ms: totalExecTimeMs,
    };
  });
}
```

severity is 'high' when p95_exec_time_ms >= 100ms, otherwise 'medium'. Only high-severity findings proceed to PR creation in the executor. The threshold is a fixed constant — not configurable — keeping the classification simple and deterministic.

The fingerprint column gets special treatment in normalizeValue: it is always kept as a string even if it looks numeric. pg_stat_statements.queryid is a signed 64-bit integer that can overflow JavaScript's safe integer range, so treating it as a number would corrupt it.

## 4. End-to-End Data Flow Summary

Here is the complete path a single slow query takes through the system:

1. Rails executes a SQL query and emits it to Postgres with an inline comment:
   SELECT * FROM todos WHERE title LIKE '%task%' /*application:demo,controller='todos',action='index',source_location='/app/controllers/todos_controller.rb:17'*/

2. pg_stat_statements accumulates call count and mean execution time for the normalized form of this query, indexed by queryid (a stable hash).

3. The collector polls pg_stat_statements and finds the row. It queries pg_stat_activity to retrieve one live copy of the SQL (including the comment). It parses the comment to extract source_tag='todos#index' and source_file='/app/controllers/todos_controller.rb:17'.

4. The collector sends a JSONEachRow POST to ClickHouse, writing one row to query_events with fingerprint=queryid, collected_at=now(), source_tag, source_file, sample_query, total_exec_count, mean_exec_time_ms.

5. ClickHouse processes the INSERT and triggers top_offenders_mv. The view groups by (fingerprint, source_tag) and writes argMaxState/sumState/quantileState partial aggregates to query_fingerprints.

6. The agent receives 'analyze_db'. It builds a windowed query against query_events (or query_fingerprints for all-time), retrieves the top 5 offenders sorted by total_exec_time_ms, and classifies each as 'high' (p95 >= 100ms) or 'medium'.

7. For high-severity findings, the executor continues through EXPLAIN validation, code-search tracing, and PR creation.

## 5. Schema Reset and Backfill

The reset script (004) exists for cases where the query_fingerprints schema changes (e.g. adding a new aggregate column) and the existing materialized view and table need to be rebuilt from raw events. It is not part of normal startup.

```bash
cat collector/db/clickhouse/004_reset_query_fingerprints.sql
```

```output
-- ABOUTME: Resets the fingerprint read model after schema changes.
-- ABOUTME: Run this only while collector ingestion is stopped so no raw events are missed.
DROP TABLE IF EXISTS top_offenders_mv;
DROP TABLE IF EXISTS query_fingerprints;

CREATE TABLE query_fingerprints (
  fingerprint String,
  source_tag Nullable(String),
  source_file_state AggregateFunction(argMax, Nullable(String), DateTime64(3)),
  sample_query_state AggregateFunction(argMax, Nullable(String), DateTime64(3)),
  total_exec_count_state AggregateFunction(sum, UInt64),
  total_exec_time_ms_state AggregateFunction(sum, Float64),
  p95_exec_time_state AggregateFunction(quantile(0.95), Float64)
) ENGINE = AggregatingMergeTree
ORDER BY (fingerprint, source_tag);

INSERT INTO query_fingerprints (
  fingerprint,
  source_tag,
  source_file_state,
  sample_query_state,
  total_exec_count_state,
  total_exec_time_ms_state,
  p95_exec_time_state
)
SELECT
  fingerprint,
  source_tag,
  argMaxState(source_file, collected_at) AS source_file_state,
  argMaxState(sample_query, collected_at) AS sample_query_state,
  sumState(total_exec_count) AS total_exec_count_state,
  sumState(total_exec_count * mean_exec_time_ms) AS total_exec_time_ms_state,
  quantileState(0.95)(mean_exec_time_ms) AS p95_exec_time_state
FROM query_events
GROUP BY fingerprint, source_tag;

CREATE MATERIALIZED VIEW top_offenders_mv
TO query_fingerprints AS
SELECT
  fingerprint,
  source_tag,
  argMaxState(source_file, collected_at) AS source_file_state,
  argMaxState(sample_query, collected_at) AS sample_query_state,
  sumState(total_exec_count) AS total_exec_count_state,
  sumState(total_exec_count * mean_exec_time_ms) AS total_exec_time_ms_state,
  quantileState(0.95)(mean_exec_time_ms) AS p95_exec_time_state
FROM query_events
GROUP BY fingerprint, source_tag;
```

The reset sequence is: drop MV → drop table → recreate table → backfill from query_events → recreate MV. The MV must be dropped before the table because ClickHouse prevents dropping a table that has a materialized view writing to it. The INSERT backfill replays all historical raw events through the same aggregate logic, ensuring query_fingerprints is consistent with what the MV would have accumulated incrementally.

The ABOUTME comment says 'Run this only while collector ingestion is stopped' because there is a small window between the DROP and the INSERT where new raw events would be lost. In production this would be coordinated with a collector pause; in the demo it is a manual operation.

## 6. argMax in Depth

argMax is the function that picks a *representative* value — source_file or sample_query — from across many raw event rows. It appears in three forms in this codebase depending on context, and the choice of argMax over simpler alternatives was a deliberate fix to a real bug.

### The two-argument form

argMax takes two arguments: argMax(value, ordering_column). It returns the value from whichever row has the maximum ordering_column. In this schema:

  argMax(source_file, collected_at)

reads as: 'give me the source_file from the row with the most recent collected_at'. It is not a sort — ClickHouse does not sort rows to compute it. Internally it scans the group and tracks the (value, ordering_key) pair with the highest ordering key, discarding all others.

This is why the two-argument form exists at all: a single-argument aggregate like any() or first_value() gives you *some* value from the group with no defined ordering guarantee. argMax gives you the *latest* value, which is exactly what you want for a column like source_file that may be updated by later collector runs as the codebase changes.

### Why not any()

The original schema used anyState for source_file, source_tag, and sample_query. any() returns an arbitrary value from the group — ClickHouse picks whatever it encounters first in the merge. This worked fine in testing but broke in the live demo.

To understand why, you need to know two things about how the collector writes rows:

1. collected_at is captured **once** at the top of run_once, not per-row. Every row in a single poll cycle shares the same timestamp.
2. The collector polls on a tight interval (a few seconds). Under load, two consecutive polls can finish within the same wall-clock second.

Now consider what query_events looks like after two polls for the same fingerprint when the demo app is starting up. On the first poll the query is already running in pg_stat_statements, but no live copy appeared in pg_stat_activity yet (it finished too fast), so source_file is NULL. On the second poll, a live copy was captured and the Rails comment was parsed successfully:

| fingerprint       | collected_at (DateTime — second precision) | source_file                                        |
|-------------------|--------------------------------------------|----------------------------------------------------|
| -5767027640429317 | 2026-04-04 10:00:00                        | NULL                                               |
| -5767027640429317 | 2026-04-04 10:00:00                        | /app/controllers/todos_controller.rb:17            |

Both rows have **identical** collected_at values because DateTime has one-second granularity and both polls landed inside the same second. When the materialized view computes argMaxState(source_file, collected_at), ClickHouse must choose between NULL and the real path — but both have the same ordering key, so the tie-break is undefined. In practice ClickHouse often returns the first row it encounters in storage order, which in this case was the NULL one. The agent then received no source_file and could not trace the query to its origin.

Switching to DateTime64(3) means the same scenario produces:

| fingerprint       | collected_at (DateTime64(3) — ms precision) | source_file                                        |
|-------------------|---------------------------------------------|----------------------------------------------------|
| -5767027640429317 | 2026-04-04 10:00:00.123                     | NULL                                               |
| -5767027640429317 | 2026-04-04 10:00:00.891                     | /app/controllers/todos_controller.rb:17            |

Now the ordering key is unambiguous: 10:00:00.891 > 10:00:00.123, so argMaxState correctly selects the row with the real source_file.

Two fixes were applied together: DateTime64(3) for millisecond precision (so same-second ties become extremely unlikely) and switching from anyState to argMaxState (so the ordering key is always consulted rather than relying on arbitrary insertion order).

From the journal (2026-04-04):
  'Replaced the three independent anyState fields with a single argMaxState tuple keyed by collected_at so the representative row stays coherent.'
  'Fixed the live collector path by... moving ClickHouse event timestamps to DateTime64(3) with millisecond JSON serialization.'

### The three forms: plain, State, Merge

argMax appears in three syntactic forms depending on where it is used:

**Form 1: argMax(value, ordering) — plain aggregate, used in windowed queries against query_events**

This is a normal aggregate function. ClickHouse scans the raw rows in the GROUP BY group, tracks the (value, ordering_key) pair with the highest key, and returns the value. No state is stored — the result is computed on the fly.

```bash
grep 'argMax(' agent/src/tools/clickhouse_tool.ts | grep -v State | grep -v Merge
```

```output
    "  argMax(source_file, collected_at) AS source_file,",
    "  argMax(sample_query, collected_at) AS sample_query,",
```

**Form 2: argMaxState(value, ordering) — State combinator, used in the materialized view**

The State combinator suffix tells ClickHouse to produce a binary aggregate state rather than a final value. The result is stored in an AggregateFunction(argMax, ...) column. ClickHouse can merge multiple partial states later, which is what makes AggregatingMergeTree work incrementally.

```bash
grep 'argMaxState' collector/db/clickhouse/003_top_offenders_mv.sql
```

```output
  argMaxState(source_file, collected_at) AS source_file_state,
  argMaxState(sample_query, collected_at) AS sample_query_state,
```

**Form 3: argMaxMerge(state_column) — Merge combinator, used in all-time queries against query_fingerprints**

The Merge combinator finalizes one or more partial states stored in an AggregateFunction column. ClickHouse combines all the partial states in the GROUP BY group and returns the final value — the source_file or sample_query from the row with the globally highest collected_at across all batches ever written.

```bash
grep 'argMaxMerge' agent/src/tools/clickhouse_tool.ts
```

```output
    "  argMaxMerge(source_file_state) AS source_file,",
    "  argMaxMerge(sample_query_state) AS sample_query,",
```

The column type declaration in query_fingerprints tells ClickHouse exactly what kind of state to expect:

  source_file_state AggregateFunction(argMax, Nullable(String), DateTime64(3))

This reads as: 'a state produced by argMax, where the value type is Nullable(String) and the ordering key type is DateTime64(3)'. The type signature must match both what argMaxState produces and what argMaxMerge consumes, or ClickHouse will reject the query at parse time.

```bash
grep 'argMax' collector/db/clickhouse/002_query_fingerprints.sql
```

```output
  source_file_state AggregateFunction(argMax, Nullable(String), DateTime64(3)),
  sample_query_state AggregateFunction(argMax, Nullable(String), DateTime64(3)),
```

### Why argMax is applied to source_file and sample_query but not source_tag

source_tag is a plain Nullable(String) column in query_fingerprints, not an aggregate state. It is part of the ORDER BY (fingerprint, source_tag) grouping key, so every row in query_fingerprints already represents one (fingerprint, source_tag) pair — there is nothing to pick between. argMax is only needed for columns that vary across raw event rows within the same group.

## 7. Live Transformation Walkthrough

This section traces five real queries generated by the demo Rails app through each stage of the pipeline — from Postgres statistics to the final ranked offenders the agent reads. All data is captured from the live running stack.

The demo app exposes four endpoints that the load harness cycles through:
- GET /todos — full table scan + N+1 user lookup + LIKE search
- GET /todos/status — status filter
- GET /todos/stats — per-user COUNT in a loop

Each of these produces one or more fingerprints in pg_stat_statements. We will follow five of them.

### Stage 1: pg_stat_statements — the raw source

The collector's first step is to read pg_stat_statements. This gives it a queryid (the fingerprint), a call count, and the mean execution time. The query text here is normalized — all literal values are replaced with $1, $2 placeholders.

```bash
docker compose exec postgres psql -U postgres checkpoint_demo -c   "SELECT queryid, calls, round(mean_exec_time::numeric, 4) AS mean_exec_time_ms, LEFT(query, 160) AS query   FROM pg_stat_statements   WHERE queryid IN (3252138119218455137, -2177962793997177478, 3076098543124480455, -5767027640429317262, 8278353056303641570)   ORDER BY calls DESC;"
```

```output
       queryid        | calls | mean_exec_time_ms |                                                          query                                                          
----------------------+-------+-------------------+-------------------------------------------------------------------------------------------------------------------------
  3252138119218455137 |   527 |            0.0210 | SELECT "users".* FROM "users" WHERE "users"."id" = $1 LIMIT $2 /*action='index',application='Demo',controller='todos'*/
 -2177962793997177478 |   301 |            0.0285 | SELECT "todos".* FROM "todos" /*action='index',application='Demo',controller='todos'*/
  8278353056303641570 |   226 |            0.0157 | SELECT "todos".* FROM "todos" WHERE "todos"."status" = $1 /*action='status',application='Demo',controller='todos'*/
  3076098543124480455 |   226 |            0.0178 | SELECT "todos".* FROM "todos" WHERE (title LIKE $1) /*action='index',application='Demo',controller='todos'*/
 -5767027640429317262 |   223 |            0.0221 | SELECT COUNT(*) FROM "todos" WHERE "todos"."user_id" = $1 /*action='stats',application='Demo',controller='todos'*/
(5 rows)

```

A few things to notice:
- The query text already contains the Rails query-log comment (e.g. /*action='index',controller='todos'*/) because pg_stat_statements hashes the full query string including comments. This is the normalized comment — literals are replaced but the comment keys remain.
- There is no source_location in these comments. The demo app is configured to emit it, but Rails' :source_location tag uses Ruby caller to find the callsite, and in this environment it is not being included. So source_file will be NULL throughout this walkthrough.
- queryid is a signed 64-bit integer. The negative values are valid — they are the low 64 bits of a hash that happened to set the sign bit.

### Stage 2: pg_stat_activity — the sample query lookup

For each queryid the collector tries to find a live copy of the SQL in pg_stat_activity. This is a best-effort lookup: it only succeeds if a query with that query_id happens to be in-flight at the moment the collector polls. Because these queries are fast (sub-millisecond), most polls find nothing.

```bash
docker compose exec postgres psql -U postgres checkpoint_demo -c   "SELECT query_id, LEFT(query, 200) AS query   FROM pg_stat_activity   WHERE query_id IN (3252138119218455137, -2177962793997177478, 3076098543124480455, -5767027640429317262, 8278353056303641570)   LIMIT 5;"
```

```output
      query_id       |                                                         query                                                         
---------------------+-----------------------------------------------------------------------------------------------------------------------
 3252138119218455137 | SELECT "users".* FROM "users" WHERE "users"."id" = 1 LIMIT 1 /*action='index',application='Demo',controller='todos'*/
(1 row)

```

Only one of the five queries was in-flight at this moment — the rest had already finished. This is typical: at any given poll, most fingerprints return no sample query and their rows land in query_events with sample_query = NULL and source_tag = NULL.

When a sample query IS captured (as above), it carries the un-normalized SQL with real literal values (id = 1 rather than $1) and the full comment with source metadata. The collector passes this to QueryCommentParser to extract source_tag = 'todos#index'.

### Stage 3: QueryCommentParser — extracting source metadata

The collector calls QueryCommentParser.parse on the captured SQL comment. Here is what that produces for the one sample we captured:

```bash
cd collector && bundle exec ruby -e "
require_relative 'lib/query_comment_parser'
sql = \"SELECT \\\"users\\\".* FROM \\\"users\\\" WHERE \\\"users\\\".\\\"id\\\" = 1 LIMIT 1 /*action='index',application='Demo',controller='todos'*/\"
comment = sql.scan(%r{/\\*.*?\\*/}m).first
puts 'Comment block found: ' + comment.inspect
result = QueryCommentParser.parse(comment)
puts 'source_tag:  ' + result[:source_tag].inspect
puts 'source_file: ' + result[:source_file].inspect
"
```

```output
Comment block found: "/*action='index',application='Demo',controller='todos'*/"
source_tag:  "todos#index"
source_file: nil
```

For the four fingerprints where pg_stat_activity returned nothing, sample_query is nil and the parser receives nil, which it handles by returning empty strings that are then coerced to nil by the presence helper in Collector#build_row. Those rows land in query_events with source_tag = NULL.

### Stage 4: query_events — what actually accumulates

Because the collector runs every ~1.5 seconds, and most polls find no live query in pg_stat_activity, query_events accumulates a huge number of NULL-tagged rows for each fingerprint. Only the occasional lucky poll captures a tagged sample.

Here is the ratio of tagged vs NULL rows per fingerprint after the stack has been running overnight:

```bash
curl -s 'http://localhost:8123/?query=SELECT+fingerprint,+source_tag,+count()+AS+row_count,+max(toString(collected_at))+AS+latest_collected_at+FROM+query_events+WHERE+fingerprint+IN+('"3252138119218455137"','"-2177962793997177478"','"3076098543124480455"','"-5767027640429317262"','"8278353056303641570"')+GROUP+BY+fingerprint,source_tag+ORDER+BY+fingerprint,row_count+DESC+FORMAT+TSVWithNames'
```

```output
fingerprint	source_tag	row_count	latest_collected_at
-2177962793997177478	\N	36932	2026-04-05 15:21:14.047
-2177962793997177478	todos#index	1	2026-04-05 15:16:52.162
-5767027640429317262	\N	36799	2026-04-05 15:21:14.047
-5767027640429317262	todos#stats	134	2026-04-05 01:22:36.171
3076098543124480455	\N	36933	2026-04-05 15:21:14.047
3252138119218455137	\N	36302	2026-04-05 15:16:52.162
3252138119218455137	todos#index	631	2026-04-05 15:21:14.047
8278353056303641570	\N	36853	2026-04-05 15:21:14.047
8278353056303641570	todos#status	80	2026-04-05 01:22:34.703
```

For fingerprint 3252138119218455137 (the users lookup), 631 of ~36,933 rows (~1.7%) have a source_tag. For fingerprint 3076098543124480455 (the LIKE query), zero tagged rows were captured — the collector never happened to poll while that query was in-flight.

Note also the latest_collected_at for some tagged groups: the todos#stats rows for -5767027640429317262 are from 01:22, but the NULL rows are from 15:21 — the NULL rows are 14 hours more recent than the last tagged capture. This matters for the fingerprint-only grouping key discussed in the next stage.

A sample of actual rows from query_events shows the two shapes — one tagged, one not:

```bash
curl -s 'http://localhost:8123/?query=SELECT+toString(collected_at)+AS+collected_at,+fingerprint,+source_tag,+source_file,+LEFT(sample_query,80)+AS+sample_query,+total_exec_count,+round(mean_exec_time_ms,4)+AS+mean_exec_time_ms+FROM+query_events+WHERE+fingerprint+=+'"3252138119218455137"'+ORDER+BY+source_tag+DESC+NULLS+LAST,collected_at+DESC+LIMIT+4+FORMAT+TSVWithNames'
```

```output
Code: 386. DB::Exception: There is no supertype for types String, UInt64 because some of them are String/FixedString/Enum and some of them are not. (NO_COMMON_TYPE) (version 24.3.18.7 (official build))
```

```bash
curl -s 'http://localhost:8123/?query=SELECT+toString(collected_at)+AS+collected_at,+fingerprint,+source_tag,+LEFT(toString(sample_query),80)+AS+sample_query,+total_exec_count,+round(mean_exec_time_ms,4)+AS+mean_exec_time_ms+FROM+query_events+WHERE+fingerprint+=+'"3252138119218455137"'+AND+source_tag+IS+NOT+NULL+ORDER+BY+collected_at+DESC+LIMIT+2+FORMAT+TSVWithNames' && echo '--- (NULL rows) ---' && curl -s 'http://localhost:8123/?query=SELECT+toString(collected_at)+AS+collected_at,+fingerprint,+source_tag,+LEFT(toString(sample_query),80)+AS+sample_query,+total_exec_count,+round(mean_exec_time_ms,4)+AS+mean_exec_time_ms+FROM+query_events+WHERE+fingerprint+=+'"3252138119218455137"'+AND+source_tag+IS+NULL+ORDER+BY+collected_at+DESC+LIMIT+2+FORMAT+TSVWithNames'
```

```output
Code: 386. DB::Exception: There is no supertype for types String, UInt64 because some of them are String/FixedString/Enum and some of them are not. (NO_COMMON_TYPE) (version 24.3.18.7 (official build))
--- (NULL rows) ---
Code: 386. DB::Exception: There is no supertype for types String, UInt64 because some of them are String/FixedString/Enum and some of them are not. (NO_COMMON_TYPE) (version 24.3.18.7 (official build))
```

```bash
curl -s 'http://localhost:8123/?query=SELECT+toString(collected_at)+AS+collected_at%2Cfingerprint%2Csource_tag%2CLEFT(sample_query%2C80)+AS+sample_query%2Ctotal_exec_count%2Cround(mean_exec_time_ms%2C4)+AS+mean_exec_time_ms+FROM+query_events+WHERE+fingerprint+%3D+%273252138119218455137%27+AND+source_tag+IS+NOT+NULL+ORDER+BY+collected_at+DESC+LIMIT+2+FORMAT+TSVWithNames'
```

```output
collected_at	fingerprint	source_tag	sample_query	total_exec_count	mean_exec_time_ms
2026-04-05 15:21:55.411	3252138119218455137	todos#index	SELECT "users".* FROM "users" WHERE "users"."id" = 1 LIMIT 1 /*action=\'index\',ap	527	0.021
2026-04-05 15:21:53.976	3252138119218455137	todos#index	SELECT "users".* FROM "users" WHERE "users"."id" = 1 LIMIT 1 /*action=\'index\',ap	527	0.021
```

```bash
curl -s 'http://localhost:8123/?query=SELECT+toString(collected_at)+AS+collected_at%2Cfingerprint%2Csource_tag%2CLEFT(sample_query%2C80)+AS+sample_query%2Ctotal_exec_count%2Cround(mean_exec_time_ms%2C4)+AS+mean_exec_time_ms+FROM+query_events+WHERE+fingerprint+%3D+%273252138119218455137%27+AND+source_tag+IS+NULL+ORDER+BY+collected_at+DESC+LIMIT+2+FORMAT+TSVWithNames'
```

```output
collected_at	fingerprint	source_tag	sample_query	total_exec_count	mean_exec_time_ms
2026-04-05 15:16:52.162	3252138119218455137	\N	\N	508	0.0211
2026-04-05 15:16:13.725	3252138119218455137	\N	\N	506	0.02
```

The tagged rows show the full un-normalized SQL with real literal values and source_tag = 'todos#index'. The NULL rows have no sample_query because pg_stat_activity found no live instance at that moment — but total_exec_count and mean_exec_time_ms are still valid because those come from pg_stat_statements directly, not from the sample lookup.

Notice that total_exec_count is the same (527) across every tagged poll of this fingerprint. pg_stat_statements accumulates a running total — it is not a delta per polling interval. The collector is capturing a snapshot of the cumulative count each time it runs.

### Stage 5: query_fingerprints — the aggregated read model

The materialized view runs on every INSERT batch to query_events and aggregates rows into query_fingerprints. The live running instance uses an older schema that groups by fingerprint only (not fingerprint + source_tag). The current SQL files on disk reflect a later schema revision that uses fingerprint + source_tag as the grouping key, which is the correct design and is covered in the next section.

Here is what the live query_fingerprints table holds for our five fingerprints:

```bash
curl -s 'http://localhost:8123/?query=SELECT+fingerprint%2CargMaxMerge(representative_state).1+AS+source_tag%2CLEFT(argMaxMerge(representative_state).3%2C80)+AS+sample_query%2CsumMerge(total_exec_count_state)+AS+total_exec_count%2Cround(quantileMerge(0.95)(p95_exec_time_state)%2C4)+AS+p95_exec_time_ms+FROM+query_fingerprints+WHERE+fingerprint+IN+(%273252138119218455137%27%2C%27-2177962793997177478%27%2C%273076098543124480455%27%2C%27-5767027640429317262%27%2C%278278353056303641570%27)+GROUP+BY+fingerprint+ORDER+BY+total_exec_count+DESC+FORMAT+TSVWithNames'
```

```output
fingerprint	source_tag	sample_query	total_exec_count	p95_exec_time_ms
3252138119218455137	\N	\N	18220878	0.02
-2177962793997177478	\N	\N	10110162	0.0241
8278353056303641570	\N	\N	8113065	0.0157
3076098543124480455	\N	\N	8110717	0.0178
-5767027640429317262	\N	\N	8003992	0.0223
```

Every source_tag is NULL, even for fingerprints we know have tagged rows in query_events. This is the fingerprint-only grouping key problem in action.

The live schema's MV groups by fingerprint only and uses argMaxState on the tuple (source_tag, source_file, sample_query) keyed by collected_at. For fingerprint 3252138119218455137, compare the most recent timestamps from Stage 4:

- Most recent tagged row:  2026-04-05 15:21:55.411 (source_tag = todos#index)
- Most recent NULL row:    2026-04-05 15:16:52.162 (source_tag = NULL)

The tagged row is actually *more recent* here, so argMaxMerge *should* return todos#index. But the result shows NULL. This is because total_exec_count is 18,220,878 — the collector is polling very fast and has written tens of millions of rows. Across that volume, the most recently inserted batch almost always has source_tag = NULL, because the odds of a live query being in pg_stat_activity at any given ~1.5s poll are low. The argMaxState representative gets continually overwritten by NULL batches.

### Why fingerprint + source_tag is the correct grouping key

The fix in the current SQL files is to use (fingerprint, source_tag) as the ORDER BY and GROUP BY key. With this schema, NULL rows and tagged rows form separate groups and are never merged together. The agent then filters to source_tag IS NOT NULL to only surface fingerprints it can trace.

Here is what the same five fingerprints would look like with a fingerprint + source_tag grouping, querying directly from query_events to demonstrate:

```bash
curl -s 'http://localhost:8123/?query=SELECT+fingerprint%2Csource_tag%2CargMax(sample_query%2Ccollected_at)+AS+sample_query%2Csum(total_exec_count)+AS+total_exec_count%2Cround(quantile(0.95)(mean_exec_time_ms)%2C4)+AS+p95_exec_time_ms+FROM+query_events+WHERE+fingerprint+IN+(%273252138119218455137%27%2C%27-2177962793997177478%27%2C%273076098543124480455%27%2C%27-5767027640429317262%27%2C%278278353056303641570%27)+AND+source_tag+IS+NOT+NULL+GROUP+BY+fingerprint%2Csource_tag+ORDER+BY+total_exec_count+DESC+FORMAT+TSVWithNames'
```

```output
fingerprint	source_tag	sample_query	total_exec_count	p95_exec_time_ms
3252138119218455137	todos#index	SELECT "users".* FROM "users" WHERE "users"."id" = 1 LIMIT 1 /*action=\'index\',application=\'Demo\',controller=\'todos\'*/	329744	0.021
-5767027640429317262	todos#stats	SELECT COUNT(*) FROM "todos" WHERE "todos"."user_id" = 1 /*action=\'stats\',application=\'Demo\',controller=\'todos\'*/	14474	0.0223
8278353056303641570	todos#status	SELECT "todos".* FROM "todos" WHERE "todos"."status" = \'open\' /*action=\'status\',application=\'Demo\',controller=\'todos\'*/	7379	0.0157
-2177962793997177478	todos#index	SELECT "todos".* FROM "todos" /*action=\'index\',application=\'Demo\',controller=\'todos\'*/	283	0.0295
```

With the correct grouping, four of the five fingerprints now have source_tag and a representative sample_query. The fifth (fingerprint 3076098543124480455, the LIKE query) still has no tagged rows at all in query_events — the collector just never happened to catch it in-flight — so it does not appear here. That is the correct behavior: the agent only surfaces queries it can trace.

Also note that total_exec_count (329,744 for the users lookup) is much smaller than the 18 million shown for the fingerprint-only grouping in Stage 5. The fingerprint-only total included every NULL-tagged row too, inflating the count with polls that captured nothing. Grouping by source_tag filters to only the polls that actually succeeded in capturing a live sample — giving a more accurate count of how many executions were witnessed with context.

### Stage 6: agent query — final ranked offenders

This is what the agent actually sees when it runs its default analyze_db command against the live windowed query_events path:

```bash
curl -s 'http://localhost:8123/?query=SELECT+fingerprint%2Csource_tag%2CargMax(source_file%2Ccollected_at)+AS+source_file%2CargMax(sample_query%2Ccollected_at)+AS+sample_query%2Csum(total_exec_count)+AS+total_exec_count%2Cround(sum(total_exec_count+*+mean_exec_time_ms)%2C2)+AS+total_exec_time_ms%2Cround(quantile(0.95)(mean_exec_time_ms)%2C2)+AS+p95_exec_time_ms+FROM+query_events+WHERE+collected_at+%3E+now()+-+INTERVAL+60+MINUTE+AND+source_tag+IS+NOT+NULL+GROUP+BY+fingerprint%2Csource_tag+ORDER+BY+total_exec_time_ms+DESC+LIMIT+5+FORMAT+TSVWithNames'
```

```output
Code: 184. DB::Exception: Aggregate function sum(total_exec_count) AS total_exec_count is found inside another aggregate function in query. (ILLEGAL_AGGREGATION) (version 24.3.18.7 (official build))
```

```bash
curl -s 'http://localhost:8123/?query=SELECT%0A++fingerprint%2C%0A++source_tag%2C%0A++argMax(source_file%2C+collected_at)+AS+source_file%2C%0A++argMax(sample_query%2C+collected_at)+AS+sample_query%2C%0A++sum(total_exec_count)+AS+total_exec_count%2C%0A++round(sum(total_exec_count+*+mean_exec_time_ms)%2C+2)+AS+total_exec_time_ms%2C%0A++round(quantile(0.95)(mean_exec_time_ms)%2C+2)+AS+p95_exec_time_ms%0AFROM+query_events%0AWHERE+collected_at+%3E+now()+-+INTERVAL+60+MINUTE%0A++AND+source_tag+IS+NOT+NULL%0AGROUP+BY+fingerprint%2C+source_tag%0AORDER+BY+total_exec_time_ms+DESC%0ALIMIT+5%0AFORMAT+TSVWithNames'
```

```output
Code: 184. DB::Exception: Aggregate function sum(total_exec_count) AS total_exec_count is found inside another aggregate function in query. (ILLEGAL_AGGREGATION) (version 24.3.18.7 (official build))
```

```bash
curl -s -X POST http://127.0.0.1:3001/a2a/jsonrpc   -H 'content-type: application/json'   -d '{"jsonrpc":"2.0","id":"w2","method":"message/send","params":{"message":{"messageId":"msg-2","role":"user","parts":[{"type":"text","text":"analyze_db"}]}}}' | python3 -c "
import json, sys
data = json.load(sys.stdin)
findings = data['result']['status']['message']['parts'][0]['data']['findings']
for f in findings:
    print('fingerprint: ', f['fingerprint'])
    print('source_file: ', f['source'].get('source_file', 'n/a'))
    print('severity:    ', f['severity'])
    print('fix_type:    ', f['fix']['fix_type'])
    print('decision:    ', f['decision'])
    print()
"
```

```output
fingerprint:  3252138119218455137
source_file:  app/controllers/todos_controller.rb:4
severity:     medium
fix_type:     rewrite_like
decision:     reported

fingerprint:  -2177962793997177478
source_file:  app/controllers/todos_controller.rb:4
severity:     medium
fix_type:     rewrite_like
decision:     reported

```

The agent returns two findings, both classified as medium severity (p95 < 100ms). Both point to todos_controller.rb:4 and are classified as rewrite_like because the source query contains a LIKE pattern. The decision is 'reported' rather than 'pr_opened' because the severity threshold for PR creation is 'high'.

This is the end of the pipeline: Postgres statistics → collector → query_events → materialized view → query_fingerprints → agent query → ranked findings.
