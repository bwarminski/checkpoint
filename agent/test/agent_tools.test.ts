// ABOUTME: Verifies the pi-agent-core tool wrappers stay aligned with the agent runtime boundaries.
// ABOUTME: Keeps memory and ClickHouse access exposed through focused tool names and typed details.
import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentTools, createLoopRunEvidence } from "../src/agent_tools.ts";

test("buildAgentTools exposes memory search and memory record tools", () => {
  const tools = buildAgentTools({
    memoryTool: {
      search: async () => [],
      record: async () => {},
    },
    clickhouseTool: {
      listTables: async () => ["query_events"],
      describeTable: async () => "fingerprint\tString",
      executeQuery: async () => "fingerprint\tabc",
      queryFindings: async () => [],
    },
  } as any, createLoopRunEvidence());

  assert.equal(tools.some((tool) => tool.name === "search_memory"), true);
  assert.equal(tools.some((tool) => tool.name === "record_memory"), true);
  assert.equal(tools.some((tool) => tool.name === "list_tables"), true);
  assert.equal(tools.some((tool) => tool.name === "describe_table"), true);
  assert.equal(tools.some((tool) => tool.name === "query_database"), true);
  assert.equal(tools.some((tool) => tool.name === "query_findings"), true);
});

test("query_findings returns typed ClickHouse findings details", async () => {
  const tools = buildAgentTools({
    clickhouseTool: {
      listTables: async () => ["query_events"],
      describeTable: async () => "fingerprint\tString",
      executeQuery: async () => "fingerprint\tabc",
      queryFindings: async (scope?: unknown) => [
        {
          fingerprint: String(scope ?? "fp-1"),
          severity: "high",
          total_exec_time_ms: 123.4,
        },
      ],
    },
  } as any, createLoopRunEvidence());

  const queryFindings = tools.find((tool) => tool.name === "query_findings");
  assert.ok(queryFindings);

  const result = await queryFindings.execute("tool-1", {
    scope: "analyze_db",
  } as any);

  const contentPart = result.content[0];
  assert.equal(contentPart?.type, "text");
  assert.match(
    contentPart && "text" in contentPart ? contentPart.text : "",
    /analyze_db/,
  );
  assert.deepEqual(result.details, [
    {
      fingerprint: "analyze_db",
      severity: "high",
      total_exec_time_ms: 123.4,
    },
  ]);
});

test("record_memory accepts an empty string summary", async () => {
  let recorded: { summary: string } | undefined;
  const tools = buildAgentTools({
    memoryTool: {
      search: async () => [],
      record: async (input: { summary: string }) => {
        recorded = { summary: input.summary };
      },
    },
  } as any, createLoopRunEvidence());

  const recordMemory = tools.find((tool) => tool.name === "record_memory");
  assert.ok(recordMemory);

  await recordMemory.execute("tool-empty-summary", {
    kind: "discovery",
    summary: "",
  } as any);

  assert.deepEqual(recorded, { summary: "" });
});

test("locate_source rejects calls without source_file or source_tag", async () => {
  const tools = buildAgentTools({
    codeSearchTool: {
      locate: async () => {
        throw new Error("should not reach code search");
      },
    },
  } as any, createLoopRunEvidence());

  const locateSource = tools.find((tool) => tool.name === "locate_source");
  assert.ok(locateSource);

  await assert.rejects(
    () => locateSource.execute("tool-2", {} as any),
    /source_file or source_tag/i,
  );
});

test("apply_fix rejects when the loop has not recorded prior finding evidence", async () => {
  const tools = buildAgentTools({
    demoRepoTool: {
      applyFix: async () => {
        throw new Error("should not reach demo repo");
      },
    },
  } as any, createLoopRunEvidence());

  const applyFix = tools.find((tool) => tool.name === "apply_fix");
  assert.ok(applyFix);

  await assert.rejects(
    () =>
      applyFix.execute("tool-3", {
        finding: { fingerprint: "fp-1" },
        fix: { fix_type: "rewrite_like", summary: "summary" },
        source: { content: "source", source_file: "app/controllers/todos_controller.rb:3" },
      } as any),
    /prior finding evidence/i,
  );
});

