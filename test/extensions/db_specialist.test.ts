// ABOUTME: Verifies the root db-specialist extension registers the specialist tools.
// ABOUTME: Keeps the root package contract stable for the pi extension entry point.
import assert from "node:assert/strict";
import test from "node:test";

import registerDbSpecialist from "../../extensions/db-specialist.ts";
import { DemoRepoTool } from "../../src/tools/demo_repo_tool.ts";
import { GitHubTool } from "../../src/tools/github_tool.ts";

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

test("db-specialist extension gates apply_fix before calling DemoRepoTool", async () => {
  const originalApplyFix = DemoRepoTool.prototype.applyFix;
  let calls = 0;
  DemoRepoTool.prototype.applyFix = async function () {
    calls += 1;
    return { branchName: "branch", diff: "diff" };
  };

  try {
    const tools = collectRegisteredTools();
    const applyFix = tools.get("apply_fix");

    assert.ok(applyFix);

    await assert.rejects(
      () =>
        applyFix!.execute({
          finding: { fingerprint: "fp-1", severity: "medium" },
          fix: { fix_type: "rewrite_like", summary: "summary" },
          source: { content: "content", source_file: "app/controllers/todos_controller.rb:3" },
          validation: { validated: true },
        }),
      /high-severity/i,
    );

    await assert.rejects(
      () =>
        applyFix!.execute({
          finding: { fingerprint: "fp-2", severity: "high" },
          fix: { fix_type: "rewrite_like", summary: "summary" },
          source: { content: "content", source_file: "app/controllers/todos_controller.rb:3" },
          validation: { validated: false },
        }),
      /validated query input/i,
    );

    await assert.rejects(
      () =>
        applyFix!.execute({
          finding: { fingerprint: "fp-3", severity: "high" },
          fix: { fix_type: "rewrite_like", summary: "summary" },
          source: { content: "content", source_file: "" },
          validation: { validated: true },
        }),
      /source_file/i,
    );

    assert.equal(calls, 0);
  } finally {
    DemoRepoTool.prototype.applyFix = originalApplyFix;
  }
});

test("db-specialist extension gates open_pull_request before calling GitHubTool", async () => {
  const originalOpenPullRequest = GitHubTool.prototype.openPullRequest;
  let calls = 0;
  GitHubTool.prototype.openPullRequest = async function () {
    calls += 1;
    return { url: "local://db-specialist/pull-requests/fp" };
  };

  try {
    const tools = collectRegisteredTools();
    const openPullRequest = tools.get("open_pull_request");

    assert.ok(openPullRequest);

    await assert.rejects(
      () =>
        openPullRequest!.execute({
          codeDiff: "diff --git a/app/controllers/todos_controller.rb b/app/controllers/todos_controller.rb",
          finding: { fingerprint: "fp-4" },
          fix: { fix_type: "rewrite_like", summary: "summary" },
          validation: { validated: true },
        }),
      /headRef/i,
    );

    await assert.rejects(
      () =>
        openPullRequest!.execute({
          finding: { fingerprint: "fp-5" },
          fix: { fix_type: "rewrite_like", summary: "summary" },
          headRef: "agent/demo-fix-fp",
          validation: { validated: true },
        }),
      /codeDiff/i,
    );

    assert.equal(calls, 0);
  } finally {
    GitHubTool.prototype.openPullRequest = originalOpenPullRequest;
  }
});

function collectRegisteredTools(): Map<string, { execute: (input: any) => Promise<unknown> }> {
  const tools = new Map<string, { execute: (input: any) => Promise<unknown> }>();

  registerDbSpecialist({
    registerTool(definition: { execute?: (input: any) => Promise<unknown>; name: string }) {
      if (definition.execute) {
        tools.set(definition.name, { execute: definition.execute });
      }
    },
  } as any);

  return tools;
}
