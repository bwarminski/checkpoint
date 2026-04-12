# oh-my-pi MVP Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current A2A and `pi-mono` runtime with a smaller `oh-my-pi` MVP that runs from a generated external workspace, uses coarse Postgres and ClickHouse SQL tools, and supports manual TUI verification loops against a cloned demo repo.

**Architecture:** The repo remains the source of truth for skills, tools, tests, and local orchestration. A generated workspace at `~/.oh-my-pi-workspaces/checkpoint` acts as the runtime-facing `oh-my-pi` project and symlinks back to repo-owned skills and tools. The implementation starts with a `*_db_checker` subagent spike because the `oh-my-pi` subagent API is the least familiar surface and informs the rest of the SQL tool design.

**Tech Stack:** TypeScript, Node.js test runner, `oh-my-pi`, PostgreSQL, ClickHouse, shell scripts, git

---

## File Map

### New files

- `AGENTS.md`
  Root project instructions, including Brett's required gate that live model-based integration tests must run before opening PRs or merging to `main`.
- `src/tools/postgres/list_tables_tool.ts`
  Postgres table discovery tool.
- `src/tools/postgres/schema_tool.ts`
  Postgres schema introspection tool.
- `src/tools/postgres/checker_tool.ts`
  Postgres query checker that delegates to an `oh-my-pi` subagent.
- `src/tools/postgres/query_tool.ts`
  Postgres query execution tool with timeout and row-cap controls.
- `src/tools/clickhouse/list_tables_tool.ts`
  ClickHouse table discovery tool.
- `src/tools/clickhouse/schema_tool.ts`
  ClickHouse schema introspection tool.
- `src/tools/clickhouse/checker_tool.ts`
  ClickHouse query checker that delegates to an `oh-my-pi` subagent.
- `src/tools/clickhouse/query_tool.ts`
  ClickHouse query execution tool with timeout and row-cap controls.
- `src/tools/shared/query_limits.ts`
  Shared timeout and row-cap parsing helpers for SQL tools.
- `src/tools/shared/subagent_checker.ts`
  Shared adapter interface for `oh-my-pi` subagent-backed checker behavior.
- `skills/db-investigation.md`
  Main investigation workflow skill with inline ClickHouse performance catalog.
- `scripts/setup-oh-my-pi-workspace.sh`
  Creates or refreshes `~/.oh-my-pi-workspaces/checkpoint`, writes minimal runtime files, and symlinks repo-owned skills and tools.
- `scripts/reset-oh-my-pi-workspace.sh`
  Recreates or cleans the generated workspace for reproducible runs.
- `scripts/run-model-integration.sh`
  Manual wrapper for the live `oh-my-pi` integration scenario.
- `scripts/workspace-smoke.sh`
  Manual workspace smoke verification against known demo query issues.
- `test/tools/postgres_list_tables_tool.test.ts`
- `test/tools/postgres_schema_tool.test.ts`
- `test/tools/postgres_checker_tool.test.ts`
- `test/tools/postgres_query_tool.test.ts`
- `test/tools/clickhouse_list_tables_tool.test.ts`
- `test/tools/clickhouse_schema_tool.test.ts`
- `test/tools/clickhouse_checker_tool.test.ts`
- `test/tools/clickhouse_query_tool.test.ts`
  Unit tests for the eight SQL tools.
- `test/integration/oh_my_pi_session.test.ts`
  Root integration harness for generated-workspace `oh-my-pi` sessions.

### Modified files

- `package.json`
  Replace stale `pi` metadata with `oh-my-pi`-oriented scripts used by tests and manual runs.
- `README.md`
  Rewrite setup and verification instructions around the generated workspace, demo clone flow, TUI loop, and manual smoke scripts.
- `TODOS.md`
  Remove items made obsolete by the hard cut and preserve only still-live follow-ups.
- `JOURNAL.md`
  Record the restructuring decisions and implementation milestones as work proceeds.
