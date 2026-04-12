// ABOUTME: Verifies ClickHouseTool exposes table discovery and guarded query execution.
// ABOUTME: Keeps the ClickHouse boundary limited to discovery and SELECT-only access.
import assert from "node:assert/strict";
import test from "node:test";

import { ClickHouseTool } from "../../src/tools/clickhouse_tool.ts";

test("ClickHouseTool lists tables from SHOW TABLES", async () => {
  let queryCalls = 0;
  const tool = new ClickHouseTool({
    transport: {
      query: async () => {
        queryCalls += 1;
        return "query_events\ncollector_state\nquery_intervals\nsystem.tables\n";
      },
    },
  });

  assert.deepEqual(await tool.listTables(), [
    "query_events",
    "collector_state",
    "query_intervals",
    "postgres_logs",
    "postgres_log_state",
  ]);
  assert.equal(queryCalls, 0);
});

test("ClickHouseTool hides unsupported tables from discovery", async () => {
  const tool = new ClickHouseTool({
    transport: {
      query: async () => "query_events\ncollector_state\nquery_intervals\ntop_offenders_mv\nsystem.tables\n",
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

test("ClickHouseTool describes a table with TSV output", async () => {
  let sql = "";
  const tool = new ClickHouseTool({
    transport: {
      query: async (value) => {
        sql = value;
        return "fingerprint\tString\n";
      },
    },
  });

  await tool.describeTable("query_events");

  assert.equal(sql, "DESCRIBE TABLE query_events FORMAT TSV");
});

test("ClickHouseTool rejects non-SELECT queries", async () => {
  const tool = new ClickHouseTool({
    transport: {
      query: async () => "unused",
    },
  });

  await assert.rejects(() => tool.executeQuery("DELETE FROM query_events"), /SELECT-only/i);
});

test("ClickHouseTool rejects multi-statement raw queries", async () => {
  const tool = new ClickHouseTool({
    transport: {
      query: async () => "unused",
    },
  });

  await assert.rejects(
    () => tool.executeQuery("SELECT * FROM query_events; SELECT * FROM query_intervals"),
    /single statement/i,
  );
});

test("ClickHouseTool rejects raw queries against unsupported tables", async () => {
  const tool = new ClickHouseTool({
    transport: {
      query: async () => "unused",
    },
  });

  await assert.rejects(
    () => tool.executeQuery("SELECT * FROM system.tables"),
    /supported ClickHouse tables/i,
  );
});

test("ClickHouseTool queries typed findings without source_tag output", async () => {
  const queries: Array<string> = [];
  const tool = new ClickHouseTool({
    transport: {
      query: async (sql: string) => {
        queries.push(sql);
        return [
          "queryid\tsource_file\tstatement_text\ttotal_exec_count\ttotal_exec_time_ms\tavg_exec_time_ms",
          "101\t/app/controllers/todos_controller.rb:12\tSELECT 1\t7\t50.5\t12",
        ].join("\n");
      },
    },
  });

  assert.deepEqual(await tool.queryFindings("analyze_db"), [
    {
      avg_exec_time_ms: 12,
      queryid: "101",
      severity: "medium",
      statement_text: "SELECT 1",
      source_file: "/app/controllers/todos_controller.rb:12",
      total_exec_count: 7,
      total_exec_time_ms: 50.5,
    },
  ]);
  assert.match(queries[0] ?? "", /FROM query_intervals/);
  assert.match(queries[0] ?? "", /LEFT JOIN postgres_logs/);
  assert.match(queries[0] ?? "", /interval_duration_ms <= 3600000/);
  assert.match(queries[0] ?? "", /interval_started_at > now\(\) - INTERVAL 60 MINUTE/);
  assert.match(queries[0] ?? "", /round\(if\(sum\(total_exec_count\) = 0, 0, sum\(delta_exec_time_ms\) \/ sum\(total_exec_count\)\), 2\) AS avg_exec_time_ms/);
  assert.doesNotMatch(queries[0] ?? "", /sample_query/);
  assert.doesNotMatch(queries[0] ?? "", /source_tag/);
});

test("ClickHouseTool parseOffenderRows maps latest_source_file and latest_statement_text column aliases", async () => {
  const tool = new ClickHouseTool({
    transport: {
      query: async () => {
        return [
          "queryid\tlatest_statement_text\tlatest_source_file\tcall_count\ttotal_exec_time_ms\tavg_exec_time_ms",
          "101\tSELECT * FROM todos\t/app/controllers/todos_controller.rb:12\t5\t250.0\t50",
        ].join("\n");
      },
    },
  });

  const findings = await tool.queryFindings("analyze_db");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.statement_text, "SELECT * FROM todos");
  assert.equal(findings[0]?.source_file, "/app/controllers/todos_controller.rb:12");
  assert.equal(findings[0]?.queryid, "101");
});

test("ClickHouseTool queries all-time findings from query_intervals", async () => {
  const queries: Array<string> = [];
  const tool = new ClickHouseTool({
    transport: {
      query: async (sql: string) => {
        queries.push(sql);
        return [
          "queryid\tsource_file\tstatement_text\ttotal_exec_count\ttotal_exec_time_ms\tavg_exec_time_ms",
          "102\t/app/models/todo.rb:5\tSELECT 2\t9\t100.0\t200",
        ].join("\n");
      },
    },
  });

  await tool.queryFindings("analyze_table todos all");

  assert.match(queries[0] ?? "", /FROM query_intervals/);
  assert.match(queries[0] ?? "", /LEFT JOIN postgres_logs/);
  assert.doesNotMatch(queries[0] ?? "", /source_tag/);
  assert.match(queries[0] ?? "", /GROUP BY queryid/);
});

test("ClickHouseTool rejects describeTable for unsupported table", async () => {
  const tool = new ClickHouseTool({
    transport: {
      query: async () => "unused",
    },
  });

  await assert.rejects(() => tool.describeTable("system.tables"), /Unsupported ClickHouse table/i);
});

test("ClickHouseTool rejects executeQuery with no table reference", async () => {
  const tool = new ClickHouseTool({
    transport: {
      query: async () => "unused",
    },
  });

  await assert.rejects(
    () => tool.executeQuery("SELECT now()"),
    /supported ClickHouse tables/i,
  );
});
