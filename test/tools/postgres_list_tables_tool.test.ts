// ABOUTME: Verifies Postgres list-tables tool normalizes table names.
// ABOUTME: Ensures the tool only depends on an injected query runner.
import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresListTablesTool } from "../../src/tools/postgres/list_tables_tool.ts";

test("postgres list tables returns plain table names", async () => {
  const tool = createPostgresListTablesTool(async () => [
    { table_name: "todos" },
    { table_name: "users" },
  ]);

  assert.deepEqual(await tool.execute({ schema: "public" }), ["todos", "users"]);
});