- `test/integration/pi_session.test.ts`
  Replace or rename to the new `oh-my-pi` integration harness if keeping history in place is cleaner than a fresh file.

### Removed files and directories

- `src/a2a_bridge/`
- `src/agent_tools.ts`
- `src/tools/clickhouse_tool.ts`
- `src/tools/demo_repo_tool.ts`
- `src/tools/github_tool.ts`
- `agent/`
- `extensions/db-specialist.ts`
  Remove the old runtime path after tagging the pre-cut state.

---

### Task 1: Capture The Pre-Cut Baseline And Tag It

**Files:**
- Modify: `JOURNAL.md`
- Test: none

- [ ] **Step 1: Record the pre-cut snapshot in the journal**

```md
- 2026-04-12: Started the oh-my-pi MVP cutover plan implementation. Before removing the A2A and pi-mono runtime, create a git tag that captures the last pre-cut checkpoint architecture so the old path remains recoverable without keeping compatibility code in the main line.
```

- [ ] **Step 2: Verify the worktree is clean except for approved planning docs**

Run: `git status --short --branch`
Expected: the branch is `wip/brainstorm-2026-04-12` and only the expected planning docs plus the new `JOURNAL.md` edit appear.

- [ ] **Step 3: Create the pre-cut tag**

Run: `git tag checkpoint-pre-oh-my-pi-cut`
Expected: no output and `git tag --list checkpoint-pre-oh-my-pi-cut` prints the new tag.

- [ ] **Step 4: Verify the tag points at the current pre-cut commit**

Run: `git rev-list -n 1 checkpoint-pre-oh-my-pi-cut`
Expected: prints the current HEAD SHA.

- [ ] **Step 5: Commit the journal note**

```bash
git add JOURNAL.md
git commit -m "docs: record pre-cut oh-my-pi tag checkpoint"
```

### Task 2: Spike The oh-my-pi Subagent Checker API First

**Files:**
- Create: `src/tools/shared/subagent_checker.ts`
- Create: `test/tools/postgres_checker_tool.test.ts`
- Create: `test/tools/clickhouse_checker_tool.test.ts`
- Modify: `package.json`
- Test: `test/tools/postgres_checker_tool.test.ts`, `test/tools/clickhouse_checker_tool.test.ts`

- [ ] **Step 1: Write the failing Postgres checker test around an injectable subagent**

```ts
// ABOUTME: Verifies the Postgres checker delegates query validation to a subagent.
// ABOUTME: Ensures the checker returns the subagent verdict without a live model.
import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresCheckerTool } from "../../src/tools/postgres/checker_tool.ts";

test("postgres checker delegates to the injected subagent", async () => {
  const calls: Array<{ prompt: string }> = [];
  const tool = createPostgresCheckerTool({
    runCheck: async (prompt) => {
      calls.push({ prompt });
      return { verdict: "safe", rewrittenQuery: "select 1", notes: ["ok"] };
    },
  });

  const result = await tool.execute({
    dialect: "postgres",
    question: "Validate this query",
    query: "select 1",
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /select 1/);
  assert.deepEqual(result, {
    verdict: "safe",
    rewrittenQuery: "select 1",
    notes: ["ok"],
  });
});
```

- [ ] **Step 2: Write the failing ClickHouse checker test that shares the same adapter shape**

```ts
// ABOUTME: Verifies the ClickHouse checker uses the shared subagent adapter.
// ABOUTME: Confirms ClickHouse prompts can be validated without a live model.
import assert from "node:assert/strict";
import test from "node:test";
import { createClickHouseCheckerTool } from "../../src/tools/clickhouse/checker_tool.ts";

test("clickhouse checker delegates to the injected subagent", async () => {
  const prompts: Array<string> = [];
  const tool = createClickHouseCheckerTool({
    runCheck: async (prompt) => {
      prompts.push(prompt);
      return { verdict: "rewrite", rewrittenQuery: "select * from query_events limit 5", notes: ["limit added"] };
    },
  });

  const result = await tool.execute({
    dialect: "clickhouse",
    question: "Validate this query",
    query: "select * from query_events",
  });

  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /query_events/);
  assert.equal(result.verdict, "rewrite");
});
```

