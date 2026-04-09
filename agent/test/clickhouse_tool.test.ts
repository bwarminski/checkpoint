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
        return "query_events\nquery_fingerprints\nsystem.tables\n";
      },
    },
  });

  assert.deepEqual(await tool.listTables(), ["query_events", "query_fingerprints"]);
  assert.equal(queryCalls, 0);
});

test("ClickHouseTool hides unsupported tables from discovery", async () => {
  const tool = new ClickHouseTool({
    transport: {
      query: async () => "query_events\nquery_fingerprints\ntop_offenders_mv\nsystem.tables\n",
    },
  });

  assert.deepEqual(await tool.listTables(), ["query_events", "query_fingerprints"]);
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

test("ClickHouseTool reads the schema contract from TSVWithNames output", async () => {
  const queries: Array<string> = [];
  const tool = new ClickHouseTool({
    transport: {
      query: async (sql: string) => {
        queries.push(sql);

        if (sql.includes("schema_contract_tables")) {
          return [
            "name\tcolumns",
            "query_events\tfingerprint,collected_at,source_file",
            "query_fingerprints\tfingerprint,representative_state",
          ].join("\n");
        }

        return ["schema_version", "2"].join("\n");
      },
    },
  });

  assert.deepEqual(await tool.readSchemaContract(), {
    schemaVersion: "2",
    tables: [
      {
        columns: ["fingerprint", "collected_at", "source_file"],
        name: "query_events",
      },
      {
        columns: ["fingerprint", "representative_state"],
        name: "query_fingerprints",
      },
    ],
  });
  assert.match(queries[0] ?? "", /schema_contract FORMAT TSVWithNames/);
  assert.match(queries[1] ?? "", /schema_contract_tables FORMAT TSVWithNames/);
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
    () => tool.executeQuery("SELECT * FROM query_events; SELECT * FROM query_fingerprints"),
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
          "fingerprint\tsource_file\tsample_query\ttotal_exec_count\ttotal_exec_time_ms\tp95_exec_time_ms",
          "fp-1\t/app/controllers/todos_controller.rb:12\tSELECT 1\t7\t50.5\t12",
        ].join("\n");
      },
    },
  });

  assert.deepEqual(await tool.queryFindings("analyze_db"), [
    {
      fingerprint: "fp-1",
      p95_exec_time_ms: 12,
      sample_query: "SELECT 1",
      severity: "medium",
      source_file: "/app/controllers/todos_controller.rb:12",
      total_exec_count: 7,
      total_exec_time_ms: 50.5,
    },
  ]);
  assert.match(queries[0] ?? "", /FROM query_events/);
  assert.doesNotMatch(queries[0] ?? "", /source_tag/);
});

test("ClickHouseTool queries all-time findings from the fingerprint table", async () => {
  const queries: Array<string> = [];
  const tool = new ClickHouseTool({
    transport: {
      query: async (sql: string) => {
        queries.push(sql);
        return [
          "fingerprint\tsource_file\tsample_query\ttotal_exec_count\ttotal_exec_time_ms\tp95_exec_time_ms",
          "fp-2\t/app/models/todo.rb:5\tSELECT 2\t9\t100.0\t200",
        ].join("\n");
      },
    },
  });

  await tool.queryFindings("analyze_table todos all");

  assert.match(queries[0] ?? "", /FROM query_fingerprints/);
  assert.doesNotMatch(queries[0] ?? "", /source_tag/);
  assert.match(queries[0] ?? "", /GROUP BY fingerprint/);
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
