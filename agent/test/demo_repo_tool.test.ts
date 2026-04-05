// ABOUTME: Verifies the demo repo mutation path creates a real branch diff before PR creation.
// ABOUTME: Covers the smallest file edits and git commands needed for the live GitHub proof.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { DemoRepoTool } from "../src/tools/demo_repo_tool.ts";

test("DemoRepoTool rewrites the stats action and stages a branch push", async () => {
  const root = await mkdtemp(join(tmpdir(), "demo-repo-tool-"));
  const commands: Array<string> = [];

  try {
    await mkdir(join(root, "app", "controllers"), { recursive: true });
    await writeFile(
      join(root, "app", "controllers", "todos_controller.rb"),
      [
        "class TodosController < ApplicationController",
        "  def stats",
        "    render json: User.all.index_with { |user| user.todos.count }.transform_keys { |user| user.id.to_s }",
        "  end",
        "end",
      ].join("\n"),
    );

    const tool = new DemoRepoTool(
      {
        exec: async (args, cwd) => {
          commands.push(`${cwd}: ${args.join(" ")}`);
          return "";
        },
      },
      {
        env: {
          DEMO_APP_ROOT: root,
          DEMO_HEAD_REF: "agent/demo-fix",
        },
        now: () => new Date("2026-04-05T01:20:00Z"),
      },
    );

    await tool.applyFix({
      fix: {
        fix_type: "rewrite_count",
        summary: "Move the count query out of the loop and precompute the totals.",
      },
      source: {
        content: "14: render json: User.all.index_with { |user| user.todos.count }.transform_keys { |user| user.id.to_s }",
        source_file: "app/controllers/todos_controller.rb:13",
      },
    });

    const content = await readFile(join(root, "app", "controllers", "todos_controller.rb"), "utf8");

    assert.match(content, /counts = Todo\.group\(:user_id\)\.count/);
    assert.match(content, /counts\.fetch\(user\.id, 0\)/);
    assert.deepEqual(commands, [
      `${root}: git checkout agent/demo-fix`,
      `${root}: git add app/controllers/todos_controller.rb`,
      `${root}: git commit -m chore: apply rewrite_count fix`,
      `${root}: git push origin agent/demo-fix`,
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("DemoRepoTool creates the migration directory before adding an index fix", async () => {
  const root = await mkdtemp(join(tmpdir(), "demo-repo-tool-"));
  const commands: Array<string> = [];

  try {
    await mkdir(join(root, "app", "models"), { recursive: true });
    await writeFile(
      join(root, "app", "models", "todo.rb"),
      [
        "class Todo < ApplicationRecord",
        "  scope :open, -> { where(status: 'open') }",
        "end",
      ].join("\n"),
    );

    const tool = new DemoRepoTool(
      {
        exec: async (args, cwd) => {
          commands.push(`${cwd}: ${args.join(" ")}`);
          return "";
        },
      },
      {
        env: {
          DEMO_APP_ROOT: root,
          DEMO_HEAD_REF: "agent/demo-fix",
        },
        now: () => new Date("2026-04-05T01:21:00Z"),
      },
    );

    await tool.applyFix({
      fix: {
        fix_type: "add_index",
        summary: "Add an index for the status filter used at /app/models/todo.rb:2.",
      },
      source: {
        content: "2: scope :open, -> { where(status: 'open') }",
        source_file: "app/models/todo.rb:2",
      },
    });

    const migration = await readFile(
      join(root, "db", "migrate", "20260405012100_add_index_to_todos_status.rb"),
      "utf8",
    );

    assert.match(migration, /add_index :todos, :status/);
    assert.deepEqual(commands, [
      `${root}: git checkout agent/demo-fix`,
      `${root}: git add db/migrate/20260405012100_add_index_to_todos_status.rb`,
      `${root}: git commit -m chore: apply add_index fix`,
      `${root}: git push origin agent/demo-fix`,
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
