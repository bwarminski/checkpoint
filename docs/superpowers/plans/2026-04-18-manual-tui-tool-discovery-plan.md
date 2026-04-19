# Manual TUI Tool Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a fresh generated workspace expose the eight coarse SQL tools through native `omp` `.omp/tools` discovery so the README manual TUI loop is true.

**Architecture:** Replace the raw `.omp/tools -> src/tools` symlink with generated `.omp/tools/<tool>/index.ts` shims that import repo-owned `CustomToolFactory` adapters. Move runtime glue for Postgres, ClickHouse, and the live checker into a shared repo-owned adapter layer so the generated TUI tools and the existing Bun SDK helper use the same logic.

**Tech Stack:** TypeScript, Bun, `@oh-my-pi/pi-coding-agent`, `@oh-my-pi/pi-ai`, `pg`, shell workspace scripts, Node test runner

---

## File Structure

- Modify: `test/integration/oh_my_pi_session.test.ts`
  Verifies the generated workspace shape and the live SDK session path. Update it to expect discoverable `.omp/tools/<name>/index.ts` directories instead of a raw symlink.
- Modify: `test/helpers/oh_my_pi_workspace.ts`
  Current Bun SDK helper. Refactor it to reuse shared runtime adapters instead of owning its own SQL runtime glue.
- Create: `src/omp_tools/runtime.ts`
  Shared runtime helpers for Postgres pool creation, ClickHouse HTTP querying, and generated workspace shim contents.
- Create: `src/omp_tools/live_query_checker.ts`
  Shared live checker adapter built on the active `oh-my-pi` runtime context and `@oh-my-pi/pi-ai.completeSimple()`.
- Create: `src/omp_tools/postgres_custom_tools.ts`
  Native `CustomToolFactory` builders for `sql_db_list_tables`, `sql_db_schema`, `sql_db_checker`, and `sql_db_query`.
- Create: `src/omp_tools/clickhouse_custom_tools.ts`
  Native `CustomToolFactory` builders for `clickhouse_db_list_tables`, `clickhouse_db_schema`, `clickhouse_db_checker`, and `clickhouse_db_query`.
- Modify: `scripts/setup-oh-my-pi-workspace.sh`
  Generate `.omp/tools/<tool>/index.ts` shims and keep `.omp/skills` as a symlink.
- Modify: `scripts/reset-oh-my-pi-workspace.sh`
  Continue delegating to setup after full workspace removal.
- Modify: `scripts/workspace-smoke.sh`
  Align the printed manual TUI command with the actual CLI name and the generated tool layout.
- Modify: `README.md`
  Update the manual TUI loop so it matches the working runtime contract.
- Modify: `JOURNAL.md`
  Record the discovery root cause and the final fix.

## Task 1: Make the workspace-shape failure explicit

**Files:**
- Modify: `test/integration/oh_my_pi_session.test.ts`
- Test: `test/integration/oh_my_pi_session.test.ts`

- [ ] **Step 1: Write the failing workspace-shape assertions**

Replace the current tool symlink assertions with assertions that the generated workspace contains a real tools directory and discoverable tool entrypoints:

```ts
const toolsRoot = join(workspaceRoot, ".omp", "tools");
const postgresListEntry = join(toolsRoot, "sql_db_list_tables", "index.ts");
const clickHouseQueryEntry = join(toolsRoot, "clickhouse_db_query", "index.ts");

let toolsRootStats = await lstat(toolsRoot);
let postgresListStats = await lstat(postgresListEntry);
let clickHouseQueryStats = await lstat(clickHouseQueryEntry);

assert.equal(toolsRootStats.isDirectory(), true);
assert.equal(postgresListStats.isFile(), true);
assert.equal(clickHouseQueryStats.isFile(), true);
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
npm test -- test/integration/oh_my_pi_session.test.ts
```

Expected: FAIL because `.omp/tools` is still a symlink to `src/tools` and `sql_db_list_tables/index.ts` does not exist in the generated workspace.

- [ ] **Step 3: Commit the red test**

```bash
git add test/integration/oh_my_pi_session.test.ts
git commit -m "test: expect discoverable workspace tools"
```

