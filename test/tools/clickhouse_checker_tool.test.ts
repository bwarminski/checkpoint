// ABOUTME: Verifies the ClickHouse checker uses the shared subagent adapter.
// ABOUTME: Confirms ClickHouse prompts can be validated without a live model.
import assert from "node:assert/strict";
import test from "node:test";

import { createClickHouseCheckerTool } from "../../src/tools/clickhouse/checker_tool.ts";

test("clickhouse checker delegates to the injected subagent", async () => {
  const prompts: Array<string> = [];
  const tool = createClickHouseCheckerTool({
    runCheck: async (prompt) => {
      prompts.push(prompt);
      return {
        verdict: "rewrite",
        rewrittenQuery: "select * from query_events limit 5",
        notes: ["limit added"],
      };
    },
  });

  const result = await tool.execute({
    dialect: "clickhouse",
    question: "Validate this query",
    query: "select * from query_events",
  });

  assert.equal(prompts.length, 1);
  assert.match(prompts[0] ?? "", /query_events/);
  assert.equal(result.verdict, "rewrite");
});
