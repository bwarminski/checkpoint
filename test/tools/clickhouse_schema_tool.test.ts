// ABOUTME: Verifies ClickHouse schema inspection returns the runner rows unchanged.
// ABOUTME: Confirms the schema tool stays a coarse injectable adapter.
import assert from "node:assert/strict";
import test from "node:test";

import { createClickHouseSchemaTool } from "../../src/tools/clickhouse/schema_tool.ts";

test("clickhouse schema tool returns column details for the requested tables", async () => {
  let received = "";
  const tool = createClickHouseSchemaTool(async (sql) => {
    received = sql;
    return [
      { table: "query_events", name: "fingerprint", type: "String" },
      { table: "query_events", name: "mean_exec_time_ms", type: "Float64" },
    ];
  });

  const rows = await tool.execute({ database: "default", tables: ["query_events"] });

  assert.equal(rows.length, 2);
  assert.match(received, /system\.columns/);
  assert.match(received, /'query_events'/);
});
