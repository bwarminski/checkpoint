// ABOUTME: Verifies CodeSearchTool resolves container file references through the MCP client.
// ABOUTME: Ensures the generated client is called with a repo-relative path and context.
import assert from "node:assert/strict";
import test from "node:test";

import { CodeSearchTool } from "../src/tools/code_search_tool.ts";

test("CodeSearchTool strips the /app prefix and loads surrounding file context", async () => {
  const calls: Array<{ lines?: number; path: string }> = [];
  const tool = new CodeSearchTool({
    read_file: async (params: { lines?: number; path: string }) => {
      calls.push(params);
      return "41:   before\n42:   render json: Todo.all\n43: end";
    },
  });

  const result = await tool.locate({
    source_file: "/app/controllers/todos_controller.rb:42",
  });

  assert.deepEqual(calls, [
    { lines: 3, path: "controllers/todos_controller.rb:42" },
  ]);
  assert.deepEqual(result, {
    content: "41:   before\n42:   render json: Todo.all\n43: end",
    source_file: "controllers/todos_controller.rb:42",
  });
});
