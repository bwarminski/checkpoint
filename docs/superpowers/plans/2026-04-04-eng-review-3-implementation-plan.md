# Eng Review 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 10 Eng Review 3 corrections on `wip-db-specialist-agent-plan` with strict TDD, preserving the current Phase 1 vertical slice and keeping the existing test suite green.

**Architecture:** The work keeps the current tool boundaries intact. `ClickHouseTool` continues to rank and normalize findings, `DemoRepoTool` mutates the sibling demo repo, `GitHubTool` opens per-finding PRs, and `DBSpecialistExecutor` orchestrates those tools. The main changes are correctness fixes: rank by execution time, use one branch per finding, make demo-repo mutations fail loudly when drifted, carry per-finding PR metadata through the executor, and document the reset/setup workflow.

**Tech Stack:** TypeScript, Node test runner with `tsx`, GitHub REST API, local git CLI, Markdown docs, Ruby/Python docs tests already present in the repo

---

## File Structure

- `agent/src/tools/clickhouse_tool.ts`
  Query building and row normalization for offender ranking.
- `agent/test/clickhouse_tool.test.ts`
  Focused ClickHouse query and parsing assertions.
- `agent/src/tools/demo_repo_tool.ts`
  Demo repo mutation, branch preparation, credential check, and diff capture.
- `agent/test/demo_repo_tool.test.ts`
  Temp-repo coverage for branching, replacement safety, and push flow.
- `agent/src/tools/github_tool.ts`
  PR request construction, existing-PR lookup, and body formatting.
- `agent/test/github_tool.test.ts`
  GitHub REST request and error-path assertions.
- `agent/src/executor.ts`
  Orchestration between source lookup, classification, validation, demo-repo mutation, and PR opening.
- `agent/test/executor.test.ts`
  Classification and orchestration contract coverage.
- `README.md`
  Demo setup and reset instructions.
- `TODOS.md`
  Deferred Phase 2 pi-agent-core loop note.
- `JOURNAL.md`
  Notes about review-driven decisions and repeatable demo workflow.

### Task 1: Fix ClickHouse Ranking And Severity

**Files:**
- Modify: `agent/src/tools/clickhouse_tool.ts`
- Test: `agent/test/clickhouse_tool.test.ts`
- Modify: `collector/db/clickhouse/002_query_fingerprints.sql`
- Modify: `collector/db/clickhouse/003_top_offenders_mv.sql`
- Create: `collector/db/clickhouse/004_reset_query_fingerprints.sql`
- Test: `collector/test/sql/clickhouse_schema_test.rb`

- [ ] **Step 1: Write the failing test**

