// ABOUTME: Verifies the root code-search tool stays self-contained under the root package.
// ABOUTME: Keeps the default client path tied to the repo root instead of the agent subpackage.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { CodeSearchTool } from "../../src/tools/code_search_tool.ts";

test("CodeSearchTool default client reads from CODE_SEARCH_ROOT", async () => {
  const root = await mkdtemp(join(tmpdir(), "code-search-root-"));
  const previousRoot = process.env.CODE_SEARCH_ROOT;

  try {
    await mkdir(join(root, "app", "controllers"), { recursive: true });
    await writeFile(
      join(root, "app", "controllers", "todos_controller.rb"),
      [
        "class TodosController",
        "  def index",
        "    render json: Todo.all",
        "  end",
        "end",
      ].join("\n"),
    );

    process.env.CODE_SEARCH_ROOT = root;

    const tool = new CodeSearchTool();
    const result = await tool.locate({ source_file: "/app/controllers/todos_controller.rb:3" });

    assert.equal(result.source_file, "app/controllers/todos_controller.rb:3");
    assert.match(result.content, /render json: Todo\.all/);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.CODE_SEARCH_ROOT;
    } else {
      process.env.CODE_SEARCH_ROOT = previousRoot;
    }

    await rm(root, { force: true, recursive: true });
  }
});

test("CodeSearchTool default client falls back to DEMO_APP_ROOT when CODE_SEARCH_ROOT is unset", async () => {
  const root = await mkdtemp(join(tmpdir(), "code-search-demo-root-"));
  const previousCodeSearchRoot = process.env.CODE_SEARCH_ROOT;
  const previousDemoAppRoot = process.env.DEMO_APP_ROOT;

  try {
    await mkdir(join(root, "app", "controllers"), { recursive: true });
    await writeFile(
      join(root, "app", "controllers", "todos_controller.rb"),
      [
        "class TodosController",
        "  def index",
        "    render json: Todo.all",
        "  end",
        "end",
      ].join("\n"),
    );

    delete process.env.CODE_SEARCH_ROOT;
    process.env.DEMO_APP_ROOT = root;

    const tool = new CodeSearchTool();
    const result = await tool.locate({ source_file: "/app/controllers/todos_controller.rb:3" });

    assert.equal(result.source_file, "app/controllers/todos_controller.rb:3");
    assert.match(result.content, /render json: Todo\.all/);
  } finally {
    if (previousCodeSearchRoot === undefined) {
      delete process.env.CODE_SEARCH_ROOT;
    } else {
      process.env.CODE_SEARCH_ROOT = previousCodeSearchRoot;
    }

    if (previousDemoAppRoot === undefined) {
      delete process.env.DEMO_APP_ROOT;
    } else {
      process.env.DEMO_APP_ROOT = previousDemoAppRoot;
    }

    await rm(root, { force: true, recursive: true });
  }
});

test("CodeSearchTool source does not reference the agent package", async () => {
  const source = await readFile(new URL("../../src/tools/code_search_tool.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /agent\/src\/tools\/generated/);
  assert.doesNotMatch(source, /agent\/\.mcporter\.json/);
});