- [ ] **Step 3: Run the new checker tests to confirm they fail**

Run: `npm test -- test/tools/postgres_checker_tool.test.ts test/tools/clickhouse_checker_tool.test.ts`
Expected: FAIL with module-not-found or export-not-found errors for the new checker files.

- [ ] **Step 4: Add the shared subagent adapter contract**

```ts
// ABOUTME: Defines the shared contract for SQL checker tools backed by oh-my-pi subagents.
// ABOUTME: Keeps checker logic injectable so unit tests do not require a live model.
export type CheckerVerdict = "safe" | "rewrite" | "reject";

export type CheckerResult = {
  verdict: CheckerVerdict;
  rewrittenQuery: string;
  notes: Array<string>;
};

export type SubagentChecker = {
  runCheck(prompt: string): Promise<CheckerResult>;
};

export function buildCheckerPrompt(input: {
  dialect: "postgres" | "clickhouse";
  question: string;
  query: string;
}): string {
  return [
    `Dialect: ${input.dialect}`,
    `Question: ${input.question}`,
    "Review the SQL for correctness and safety.",
    `SQL:\n${input.query}`,
    'Respond with JSON: {"verdict":"safe|rewrite|reject","rewrittenQuery":"...","notes":["..."]}',
  ].join("\n\n");
}
```

- [ ] **Step 5: Implement the minimal checker tools against the shared adapter**

```ts
// ABOUTME: Validates Postgres SQL through an injected oh-my-pi subagent adapter.
// ABOUTME: Returns the adapter verdict without embedding runtime-specific wiring here.
import { buildCheckerPrompt, type SubagentChecker } from "../shared/subagent_checker.ts";

export function createPostgresCheckerTool(checker: SubagentChecker) {
  return {
    async execute(input: { dialect: "postgres"; question: string; query: string }) {
      return checker.runCheck(buildCheckerPrompt(input));
    },
  };
}
```

```ts
// ABOUTME: Validates ClickHouse SQL through an injected oh-my-pi subagent adapter.
// ABOUTME: Shares the same prompt contract as the Postgres checker tool.
import { buildCheckerPrompt, type SubagentChecker } from "../shared/subagent_checker.ts";

export function createClickHouseCheckerTool(checker: SubagentChecker) {
  return {
    async execute(input: { dialect: "clickhouse"; question: string; query: string }) {
      return checker.runCheck(buildCheckerPrompt(input));
    },
  };
}
```

- [ ] **Step 6: Run the checker tests to verify they pass**

Run: `npm test -- test/tools/postgres_checker_tool.test.ts test/tools/clickhouse_checker_tool.test.ts`
Expected: PASS with 2 passing tests.

- [ ] **Step 7: Commit the verified subagent spike**

```bash
git add package.json src/tools/shared/subagent_checker.ts src/tools/postgres/checker_tool.ts src/tools/clickhouse/checker_tool.ts test/tools/postgres_checker_tool.test.ts test/tools/clickhouse_checker_tool.test.ts
git commit -m "feat: spike oh-my-pi sql checker adapter"
```

### Task 3: Hard-Cut The Old Runtime Path

**Files:**
- Delete: `src/a2a_bridge/server.ts`
- Delete: `src/a2a_bridge/session_registry.ts`
- Delete: `src/agent_tools.ts`
- Delete: `src/tools/clickhouse_tool.ts`
- Delete: `src/tools/demo_repo_tool.ts`
- Delete: `src/tools/github_tool.ts`
- Delete: `agent/`
- Delete: `extensions/db-specialist.ts`
- Modify: `TODOS.md`
- Modify: `README.md`
- Test: `npm test`

- [ ] **Step 1: Write a failing regression test that asserts removed legacy surfaces are gone from the root runtime**