```ts
test("ClickHouseTool orders offenders by total execution time and marks high severity from p95", async () => {
  const queries: Array<string> = [];
  const tool = new ClickHouseTool(undefined, {
    transport: {
      query: async (sql: string) => {
        queries.push(sql);
        return [
          "fingerprint\tsource_tag\tsource_file\tsample_query\ttotal_exec_count\ttotal_exec_time_ms\tp95_exec_time_ms",
          "slow-low-count\ttodos#index\t\\N\tSELECT 1\t2\t400.5\t120",
          "fast-high-count\ttodos#status\t\\N\tSELECT 2\t999\t200.0\t80",
        ].join("\\n");
      },
    },
  });

  const results = await tool.topOffenders("analyze_db");

  assert.match(queries[0] ?? "", /sum\\(total_exec_count \\* mean_exec_time_ms\\) AS total_exec_time_ms/);
  assert.match(queries[0] ?? "", /ORDER BY total_exec_time_ms DESC/);
  assert.deepEqual(
    results.map((row) => ({
      fingerprint: row.fingerprint,
      severity: row.severity,
      total_exec_time_ms: row.total_exec_time_ms,
    })),
    [
      { fingerprint: "slow-low-count", severity: "high", total_exec_time_ms: 400.5 },
      { fingerprint: "fast-high-count", severity: "medium", total_exec_time_ms: 200.0 },
    ],
  );
});

test("ClickHouseTool uses total execution time ordering for all-time requests", async () => {
  const queries: Array<string> = [];
  const tool = new ClickHouseTool(undefined, {
    transport: {
      query: async (sql: string) => {
        queries.push(sql);
        return "fingerprint\tsource_tag\tsource_file\tsample_query\ttotal_exec_count\ttotal_exec_time_ms\tp95_exec_time_ms";
      },
    },
  });

  await tool.topOffenders("analyze_db all");

  assert.match(queries[0] ?? "", /sumMerge\\(total_exec_time_ms_state\\) AS total_exec_time_ms/);
  assert.match(queries[0] ?? "", /ORDER BY total_exec_time_ms DESC/);
});

test("ClickHouseTool keeps analyze_table all-time filtering source-tag aware", async () => {
  const queries: Array<string> = [];
  const tool = new ClickHouseTool(undefined, {
    transport: {
      query: async (sql: string) => {
        queries.push(sql);
        return "fingerprint\tsource_tag\tsource_file\tsample_query\ttotal_exec_count\ttotal_exec_time_ms\tp95_exec_time_ms";
      },
    },
  });

  await tool.topOffenders("analyze_table todos all");

  assert.match(queries[0] ?? "", /FROM query_fingerprints/);
  assert.doesNotMatch(queries[0] ?? "", /HAVING source_tag ILIKE/);
  assert.match(queries[0] ?? "", /source_tag ILIKE 'todos#%'/);
});

test("ClickHouse schema stores execution time state and documents read-model reset", async () => {
  const fingerprintSql = await readFile("../collector/db/clickhouse/002_query_fingerprints.sql", "utf8");
  const viewSql = await readFile("../collector/db/clickhouse/003_top_offenders_mv.sql", "utf8");
  const resetSql = await readFile("../collector/db/clickhouse/004_reset_query_fingerprints.sql", "utf8");

  assert.match(fingerprintSql, /total_exec_time_ms_state AggregateFunction\\(sum, Float64\\)/);
  assert.match(viewSql, /sumState\\(total_exec_count \\* mean_exec_time_ms\\) AS total_exec_time_ms_state/);
  assert.match(resetSql, /TRUNCATE TABLE query_fingerprints/);
  assert.match(resetSql, /CREATE MATERIALIZED VIEW top_offenders_mv/);
  assert.match(resetSql, /stop ingestion/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent && node --import tsx --test test/clickhouse_tool.test.ts`
Expected: FAIL because the current SQL still orders by `total_exec_count`, does not expose `total_exec_time_ms`, and severity is still count-based.

Run: `cd collector && ruby test/sql/clickhouse_schema_test.rb`
Expected: FAIL once the schema-state/reset assertions are added, because the current aggregate read model does not yet store source-tag-aware execution-time state or document a reset path.

- [ ] **Step 3: Write minimal implementation**

```ts
// in buildTopOffendersQuery()
return [
  "SELECT",
  "  fingerprint,",
  "  source_tag,",
  "  any(source_file) AS source_file,",
  "  any(sample_query) AS sample_query,",
  "  sumMerge(total_exec_count_state) AS total_exec_count,",
  "  sumMerge(total_exec_time_ms_state) AS total_exec_time_ms,",
  "  round(quantileMerge(0.95)(p95_exec_time_state), 2) AS p95_exec_time_ms",
  "FROM query_fingerprints",
  `WHERE ${conditions.join(" AND ")}`,
  "GROUP BY fingerprint, source_tag",
  "ORDER BY total_exec_time_ms DESC",
  "LIMIT 5",
  "FORMAT TSVWithNames",
].join("\\n");
```

```sql
-- collector/db/clickhouse/002_query_fingerprints.sql
CREATE TABLE query_fingerprints (
  fingerprint String,
  source_tag Nullable(String),
  source_file_state AggregateFunction(argMax, Nullable(String), DateTime64(3)),
  sample_query_state AggregateFunction(argMax, Nullable(String), DateTime64(3)),
  total_exec_count_state AggregateFunction(sum, UInt64),
  total_exec_time_ms_state AggregateFunction(sum, Float64),
  p95_exec_time_state AggregateFunction(quantile(0.95), Float64)
) ENGINE = AggregatingMergeTree
ORDER BY (fingerprint, source_tag);
```

```sql
-- collector/db/clickhouse/003_top_offenders_mv.sql
CREATE MATERIALIZED VIEW top_offenders_mv
TO query_fingerprints AS
SELECT
  fingerprint,
  source_tag,
  argMaxState(source_file, collected_at) AS source_file_state,
  argMaxState(sample_query, collected_at) AS sample_query_state,
  sumState(total_exec_count) AS total_exec_count_state,
  sumState(total_exec_count * mean_exec_time_ms) AS total_exec_time_ms_state,
  quantileState(0.95)(mean_exec_time_ms) AS p95_exec_time_state
FROM query_events
GROUP BY fingerprint, source_tag;
```

