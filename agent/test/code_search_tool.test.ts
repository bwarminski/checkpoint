// ABOUTME: Verifies CodeSearchTool resolves container file references through the MCP client.
// ABOUTME: Ensures the generated client is called with a repo-relative path and context.
import assert from "node:assert/strict";
import test from "node:test";

import { CodeSearchTool } from "../../src/tools/code_search_tool.ts";

test("CodeSearchTool preserves the app path and loads surrounding file context", async () => {
  const calls: Array<{ lines?: number; path: string }> = [];
  const tool = new CodeSearchTool({
    read_file: async (path: string, lines?: number) => {
      calls.push({ lines, path });
      return "41:   before\n42:   render json: Todo.all\n43: end";
    },
  });

  const result = await tool.locate({
    source_file: "/app/controllers/todos_controller.rb:42",
  });

  assert.deepEqual(calls, [
    { lines: 3, path: "app/controllers/todos_controller.rb:42" },
  ]);
  assert.deepEqual(result, {
    content: "41:   before\n42:   render json: Todo.all\n43: end",
    source_file: "app/controllers/todos_controller.rb:42",
  });
});

test("CodeSearchTool derives a controller file when source_tag is present", async () => {
  const calls: Array<{ lines?: number; path: string }> = [];
  const searches: Array<{ glob?: string; pattern: string }> = [];
  const tool = new CodeSearchTool({
    read_file: async (path: string, lines?: number) => {
      calls.push({ lines, path });
      return "8:   def index";
    },
    search_code: async (pattern: string, glob?: string) => {
      searches.push({ glob, pattern });
      return JSON.stringify([
        { line: 8, path: "app/controllers/todos_controller.rb", preview: "  def index" },
      ]);
    },
  });

  const result = await tool.locate({
    source_tag: "todos#index",
  });

  assert.deepEqual(searches, [
    { glob: "app/controllers/**/*_controller.rb", pattern: "def index" },
  ]);
  assert.deepEqual(calls, [
    { lines: 3, path: "app/controllers/todos_controller.rb:8" },
  ]);
  assert.deepEqual(result, {
    content: "8:   def index",
    source_file: "app/controllers/todos_controller.rb:8",
  });
});

test("CodeSearchTool rejects absolute paths outside the /app mount", async () => {
  const tool = new CodeSearchTool({
    read_file: async () => "unused",
  });

  await assert.rejects(
    () => tool.locate({ source_file: "/etc/passwd:1" }),
    /\/app\//,
  );
});

test("CodeSearchTool starts the generated client lazily and closes it after use", async () => {
  const calls: Array<{ lines?: number; path: string }> = [];
  let created = 0;
  let closed = 0;
  const tool = new CodeSearchTool(undefined, {
    clientFactory: async () => {
      created += 1;
      return {
        async close() {
          closed += 1;
        },
        async read_file(path: string, lines?: number) {
          calls.push({ lines, path });
          return "ok";
        },
      };
    },
  });

  assert.equal(created, 0);
  await tool.close();
  assert.equal(created, 0);
  assert.equal(closed, 0);

  const result = await tool.locate({ source_file: "/app/models/todo.rb:5" });

  assert.equal(created, 1);
  assert.equal(result.content, "ok");
  assert.deepEqual(calls, [{ lines: 3, path: "app/models/todo.rb:5" }]);

  await tool.close();
  assert.equal(closed, 1);
});

test("CodeSearchTool retries client creation after an initialization failure", async () => {
  let attempts = 0;
  const tool = new CodeSearchTool(undefined, {
    clientFactory: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("boot failed");
      }

      return {
        async read_file() {
          return "recovered";
        },
      };
    },
  });

  await assert.rejects(
    () => tool.locate({ source_file: "/app/models/todo.rb:5" }),
    /boot failed/,
  );

  const result = await tool.locate({ source_file: "/app/models/todo.rb:5" });

  assert.equal(attempts, 2);
  assert.equal(result.content, "recovered");
});