```ts
// ABOUTME: Prevents the oh-my-pi redesign from retaining the removed legacy runtime files.
// ABOUTME: Fails if the repo still exposes the A2A and fine-grained tool path.
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

test("legacy runtime files are removed from the main path", async () => {
  await assert.rejects(() => access("src/a2a_bridge/server.ts"));
  await assert.rejects(() => access("src/tools/github_tool.ts"));
  await assert.rejects(() => access("agent/src/executor.ts"));
});
```

- [ ] **Step 2: Run the regression test to confirm it fails before the cut**

Run: `npm test -- test/integration/legacy_runtime_cutover.test.ts`
Expected: FAIL because the files still exist.

- [ ] **Step 3: Remove the legacy runtime files and prune obsolete TODOs**

```md
# TODOS

## Security: ClickHouse bound to 0.0.0.0 with no auth

## pg_stat_monitor upgrade path

## Root package lockfile policy
```

- [ ] **Step 4: Rewrite the README opening sections around the new oh-my-pi direction**

```md
# Checkpoint DB Specialist

This repo owns the oh-my-pi-based DB specialist MVP.

The current runtime is a generated oh-my-pi workspace at `~/.oh-my-pi-workspaces/checkpoint`.
Manual verification runs use that workspace plus a dedicated demo repo clone inside it.
```

- [ ] **Step 5: Run the legacy-cut regression test and the root suite**

Run: `npm test -- test/integration/legacy_runtime_cutover.test.ts && npm test`
Expected: PASS with the legacy-cut regression green and the remaining root suite adjusted to the smaller runtime.

- [ ] **Step 6: Commit the hard cut**

```bash
git add README.md TODOS.md test/integration/legacy_runtime_cutover.test.ts src
git add -u agent extensions
git commit -m "refactor: remove pre-oh-my-pi runtime path"
```

### Task 4: Build Shared SQL Query Limits And The Six Non-Checker Tools

**Files:**
- Create: `src/tools/shared/query_limits.ts`
- Create: `src/tools/postgres/list_tables_tool.ts`
- Create: `src/tools/postgres/schema_tool.ts`
- Create: `src/tools/postgres/query_tool.ts`
- Create: `src/tools/clickhouse/list_tables_tool.ts`
- Create: `src/tools/clickhouse/schema_tool.ts`
- Create: `src/tools/clickhouse/query_tool.ts`
- Create: `test/tools/postgres_list_tables_tool.test.ts`
- Create: `test/tools/postgres_schema_tool.test.ts`
- Create: `test/tools/postgres_query_tool.test.ts`
- Create: `test/tools/clickhouse_list_tables_tool.test.ts`
- Create: `test/tools/clickhouse_schema_tool.test.ts`
- Create: `test/tools/clickhouse_query_tool.test.ts`
- Test: six new tool tests

- [ ] **Step 1: Write the failing row-cap and timeout helper test**

```ts
// ABOUTME: Verifies SQL tools clamp row counts and expose per-query timeout settings.
// ABOUTME: Keeps Postgres and ClickHouse query limits consistent.
import assert from "node:assert/strict";
import test from "node:test";
import { resolveQueryLimits } from "../../src/tools/shared/query_limits.ts";

test("resolveQueryLimits clamps row caps and timeout values", () => {
  assert.deepEqual(resolveQueryLimits({ rowCap: 5_000, timeoutMs: 90_000 }, { maxRows: 200, maxTimeoutMs: 10_000 }), {
    rowCap: 200,
    timeoutMs: 10_000,
  });
});
```

- [ ] **Step 2: Write one failing list/schema/query test for each database family**

```ts
// ABOUTME: Verifies Postgres list-tables tool normalizes table names.
// ABOUTME: Ensures the tool only depends on an injected query runner.
import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresListTablesTool } from "../../src/tools/postgres/list_tables_tool.ts";

test("postgres list tables returns plain table names", async () => {
  const tool = createPostgresListTablesTool(async () => [{ table_name: "todos" }, { table_name: "users" }]);
  assert.deepEqual(await tool.execute({ schema: "public" }), ["todos", "users"]);
});
```

