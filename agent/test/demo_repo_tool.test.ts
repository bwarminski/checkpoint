// ABOUTME: Verifies the demo repo mutation path creates a real branch diff before PR creation.
// ABOUTME: Covers branching, drift detection, and the git command sequence needed for the live GitHub proof.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { DemoRepoTool, defaultDemoAppRoot } from "../src/tools/demo_repo_tool.ts";

test("DemoRepoTool falls back to the sibling db-specialist-demo path when DEMO_APP_ROOT is unset", () => {
  assert.equal(
    defaultDemoAppRoot(),
    resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../db-specialist-demo"),
  );
});

test("DemoRepoTool creates a branch per finding fingerprint", async () => {
  const root = await mkdtemp(join(tmpdir(), "demo-repo-tool-"));
  const commands: Array<string> = [];

  try {
    await writeControllerFile(root);

    const tool = createTool(root, commands);

    const first = await tool.applyFix({
      finding: { fingerprint: "1234567890ab" },
      fix: { fix_type: "rewrite_like", summary: "summary" },
      source: {
        content: '3: Todo.where("title LIKE ?", "%#{params[:q]}%")',
        source_file: "app/controllers/todos_controller.rb:3",
      },
    });

    await writeControllerFile(root);

    const second = await tool.applyFix({
      finding: { fingerprint: "fedcba098765" },
      fix: { fix_type: "rewrite_like", summary: "summary" },
      source: {
        content: '3: Todo.where("title LIKE ?", "%#{params[:q]}%")',
        source_file: "app/controllers/todos_controller.rb:3",
      },
    });

    assert.equal(first.branchName, "agent/demo-fix-1234567890ab");
    assert.equal(second.branchName, "agent/demo-fix-fedcba098765");
    assert.match(commands.join("\n"), /git checkout -B agent\/demo-fix-1234567890ab origin\/main/);
    assert.match(commands.join("\n"), /git push origin agent\/demo-fix-1234567890ab/);
    assert.match(commands.join("\n"), /git checkout -B agent\/demo-fix-fedcba098765 origin\/main/);
    assert.match(commands.join("\n"), /git push origin agent\/demo-fix-fedcba098765/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("DemoRepoTool uses the remote-tracking base ref when creating a branch", async () => {
  const root = await mkdtemp(join(tmpdir(), "demo-repo-tool-"));
  const commands: Array<string> = [];

  try {
    await writeControllerFile(root);

    const tool = createTool(root, commands, undefined, "develop");

    await tool.applyFix({
      finding: { fingerprint: "base-ref-123" },
      fix: { fix_type: "rewrite_like", summary: "summary" },
      source: {
        content: '3: Todo.where("title LIKE ?", "%#{params[:q]}%")',
        source_file: "app/controllers/todos_controller.rb:3",
      },
    });

    assert.match(commands.join("\n"), /git checkout -B agent\/demo-fix-base-ref-123 origin\/develop/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("DemoRepoTool sanitizes fingerprint characters before building the branch name", async () => {
  const root = await mkdtemp(join(tmpdir(), "demo-repo-tool-"));
  const commands: Array<string> = [];

  try {
    await writeControllerFile(root);

    const tool = createTool(root, commands);

    const result = await tool.applyFix({
      finding: { fingerprint: "abc/def:gh" },
      fix: { fix_type: "rewrite_like", summary: "summary" },
      source: {
        content: '3: Todo.where("title LIKE ?", "%#{params[:q]}%")',
        source_file: "app/controllers/todos_controller.rb:3",
      },
    });

    assert.equal(result.branchName, "agent/demo-fix-abc-def-gh");
    assert.match(commands.join("\n"), /git checkout -B agent\/demo-fix-abc-def-gh origin\/main/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("DemoRepoTool appends a suffix for long fingerprints that share the same prefix", async () => {
  const root = await mkdtemp(join(tmpdir(), "demo-repo-tool-"));
  try {
    await writeControllerFile(root);

    const firstTool = createTool(root, []);
    const secondTool = createTool(root, []);

    const first = await firstTool.applyFix({
      finding: { fingerprint: "abcdefghijklmnop" },
      fix: { fix_type: "rewrite_like", summary: "summary" },
      source: {
        content: '3: Todo.where("title LIKE ?", "%#{params[:q]}%")',
        source_file: "app/controllers/todos_controller.rb:3",
      },
    });

    await writeControllerFile(root);

    const second = await secondTool.applyFix({
      finding: { fingerprint: "abcdefghijklqrstuv" },
      fix: { fix_type: "rewrite_like", summary: "summary" },
      source: {
        content: '3: Todo.where("title LIKE ?", "%#{params[:q]}%")',
        source_file: "app/controllers/todos_controller.rb:3",
      },
    });

    assert.equal(first.branchName.startsWith("agent/demo-fix-abcdefghijkl-"), true);
    assert.equal(second.branchName.startsWith("agent/demo-fix-abcdefghijkl-"), true);
    assert.notEqual(first.branchName, second.branchName);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("DemoRepoTool reuses the same branch name safely for the same fingerprint", async () => {
  const root = await mkdtemp(join(tmpdir(), "demo-repo-tool-"));
  const commands: Array<string> = [];

  try {
    await writeControllerFile(root);

    const tool = createTool(root, commands);

    const firstBranchName = (
      await tool.applyFix({
        finding: { fingerprint: "samefingerprint" },
        fix: { fix_type: "rewrite_like", summary: "summary" },
        source: {
          content: '3: Todo.where("title LIKE ?", "%#{params[:q]}%")',
          source_file: "app/controllers/todos_controller.rb:3",
        },
      })
    ).branchName;

    await writeControllerFile(root);

    const secondBranchName = (
      await tool.applyFix({
        finding: { fingerprint: "samefingerprint" },
        fix: { fix_type: "rewrite_like", summary: "summary" },
        source: {
          content: '3: Todo.where("title LIKE ?", "%#{params[:q]}%")',
          source_file: "app/controllers/todos_controller.rb:3",
        },
      })
    ).branchName;

    const sequence = commands.join("\n");
    assert.equal(firstBranchName, secondBranchName);
    assert.match(firstBranchName, /^agent\/demo-fix-samefingerpr-/);
    assert.match(sequence, new RegExp(`git checkout -B ${firstBranchName} origin/main`));
    assert.doesNotMatch(sequence, new RegExp(`git branch -D ${firstBranchName}`));
    assert.match(sequence, new RegExp(`git push origin ${firstBranchName}`));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("DemoRepoTool rewrite_like updates the file and pushes the branch", async () => {
  const root = await mkdtemp(join(tmpdir(), "demo-repo-tool-"));
  const commands: Array<string> = [];

  try {
    await writeControllerFile(root);

    const tool = createTool(root, commands);

    const result = await tool.applyFix({
      finding: { fingerprint: "rwlike123456" },
      fix: { fix_type: "rewrite_like", summary: "Remove the leading wildcard." },
      source: {
        content: '3: Todo.where("title LIKE ?", "%#{params[:q]}%")',
        source_file: "app/controllers/todos_controller.rb:3",
      },
    });

    const content = await readFile(join(root, "app", "controllers", "todos_controller.rb"), "utf8");

    assert.equal(result.branchName, "agent/demo-fix-rwlike123456");
    assert.match(content, /"\#\{params\[:q\]\}%"/);
    assert.doesNotMatch(content, /"%\#\{params\[:q\]\}%"/);
    assert.deepEqual(commands, [
      `${root}: git ls-remote origin`,
      `${root}: git checkout -B agent/demo-fix-rwlike123456 origin/main`,
      `${root}: git add app/controllers/todos_controller.rb`,
      `${root}: git commit -m chore: apply rewrite_like fix`,
      `${root}: git diff HEAD~1 HEAD -- app/controllers/todos_controller.rb`,
      `${root}: git push origin agent/demo-fix-rwlike123456`,
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("DemoRepoTool rewrite_count updates the file and pushes the branch", async () => {
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

    const tool = createTool(root, commands);

    const result = await tool.applyFix({
      finding: { fingerprint: "countfix1234" },
      fix: { fix_type: "rewrite_count", summary: "Move the count query out of the loop." },
      source: {
        content:
          "14: render json: User.all.index_with { |user| user.todos.count }.transform_keys { |user| user.id.to_s }",
        source_file: "app/controllers/todos_controller.rb:13",
      },
    });

    const content = await readFile(join(root, "app", "controllers", "todos_controller.rb"), "utf8");

    assert.equal(result.branchName, "agent/demo-fix-countfix1234");
    assert.match(content, /counts = Todo\.group\(:user_id\)\.count/);
    assert.match(content, /counts\.fetch\(user\.id, 0\)/);
    assert.deepEqual(commands, [
      `${root}: git ls-remote origin`,
      `${root}: git checkout -B agent/demo-fix-countfix1234 origin/main`,
      `${root}: git add app/controllers/todos_controller.rb`,
      `${root}: git commit -m chore: apply rewrite_count fix`,
      `${root}: git diff HEAD~1 HEAD -- app/controllers/todos_controller.rb`,
      `${root}: git push origin agent/demo-fix-countfix1234`,
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("DemoRepoTool add_includes updates the file and pushes the branch", async () => {
  const root = await mkdtemp(join(tmpdir(), "demo-repo-tool-"));
  const commands: Array<string> = [];

  try {
    await writeControllerFile(root, [
      "class TodosController < ApplicationController",
      "  def index",
      '    todos = params[:q].present? ? Todo.where("title LIKE ?", "#{params[:q]}%") : Todo.all',
      "  end",
      "end",
    ]);

    const tool = createTool(root, commands);

    const result = await tool.applyFix({
      finding: { fingerprint: "addincl12345" },
      fix: { fix_type: "add_includes", summary: "Eager load the user association." },
      source: {
        content: [
          '3: todos = params[:q].present? ? Todo.where("title LIKE ?", "#{params[:q]}%") : Todo.all',
          "4: todos.each { |t| t.user.name }",
        ].join("\n"),
        source_file: "app/controllers/todos_controller.rb:3",
      },
    });

    const content = await readFile(join(root, "app", "controllers", "todos_controller.rb"), "utf8");

    assert.equal(result.branchName, "agent/demo-fix-addincl12345");
    assert.match(content, /Todo\.includes\(:user\)\.all/);
    assert.deepEqual(commands, [
      `${root}: git ls-remote origin`,
      `${root}: git checkout -B agent/demo-fix-addincl12345 origin/main`,
      `${root}: git add app/controllers/todos_controller.rb`,
      `${root}: git commit -m chore: apply add_includes fix`,
      `${root}: git diff HEAD~1 HEAD -- app/controllers/todos_controller.rb`,
      `${root}: git push origin agent/demo-fix-addincl12345`,
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("DemoRepoTool add_includes rejects partial rewrites", async () => {
  const root = await mkdtemp(join(tmpdir(), "demo-repo-tool-"));
  try {
    await writeControllerFile(root, [
      "class TodosController < ApplicationController",
      "  def index",
      '    todos = params[:q].present? ? Todo.all : Todo.none',
      "  end",
      "end",
    ]);

    const tool = createTool(root, []);

    await assert.rejects(
      () =>
        tool.applyFix({
          finding: { fingerprint: "partial-includes" },
          fix: { fix_type: "add_includes", summary: "Eager load the user association." },
          source: {
            content: [
              '3: todos = params[:q].present? ? Todo.where("title LIKE ?", "#{params[:q]}%") : Todo.all',
              "4: todos.each { |t| t.user.name }",
            ].join("\n"),
            source_file: "app/controllers/todos_controller.rb:3",
          },
        }),
      /DemoRepoTool: expected string not found in app\/controllers\/todos_controller\.rb — demo app content may have drifted/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("DemoRepoTool raises a drift error when rewrite_count replacement does not match", async () => {
  await assert.rejects(
    () => runDriftCase("rewrite_count", "class TodosController < ApplicationController\nend\n"),
    /DemoRepoTool: expected string not found in app\/controllers\/todos_controller\.rb — demo app content may have drifted/,
  );
});

test("DemoRepoTool raises a drift error when rewrite_like replacement does not match", async () => {
  await assert.rejects(
    () => runDriftCase("rewrite_like", 'class TodosController < ApplicationController\n  def index\n    Todo.all\n  end\nend\n'),
    /DemoRepoTool: expected string not found in app\/controllers\/todos_controller\.rb — demo app content may have drifted/,
  );
});

test("DemoRepoTool raises a drift error when add_includes replacement does not match", async () => {
  await assert.rejects(
    () => runDriftCase("add_includes", "class TodosController < ApplicationController\n  def index\n    todos = Todo.none\n  end\nend\n"),
    /DemoRepoTool: expected string not found in app\/controllers\/todos_controller\.rb — demo app content may have drifted/,
  );
});

test("DemoRepoTool fails before file edits when the git remote is unreachable", async () => {
  const root = await mkdtemp(join(tmpdir(), "demo-repo-tool-"));
  try {
    await writeControllerFile(root);

    const tool = new DemoRepoTool(
      {
        exec: async (args) => {
          if (args[0] === "git" && args[1] === "ls-remote") {
            throw new Error("auth failed");
          }

          throw new Error(`unexpected command: ${args.join(" ")}`);
        },
      },
      {
        env: { DEMO_APP_ROOT: root, DEMO_BASE_REF: "main" },
      },
    );

    await assert.rejects(
      () =>
        tool.applyFix({
          finding: { fingerprint: "remote-failure" },
          fix: { fix_type: "rewrite_like", summary: "summary" },
          source: {
            content: '3: Todo.where("title LIKE ?", "%#{params[:q]}%")',
            source_file: "app/controllers/todos_controller.rb:3",
          },
        }),
      /DemoRepoTool: cannot reach git remote — check credentials for/,
    );
    assert.equal(
      await readFile(join(root, "app", "controllers", "todos_controller.rb"), "utf8"),
      [
        "class TodosController < ApplicationController",
        "  def index",
        '    todos = params[:q].present? ? Todo.where("title LIKE ?", "%#{params[:q]}%") : Todo.all',
        "  end",
        "end",
      ].join("\n"),
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("DemoRepoTool keeps add_index working and creates db/migrate", async () => {
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

    const tool = createTool(root, commands, new Date("2026-04-05T01:21:00Z"));

    const result = await tool.applyFix({
      finding: { fingerprint: "addindex1234" },
      fix: { fix_type: "add_index", summary: "Add an index for the status filter used at /app/models/todo.rb:2." },
      source: {
        content: "2: scope :open, -> { where(status: 'open') }",
        source_file: "app/models/todo.rb:2",
      },
    });

    const migration = await readFile(
      join(root, "db", "migrate", "20260405012100_add_index_to_todos_status.rb"),
      "utf8",
    );

    assert.equal(result.branchName, "agent/demo-fix-addindex1234");
    assert.match(migration, /add_index :todos, :status/);
    assert.deepEqual(commands, [
      `${root}: git ls-remote origin`,
      `${root}: git checkout -B agent/demo-fix-addindex1234 origin/main`,
      `${root}: git add db/migrate/20260405012100_add_index_to_todos_status.rb`,
      `${root}: git commit -m chore: apply add_index fix`,
      `${root}: git diff HEAD~1 HEAD -- db/migrate/20260405012100_add_index_to_todos_status.rb`,
      `${root}: git push origin agent/demo-fix-addindex1234`,
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("DemoRepoTool rejects source_file paths that escape the repo root", async () => {
  const root = await mkdtemp(join(tmpdir(), "demo-repo-tool-"));
  try {
    const tool = createTool(root, []);
    await assert.rejects(
      () =>
        tool.applyFix({
          finding: { fingerprint: "traversal-test" },
          fix: { fix_type: "rewrite_like", summary: "summary" },
          source: {
            content: "some content",
            source_file: "../../../etc/passwd:1",
          },
        }),
      /path escapes the repo root/i,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("DemoRepoTool rejects unsupported fix types", async () => {
  const root = await mkdtemp(join(tmpdir(), "demo-repo-tool-"));
  const commands: Array<string> = [];

  try {
    await writeControllerFile(root);

    const tool = createTool(root, commands);

    await assert.rejects(
      () =>
        tool.applyFix({
          finding: { fingerprint: "unsupported-1" },
          fix: { fix_type: "rename_table", summary: "summary" },
          source: {
            content: '3: Todo.where("title LIKE ?", "%#{params[:q]}%")',
            source_file: "app/controllers/todos_controller.rb:3",
          },
        }),
      /DemoRepoTool: unsupported fix_type rename_table/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

function createTool(
  root: string,
  commands: Array<string>,
  now?: Date,
  baseRef?: string,
): DemoRepoTool {
  return new DemoRepoTool(
    {
      exec: async (args, cwd) => {
        commands.push(`${cwd}: ${args.join(" ")}`);
        if (args[0] === "git" && args[1] === "diff") {
          const path = args[args.length - 1] ?? "";
          return `diff --git a/${path} b/${path}`;
        }
        return "";
      },
    },
    {
      env: {
        DEMO_APP_ROOT: root,
        DEMO_BASE_REF: baseRef ?? "main",
      },
      now: now ? () => now : undefined,
    },
  );
}

async function writeControllerFile(root: string, lines?: Array<string>): Promise<void> {
  await mkdir(join(root, "app", "controllers"), { recursive: true });
  await writeFile(
    join(root, "app", "controllers", "todos_controller.rb"),
    lines ?? [
      "class TodosController < ApplicationController",
      "  def index",
      '    todos = params[:q].present? ? Todo.where("title LIKE ?", "%#{params[:q]}%") : Todo.all',
      "  end",
      "end",
    ].join("\n"),
  );
}

async function runDriftCase(fixType: string, fileContent: string): Promise<never> {
  const root = await mkdtemp(join(tmpdir(), "demo-repo-tool-"));

  try {
    await writeControllerFile(root, fileContent.split("\n"));

    const tool = createTool(root, []);
    await tool.applyFix({
      finding: { fingerprint: `${fixType}-drift` },
      fix: { fix_type: fixType, summary: "summary" },
      source: {
        content: '3: Todo.where("title LIKE ?", "%#{params[:q]}%")',
        source_file: "app/controllers/todos_controller.rb:3",
      },
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }

  throw new Error("expected drift error");
}
