// ABOUTME: Verifies Postgres schema inspection returns the runner rows unchanged.
// ABOUTME: Confirms the schema tool stays a coarse injectable adapter.
import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresSchemaTool } from "../../src/tools/postgres/schema_tool.ts";

test("postgres schema tool returns column details for the requested tables", async () => {
  let received = "";
  const tool = createPostgresSchemaTool(async (sql) => {
    received = sql;
    return [
      { table_name: "todos", column_name: "id", data_type: "integer" },
      { table_name: "todos", column_name: "title", data_type: "text" },
    ];
  });

  const rows = await tool.execute({ schema: "public", tables: ["todos"] });

  assert.equal(rows.length, 2);
  assert.match(received, /information_schema\.columns/);
  assert.match(received, /'todos'/);
});

test("postgres schema tool rejects empty table lists", async () => {
  const tool = createPostgresSchemaTool(async () => []);

  await assert.rejects(
    () => tool.execute({ schema: "public", tables: [] }),
    /table list/i,
  );
});

test("postgres schema tool rejects non-identifier table names", async () => {
  const tool = createPostgresSchemaTool(async () => []);

  await assert.rejects(
    () => tool.execute({ schema: "public", tables: ["todos;drop"] }),
    /invalid.*table/i,
  );
});