```ts
// ABOUTME: Verifies ClickHouse query tool applies max_execution_time and row caps.
// ABOUTME: Keeps the tool honest about bounded exploratory queries.
import assert from "node:assert/strict";
import test from "node:test";
import { createClickHouseQueryTool } from "../../src/tools/clickhouse/query_tool.ts";

test("clickhouse query tool prepends execution settings and limit", async () => {
  let received = "";
  const tool = createClickHouseQueryTool(async (sql) => {
    received = sql;
    return [{ fingerprint: "abc" }];
  });

  const rows = await tool.execute({ query: "select fingerprint from query_events", rowCap: 10, timeoutMs: 2 });

  assert.equal(rows.length, 1);
  assert.match(received, /max_execution_time/);
  assert.match(received, /LIMIT 10/);
});
```

- [ ] **Step 3: Run the focused tool tests to confirm they fail**

Run: `npm test -- test/tools/postgres_list_tables_tool.test.ts test/tools/postgres_schema_tool.test.ts test/tools/postgres_query_tool.test.ts test/tools/clickhouse_list_tables_tool.test.ts test/tools/clickhouse_schema_tool.test.ts test/tools/clickhouse_query_tool.test.ts`
Expected: FAIL with missing-module or missing-export errors.

- [ ] **Step 4: Implement shared query-limit helpers**

```ts
// ABOUTME: Resolves safe row-cap and timeout values for exploratory SQL tools.
// ABOUTME: Prevents callers from bypassing configured hard limits.
export function resolveQueryLimits(
  requested: { rowCap?: number; timeoutMs?: number },
  caps: { maxRows: number; maxTimeoutMs: number },
): { rowCap: number; timeoutMs: number } {
  return {
    rowCap: Math.min(requested.rowCap ?? caps.maxRows, caps.maxRows),
    timeoutMs: Math.min(requested.timeoutMs ?? caps.maxTimeoutMs, caps.maxTimeoutMs),
  };
}
```

- [ ] **Step 5: Implement the minimal Postgres and ClickHouse tools with injected runners**

```ts
// ABOUTME: Lists PostgreSQL tables from the requested schema.
// ABOUTME: Keeps table discovery separate from schema and query execution.
export function createPostgresListTablesTool(runQuery: (sql: string) => Promise<Array<{ table_name: string }>>) {
  return {
    async execute(input: { schema: string }) {
      const rows = await runQuery(
        `select table_name from information_schema.tables where table_schema = '${input.schema}' order by table_name`,
      );
      return rows.map((row) => row.table_name);
    },
  };
}
```

```ts
// ABOUTME: Executes bounded ClickHouse SQL for exploration and verification.
// ABOUTME: Applies max_execution_time and a row limit before delegating to the runner.
import { resolveQueryLimits } from "../shared/query_limits.ts";

export function createClickHouseQueryTool(runQuery: (sql: string) => Promise<Array<Record<string, unknown>>>) {
  return {
    async execute(input: { query: string; rowCap?: number; timeoutMs?: number }) {
      const limits = resolveQueryLimits(input, { maxRows: 200, maxTimeoutMs: 10_000 });
      const sql = `SETTINGS max_execution_time=${Math.ceil(limits.timeoutMs / 1000)} ${input.query} LIMIT ${limits.rowCap}`;
      return runQuery(sql);
    },
  };
}
```

- [ ] **Step 6: Run the focused tool tests to verify the implementations pass**

Run: `npm test -- test/tools/postgres_list_tables_tool.test.ts test/tools/postgres_schema_tool.test.ts test/tools/postgres_query_tool.test.ts test/tools/clickhouse_list_tables_tool.test.ts test/tools/clickhouse_schema_tool.test.ts test/tools/clickhouse_query_tool.test.ts`
Expected: PASS with 6 passing tests plus the earlier checker tests still green.

- [ ] **Step 7: Commit the SQL tool family**

