// ABOUTME: Prevents the oh-my-pi redesign from retaining the removed legacy runtime files.
// ABOUTME: Fails if the repo still exposes the A2A and fine-grained tool path.
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

test("legacy runtime files are removed from the main path", async () => {
  await assert.rejects(() => access("src/a2a_bridge/server.ts"));
  await assert.rejects(() => access("src/tools/github_tool.ts"));
  await assert.rejects(() => access("agent/src/executor.ts"));
});
