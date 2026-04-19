// ABOUTME: Verifies ClickHouse query tool renders formatted text and error strings.
// ABOUTME: Keeps the tool honest about bounded exploratory queries.
import assert from "node:assert/strict";
import test from "node:test";

import { createClickHouseQueryTool } from "../../src/tools/clickhouse/query_tool.ts";

test("clickhouse query tool renders formatted query results", async () => {
  let received = "";
  const tool = createClickHouseQueryTool(async (sql) => {
    received = sql;
    return [{ fingerprint: "abc" }, { fingerprint: "def" }];
  });

  const text = await tool.execute({
    query: "select fingerprint from query_events",
    rowCap: 10,
    timeoutMs: 2,
  });

  assert.match(text, /^fingerprint$/m);
  assert.match(text, /^abc$/m);
  assert.match(text, /^def$/m);
  assert.match(received, /max_execution_time/);
  assert.match(received, /LIMIT 10/);
});

test("clickhouse query tool returns Error text when execution fails", async () => {
  const tool = createClickHouseQueryTool(async () => {
    throw new Error("unknown table");
  });

  assert.equal(
    await tool.execute({ query: "select * from missing_table" }),
    "Error: unknown table",
  );
});