```bash
git add src/tools/shared/query_limits.ts src/tools/postgres src/tools/clickhouse test/tools/postgres_* test/tools/clickhouse_*
git commit -m "feat: add coarse postgres and clickhouse sql tools"
```

### Task 5: Create The Investigation Skill With Inline ClickHouse Catalog

**Files:**
- Modify: `skills/investigation.md`
- Create: `skills/db-investigation.md`
- Test: `npm test -- test/integration/oh_my_pi_session.test.ts`

- [ ] **Step 1: Write the failing integration assertion for the new investigation skill name and catalog text**

```ts
// ABOUTME: Verifies the generated oh-my-pi session exposes the DB investigation skill.
// ABOUTME: Ensures the skill carries the ClickHouse catalog guidance inline.
import assert from "node:assert/strict";
import test from "node:test";
import { loadWorkspaceSkill } from "./helpers/workspace_loader.ts";

test("db investigation skill includes ClickHouse catalog guidance", async () => {
  const markdown = await loadWorkspaceSkill("db-investigation");
  assert.match(markdown, /query_events/);
  assert.match(markdown, /query_intervals/);
  assert.match(markdown, /highest-value issue/);
});
```

- [ ] **Step 2: Run the skill integration assertion to confirm it fails**

Run: `npm test -- test/integration/oh_my_pi_session.test.ts`
Expected: FAIL because the new skill file and workspace loader are not in place yet.

- [ ] **Step 3: Write the new investigation skill with the workflow and inline catalog**

```md
# DB Investigation

Use this skill when asked to identify and fix a database performance issue in the demo app.

Workflow:
1. Inspect the repo checkout and relevant application files.
2. Use Postgres tools to understand tables and schema.
3. Use ClickHouse tools to inspect performance evidence.
4. Form one concrete hypothesis about the highest-value issue.
5. Validate the hypothesis with bounded queries.
6. Make the smallest reasonable local code change.
7. Re-run evidence queries and summarize the before/after result.
8. Create a local commit only after the evidence still supports the fix.

ClickHouse catalog:
- `query_events`: raw cumulative statement snapshots keyed by statement identity.
- `query_intervals`: reset-aware interval deltas derived from successive snapshots.
- `collector_state`: global `pg_stat_statements_info` snapshots including `stats_reset`.
```

- [ ] **Step 4: Run the integration assertion to verify the skill content is now discoverable**

Run: `npm test -- test/integration/oh_my_pi_session.test.ts`
Expected: PASS for the skill-content assertion.

- [ ] **Step 5: Commit the investigation skill**

```bash
git add skills/investigation.md skills/db-investigation.md test/integration/oh_my_pi_session.test.ts
git commit -m "feat: add oh-my-pi db investigation skill"
```

### Task 6: Generate And Reset The External oh-my-pi Workspace

**Files:**
- Create: `scripts/setup-oh-my-pi-workspace.sh`
- Create: `scripts/reset-oh-my-pi-workspace.sh`
- Modify: `README.md`
- Create: `test/integration/oh_my_pi_session.test.ts`
- Test: `test/integration/oh_my_pi_session.test.ts`

- [ ] **Step 1: Write the failing workspace integration test**

```ts
// ABOUTME: Verifies the generated oh-my-pi workspace exists outside the main checkout.
// ABOUTME: Confirms tools and skills are exposed through symlinks in the runtime workspace.
import assert from "node:assert/strict";
import { lstat, readlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("workspace setup script creates symlinked skills and tools", async () => {
  const root = join(homedir(), ".oh-my-pi-workspaces/checkpoint");
  const skillsEntry = join(root, ".omp/skills");
  await assert.rejects(() => lstat(skillsEntry));
});
```

- [ ] **Step 2: Run the workspace integration test to confirm it fails**

Run: `npm test -- test/integration/oh_my_pi_session.test.ts`
Expected: FAIL because the workspace script has not created the symlinks yet.

- [ ] **Step 3: Implement the setup and reset scripts**