```sql
-- collector/db/clickhouse/004_reset_query_fingerprints.sql
-- ABOUTME: Rebuilds the fingerprint read model after execution-time schema changes.
-- ABOUTME: Run this only while collector ingestion is stopped so no raw events are missed.
DROP TABLE IF EXISTS top_offenders_mv;
DROP TABLE IF EXISTS query_fingerprints;

CREATE TABLE query_fingerprints (
  fingerprint String,
  source_tag Nullable(String),
  source_file_state AggregateFunction(argMax, Nullable(String), DateTime64(3)),
  sample_query_state AggregateFunction(argMax, Nullable(String), DateTime64(3)),
  total_exec_count_state AggregateFunction(sum, UInt64),
  total_exec_time_ms_state AggregateFunction(sum, Float64),
  p95_exec_time_state AggregateFunction(quantile(0.95), Float64)
) ENGINE = AggregatingMergeTree
ORDER BY (fingerprint, source_tag);

INSERT INTO query_fingerprints
SELECT
  fingerprint,
  source_tag,
  argMaxState(source_file, collected_at),
  argMaxState(sample_query, collected_at),
  sumState(total_exec_count),
  sumState(total_exec_count * mean_exec_time_ms),
  quantileState(0.95)(mean_exec_time_ms)
FROM query_events
GROUP BY fingerprint, source_tag;
```

```ts
// in buildWindowedQuery()
return [
  "SELECT",
  "  fingerprint,",
  "  tupleElement(representative, 1) AS source_tag,",
  "  tupleElement(representative, 2) AS source_file,",
  "  tupleElement(representative, 3) AS sample_query,",
  "  total_exec_count,",
  "  total_exec_time_ms,",
  "  p95_exec_time_ms",
  "FROM (",
  "  SELECT",
  "    fingerprint,",
  "    argMax((source_tag, source_file, sample_query), collected_at) AS representative,",
  "    sum(total_exec_count) AS total_exec_count,",
  "    round(sum(total_exec_count * mean_exec_time_ms), 2) AS total_exec_time_ms,",
  "    round(quantile(0.95)(mean_exec_time_ms), 2) AS p95_exec_time_ms",
  "  FROM query_events",
  `  WHERE ${conditions.join(" AND ")}`,
  "  GROUP BY fingerprint",
  ")",
  "ORDER BY total_exec_time_ms DESC",
  "LIMIT 5",
  "FORMAT TSVWithNames",
].join("\\n");
```

```ts
// in parseRows()
const totalExecTimeMs = Number(row.total_exec_time_ms ?? 0);
const p95ExecTimeMs = Number(row.p95_exec_time_ms ?? 0);

return {
  fingerprint: String(row.fingerprint ?? ""),
  p95_exec_time_ms: p95ExecTimeMs,
  sample_query: row.sample_query,
  severity: p95ExecTimeMs >= 100 ? "high" : "medium",
  source_file: row.source_file,
  source_tag: row.source_tag,
  total_exec_count: totalExecCount,
  total_exec_time_ms: totalExecTimeMs,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent && node --import tsx --test test/clickhouse_tool.test.ts`
Expected: PASS

Run: `cd collector && ruby test/sql/clickhouse_schema_test.rb`
Expected: PASS

Run: `cd agent && npm test`
Expected: PASS with the baseline suite still green.

- [ ] **Step 5: Commit**

```bash
git add agent/src/tools/clickhouse_tool.ts agent/test/clickhouse_tool.test.ts collector/db/clickhouse/002_query_fingerprints.sql collector/db/clickhouse/003_top_offenders_mv.sql collector/db/clickhouse/004_reset_query_fingerprints.sql collector/test/sql/clickhouse_schema_test.rb JOURNAL.md
git commit -m "fix: rank offenders by execution time"
```

### Task 2: Make Demo Repo Fixes Per-Finding And Fail Loudly On Drift

