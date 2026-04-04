// ABOUTME: Verifies ClickHouseTool reads and normalizes offender rows from ClickHouse results.
// ABOUTME: Keeps the real query boundary focused on source-tagged application findings.
import assert from "node:assert/strict";
import test from "node:test";

import { ClickHouseTool } from "../src/tools/clickhouse_tool.ts";

test("ClickHouseTool loads top offenders from source-tagged rows", async () => {
  const queries: Array<string> = [];
  const tool = new ClickHouseTool(undefined, {
    transport: {
      query: async (sql: string) => {
        queries.push(sql);
        return [
          "fingerprint\tsource_tag\tsource_file\tsample_query\ttotal_exec_count\tp95_exec_time_ms",
          "3252138119218455137\ttodos#index\t\\N\tSELECT \\\"users\\\".* FROM \\\"users\\\" WHERE \\\"users\\\".\\\"id\\\" = 1 LIMIT 1 /*action=\\'index\\',application=\\'Demo\\',controller=\\'todos\\'*/\t6547\t0.02",
        ].join("\n");
      },
    },
  });

  const results = await tool.topOffenders("analyze_db");

  assert.match(queries[0] ?? "", /HAVING source_tag IS NOT NULL/);
  assert.deepEqual(results, [
    {
      fingerprint: "3252138119218455137",
      p95_exec_time_ms: 0.02,
      sample_query:
        "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"id\" = 1 LIMIT 1 /*action='index',application='Demo',controller='todos'*/",
      severity: "high",
      source_file: null,
      source_tag: "todos#index",
      total_exec_count: 6547,
    },
  ]);
});

test("ClickHouseTool scopes analyze_table requests to the named table", async () => {
  const queries: Array<string> = [];
  const tool = new ClickHouseTool(undefined, {
    transport: {
      query: async (sql: string) => {
        queries.push(sql);
        return "fingerprint\tsource_tag\tsource_file\tsample_query\ttotal_exec_count\tp95_exec_time_ms";
      },
    },
  });

  await tool.topOffenders("analyze_table todos");

  assert.match(queries[0] ?? "", /todos#/);
});