```bash
#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_ROOT="${HOME}/.oh-my-pi-workspaces/checkpoint"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${WORKSPACE_ROOT}/.omp"
ln -sfn "${REPO_ROOT}/skills" "${WORKSPACE_ROOT}/.omp/skills"
ln -sfn "${REPO_ROOT}/src/tools" "${WORKSPACE_ROOT}/.omp/tools"
mkdir -p "${WORKSPACE_ROOT}/workdir"
```

```bash
#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_ROOT="${HOME}/.oh-my-pi-workspaces/checkpoint"
rm -rf "${WORKSPACE_ROOT}"
"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/setup-oh-my-pi-workspace.sh"
```

- [ ] **Step 4: Update the integration test to assert the workspace now exists and uses symlinks**

```ts
const stats = await lstat(skillsEntry);
assert.equal(stats.isSymbolicLink(), true);
assert.equal(await readlink(skillsEntry), `${process.cwd()}/skills`);
```

- [ ] **Step 5: Run the workspace setup script and the integration test**

Run: `bash scripts/setup-oh-my-pi-workspace.sh && npm test -- test/integration/oh_my_pi_session.test.ts`
Expected: PASS with the workspace test green.

- [ ] **Step 6: Commit the workspace generation flow**

```bash
git add scripts/setup-oh-my-pi-workspace.sh scripts/reset-oh-my-pi-workspace.sh README.md test/integration/oh_my_pi_session.test.ts
git commit -m "feat: generate external oh-my-pi workspace"
```

### Task 7: Wire A Live oh-my-pi Session Harness And Model-Based Integration Test

**Files:**
- Modify: `package.json`
- Create: `scripts/run-model-integration.sh`
- Modify: `test/integration/oh_my_pi_session.test.ts`
- Modify: `README.md`
- Test: `test/integration/oh_my_pi_session.test.ts`

- [ ] **Step 1: Write the failing live-session integration test around a generated workspace**

```ts
// ABOUTME: Verifies a real oh-my-pi session can load the generated workspace tools.
// ABOUTME: Supports the live-model verification loop required before PR or mainline merge.
import assert from "node:assert/strict";
import test from "node:test";

test("live oh-my-pi session exposes coarse SQL tools", async (t) => {
  if (!process.env.OMP_MODEL) {
    t.skip("OMP_MODEL is not set");
  }

  const output = await runWorkspacePrompt("List the database investigation tools.");
  assert.match(output, /sql_db_list_tables/);
  assert.match(output, /clickhouse_db_query/);
});
```

- [ ] **Step 2: Run the integration test to confirm it fails before the harness exists**

Run: `npm test -- test/integration/oh_my_pi_session.test.ts`
Expected: FAIL with `runWorkspacePrompt` not defined, or SKIP when `OMP_MODEL` is absent.

- [ ] **Step 3: Implement the minimal live-session harness and script wrapper**

```bash
#!/usr/bin/env bash
set -euo pipefail

bash scripts/setup-oh-my-pi-workspace.sh
node --import tsx --test test/integration/oh_my_pi_session.test.ts
```

```json
{
  "scripts": {
    "test:model-integration": "bash scripts/run-model-integration.sh"
  }
}
```

- [ ] **Step 4: Run the live integration test in both modes**

Run: `npm test -- test/integration/oh_my_pi_session.test.ts`
Expected: SKIP with a clear message when `OMP_MODEL` is unset, PASS when the live model env is present and the workspace is configured.

- [ ] **Step 5: Commit the live-model integration harness**

```bash
git add package.json scripts/run-model-integration.sh test/integration/oh_my_pi_session.test.ts README.md
git commit -m "test: add oh-my-pi live model integration harness"
```

### Task 8: Add Manual Workspace Smoke Verification

**Files:**
- Create: `scripts/workspace-smoke.sh`
- Modify: `README.md`
- Test: manual script invocation

- [ ] **Step 1: Write the manual smoke script with explicit scenario prompts**