## Task 2: Add shared native-tool runtime adapters

**Files:**
- Create: `src/omp_tools/runtime.ts`
- Create: `src/omp_tools/live_query_checker.ts`
- Create: `src/omp_tools/postgres_custom_tools.ts`
- Create: `src/omp_tools/clickhouse_custom_tools.ts`
- Modify: `test/helpers/oh_my_pi_workspace.ts`
- Test: `test/integration/oh_my_pi_session.test.ts`

- [ ] **Step 1: Add a focused live-checker adapter test before moving logic**

Add a narrow helper-level test file so the shared checker adapter is not only exercised indirectly:

```ts
// test/tools/live_query_checker.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseQueryCheckResult } from "../helpers/oh_my_pi_workspace.ts";

test("parseQueryCheckResult accepts fenced JSON returned by live checker calls", () => {
  const result = parseQueryCheckResult('```json\n{"verdict":"safe","rewrittenQuery":"select 1","notes":["ok"]}\n```');
  assert.equal(result.verdict, "safe");
});
```

- [ ] **Step 2: Run the focused helper test**

Run:

```bash
npm test -- test/tools/live_query_checker.test.ts
```

Expected: PASS. This protects the existing JSON contract before the runtime move.

- [ ] **Step 3: Create the shared live checker adapter**

Add `src/omp_tools/live_query_checker.ts` with the current live checker logic extracted out of the test helper:

```ts
// ABOUTME: Builds a live model-backed SQL checker from the current oh-my-pi tool context.
// ABOUTME: Shares one checker runtime between native custom tools and SDK-backed tests.
import type { QueryCheckInput, QueryCheckResult } from "../tools/shared/query_checker.ts";

export type LiveCheckerContext = {
  model: { provider: string } | undefined;
  modelRegistry: {
    getApiKey(model: { provider: string }, sessionId?: string): Promise<string | undefined>;
  };
  sessionManager: {
    getSessionId(): string;
  };
};

export function createLiveQueryChecker(ctx: LiveCheckerContext): {
  runCheck(input: QueryCheckInput): Promise<QueryCheckResult>;
} {
  // move the existing completeSimple() path here unchanged
}
```

- [ ] **Step 4: Create shared Postgres and ClickHouse runtime helpers**

Add `src/omp_tools/runtime.ts`:

```ts
// ABOUTME: Creates database runners and generated tool shim contents for oh-my-pi workspaces.
// ABOUTME: Keeps runtime wiring out of the domain tool modules.
import { Pool } from "pg";

export function createPostgresRunner(): (sql: string) => Promise<Array<Record<string, unknown>>> {
  // move the existing helper implementation here
}

export function createClickHouseRunner(): (sql: string) => Promise<Array<Record<string, unknown>>> {
  // move the existing helper implementation here
}

export function renderToolShim(importPath: string): string {
  return `export { default } from ${JSON.stringify(importPath)};\n`;
}
```

- [ ] **Step 5: Create repo-owned native custom-tool factories**

Add `src/omp_tools/postgres_custom_tools.ts` and `src/omp_tools/clickhouse_custom_tools.ts` with factories shaped like:

```ts
// ABOUTME: Exposes native oh-my-pi custom tools for coarse Postgres investigation.
// ABOUTME: Adapts repo-owned domain tools to the custom-tool discovery contract.
import type { CustomToolFactory } from "@oh-my-pi/pi-coding-agent";
import { createPostgresListTablesTool } from "../tools/postgres/list_tables_tool.ts";

const sqlDbListTables: CustomToolFactory = pi => {
  const { Type } = pi.typebox;
  const runner = createPostgresRunner();
  const tool = createPostgresListTablesTool(async (sql) => runner(sql) as Promise<Array<{ table_name: string }>>);
  return {
    name: "sql_db_list_tables",
    label: "Postgres Tables",
    description: "List PostgreSQL tables from the requested schema.",
    parameters: Type.Object({ schema: Type.String() }),
    async execute(_toolCallId, params) {
      return { content: [{ type: "text", text: await tool.execute(params) }] };
    },
  };
};

export default sqlDbListTables;
```