**Files:**
- Modify: `agent/src/tools/demo_repo_tool.ts`
- Test: `agent/test/demo_repo_tool.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("DemoRepoTool creates a branch per finding fingerprint", async () => {
  const root = await mkdtemp(join(tmpdir(), "demo-repo-tool-"));
  const commands: Array<string> = [];

  try {
    await mkdir(join(root, "app", "controllers"), { recursive: true });
    await writeFile(
      join(root, "app", "controllers", "todos_controller.rb"),
      [
        "class TodosController < ApplicationController",
        "  def index",
        "    todos = params[:q].present? ? Todo.where(\"title LIKE ?\", \"%#{params[:q]}%\") : Todo.all",
        "  end",
        "end",
      ].join("\\n"),
    );

    const tool = new DemoRepoTool(
      {
        exec: async (args, cwd) => {
          commands.push(`${cwd}: ${args.join(" ")}`);
          if (args[0] === "git" && args[1] === "diff") {
            return "diff --git a/app/controllers/todos_controller.rb b/app/controllers/todos_controller.rb";
          }
          return "";
        },
      },
      {
        env: {
          DEMO_APP_ROOT: root,
          DEMO_BASE_REF: "main",
        },
      },
    );

    const first = await tool.applyFix({
      finding: { fingerprint: "1234567890abcdef" },
      fix: { fix_type: "rewrite_like", summary: "summary" },
      source: {
        content: "3: Todo.where(\"title LIKE ?\", \"%#{params[:q]}%\")",
        source_file: "app/controllers/todos_controller.rb:3",
      },
    });

    await writeFile(
      join(root, "app", "controllers", "todos_controller.rb"),
      [
        "class TodosController < ApplicationController",
        "  def index",
        "    todos = params[:q].present? ? Todo.where(\"title LIKE ?\", \"%#{params[:q]}%\") : Todo.all",
        "  end",
        "end",
      ].join("\\n"),
    );

    const second = await tool.applyFix({
      finding: { fingerprint: "fedcba0987654321" },
      fix: { fix_type: "rewrite_like", summary: "summary" },
      source: {
        content: "3: Todo.where(\"title LIKE ?\", \"%#{params[:q]}%\")",
        source_file: "app/controllers/todos_controller.rb:3",
      },
    });

    assert.equal(first.branchName, "agent/demo-fix-1234567890ab");
    assert.equal(second.branchName, "agent/demo-fix-fedcba098765");
    assert.match(commands.join("\\n"), /git checkout -b agent\\/demo-fix-1234567890ab main/);
    assert.match(commands.join("\\n"), /git push origin agent\\/demo-fix-1234567890ab/);
    assert.match(commands.join("\\n"), /git checkout -b agent\\/demo-fix-fedcba098765 main/);
    assert.match(commands.join("\\n"), /git push origin agent\\/demo-fix-fedcba098765/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("DemoRepoTool rewrite_like updates the file and pushes the branch", async () => {
  const root = await mkdtemp(join(tmpdir(), "demo-repo-tool-"));
  const commands: Array<string> = [];

  try {
    await mkdir(join(root, "app", "controllers"), { recursive: true });
    await writeFile(
      join(root, "app", "controllers", "todos_controller.rb"),
      [
        "class TodosController < ApplicationController",
        "  def index",
        "    todos = params[:q].present? ? Todo.where(\"title LIKE ?\", \"%#{params[:q]}%\") : Todo.all",
        "  end",
        "end",
      ].join("\\n"),
    );

    const tool = new DemoRepoTool(
      {
        exec: async (args, cwd) => {
          commands.push(`${cwd}: ${args.join(" ")}`);
          if (args[0] === "git" && args[1] === "diff") {
            return "diff --git a/app/controllers/todos_controller.rb b/app/controllers/todos_controller.rb";
          }
          return "";
        },
      },
      {
        env: {
          DEMO_APP_ROOT: root,
          DEMO_BASE_REF: "main",
        },
      },
    );

    await tool.applyFix({
      finding: { fingerprint: "rewrite-like-1" },
      fix: { fix_type: "rewrite_like", summary: "Remove the leading wildcard." },
      source: {
        content: "3: Todo.where(\"title LIKE ?\", \"%#{params[:q]}%\")",
        source_file: "app/controllers/todos_controller.rb:3",
      },
    });

    const content = await readFile(join(root, "app", "controllers", "todos_controller.rb"), "utf8");

    assert.match(content, /"\#\{params\[:q\]\}%"/);
    assert.doesNotMatch(content, /"%\#\{params\[:q\]\}%"/);
    assert.deepEqual(commands, [
      `${root}: git ls-remote origin`,
      `${root}: git checkout -b agent/demo-fix-rewrite-like main`,
      `${root}: git add app/controllers/todos_controller.rb`,
      `${root}: git commit -m chore: apply rewrite_like fix`,
      `${root}: git diff HEAD~1 HEAD -- app/controllers/todos_controller.rb`,
      `${root}: git push origin agent/demo-fix-rewrite-like`,
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("DemoRepoTool add_includes updates the file and pushes the branch", async () => {
  const root = await mkdtemp(join(tmpdir(), "demo-repo-tool-"));
  const commands: Array<string> = [];

  try {
    await mkdir(join(root, "app", "controllers"), { recursive: true });
    await writeFile(
      join(root, "app", "controllers", "todos_controller.rb"),
      [
        "class TodosController < ApplicationController",
        "  def index",
        "    todos = params[:q].present? ? Todo.where(\"title LIKE ?\", \"#{params[:q]}%\") : Todo.all",
        "  end",
        "end",
      ].join("\\n"),
    );

    const tool = new DemoRepoTool(
      {
        exec: async (args, cwd) => {
          commands.push(`${cwd}: ${args.join(" ")}`);
          if (args[0] === "git" && args[1] === "diff") {
            return "diff --git a/app/controllers/todos_controller.rb b/app/controllers/todos_controller.rb";
          }
          return "";
        },
      },
      {
        env: {
          DEMO_APP_ROOT: root,
          DEMO_BASE_REF: "main",
        },
      },
    );

    await tool.applyFix({
      finding: { fingerprint: "add-includes-1" },
      fix: { fix_type: "add_includes", summary: "Eager load the user association." },
      source: {
        content: [
          "3: todos = params[:q].present? ? Todo.where(\"title LIKE ?\", \"#{params[:q]}%\") : Todo.all",
          "4: todos.each { |t| t.user.name }",
        ].join("\\n"),
        source_file: "app/controllers/todos_controller.rb:3",
      },
    });

    const content = await readFile(join(root, "app", "controllers", "todos_controller.rb"), "utf8");

    assert.match(content, /Todo\.includes\(:user\)\.all/);
    assert.deepEqual(commands, [
      `${root}: git ls-remote origin`,
      `${root}: git checkout -b agent/demo-fix-add-includes main`,
      `${root}: git add app/controllers/todos_controller.rb`,
      `${root}: git commit -m chore: apply add_includes fix`,
      `${root}: git diff HEAD~1 HEAD -- app/controllers/todos_controller.rb`,
      `${root}: git push origin agent/demo-fix-add-includes`,
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("DemoRepoTool raises a drift error when rewrite_count replacement does not match", async () => {
  await assert.rejects(
    () => tool.applyFix({ ...rewriteCountInputWithNonMatchingFile }),
    /DemoRepoTool: expected string not found in app\/controllers\/todos_controller\.rb/,
  );
});

test("DemoRepoTool raises a drift error when rewrite_like replacement does not match", async () => {
  await assert.rejects(
    () => tool.applyFix({ ...rewriteLikeInputWithNonMatchingFile }),
    /DemoRepoTool: expected string not found in app\/controllers\/todos_controller\.rb/,
  );
});

test("DemoRepoTool raises a drift error when add_includes replacement does not match", async () => {
  await assert.rejects(
    () => tool.applyFix({ ...addIncludesInputWithNonMatchingFile }),
    /DemoRepoTool: expected string not found in app\/controllers\/todos_controller\.rb/,
  );
});

test("DemoRepoTool fails before file edits when the git remote is unreachable", async () => {
  const root = await mkdtemp(join(tmpdir(), "demo-repo-tool-"));
  try {
    await mkdir(join(root, "app", "controllers"), { recursive: true });
    const controllerPath = join(root, "app", "controllers", "todos_controller.rb");
    const original = "class TodosController < ApplicationController\\nend\\n";
    await writeFile(controllerPath, original);

    const tool = new DemoRepoTool(
      {
        exec: async (args) => {
          if (args[0] === "git" && args[1] === "ls-remote") {
            throw new Error("auth failed");
          }
          return "";
        },
      },
      {
        env: { DEMO_APP_ROOT: root, DEMO_BASE_REF: "main" },
      },
    );

    await assert.rejects(
      () => tool.applyFix({ ...rewriteLikeInput }),
      /DemoRepoTool: cannot reach git remote — check credentials/,
    );
    assert.equal(await readFile(controllerPath, "utf8"), original);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd agent && node --import tsx --test test/demo_repo_tool.test.ts`
