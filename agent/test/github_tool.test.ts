// ABOUTME: Verifies GitHubTool can return a stable demo pull request result locally.
// ABOUTME: Keeps the Step 8 runtime flow from depending on a live external GitHub repo.
import assert from "node:assert/strict";
import test from "node:test";

import { GitHubTool } from "../src/tools/github_tool.ts";

test("GitHubTool returns a local demo pull request url when no client is configured", async () => {
  const tool = new GitHubTool();

  const result = await tool.openPullRequest({
    finding: { fingerprint: "fp-demo" },
  });

  assert.deepEqual(result, {
    url: "local://db-specialist/pull-requests/fp-demo",
  });
});
