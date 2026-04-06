// ABOUTME: Verifies ClickHouseTool exposes table discovery and guarded query execution.
// ABOUTME: Keeps the ClickHouse boundary limited to discovery and SELECT-only access.
import assert from "node:assert/strict";
import test from "node:test";

import { ClickHouseTool } from "../src/tools/clickhouse_tool.ts";

test("ClickHouseTool lists tables from SHOW TABLES", async () => {
  const tool = new ClickHouseTool({
    transport: {
      query: async () => "query_events\nquery_fingerprints\n",
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

test("ClickHouseTool rejects non-SELECT queries", async () => {
  const tool = new ClickHouseTool({
    transport: {
      query: async () => "unused",
    },
  });

  await assert.rejects(() => tool.executeQuery("DELETE FROM query_events"), /SELECT-only/i);
});
