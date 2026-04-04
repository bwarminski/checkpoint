// ABOUTME: Verifies the exported A2A service surface advertised by the local server.
// ABOUTME: Keeps the agent card aligned with the commands the executor is expected to handle.
import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "../src/server.ts";

test("createServer advertises analyze_db and analyze_table skills", () => {
  const server = createServer({ baseUrl: "http://127.0.0.1:3001" });

  assert.deepEqual(
    server.agentCard.skills.map((skill) => skill.id),
    ["analyze_db", "analyze_table"],
  );
});