For checker tools, use the shared live checker adapter:

```ts
const checker = createPostgresCheckerTool(createLiveQueryChecker(ctx));
return {
  content: [{ type: "text", text: JSON.stringify(await checker.execute(params), null, 2) }],
};
```

- [ ] **Step 6: Rewire the SDK helper to use the shared adapters**

Modify `test/helpers/oh_my_pi_workspace.ts` so it imports from `src/omp_tools/runtime.ts` and `src/omp_tools/live_query_checker.ts` instead of keeping its own copies of:

- `createPostgresRunner()`
- `createClickHouseRunner()`
- `createLiveQueryChecker()`

The helper should still build `ToolDefinition` objects for the SDK path, but the runtime logic must come from the shared adapter files.

- [ ] **Step 7: Run the focused integration and typecheck commands**

Run:

```bash
npm test -- test/integration/oh_my_pi_session.test.ts
npm run typecheck
```

Expected: still FAIL on workspace-shape assertions, but typecheck should pass once the shared adapter extraction is complete.

- [ ] **Step 8: Commit the shared adapter layer**

```bash
git add src/omp_tools test/helpers/oh_my_pi_workspace.ts test/tools/live_query_checker.test.ts
git commit -m "refactor: share native sql tool runtime"
```

## Task 3: Generate discoverable workspace tools

**Files:**
- Modify: `scripts/setup-oh-my-pi-workspace.sh`
- Modify: `scripts/reset-oh-my-pi-workspace.sh`
- Test: `test/integration/oh_my_pi_session.test.ts`

- [ ] **Step 1: Update the setup script to generate `.omp/tools`**

Replace the current `.omp/tools` symlink logic with generated directories:

```bash
mkdir -p "${WORKSPACE_ROOT}/.omp" "${WORKSPACE_ROOT}/workdir" "${WORKSPACE_ROOT}/.omp/tools"
rm -rf "${WORKSPACE_ROOT}/.omp/skills" "${WORKSPACE_ROOT}/.omp/tools"
ln -s "${REPO_ROOT}/skills" "${WORKSPACE_ROOT}/.omp/skills"
mkdir -p "${WORKSPACE_ROOT}/.omp/tools"
```

Add a shell helper that writes each shim:

```bash
write_tool() {
  local tool_name="$1"
  local import_path="$2"
  mkdir -p "${WORKSPACE_ROOT}/.omp/tools/${tool_name}"
  cat > "${WORKSPACE_ROOT}/.omp/tools/${tool_name}/index.ts" <<EOF
export { default } from ${import_path@Q};
EOF
}
```

Then write all eight tools:

```bash
write_tool "sql_db_list_tables" "${REPO_ROOT}/src/omp_tools/postgres_custom_tools.ts"
write_tool "sql_db_schema" "${REPO_ROOT}/src/omp_tools/postgres_custom_tools.ts"
write_tool "sql_db_checker" "${REPO_ROOT}/src/omp_tools/postgres_custom_tools.ts"
write_tool "sql_db_query" "${REPO_ROOT}/src/omp_tools/postgres_custom_tools.ts"
write_tool "clickhouse_db_list_tables" "${REPO_ROOT}/src/omp_tools/clickhouse_custom_tools.ts"
write_tool "clickhouse_db_schema" "${REPO_ROOT}/src/omp_tools/clickhouse_custom_tools.ts"
write_tool "clickhouse_db_checker" "${REPO_ROOT}/src/omp_tools/clickhouse_custom_tools.ts"
write_tool "clickhouse_db_query" "${REPO_ROOT}/src/omp_tools/clickhouse_custom_tools.ts"
```

If the adapters export named factories instead of one-per-file defaults, generate:

```ts
export { sqlDbListTables as default } from "/abs/path/to/postgres_custom_tools.ts";
```

- [ ] **Step 2: Keep reset behavior simple**

`scripts/reset-oh-my-pi-workspace.sh` should remain:

```bash
rm -rf "${WORKSPACE_ROOT}"
"${SCRIPT_DIR}/setup-oh-my-pi-workspace.sh"
```

