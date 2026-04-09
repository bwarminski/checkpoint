// ABOUTME: Verifies the root ClickHouse tool only depends on root-package contracts.
// ABOUTME: Keeps the root tool boundary clear of agent package internals.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ClickHouseTool } from "../../src/tools/clickhouse_tool.ts";

test("clickhouse_tool.ts does not reference agent internals", async () => {
  const source = await readFile(new URL("../../src/tools/clickhouse_tool.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /agent\/src\/clickhouse_schema_contract\.ts/);
  assert.doesNotMatch(source, /agent\//);
});

test("queryFindings groups by fingerprint only", async () => {
  const queries: Array<string> = [];
  const tool = new ClickHouseTool({
    transport: {
      query: async (sql: string) => {
        queries.push(sql);
        return ["fingerprint\tString", "fp-1"].join("\n");
      },
    },
  });

  await tool.queryFindings("analyze_table todos");

  assert.doesNotMatch(queries[0] ?? "", /source_tag/);
  assert.match(queries[0] ?? "", /GROUP BY fingerprint/);
});
