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

test("queryFindings groups by queryid and reads source locations from postgres logs", async () => {
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

  assert.doesNotMatch(queries[0] ?? "", /source_tag/);
  assert.doesNotMatch(queries[0] ?? "", /sample_query/);
  assert.match(queries[0] ?? "", /LEFT JOIN postgres_logs/);
  assert.match(queries[0] ?? "", /GROUP BY queryid/);
  assert.match(queries[0] ?? "", /FROM query_intervals/);
  assert.match(queries[0] ?? "", /interval_duration_ms <= 3600000/);
  assert.match(queries[0] ?? "", /interval_started_at > now\(\) - INTERVAL 60 MINUTE/);
  assert.match(queries[0] ?? "", /round\(if\(sum\(total_exec_count\) = 0, 0, sum\(delta_exec_time_ms\) \/ sum\(total_exec_count\)\), 2\) AS avg_exec_time_ms/);
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
    assert.match(sql, /AS latest_source_file/);
    assert.match(sql, /AS latest_statement_text/);
    assert.doesNotMatch(sql, /\) AS source_file/);
    assert.doesNotMatch(sql, /\) AS statement_text/);
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
