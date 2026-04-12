// ABOUTME: Verifies Postgres query tool applies statement_timeout and row caps.
// ABOUTME: Keeps exploratory Postgres queries bounded before they reach the runner.
import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresQueryTool } from "../../src/tools/postgres/query_tool.ts";

test("postgres query tool prepends statement_timeout and limit", async () => {
  let received = "";
  const tool = createPostgresQueryTool(async (sql) => {
    received = sql;
    return [{ id: 1 }];
  });

  const rows = await tool.execute({
    query: "select id from todos",
    rowCap: 10,
    timeoutMs: 2_000,
  });

  assert.equal(rows.length, 1);
  assert.match(received, /statement_timeout/);
  assert.match(received, /LIMIT 10/);
});
