// ABOUTME: Verifies the pi-agent-core tool wrappers stay aligned with the agent runtime boundaries.
// ABOUTME: Keeps ClickHouse, source lookup, validation, and fix/PR actions exposed through focused tool names and typed details.
import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentTools } from "../src/agent_tools.ts";

test("buildAgentTools does not expose memory tools", () => {
  const tools = buildAgentTools({
    clickhouseTool: {
      listTables: async () => ["query_events"],
      describeTable: async () => "fingerprint\tString",
      executeQuery: async () => "fingerprint\tabc",
      queryFindings: async () => [],
    },
  } as any);

  assert.equal(tools.some((tool) => tool.name === "search_memory"), false);
  assert.equal(tools.some((tool) => tool.name === "record_memory"), false);
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
  } as any);

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

test("locate_source rejects calls without source_file or source_tag", async () => {
  const tools = buildAgentTools({
    codeSearchTool: {
      locate: async () => {
        throw new Error("should not reach code search");
      },
    },
  } as any);

  const locateSource = tools.find((tool) => tool.name === "locate_source");
  assert.ok(locateSource);

  await assert.rejects(
    () => locateSource.execute("tool-2", {} as any),
    /source_file or source_tag/i,
  );
});

test("apply_fix requires explicit high severity, validation, and source input", async () => {
  const tools = buildAgentTools({
    demoRepoTool: {
      applyFix: async () => {
        throw new Error("should not reach demo repo");
      },
    },
  } as any);

  const applyFix = tools.find((tool) => tool.name === "apply_fix");
  assert.ok(applyFix);

  await assert.rejects(
    () =>
      applyFix.execute("tool-3", {
        finding: { fingerprint: "fp-1", severity: "medium" },
        validation: { validated: true },
        source: { content: "body", source_file: "app/models/todo.rb:2" },
        fix: { fix_type: "add_index", summary: "Add index" },
      } as any),
    /high-severity/i,
  );
});

test("apply_fix rejects when finding severity is not high", async () => {
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
  } as any);

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

test("open_pull_request requires prepared branch and diff inputs", async () => {
  const tools = buildAgentTools({
    githubTool: {
      openPullRequest: async () => {
        throw new Error("should not reach github");
      },
    },
  } as any);

  const openPullRequest = tools.find((tool) => tool.name === "open_pull_request");
  assert.ok(openPullRequest);

  await assert.rejects(
    () =>
      openPullRequest.execute("tool-4", {
        finding: { fingerprint: "fp-1" },
        fix: { fix_type: "add_index", summary: "Add index" },
        validation: { validated: true },
      } as any),
    /headRef|codeDiff/i,
  );
});