```bash
#!/usr/bin/env bash
set -euo pipefail

bash scripts/setup-oh-my-pi-workspace.sh

cat <<'PROMPT'
Investigate the demo repo for the highest-value database performance issue.
Use Postgres and ClickHouse evidence, make the smallest reasonable local fix,
and leave a local git diff or commit in the demo checkout.
PROMPT
```

- [ ] **Step 2: Add README instructions for the manual TUI loop and smoke script**

```md
## Manual TUI Loop

1. Run `bash scripts/setup-oh-my-pi-workspace.sh`
2. Start the oh-my-pi TUI in `~/.oh-my-pi-workspaces/checkpoint`
3. Use the DB investigation skill and the smoke prompt from `scripts/workspace-smoke.sh`
4. Inspect the resulting diff or local commit in the demo checkout
```

- [ ] **Step 3: Run the smoke script manually to verify the prompt and workspace path are usable**

Run: `bash scripts/workspace-smoke.sh`
Expected: prints the smoke prompt and exits successfully after ensuring the workspace exists.

- [ ] **Step 4: Commit the manual verification loop**

```bash
git add scripts/workspace-smoke.sh README.md
git commit -m "docs: add workspace smoke verification loop"
```

### Task 9: Add The Root AGENTS Policy And Final Verification

**Files:**
- Create: `AGENTS.md`
- Modify: `README.md`
- Modify: `JOURNAL.md`
- Test: `npm test`, `npm run typecheck`, `npm run test:model-integration`

- [ ] **Step 1: Create the root AGENTS instructions with Brett's live-model test gate**

```md
# AGENTS

- Before opening a pull request or merging to `main`, you MUST run the model-based oh-my-pi integration tests for this project when the required oh-my-pi model environment is available.
- If the live model environment is unavailable, you MUST stop and report that the PR or merge gate is blocked rather than silently skipping the check.
- The live-model test gate does not apply to intermediate local commits on working branches.
```

- [ ] **Step 2: Update the README verification section to match the AGENTS policy**

```md
## Merge Gate

Before opening a PR or merging to `main`, run the live model-based integration path:

```bash
npm run test:model-integration
```

If the required oh-my-pi model environment is unavailable, treat the change as blocked for PR or merge until that verification can run.
```

- [ ] **Step 3: Record the final restructuring state in the journal**

```md
- 2026-04-12: Completed the oh-my-pi MVP cutover plan implementation. The repo now uses a generated external oh-my-pi workspace, coarse Postgres and ClickHouse SQL tools, a skill-based investigation loop, a live-model integration harness for pre-PR and pre-main verification, and a manual workspace smoke loop against the external demo clone.
```

- [ ] **Step 4: Run the full root verification suite**

Run: `npm test && npm run typecheck`
Expected: PASS with all root tests and type checks green.

- [ ] **Step 5: Run the live-model integration command in the appropriate mode**

Run: `npm run test:model-integration`
Expected: PASS when the `oh-my-pi` model environment is configured, or an explicit blocked/skip result when the environment is absent.

- [ ] **Step 6: Commit the final policy and verification updates**

```bash
git add AGENTS.md README.md JOURNAL.md
git commit -m "docs: require live oh-my-pi verification before merge"
```

## Self-Review

- Spec coverage:
  The plan covers the pre-cut tag, hard removal of A2A and `pi-mono`, the checker-first `oh-my-pi` subagent spike, the eight coarse SQL tools, the inline ClickHouse catalog in the investigation skill, the generated workspace at `~/.oh-my-pi-workspaces/checkpoint`, the persistent workspace with reset flow, the live-model integration harness, the manual workspace smoke path, the TODO pruning, and the new AGENTS verification gate.
- Placeholder scan:
  No `TODO`, `TBD`, or “implement later” placeholders remain in task steps. Each code step includes concrete file paths, commands, or example content.
- Type consistency:
  Checker tools consistently use the `runCheck(prompt)` adapter and return `CheckerResult`. Query tools consistently use `rowCap` and `timeoutMs`, matching the spec’s row-cap and timeout requirements.
