// ABOUTME: Verifies the executor emits the minimal lifecycle events for Gate A.
// ABOUTME: Keeps the agent scaffold honest before later orchestration is added.
import assert from "node:assert/strict";
import test from "node:test";

import { DBSpecialistExecutor } from "../src/executor.ts";

test("DBSpecialistExecutor emits working and completed events", async () => {
  const events: Array<unknown> = [];
  const executor = new DBSpecialistExecutor();

  await executor.execute(
    { userMessage: { text: "analyze_db" } },
    {
      enqueueEvent(event: unknown) {
        events.push(event);
      },
    },
  );

  assert.deepEqual(events, [
    { type: "working", message: "analysis started" },
    { type: "completed", result: { findings: [] } },
  ]);
});
