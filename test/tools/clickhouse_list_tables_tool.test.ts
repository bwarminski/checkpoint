// ABOUTME: Verifies ClickHouse list-tables tool normalizes table names.
// ABOUTME: Ensures the tool only depends on an injected query runner.
import assert from "node:assert/strict";
import test from "node:test";

import { createClickHouseListTablesTool } from "../../src/tools/clickhouse/list_tables_tool.ts";

test("clickhouse list tables returns plain table names", async () => {
  const tool = createClickHouseListTablesTool(async () => [
    { name: "query_events" },
    { name: "collector_state" },
  ]);

  assert.deepEqual(await tool.execute({ database: "default" }), [
    "query_events",
    "collector_state",
  ]);
});

test("clickhouse list tables rejects non-identifier databases", async () => {
  let called = false;
  const tool = createClickHouseListTablesTool(async () => {
    called = true;
    return [];
  });

  await assert.rejects(() => tool.execute({ database: "default.system" }), /invalid.*database/i);
  assert.equal(called, false);
});
