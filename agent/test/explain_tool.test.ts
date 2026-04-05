// ABOUTME: Validates the ExplainTool SQL safety boundary.
// ABOUTME: Ensures only SELECT statements reach EXPLAIN ANALYZE at Gate A.
import assert from "node:assert/strict";
import test from "node:test";

import { ExplainTool } from "../src/tools/explain_tool.ts";

test("ExplainTool rejects destructive SQL", async () => {
  const tool = new ExplainTool({ query: async () => ({ rows: [] }) });

  const destructive = [
    "DELETE FROM todos",
    "UPDATE todos SET done = true",
    "INSERT INTO todos (title) VALUES ('x')",
    "DROP TABLE todos",
    "TRUNCATE todos",
  ];

  for (const sql of destructive) {
    await assert.rejects(
      () => tool.analyze({ sql }),
      /SELECT-only/i,
      `should reject: ${sql}`,
    );
  }
});
