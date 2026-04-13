// ABOUTME: Verifies the root ClickHouse tool only depends on root-package contracts.
// ABOUTME: Keeps the root tool boundary clear of agent package internals.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ClickHouseTool } from "../../src/tools/clickhouse_tool.ts";

test("clickhouse_tool.ts does not reference agent internals or schema contract helpers", async () => {
  const source = await readFile(new URL("../../src/tools/clickhouse_tool.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /agent\/src\/clickhouse_schema_contract\.ts/);
  assert.doesNotMatch(source, /agent\//);
  assert.doesNotMatch(source, /readSchemaContract/);
  assert.doesNotMatch(source, /clickhouse_schema_contract/);
});

test("queryFindings groups by queryid and reads source locations from comment metadata", async () => {
  const queries: Array<string> = [];
  const tool = new ClickHouseTool({
    transport: {
      query: async (sql: string) => {
        queries.push(sql);
        return ["queryid\tString", "101"].join("\n");
      },
    },
  });

  await tool.queryFindings("analyze_table todos");

  assert.match(queries[0] ?? "", /comment_metadata\['source_location'\]/);
  assert.doesNotMatch(queries[0] ?? "", /sample_query/);
  assert.match(queries[0] ?? "", /LEFT JOIN postgres_logs/);
  assert.match(queries[0] ?? "", /GROUP BY queryid/);
  assert.match(queries[0] ?? "", /FROM query_intervals/);
  assert.match(queries[0] ?? "", /interval_duration_ms <= 3600000/);
  assert.match(queries[0] ?? "", /interval_started_at > now\(\) - INTERVAL 60 MINUTE/);
  assert.match(queries[0] ?? "", /round\(if\(sum\(total_exec_count\) = 0, 0, sum\(delta_exec_time_ms\) \/ sum\(total_exec_count\)\), 2\) AS avg_exec_time_ms/);
  assert.doesNotMatch(queries[0] ?? "", /\bsource_location\b(?!'\])/);
  assert.doesNotMatch(queries[0] ?? "", /\bsource_file\b/);
});

test("queryFindings does not fall back to the removed source_file column", async () => {
  const tool = new ClickHouseTool({
    transport: {
      query: async () =>
        [
          "queryid\tlatest_statement_text\tsource_file\tcall_count\ttotal_exec_time_ms\tavg_exec_time_ms",
          "101\tSELECT 1\t/app/controllers/todos_controller.rb:12\t7\t50.5\t12",
        ].join("\n"),
    },
  });

  const findings = await tool.queryFindings("analyze_db");

  assert.equal(findings[0]?.source_file, "");
});

test("queryFindings falls back to query interval metadata when postgres log source location is empty", async () => {
  const queries: Array<string> = [];
  const tool = new ClickHouseTool({
    transport: {
      query: async (sql: string) => {
        queries.push(sql);
        return [
          "queryid\tlatest_statement_text\tlatest_source_location\tcall_count\ttotal_exec_time_ms\tavg_exec_time_ms",
          "101\tSELECT 1\t/app/models/todo.rb:5\t7\t50.5\t12",
        ].join("\n");
      },
    },
  });

  const findings = await tool.queryFindings("analyze_db");

  assert.equal(findings[0]?.source_file, "/app/models/todo.rb:5");
  assert.match(
    queries[0] ?? "",
    /coalesce\(nullIf\(argMax\(postgres_logs\.comment_metadata\['source_location'\], postgres_logs\.log_timestamp\), ''\), argMax\(query_intervals\.comment_metadata\['source_location'\], interval_ended_at\)\)/,
  );
  assert.match(queries[0] ?? "", /argMax\(query_intervals\.comment_metadata\['source_location'\], interval_ended_at\)/);
});

test("queryFindings reads all-time findings from query_intervals", async () => {
  const queries: Array<string> = [];
  const tool = new ClickHouseTool({
    transport: {
      query: async (sql: string) => {
        queries.push(sql);
        return ["queryid\tString", "101"].join("\n");
      },
    },
  });

  await tool.queryFindings("analyze_table todos all");

  assert.match(queries[0] ?? "", /FROM query_intervals/);
  assert.match(queries[0] ?? "", /LEFT JOIN postgres_logs/);
});

test("queryFindings uses non-conflicting aliases to avoid ClickHouse cyclic alias errors", async () => {
  const queries: Array<string> = [];
  const tool = new ClickHouseTool({
    transport: {
      query: async (sql: string) => {
        queries.push(sql);
        return ["queryid\tString", "101"].join("\n");
      },
    },
  });

  await tool.queryFindings();
  await tool.queryFindings("all");

  for (const sql of queries) {
    assert.match(sql, /sum\(total_exec_count\) AS call_count/);
    assert.doesNotMatch(sql, /sum\(total_exec_count\) AS total_exec_count/);
    assert.match(sql, /AS latest_source_location/);
    assert.match(sql, /AS latest_statement_text/);
    assert.doesNotMatch(sql, /\) AS source_file/);
    assert.doesNotMatch(sql, /\) AS statement_text/);
    assert.match(sql, /comment_metadata\['source_location'\]/);
  }
});

test("listTables returns exactly the supported checkpoint schema tables", async () => {
  const tool = new ClickHouseTool({
    transport: {
      query: async () => "unused",
    },
  });

  assert.deepEqual(await tool.listTables(), [
    "query_events",
    "collector_state",
    "query_intervals",
    "postgres_logs",
    "postgres_log_state",
  ]);
});
