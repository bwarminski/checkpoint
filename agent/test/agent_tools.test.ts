// ABOUTME: Verifies the pi-agent-core tool wrappers stay aligned with the agent runtime boundaries.
// ABOUTME: Keeps memory and ClickHouse access exposed through focused tool names and typed details.
import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentTools } from "../src/agent_tools.ts";

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
  } as any);

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
