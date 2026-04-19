// ABOUTME: Verifies the Postgres checker delegates query validation to a subagent.
// ABOUTME: Ensures the checker returns the subagent verdict without a live model.
import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresCheckerTool } from "../../src/tools/postgres/checker_tool.ts";

test("postgres checker delegates to the injected subagent", async () => {
  const calls: Array<{
    dialect: "postgres" | "clickhouse";
    question: string;
    query: string;
  }> = [];
  const tool = createPostgresCheckerTool({
    runCheck: async (input) => {
      calls.push(input);
      return { verdict: "safe", rewrittenQuery: "select 1", notes: ["ok"] };
    },
  });

  const result = await tool.execute({
    dialect: "postgres",
    question: "Validate this query",
    query: "select 1",
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    dialect: "postgres",
    question: "Validate this query",
    query: "select 1",
  });
  assert.deepEqual(result, {
    verdict: "safe",
    rewrittenQuery: "select 1",
    notes: ["ok"],
  });
});