Expected: FAIL because `applyFix()` still uses a shared head branch, does not run `git ls-remote origin`, does not return branch/diff metadata, and does not validate replacements.

- [ ] **Step 3: Write minimal implementation**

```ts
type ApplyFixInput = {
  finding: { fingerprint: string };
  fix: FixProposal;
  source: LocatedSource;
};

type ApplyFixResult = {
  branchName: string;
  diff: string;
};

async applyFix(input: ApplyFixInput): Promise<ApplyFixResult> {
  const root = this.env.DEMO_APP_ROOT;
  const base = this.env.DEMO_BASE_REF ?? "main";
  if (!root) {
    throw new Error("DemoRepoTool requires DEMO_APP_ROOT.");
  }

  await ensureRemoteReachable(this.runner, root);
  const branchName = buildBranchName(input.finding.fingerprint);
  await this.runner.exec(["git", "checkout", "-b", branchName, base], root);
  const touchedPaths = await this.applyChange(root, input);

  for (const path of touchedPaths) {
    await this.runner.exec(["git", "add", path], root);
  }

  await this.runner.exec(["git", "commit", "-m", `chore: apply ${input.fix.fix_type} fix`], root);
  const diff = await this.runner.exec(["git", "diff", "HEAD~1", "HEAD", "--", ...touchedPaths], root);
  await this.runner.exec(["git", "push", "origin", branchName], root);
  return { branchName, diff };
}
```