test("apply_fix requires a previously loaded high-severity finding and validated query", async () => {
  const loopState = createLoopRunEvidence();
  let applyFixCalls = 0;
  const tools = buildAgentTools({
    clickhouseTool: {
      listTables: async () => ["query_events"],
      describeTable: async () => "fingerprint\tString",
      executeQuery: async () => "fingerprint\tabc",
      queryFindings: async () => [
        {
          fingerprint: "fp-1",
          sample_query: "SELECT * FROM todos",
          severity: "high",
        },
      ],
    },
    explainTool: {
      analyze: async ({ sql }: { sql: string }) => ({ sql, validated: true }),
    },
    codeSearchTool: {
      locate: async () => ({
        source_file: "/app/models/todo.rb:2",
        content: "where(status: 'open')",
      }),
    },
    demoRepoTool: {
      applyFix: async () => {
        applyFixCalls += 1;
        return { branchName: "agent/demo-fix-fp-1", diff: "diff --git a/file b/file" };
      },
    },
  } as any, loopState);

  const queryFindings = tools.find((tool) => tool.name === "query_findings");
  const analyzeQuery = tools.find((tool) => tool.name === "analyze_query");
  const applyFix = tools.find((tool) => tool.name === "apply_fix");
  assert.ok(queryFindings);
  assert.ok(analyzeQuery);
  assert.ok(applyFix);

  await queryFindings.execute("tool-1", { scope: "analyze_db" } as any);
  const locateSource = tools.find((tool) => tool.name === "locate_source");
  assert.ok(locateSource);
  await locateSource.execute("tool-locate", {
    source_file: "/app/models/todo.rb:2",
  } as any);

  await assert.rejects(
    () =>
      applyFix.execute("tool-3", {
        finding: {
          fingerprint: "fp-1",
          severity: "high",
          sample_query: "SELECT * FROM todos",
        },
        fix: { fix_type: "add_index", summary: "Add an index." },
        source: { content: "where(status: 'open')", source_file: "/app/models/todo.rb:2" },
      } as any),
    /validated query/i,
  );

  await analyzeQuery.execute("tool-2", { sql: "SELECT * FROM todos" } as any);
  loopState.recordSourceLookup({ source_file: "/app/models/todo.rb:2" });
  const result = await applyFix.execute("tool-4", {
    finding: {
      fingerprint: "fp-1",
      severity: "high",
      sample_query: "SELECT * FROM todos",
    },
    fix: { fix_type: "add_index", summary: "Add an index." },
    source: { content: "where(status: 'open')", source_file: "/app/models/todo.rb:2" },
  } as any);

  assert.equal(applyFixCalls, 1);
  assert.deepEqual(result.details, {
    branchName: "agent/demo-fix-fp-1",
    diff: "diff --git a/file b/file",
  });
});

test("createLoopRunEvidence accumulates preparations per fingerprint and fix_type pair", () => {
  const loopState = createLoopRunEvidence();

  loopState.recordPreparation({
    branchName: "agent/demo-fix-fp-1-add-index",
    diff: "diff add_index",
    findingFingerprint: "fp-1",
    fix_type: "add_index",
    source_file: "/app/models/todo.rb:2",
  });

  loopState.recordPreparation({
    branchName: "agent/demo-fix-fp-1-rewrite-like",
    diff: "diff rewrite_like",
    findingFingerprint: "fp-1",
    fix_type: "rewrite_like",
    source_file: "/app/controllers/todos_controller.rb:3",
  });

  const addIndex = loopState.readPreparation({ findingFingerprint: "fp-1", fix_type: "add_index" });
  const rewriteLike = loopState.readPreparation({ findingFingerprint: "fp-1", fix_type: "rewrite_like" });

  assert.equal(addIndex?.branchName, "agent/demo-fix-fp-1-add-index");
  assert.equal(rewriteLike?.branchName, "agent/demo-fix-fp-1-rewrite-like");
});

test("apply_fix rejects when finding severity is not high", async () => {
  const loopState = createLoopRunEvidence();
  const tools = buildAgentTools({
    clickhouseTool: {
      listTables: async () => ["query_events"],
      describeTable: async () => "fingerprint\tString",
      executeQuery: async () => "fingerprint\tabc",
      queryFindings: async () => [
        {
          fingerprint: "fp-medium",
          sample_query: "SELECT * FROM todos",
          severity: "medium",
        },
      ],
    },
    demoRepoTool: {
      applyFix: async () => {
        throw new Error("should not reach demo repo");
      },
    },
  } as any, loopState);

  const queryFindings = tools.find((tool) => tool.name === "query_findings");
  const applyFix = tools.find((tool) => tool.name === "apply_fix");
  assert.ok(queryFindings);
  assert.ok(applyFix);

  await queryFindings.execute("tool-1", { scope: "analyze_db" } as any);

  await assert.rejects(
    () =>
      applyFix.execute("tool-2", {
        finding: { fingerprint: "fp-medium", severity: "medium", sample_query: "SELECT * FROM todos" },
        fix: { fix_type: "add_index", summary: "Add an index." },
        source: { content: "where(status: 'open')", source_file: "/app/models/todo.rb:2" },
      } as any),
    /high-severity/i,
  );
});

