// ABOUTME: Verifies ClickHouse schema inspection renders schema and sample rows.
// ABOUTME: Confirms the tool keeps identifier validation while returning plain text.
import assert from "node:assert/strict";
import test from "node:test";

import { createClickHouseSchemaTool } from "../../src/tools/clickhouse/schema_tool.ts";

test("clickhouse schema tool returns formatted schema text for the requested tables", async () => {
  const received: Array<string> = [];
  const tool = createClickHouseSchemaTool(async (sql) => {
    received.push(sql);
    if (sql.includes("system.columns")) {
      return [
        { table: "query_events", name: "fingerprint", type: "String" },
        { table: "query_events", name: "mean_exec_time_ms", type: "Float64" },
        { table: "collector_state", name: "stats_reset", type: "DateTime64(3)" },
      ];
    }

    if (sql.includes("from default.query_events")) {
      return [{ fingerprint: "abc", mean_exec_time_ms: 12.5 }];
    }

    if (sql.includes("from default.collector_state")) {
      return [{ stats_reset: "2026-04-12 10:00:00.000" }];
    }

    return [];
  });

  const text = await tool.execute({
    database: "default",
    tables: ["query_events", "collector_state"],
  });

  assert.match(text, /^Table: query_events/m);
  assert.match(text, /^- fingerprint: String/m);
  assert.match(text, /^abc \| 12\.5/m);
  assert.match(text, /^Table: collector_state/m);
  assert.match(text, /^2026-04-12 10:00:00\.000$/m);
  assert.equal(received.length, 3);
  assert.match(received[0] ?? "", /system\.columns/);
});

test("clickhouse schema tool rejects empty table lists", async () => {
  const tool = createClickHouseSchemaTool(async () => []);

  await assert.rejects(
    () => tool.execute({ database: "default", tables: [] }),
    /table list/i,
  );
});

test("clickhouse schema tool rejects non-identifier table names", async () => {
  const tool = createClickHouseSchemaTool(async () => []);

  await assert.rejects(
    () => tool.execute({ database: "default", tables: ["query_events;drop"] }),
    /invalid.*table/i,
  );
});