```ts
function buildBranchName(fingerprint: string): string {
  return `agent/demo-fix-${fingerprint.slice(0, 12)}`;
}

async function ensureRemoteReachable(runner: CommandRunner, root: string): Promise<void> {
  try {
    await runner.exec(["git", "ls-remote", "origin"], root);
  } catch {
    throw new Error(`DemoRepoTool: cannot reach git remote — check credentials for ${root}`);
  }
}
```

```ts
function ensureReplacementChanged(path: string, original: string, updated: string): void {
  if (updated === original) {
    throw new Error(
      `DemoRepoTool: expected string not found in ${path} — demo app content may have drifted`,
    );
  }
}
```

```ts
// in rewriteCount / rewriteLike / addIncludes
const updated = content.replace(...);
ensureReplacementChanged(path, content, updated);
await writeFile(absolutePath, updated);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd agent && node --import tsx --test test/demo_repo_tool.test.ts`
Expected: PASS

Run: `cd agent && npm test`
Expected: PASS with the expanded demo-repo coverage and all prior tests green.

- [ ] **Step 5: Commit**

```bash
git add agent/src/tools/demo_repo_tool.ts agent/test/demo_repo_tool.test.ts JOURNAL.md
git commit -m "fix: isolate demo repo fixes per finding"
```

### Task 3: Wire Per-Finding PR Metadata Through Executor And GitHubTool