test("open_pull_request rejects when the loop has not recorded prior validation and preparation evidence", async () => {
  const tools = buildAgentTools({
    githubTool: {
      openPullRequest: async () => {
        throw new Error("should not reach github");
      },
    },
  } as any, createLoopRunEvidence());

  const openPullRequest = tools.find((tool) => tool.name === "open_pull_request");
  assert.ok(openPullRequest);

  await assert.rejects(
    () =>
      openPullRequest.execute("tool-4", {
        finding: { fingerprint: "fp-1" },
        fix: { fix_type: "rewrite_like", summary: "summary" },
      } as any),
    /prior validation evidence/i,
  );
});

test("open_pull_request requires a prepared fix from the current loop run", async () => {
  const loopState = createLoopRunEvidence();
  let openPullRequestCalls = 0;
  const tools = buildAgentTools({
    clickhouseTool: {
      listTables: async () => ["query_events"],
      describeTable: async () => "fingerprint\tString",
      executeQuery: async () => "fingerprint\tabc",
      queryFindings: async () => [
        {
          fingerprint: "fp-1",
          sample_query: "SELECT * FROM todos",
          severity: "high",
          source_tag: "todos#index",
        },
      ],
    },
    explainTool: {
      analyze: async ({ sql }: { sql: string }) => ({ sql, validated: true, plan_rows: [{ plan: sql }] }),
    },
    codeSearchTool: {
      locate: async () => ({
        source_file: "/app/models/todo.rb:2",
        content: "where(status: 'open')",
      }),
    },
    demoRepoTool: {
      applyFix: async () => ({ branchName: "agent/demo-fix-fp-1", diff: "diff --git a/file b/file" }),
    },
    githubTool: {
      openPullRequest: async (input: { codeDiff?: string; headRef?: string }) => {
        openPullRequestCalls += 1;
        return {
          url: `local:///${input.headRef}:${input.codeDiff}`,
        };
      },
    },
  } as any, loopState);

  const queryFindings = tools.find((tool) => tool.name === "query_findings");
  const analyzeQuery = tools.find((tool) => tool.name === "analyze_query");
  const applyFix = tools.find((tool) => tool.name === "apply_fix");
  const openPullRequest = tools.find((tool) => tool.name === "open_pull_request");
  assert.ok(queryFindings);
  assert.ok(analyzeQuery);
  assert.ok(applyFix);
  assert.ok(openPullRequest);

  await queryFindings.execute("tool-1", { scope: "analyze_db" } as any);
  await analyzeQuery.execute("tool-2", { sql: "SELECT * FROM todos" } as any);
  const locateSource = tools.find((tool) => tool.name === "locate_source");
  assert.ok(locateSource);
  await locateSource.execute("tool-locate", {
    source_file: "/app/models/todo.rb:2",
  } as any);

  await assert.rejects(
    () =>
      openPullRequest.execute("tool-3", {
        finding: { fingerprint: "fp-1", source_tag: "todos#index" },
        fix: { fix_type: "add_index", summary: "Add an index." },
      } as any),
    /prepared fix/i,
  );

  await applyFix.execute("tool-4", {
    finding: {
      fingerprint: "fp-1",
      severity: "high",
      sample_query: "SELECT * FROM todos",
    },
    fix: { fix_type: "add_index", summary: "Add an index." },
    source: { content: "where(status: 'open')", source_file: "/app/models/todo.rb:2" },
  } as any);

  const result = await openPullRequest.execute("tool-5", {
    finding: { fingerprint: "fp-1", source_tag: "todos#index" },
    fix: { fix_type: "add_index", summary: "Add an index." },
  } as any);

  assert.equal(openPullRequestCalls, 1);
  assert.deepEqual(result.details, {
    url: "local:///agent/demo-fix-fp-1:diff --git a/file b/file",
  });
});
