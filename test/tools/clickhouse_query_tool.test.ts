// ABOUTME: Verifies ClickHouse query tool applies max_execution_time and row caps.
// ABOUTME: Keeps the tool honest about bounded exploratory queries.
import assert from "node:assert/strict";
import test from "node:test";

import { createClickHouseQueryTool } from "../../src/tools/clickhouse/query_tool.ts";

test("clickhouse query tool prepends execution settings and limit", async () => {
  let received = "";
  const tool = createClickHouseQueryTool(async (sql) => {
    received = sql;
    return [{ fingerprint: "abc" }];
  });

  const rows = await tool.execute({
    query: "select fingerprint from query_events",
    rowCap: 10,
    timeoutMs: 2,
  });

  assert.equal(rows.length, 1);
  assert.match(received, /max_execution_time/);
  assert.match(received, /LIMIT 10/);
});