**Files:**
- Modify: `agent/src/tools/github_tool.ts`
- Modify: `agent/src/executor.ts`
- Test: `agent/test/github_tool.test.ts`
- Test: `agent/test/executor.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// add to executor.test.ts
test("DBSpecialistExecutor classifies add_includes from association traversal", async () => {
  const executor = new DBSpecialistExecutor({
    clickhouseTool: {
      topOffenders: async () => [
        {
          fingerprint: "fp-includes",
          sample_query: "SELECT * FROM todos",
          severity: "medium",
          source_file: "/app/controllers/todos_controller.rb:3",
        },
      ],
    },
    codeSearchTool: {
      locate: async ({ source_file }: { source_file?: string | null }) => ({
        content: [
          "3: todos = params[:q].present? ? Todo.where(...) : Todo.all",
          "4: todos.each { |t| t.user.name }",
        ].join("\\n"),
        source_file: source_file ?? "app/controllers/todos_controller.rb:3",
      }),
    },
  } as any);

  const events: Array<any> = [];
  await executor.execute({ userMessage: { text: "analyze_db" } } as any, {
    enqueueEvent(event: unknown) {
      events.push(event);
    },
  });

  assert.equal(events[1]?.result?.findings?.[0]?.fix?.fix_type, "add_includes");
});

test("DBSpecialistExecutor passes branch name and diff from demo repo to GitHub", async () => {
  const calls: Array<any> = [];
  const executor = new DBSpecialistExecutor({
    clickhouseTool: {
      topOffenders: async () => [
        {
          fingerprint: "fp-pr",
          sample_query: "SELECT * FROM todos WHERE status = 'open'",
          severity: "high",
          source_file: "/app/controllers/todos_controller.rb:9",
          source_tag: "todos#status",
        },
      ],
    },
    codeSearchTool: {
      locate: async () => ({
        content: "9: render json: Todo.where(status: params.fetch(:status, \"open\"))",
        source_file: "/app/controllers/todos_controller.rb:9",
      }),
    },
    explainTool: {
      analyze: async () => ({ validated: true, plan_rows: [{ "QUERY PLAN": "Index Scan on todos" }] }),
    },
    memoryTool: {
      shouldSuggest: async () => true,
    },
    demoRepoTool: {
      applyFix: async () => ({ branchName: "agent/demo-fix-fp-pr", diff: "diff --git a/file b/file" }),
    },
    githubTool: {
      openPullRequest: async (input: unknown) => {
        calls.push(input);
        return { url: "https://example.test/pr/99" };
      },
    },
  } as any);

  await executor.execute({ userMessage: { text: "analyze_db" } } as any, {
    enqueueEvent() {},
  });

  assert.equal(calls[0]?.headRef, "agent/demo-fix-fp-pr");
  assert.equal(calls[0]?.codeDiff, "diff --git a/file b/file");
});

// add to github_tool.test.ts
test("GitHubTool throws when GITHUB_TOKEN is set but DEMO_REPO is missing", async () => {
  const tool = new GitHubTool(undefined, {
    env: { GITHUB_TOKEN: "token", DEMO_HEAD_REF: "agent/demo-fix" },
  });

  await assert.rejects(
    () => tool.openPullRequest({ finding: { fingerprint: "fp" } }),
    /DEMO_REPO/,
  );
});

test("GitHubTool posts a real pull request with code diff and explain evidence", async () => {
  const requests: Array<{ body: string; headers: Headers; url: string }> = [];
  const tool = new GitHubTool(undefined, {
    env: {
      DEMO_BASE_REF: "main",
      DEMO_HEAD_REF: "agent/demo-fix-default",
      DEMO_REPO: "brett/db-specialist-demo",
      GITHUB_TOKEN: "secret-token",
    },
    fetchImpl: async (url, init) => {
      requests.push({
        body: String(init?.body ?? ""),
        headers: new Headers(init?.headers),
        url: String(url),
      });

      return new Response(
        JSON.stringify({ html_url: "https://github.com/brett/db-specialist-demo/pull/12" }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  await tool.openPullRequest({
    finding: { fingerprint: "fp-real", source_tag: "todos#index" },
    fix: {
      fix_type: "rewrite_like",
      summary: "Replace the leading-wildcard title search with a searchable alternative.",
    },
    validation: {
      plan_rows: [{ "QUERY PLAN": "Seq Scan on todos" }],
      validated: true,
    },
    headRef: "agent/demo-fix-fp-real",
    codeDiff: "diff --git a/app/controllers/todos_controller.rb b/app/controllers/todos_controller.rb",
  });

  assert.match(requests[0]?.body ?? "", /## Code Change/);
  assert.match(requests[0]?.body ?? "", /diff --git/);
  assert.match(requests[0]?.body ?? "", /## EXPLAIN \\(after fix\\)/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd agent && node --import tsx --test test/executor.test.ts test/github_tool.test.ts`
Expected: FAIL because the executor does not yet pass `finding` into `DemoRepoTool`, does not forward branch/diff metadata, and `GitHubTool` still caches one PR URL and reads only `DEMO_HEAD_REF` from env.

- [ ] **Step 3: Write minimal implementation**

```ts
// in executor dependency types
demoRepoTool?: {
  applyFix(input: {
    finding: TopOffender;
    fix: FixProposal;
    source: LocatedSource;
  }): Promise<{ branchName: string; diff: string }>;
};

githubTool?: {
  openPullRequest(input: {
    finding: TopOffender;
    fix: FixProposal;
    source: LocatedSource;
    validation: ValidationResult;
    headRef?: string;
    codeDiff?: string;
  }): Promise<PullRequestResult>;
};
```

```ts
// in analyzeFinding()
let preparation: { branchName: string; diff: string } | null = null;
if (mayOpenPr) {
  preparation = await this.deps.demoRepoTool?.applyFix({
    finding,
    fix,
    source,
  }) ?? null;
  pr = await this.deps.githubTool!.openPullRequest({
    finding,
    fix,
    source,
    validation,
    headRef: preparation?.branchName,
    codeDiff: preparation?.diff,
  });
}
```

```ts
// in GitHubTool
type PullRequestInput = {
  // existing fields ...
  headRef?: string;
  codeDiff?: string;
};

const head = input.headRef ?? this.env.DEMO_HEAD_REF;
if (!repo || !head) {
  throw new Error("GitHubTool requires DEMO_REPO and DEMO_HEAD_REF when GITHUB_TOKEN is set.");
}
```

