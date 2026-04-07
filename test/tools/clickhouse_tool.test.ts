// ABOUTME: Verifies the root ClickHouse tool only depends on root-package contracts.
// ABOUTME: Keeps the root tool boundary clear of agent package internals.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("clickhouse_tool.ts does not reference agent internals", async () => {
  const source = await readFile(new URL("../../src/tools/clickhouse_tool.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /agent\/src\/clickhouse_schema_contract\.ts/);
  assert.doesNotMatch(source, /agent\//);
});
