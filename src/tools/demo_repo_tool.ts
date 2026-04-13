// ABOUTME: Applies the smallest concrete fix in the sibling demo repo before PR creation.
// ABOUTME: Commits and pushes the prepared branch so GitHub can open a real pull request.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

type FixProposal = {
  fix_type: string;
  summary: string;
};

type LocatedSource = {
  content: string;
  source_file: string;
};

type DemoRepoEnv = {
  DEMO_APP_ROOT?: string;
  DEMO_BASE_REF?: string;
};

type CommandRunner = {
  exec(args: string[], cwd: string): Promise<string>;
};

type DemoRepoToolOptions = {
  env?: DemoRepoEnv;
  now?: () => Date;
};

type ApplyFixInput = {
  finding: {
    queryid: string;
  };
  fix: FixProposal;
  source: LocatedSource;
};

type ApplyFixResult = {
  branchName: string;
  diff: string;
};

const execFileAsync = promisify(execFile);

export function defaultDemoAppRoot(): string {
  return resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../db-specialist-demo");
}

export class DemoRepoTool {
  private readonly env: DemoRepoEnv;
  private readonly now: () => Date;

  constructor(
    private readonly runner: CommandRunner = { exec: execGitCommand },
    options: DemoRepoToolOptions = {},
  ) {
    this.env = options.env ?? process.env;
    this.now = options.now ?? (() => new Date());
  }

  async applyFix(input: ApplyFixInput): Promise<ApplyFixResult> {
    const root = this.env.DEMO_APP_ROOT ?? defaultDemoAppRoot();

    const baseRef = this.env.DEMO_BASE_REF ?? "main";
    await ensureRemoteReachable(this.runner, root);
    const branchName = buildBranchName(input.finding.queryid);
    await this.runner.exec(["git", "checkout", "-B", branchName, `origin/${baseRef}`], root);
    const touchedPaths = await this.applyChange(root, input);

    for (const path of touchedPaths) {
      await this.runner.exec(["git", "add", path], root);
    }

    await this.runner.exec(["git", "commit", "-m", `chore: apply ${input.fix.fix_type} fix`], root);
    const diff = await this.runner.exec(["git", "diff", "HEAD~1", "HEAD", "--", ...touchedPaths], root);
    await this.runner.exec(["git", "push", "origin", branchName], root);
    return { branchName, diff };
  }

  private async applyChange(root: string, input: ApplyFixInput): Promise<string[]> {
    switch (input.fix.fix_type) {
      case "rewrite_count":
        return [await rewriteCount(root, input.source)];
      case "rewrite_like":
        return [await rewriteLike(root, input.source)];
      case "add_includes":
        return [await addIncludes(root, input.source)];
      case "add_index":
        return [await addIndexMigration(root, input.source, this.now)];
      default:
        throw new Error(`DemoRepoTool: unsupported fix_type ${input.fix.fix_type}`);
    }
  }
}

async function rewriteCount(root: string, source: LocatedSource): Promise<string> {
  const path = filePathFromSource(source.source_file);
  const absolutePath = resolve(root, path);
  assertWithinRoot(root, absolutePath, source.source_file);
  const content = await readFile(absolutePath, "utf8");
  const updated = content.replace(
    "    render json: User.all.index_with { |user| user.todos.count }.transform_keys { |user| user.id.to_s }",
    [
      "    counts = Todo.group(:user_id).count",
      "    render json: User.all.index_with { |user| counts.fetch(user.id, 0) }.transform_keys { |user| user.id.to_s }",
    ].join("\n"),
  );
  ensureReplacementChanged(path, content, updated);
  await writeFile(absolutePath, updated);
  return path;
}

