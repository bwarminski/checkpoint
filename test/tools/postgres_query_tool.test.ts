// ABOUTME: Verifies Postgres query tool renders formatted text and error strings.
// ABOUTME: Keeps exploratory Postgres queries bounded before they reach the runner.
import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresQueryTool } from "../../src/tools/postgres/query_tool.ts";

test("postgres query tool renders formatted query results", async () => {
  let received = "";
  const tool = createPostgresQueryTool(async (sql) => {
    received = sql;
    return [{ id: 1 }, { id: 2 }];
  });

  const text = await tool.execute({
    query: "select id from todos",
    rowCap: 10,
    timeoutMs: 2_000,
  });

  assert.match(text, /^id$/m);
  assert.match(text, /^1$/m);
  assert.match(text, /^2$/m);
  assert.match(received, /statement_timeout/);
  assert.match(received, /LIMIT 10/);
});

test("postgres query tool returns Error text when execution fails", async () => {
  const tool = createPostgresQueryTool(async () => {
    throw new Error("relation does not exist");
  });

  assert.equal(
    await tool.execute({ query: "select * from missing_table" }),
    "Error: relation does not exist",
  );
});
