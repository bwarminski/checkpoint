// ABOUTME: Validates the ExplainTool SQL safety boundary.
// ABOUTME: Ensures only SELECT statements reach EXPLAIN ANALYZE at Gate A.
import assert from "node:assert/strict";
import test from "node:test";

import { ExplainTool } from "../src/tools/explain_tool.ts";

test("ExplainTool rejects destructive SQL", async () => {
  const tool = new ExplainTool({ query: async () => ({ rows: [] }) });

  await assert.rejects(
    () => tool.analyze({ sql: "DELETE FROM todos" }),
    /SELECT-only/i,
  );
});