No extra logic belongs there.

- [ ] **Step 3: Run the focused workspace test to verify it passes**

Run:

```bash
npm test -- test/integration/oh_my_pi_session.test.ts
```

Expected: PASS for the workspace skeleton assertions with `.omp/tools` now a directory and `index.ts` files present for the discoverable tools.

- [ ] **Step 4: Commit the workspace generation change**

```bash
git add scripts/setup-oh-my-pi-workspace.sh scripts/reset-oh-my-pi-workspace.sh test/integration/oh_my_pi_session.test.ts
git commit -m "feat: generate discoverable omp tools"
```

## Task 4: Align docs and manual smoke flow

**Files:**
- Modify: `README.md`
- Modify: `scripts/workspace-smoke.sh`
- Modify: `JOURNAL.md`
- Test: `test/integration/oh_my_pi_session.test.ts`

- [ ] **Step 1: Fix the documented CLI invocation**

Update `README.md` and `scripts/workspace-smoke.sh` to use the same command:

```md
3. Start the oh-my-pi TUI from `~/.oh-my-pi-workspaces/checkpoint` with
   `omp --model "$OMP_MODEL"`
```

And:

```bash
3. Start the oh-my-pi TUI:
   omp --model "$OMP_MODEL"
```

- [ ] **Step 2: Document the generated tool layout**

Add a short README note describing the workspace shape:

```md
The generated workspace keeps `.omp/skills` as a symlink into this repo and
materializes discoverable `.omp/tools/<name>/index.ts` modules that import the
repo-owned SQL tool adapters.
```

- [ ] **Step 3: Record the root cause and fix in the journal**

Add an entry like:

```md
- 2026-04-18: Fixed the manual TUI loop by replacing the raw `.omp/tools -> src/tools`
  symlink with generated discoverable `.omp/tools/<name>/index.ts` shims backed by
  repo-owned native custom-tool adapters. The root cause was that `omp` only discovers
  top-level tool files and subdirectories with `index.ts`, while `src/tools` is nested
  domain code and was never a valid native discovery layout.
```

- [ ] **Step 4: Run the full verification slice**

Run:

```bash
npm test -- test/integration/oh_my_pi_session.test.ts
npm run typecheck
npm run test:model-integration
```

Expected:

- `npm test -- test/integration/oh_my_pi_session.test.ts` passes
- `npm run typecheck` passes
- `npm run test:model-integration` passes when `OMP_MODEL` is set, otherwise the live cases skip honestly

- [ ] **Step 5: Manually verify the TUI tool list**

Run:

```bash
bash scripts/reset-oh-my-pi-workspace.sh
cd "${HOME}/.oh-my-pi-workspaces/checkpoint"
OMP_MODEL="${OMP_MODEL}" omp --model "${OMP_MODEL}" "List the available database investigation tools by name only, one per line." -p --no-session
```

Expected output contains:

```text
sql_db_list_tables
sql_db_schema
sql_db_checker
sql_db_query
clickhouse_db_list_tables
clickhouse_db_schema
clickhouse_db_checker
clickhouse_db_query
```

- [ ] **Step 6: Commit the docs and verification closeout**

```bash
git add README.md scripts/workspace-smoke.sh JOURNAL.md
git commit -m "docs: align manual tui sql tool flow"
```

## Self-Review

- Spec coverage:
  - workspace shape mismatch is covered in Task 1 and Task 3
  - repo-owned adapter boundary is covered in Task 2
  - README/manual smoke alignment is covered in Task 4
  - SDK path preservation is covered in Tasks 2 and 4 verification
- Placeholder scan:
  - no `TODO`, `TBD`, or “similar to previous task” shortcuts remain
- Type consistency:
  - shared runtime glue lives under `src/omp_tools/`
  - discoverable workspace entrypoints are `.omp/tools/<name>/index.ts`
  - live checker runtime remains `createLiveQueryChecker()`

Plan complete and saved to `docs/superpowers/plans/2026-04-18-manual-tui-tool-discovery-plan.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
