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
          "fingerprint\tsource_tag\tsource_file\tsample_query\ttotal_exec_count\ttotal_exec_time_ms\tp95_exec_time_ms",
          "3252138119218455137\ttodos#index\t\\N\tSELECT \\\"users\\\".* FROM \\\"users\\\" WHERE \\\"users\\\".\\\"id\\\" = 1 LIMIT 1 /*action=\\'index\\',application=\\'Demo\\',controller=\\'todos\\'*/\t6547\t123.45\t0.02",
        ].join("\n");
      },
    },
  });

  const results = await tool.topOffenders("analyze_db");

  assert.match(queries[0] ?? "", /source_tag IS NOT NULL/);
  assert.deepEqual(results, [
    {
      fingerprint: "3252138119218455137",
      p95_exec_time_ms: 0.02,
      sample_query:
        "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"id\" = 1 LIMIT 1 /*action='index',application='Demo',controller='todos'*/",
      severity: "medium",
      source_file: null,
      source_tag: "todos#index",
      total_exec_count: 6547,
      total_exec_time_ms: 123.45,
    },
  ]);
});

test("ClickHouseTool orders offenders by total execution time and marks high severity from p95", async () => {
  const queries: Array<string> = [];
  const tool = new ClickHouseTool(undefined, {
    transport: {
      query: async (sql: string) => {
        queries.push(sql);
        return [
          "fingerprint\tsource_tag\tsource_file\tsample_query\ttotal_exec_count\ttotal_exec_time_ms\tp95_exec_time_ms",
          "slow-low-count\ttodos#index\t\\N\tSELECT 1\t2\t400.5\t120",
          "fast-high-count\ttodos#status\t\\N\tSELECT 2\t999\t200.0\t80",
        ].join("\n");
      },
    },
  });

  const results = await tool.topOffenders("analyze_db");

  assert.match(queries[0] ?? "", /round\(sum\(total_exec_count \* mean_exec_time_ms\), 2\) AS total_exec_time_ms/);
  assert.match(queries[0] ?? "", /ORDER BY total_exec_time_ms DESC/);
  assert.deepEqual(
    results.map((row) => ({
      fingerprint: row.fingerprint,
      severity: row.severity,
      total_exec_time_ms: row.total_exec_time_ms,
    })),
    [
      { fingerprint: "slow-low-count", severity: "high", total_exec_time_ms: 400.5 },
      { fingerprint: "fast-high-count", severity: "medium", total_exec_time_ms: 200 },
    ],
  );
});

test("ClickHouseTool scopes analyze_table requests to the named table", async () => {
  const queries: Array<string> = [];
  const tool = new ClickHouseTool(undefined, {
    transport: {
      query: async (sql: string) => {
        queries.push(sql);
        return "fingerprint\tsource_tag\tsource_file\tsample_query\ttotal_exec_count\ttotal_exec_time_ms\tp95_exec_time_ms";
      },
    },
  });

  await tool.topOffenders("analyze_table todos");

  assert.match(queries[0] ?? "", /todos#/);
});

test("ClickHouseTool uses query_events for time-windowed requests", async () => {
  const queries: Array<string> = [];
  const tool = new ClickHouseTool(undefined, {
    transport: {
      query: async (sql: string) => {
        queries.push(sql);
        return "fingerprint\tsource_tag\tsource_file\tsample_query\ttotal_exec_count\ttotal_exec_time_ms\tp95_exec_time_ms";
      },
    },
  });

  await tool.topOffenders("analyze_db");

  assert.match(queries[0] ?? "", /FROM query_events/);
  assert.match(queries[0] ?? "", /collected_at > now\(\) - INTERVAL 60 MINUTE/);
  assert.match(
    queries[0] ?? "",
    /tupleElement\(argMax\(\(source_file, sample_query\), collected_at\), 1\) AS source_file/,
  );
  assert.match(
    queries[0] ?? "",
    /tupleElement\(argMax\(\(source_file, sample_query\), collected_at\), 2\) AS sample_query/,
  );
  assert.match(
    queries[0] ?? "",
    /GROUP BY fingerprint, source_tag/,
  );
  assert.match(queries[0] ?? "", /ORDER BY total_exec_time_ms DESC/);
});

test("ClickHouseTool uses source-tag-aware query_fingerprints for all-time requests", async () => {
  const queries: Array<string> = [];
  const tool = new ClickHouseTool(undefined, {
    transport: {
      query: async (sql: string) => {
        queries.push(sql);
        return "fingerprint\tsource_tag\tsource_file\tsample_query\ttotal_exec_count\ttotal_exec_time_ms\tp95_exec_time_ms";
      },
    },
  });

  await tool.topOffenders("analyze_db all");

  assert.match(queries[0] ?? "", /FROM query_fingerprints/);
  assert.match(
    queries[0] ?? "",
    /SELECT\n  fingerprint,\n  source_tag,\n  tupleElement\(argMaxMerge\(representative_state\), 1\) AS source_file,\n  tupleElement\(argMaxMerge\(representative_state\), 2\) AS sample_query,\n  sumMerge\(total_exec_count_state\) AS total_exec_count,\n  sumMerge\(total_exec_time_ms_state\) AS total_exec_time_ms,\n  round\(quantileMerge\(0\.95\)\(p95_exec_time_state\), 2\) AS p95_exec_time_ms\nFROM query_fingerprints/,
  );
  assert.match(queries[0] ?? "", /GROUP BY fingerprint, source_tag/);
  assert.match(queries[0] ?? "", /ORDER BY total_exec_time_ms DESC/);
});

test("ClickHouseTool keeps analyze_table all-time filtering source-tag aware", async () => {
  const queries: Array<string> = [];
  const tool = new ClickHouseTool(undefined, {
    transport: {
      query: async (sql: string) => {
        queries.push(sql);
        return "fingerprint\tsource_tag\tsource_file\tsample_query\ttotal_exec_count\ttotal_exec_time_ms\tp95_exec_time_ms";
      },
    },
  });

  await tool.topOffenders("analyze_table todos all");

  assert.match(queries[0] ?? "", /FROM query_fingerprints/);
  assert.match(queries[0] ?? "", /WHERE source_tag IS NOT NULL AND source_tag ILIKE 'todos#%'/);
  assert.match(queries[0] ?? "", /GROUP BY fingerprint, source_tag/);
  assert.match(queries[0] ?? "", /ORDER BY total_exec_time_ms DESC/);
});
