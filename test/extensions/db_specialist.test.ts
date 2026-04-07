// ABOUTME: Verifies the root db-specialist extension registers the specialist tools.
// ABOUTME: Keeps the root package contract stable for the pi extension entry point.
import assert from "node:assert/strict";
import test from "node:test";

import registerDbSpecialist from "../../extensions/db-specialist.ts";

test("db-specialist extension registers the eight specialist tools", () => {
  const toolNames: Array<string> = [];

  registerDbSpecialist({
    registerTool(definition: { name: string }) {
      toolNames.push(definition.name);
    },
  } as any);

  assert.deepEqual(toolNames.sort(), [
    "analyze_query",
    "apply_fix",
    "describe_table",
    "list_tables",
    "locate_source",
    "open_pull_request",
    "query_database",
    "query_findings",
  ]);
});