async function rewriteLike(root: string, source: LocatedSource): Promise<string> {
  const path = filePathFromSource(source.source_file);
  const absolutePath = resolve(root, path);
  assertWithinRoot(root, absolutePath, source.source_file);
  const content = await readFile(absolutePath, "utf8");
  const updated = content.replace('"%#{params[:q]}%"', '"#{params[:q]}%"');
  ensureReplacementChanged(path, content, updated);
  await writeFile(absolutePath, updated);
  return path;
}

async function addIncludes(root: string, source: LocatedSource): Promise<string> {
  const path = filePathFromSource(source.source_file);
  const absolutePath = resolve(root, path);
  assertWithinRoot(root, absolutePath, source.source_file);
  const content = await readFile(absolutePath, "utf8");
  const hasWhereClause = content.includes('Todo.where("title LIKE ?", "#{params[:q]}%")');
  const hasAllClause = content.includes(" : Todo.all");
  const updated = content
    .replace(" : Todo.all", " : Todo.includes(:user).all")
    .replace(
      'Todo.where("title LIKE ?", "#{params[:q]}%")',
      'Todo.includes(:user).where("title LIKE ?", "#{params[:q]}%")',
    );
  if (
    !hasWhereClause ||
    !hasAllClause ||
    !updated.includes('Todo.includes(:user).where("title LIKE ?", "#{params[:q]}%")') ||
    !updated.includes(" : Todo.includes(:user).all")
  ) {
    throw new Error(
      `DemoRepoTool: expected string not found in ${path} — demo app content may have drifted`,
    );
  }
  ensureReplacementChanged(path, content, updated);
  await writeFile(absolutePath, updated);
  return path;
}

async function addIndexMigration(
  root: string,
  source: LocatedSource,
  now: () => Date,
): Promise<string> {
  const column = source.content.match(/where\((\w+):/i)?.[1] ?? "status";
  const timestamp = formatTimestamp(now());
  const fileName = `${timestamp}_add_index_to_todos_${column}.rb`;
  const relativePath = `db/migrate/${fileName}`;
  const absolutePath = resolve(root, relativePath);
  const className = `AddIndexToTodos${camelize(column)}`;
  const migration = [
    "class " + className + " < ActiveRecord::Migration[7.1]",
    "  def change",
    `    add_index :todos, :${column}`,
    "  end",
    "end",
    "",
  ].join("\n");
  await mkdir(resolve(root, "db", "migrate"), { recursive: true });
  await writeFile(absolutePath, migration);
  return relativePath;
}

function filePathFromSource(sourceFile: string): string {
  return sourceFile.replace(/:\d+$/, "");
}

function assertWithinRoot(root: string, absolutePath: string, sourceFile: string): void {
  if (!absolutePath.startsWith(root + "/")) {
    throw new Error(`DemoRepoTool: path escapes the repo root: ${sourceFile}`);
  }
}

function formatTimestamp(date: Date): string {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}${hour}${minute}${second}`;
}

function camelize(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");
}

function buildBranchName(queryid: string): string {
  const sanitized = queryid.replace(/[^A-Za-z0-9._-]/g, "-");
  const readable = sanitized.slice(0, 12);
  if (sanitized.length <= 12) {
    return `agent/demo-fix-${readable}`;
  }

  const suffix = createHash("sha256").update(sanitized).digest("hex").slice(0, 8);
  return `agent/demo-fix-${readable}-${suffix}`;
}

function ensureReplacementChanged(path: string, original: string, updated: string): void {
  if (updated === original) {
    throw new Error(
      `DemoRepoTool: expected string not found in ${path} — demo app content may have drifted`,
    );
  }
}

async function ensureRemoteReachable(runner: CommandRunner, root: string): Promise<void> {
  try {
    await runner.exec(["git", "ls-remote", "origin"], root);
  } catch {
    throw new Error(`DemoRepoTool: cannot reach git remote — check credentials for ${root}`);
  }
}

async function execGitCommand(args: string[], cwd: string): Promise<string> {
  const [command, ...rest] = args;
  const { stdout } = await execFileAsync(command, rest, { cwd });
  return stdout;
}
