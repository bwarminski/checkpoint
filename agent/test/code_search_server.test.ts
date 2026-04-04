// ABOUTME: Exercises the demo code-search MCP server's file and grep behavior.
// ABOUTME: Keeps the server rooted inside the mounted Rails app directory.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  createCodeSearchService,
  getCodeSearchRoot,
} from "../src/mcp-servers/code-search/service.ts";

test("read_file returns the requested line with surrounding context", async () => {
  const root = await mkdtemp(join(tmpdir(), "code-search-root-"));

  try {
    await mkdir(join(root, "app", "controllers"), { recursive: true });
    await writeFile(
      join(root, "app", "controllers", "todos_controller.rb"),
      [
        "class TodosController < ApplicationController",
        "  def index",
        "    render json: Todo.all",
        "  end",
        "end",
      ].join("\n"),
    );

    const service = createCodeSearchService(root);
    const content = await service.readFile({
      lines: 1,
      path: "app/controllers/todos_controller.rb:3",
    });

    assert.equal(
      content,
      ["2:   def index", "3:     render json: Todo.all", "4:   end"].join("\n"),
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("search_code returns relative matches filtered by glob", async () => {
  const root = await mkdtemp(join(tmpdir(), "code-search-root-"));

  try {
    await mkdir(join(root, "app", "controllers"), { recursive: true });
    await mkdir(join(root, "app", "models"), { recursive: true });
    await writeFile(
      join(root, "app", "controllers", "todos_controller.rb"),
      [
        "class TodosController < ApplicationController",
        "  def index",
        "    render json: Todo.all",
        "  end",
        "end",
      ].join("\n"),
    );
    await writeFile(
      join(root, "app", "models", "todo.rb"),
      [
        "class Todo < ApplicationRecord",
        "  scope :open_items, -> { where(status: 'open') }",
        "end",
      ].join("\n"),
    );

    const service = createCodeSearchService(root);
    const matches = await service.searchCode({
      glob: "app/controllers/**/*.rb",
      pattern: "render json",
    });

    assert.deepEqual(matches, [
      {
        line: 3,
        path: "app/controllers/todos_controller.rb",
        preview: "    render json: Todo.all",
      },
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("getCodeSearchRoot reads CODE_SEARCH_ROOT", () => {
  assert.equal(
    getCodeSearchRoot({ CODE_SEARCH_ROOT: "/tmp/demo-app" }),
    "/tmp/demo-app",
  );
});

test("read_file rejects line zero explicitly", async () => {
  const root = await mkdtemp(join(tmpdir(), "code-search-root-"));

  try {
    await mkdir(join(root, "app"), { recursive: true });
    await writeFile(join(root, "app", "sample.rb"), "puts 'hello'\n");

    const service = createCodeSearchService(root);

    await assert.rejects(
      () => service.readFile({ path: "app/sample.rb:0" }),
      /line/i,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
