// ABOUTME: Verifies the root db-specialist extension registers the specialist tools.
// ABOUTME: Keeps the root package contract stable for the pi extension entry point.
import assert from "node:assert/strict";
import test from "node:test";

import registerDbSpecialist, { createDbSpecialistTools } from "../../extensions/db-specialist.ts";
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
          finding: { queryid: "101", severity: "medium" },
          fix: { fix_type: "rewrite_like", summary: "summary" },
          source: { content: "content", source_file: "app/controllers/todos_controller.rb:3" },
          validation: { validated: true },
        }),
      /high-severity/i,
    );

    await assert.rejects(
      () =>
        applyFix!.execute({
          finding: { queryid: "102", severity: "high" },
          fix: { fix_type: "rewrite_like", summary: "summary" },
          source: { content: "content", source_file: "app/controllers/todos_controller.rb:3" },
          validation: { validated: false },
        }),
      /validated query input/i,
    );

    await assert.rejects(
      () =>
        applyFix!.execute({
          finding: { queryid: "103", severity: "high" },
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
    return { url: "local://db-specialist/pull-requests/104" };
  };

  try {
    const tools = collectRegisteredTools();
    const openPullRequest = tools.get("open_pull_request");

    assert.ok(openPullRequest);

    await assert.rejects(
      () =>
        openPullRequest!.execute({
          codeDiff: "diff --git a/app/controllers/todos_controller.rb b/app/controllers/todos_controller.rb",
          finding: { queryid: "104" },
          fix: { fix_type: "rewrite_like", summary: "summary" },
          validation: { validated: true },
        }),
      /headRef/i,
    );

    await assert.rejects(
      () =>
        openPullRequest!.execute({
          finding: { queryid: "105" },
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

test("db-specialist extension returns validated query output usable by apply_fix", async () => {
  const originalApplyFix = DemoRepoTool.prototype.applyFix;
  let capturedInput: unknown;
  DemoRepoTool.prototype.applyFix = async function (input: unknown) {
    capturedInput = input;
    return { branchName: "branch", diff: "diff" };
  };

  try {
    const tools = createDbSpecialistTools({
      explainQuery: async () => ({
        rows: [{ "QUERY PLAN": "Seq Scan on query_events" }],
      }),
    });
    const analyzeQuery = tools.find((tool) => tool.name === "analyze_query")!;
    const applyFix = tools.find((tool) => tool.name === "apply_fix")!;

    const validation = await analyzeQuery.execute({ sql: "SELECT 1 FROM query_events" });

    assert.deepEqual(validation, {
      plan_rows: [{ "QUERY PLAN": "Seq Scan on query_events" }],
      validated: true,
    });

    const result = await applyFix.execute({
      finding: { queryid: "101", severity: "high" },
      fix: { fix_type: "rewrite_like", summary: "summary" },
      source: { content: "content", source_file: "app/controllers/todos_controller.rb:3" },
      validation,
    });

    assert.deepEqual(capturedInput, {
      finding: { queryid: "101" },
      fix: { fix_type: "rewrite_like", summary: "summary" },
      source: { content: "content", source_file: "app/controllers/todos_controller.rb:3" },
    });
    assert.deepEqual(result, {
      branchName: "branch",
      codeDiff: "diff",
      diff: "diff",
      headRef: "branch",
    });
  } finally {
    DemoRepoTool.prototype.applyFix = originalApplyFix;
  }
});

test("db-specialist extension returns apply_fix handoff fields for open_pull_request", async () => {
  const originalApplyFix = DemoRepoTool.prototype.applyFix;
  const originalOpenPullRequest = GitHubTool.prototype.openPullRequest;
  let capturedInput: unknown;
  DemoRepoTool.prototype.applyFix = async function () {
    return {
      branchName: "agent/demo-fix-fp-1",
      diff: "diff --git a/file b/file",
    };
  };
  GitHubTool.prototype.openPullRequest = async function (input: unknown) {
    capturedInput = input;
    return { url: "local://db-specialist/pull-requests/101" };
  };

  try {
    const tools = collectRegisteredTools();
    const applyFix = tools.get("apply_fix");
    const openPullRequest = tools.get("open_pull_request");

    assert.ok(applyFix);
    assert.ok(openPullRequest);

    const validation = {
      plan_rows: [{ "QUERY PLAN": "Index Scan" }],
      validated: true,
    };
    const fixResult = await applyFix!.execute({
      finding: { queryid: "101", severity: "high" },
      fix: { fix_type: "add_index", summary: "Add index" },
      source: { content: "content", source_file: "app/controllers/todos_controller.rb:3" },
      validation,
    });

    assert.deepEqual(fixResult, {
      branchName: "agent/demo-fix-fp-1",
      codeDiff: "diff --git a/file b/file",
      diff: "diff --git a/file b/file",
      headRef: "agent/demo-fix-fp-1",
    });

    const result = await openPullRequest!.execute({
      headRef: fixResult.headRef,
      codeDiff: fixResult.codeDiff,
      finding: { queryid: "101", source_file: "app/controllers/todos_controller.rb:3" },
      fix: { fix_type: "add_index", summary: "Add index" },
      validation,
    });

    assert.deepEqual(capturedInput, {
      codeDiff: "diff --git a/file b/file",
      finding: { queryid: "101", source_file: "app/controllers/todos_controller.rb:3" },
      fix: { fix_type: "add_index", summary: "Add index" },
      headRef: "agent/demo-fix-fp-1",
      validation,
    });
    assert.deepEqual(result, { url: "local://db-specialist/pull-requests/101" });
  } finally {
    DemoRepoTool.prototype.applyFix = originalApplyFix;
    GitHubTool.prototype.openPullRequest = originalOpenPullRequest;
  }
});

test("db-specialist extension rejects open_pull_request aliases without headRef and codeDiff", async () => {
  const originalOpenPullRequest = GitHubTool.prototype.openPullRequest;
  let calls = 0;
  GitHubTool.prototype.openPullRequest = async function () {
    calls += 1;
    return { url: "local://db-specialist/pull-requests/106" };
  };

  try {
    const tools = collectRegisteredTools();
    const openPullRequest = tools.get("open_pull_request")!;

    await assert.rejects(
      () =>
        openPullRequest.execute({
          branchName: "agent/demo-fix-fp",
          diff: "diff --git a/file b/file",
          finding: { queryid: "106" },
          fix: { fix_type: "add_index", summary: "summary" },
          validation: { validated: true },
        }),
      /headRef|codeDiff/i,
    );

    assert.equal(calls, 0);
  } finally {
    GitHubTool.prototype.openPullRequest = originalOpenPullRequest;
  }
});

test("db-specialist extension analyze_query uses the shared query dependency", async () => {
  const queries: Array<string> = [];
  const tools = createDbSpecialistTools({
    explainQuery: async (sql: string) => {
      queries.push(sql);
      return { rows: [{ "QUERY PLAN": "Seq Scan on query_events" }] };
    },
  });
  const analyzeQuery = tools.find((tool) => tool.name === "analyze_query")!;

  const result = await analyzeQuery.execute({
    sql: "SELECT 1 FROM query_events",
  } as any);

  assert.deepEqual(queries, ["EXPLAIN ANALYZE SELECT 1 FROM query_events"]);
  assert.deepEqual(result, {
    plan_rows: [{ "QUERY PLAN": "Seq Scan on query_events" }],
    validated: true,
  });
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