```ts
function buildPullRequestBody(input: PullRequestInput): string {
  const explainRows = input.validation?.plan_rows
    ?.map((row) => Object.values(row).join(" "))
    .join("\\n") ?? "No EXPLAIN rows captured.";
  const codeDiff = input.codeDiff && input.codeDiff.length > 0
    ? input.codeDiff
    : "No code diff captured.";

  return [
    "## DB Specialist Finding",
    `- fingerprint: ${input.finding?.fingerprint ?? "unknown"}`,
    `- source_tag: ${input.finding?.source_tag ?? "unknown"}`,
    `- fix_type: ${input.fix?.fix_type ?? "unknown"}`,
    `- summary: ${input.fix?.summary ?? "unknown"}`,
    "",
    "## Code Change",
    "```diff",
    codeDiff,
    "```",
    "",
    "## EXPLAIN (after fix)",
    "```",
    explainRows,
    "```",
  ].join("\\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd agent && node --import tsx --test test/executor.test.ts test/github_tool.test.ts`
Expected: PASS

Run: `cd agent && npm test`
Expected: PASS with all existing tests still green and the new assertions added.

- [ ] **Step 5: Commit**

```bash
git add agent/src/executor.ts agent/src/tools/github_tool.ts agent/test/executor.test.ts agent/test/github_tool.test.ts JOURNAL.md
git commit -m "fix: carry per-finding PR metadata through the agent"
```

### Task 4: Document Demo Setup, Reset, And Phase 2 TODOs

**Files:**
- Modify: `README.md`
- Modify: `TODOS.md`
- Modify: `JOURNAL.md`
- Test: `tests/docs/readme_config_test.py`

- [ ] **Step 1: Write the failing test**

```python
def test_readme_documents_demo_setup_and_reset():
    content = Path("README.md").read_text()
    assert "## Demo setup" in content
    assert "DEMO_APP_ROOT" in content
    assert "push access" in content
    assert "DEMO_REPO" in content
    assert "DEMO_BASE_REF" in content
    assert "DEMO_HEAD_REF" in content
    assert "GITHUB_TOKEN" in content
    assert "reset" in content.lower()
```

- [ ] **Step 2: Run the failing check**

Run: `python3 -m pytest tests/docs/readme_config_test.py -v`
Expected: FAIL because the current README does not yet include the dedicated `Demo setup` section and reset guidance.

- [ ] **Step 3: Write minimal implementation**

```md
## Demo setup

1. Clone the demo app repo into `DEMO_APP_ROOT`.
2. Configure push-capable git credentials inside that repo. SSH or HTTPS with a
   stored credential both work, but the agent must be able to run `git ls-remote`
   and `git push` there without interactive prompts.
3. Set `DEMO_REPO`, `DEMO_BASE_REF`, `DEMO_HEAD_REF`, and `GITHUB_TOKEN` before
   starting the live PR demo.
4. Before repeating a live proof, reset the demo repo to the base branch and
   delete the prior `agent/demo-fix-*` branches created by the agent.
```

```md
## pi-agent-core loop (Phase 2 agent capability)

**What:** Wire `DBSpecialistExecutor` through pi-agent-core's LLM reasoning loop.
Currently the executor uses deterministic pattern matching with no LLM calls.

**Why:** Phase 1 proves the vertical slice with direct tool orchestration.
Phase 2 adds LLM-based fix classification — at that point, wiring pi-agent-core
makes sense.

**Where:** `agent/src/executor.ts`, `agent/package.json`.
```

Also add a short `JOURNAL.md` entry summarizing the repeatable demo reset decision.

- [ ] **Step 4: Run verification**

Run:
- `python3 -m pytest tests/docs/readme_config_test.py -v`
- `rg -n "Demo setup|reset|pi-agent-core loop" README.md TODOS.md`
- `cd agent && npm test`

Expected: PASS / matching output, and the agent suite remains green.

- [ ] **Step 5: Commit**

```bash
git add README.md TODOS.md JOURNAL.md tests/docs/readme_config_test.py
git commit -m "docs: add eng review 3 setup and phase 2 notes"
```

## Final Verification

- [ ] Run `cd agent && npm test`
- [ ] Run `cd agent && npm run typecheck`
- [ ] Run `python3 -m pytest tests/docs/readme_config_test.py -v` if updated
- [ ] Run `git status --short`
- [ ] Capture the final `npm test` output for the report
- [ ] Report:
  - test count before and after
  - which items were code changes vs. test-only changes
  - any deviations from the brief
  - the final `npm test` output
