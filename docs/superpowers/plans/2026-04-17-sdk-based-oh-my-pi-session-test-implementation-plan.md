# SDK-Based oh-my-pi Session Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current CLI-based `oh-my-pi` session integration test with an SDK-driven live-model test that injects the coarse SQL tools directly while keeping the generated workspace as the source of skills and context.

**Architecture:** Keep the generated workspace contract, but stop spawning `omp` for the main integration assertion. Instead, create an in-process `@oh-my-pi/pi-coding-agent` session with `cwd` set to the generated workspace, inject the eight SQL tools explicitly using their real implementations and real runners, and run the live-model assertion only when `OMP_MODEL` is present.

**Tech Stack:** TypeScript, Node test runner via `tsx`, `@oh-my-pi/pi-coding-agent` SDK, `pg`, existing SQL tool modules, generated workspace scripts.

---

## File Structure

- `test/integration/oh_my_pi_session.test.ts`
  Keeps the workspace skeleton test, but rewrites the live session test to use the SDK instead of the `omp` CLI.
- `test/helpers/oh_my_pi_workspace.ts`
  Stops shelling out to `omp`; adds a small SDK-backed helper for creating a session against the generated workspace and collecting text output.
- `package.json`
  Adds the `@oh-my-pi/pi-coding-agent` dependency if it is not already available locally.
- `JOURNAL.md`
  Records the integration-gap root cause and the SDK-based correction after the task is verified.

## Task 1: Add a Failing SDK Integration Test

**Files:**
- Modify: `test/integration/oh_my_pi_session.test.ts`
- Modify: `test/helpers/oh_my_pi_workspace.ts`

- [ ] **Step 1: Rewrite the live-session test to call a new SDK helper**

Replace the current CLI prompt helper usage with a new helper call:

```ts
const output = await runWorkspaceSession({
  home: fakeHome,
  model: process.env.OMP_MODEL,
  prompt: "List the available database investigation tools by name only, one per line.",
});
```

Keep the existing expectations:

```ts
assert.match(output, /sql_db_list_tables/);
assert.match(output, /clickhouse_db_query/);
```

- [ ] **Step 2: Run the focused test to confirm failure**

Run:

```bash
npm test -- test/integration/oh_my_pi_session.test.ts
```

Expected: FAIL because `runWorkspaceSession()` does not exist yet and/or the helper still shells out to `omp`.

- [ ] **Step 3: Commit the red test state if the repo already tracks that workflow**

If you create any tracked helper/test scaffolding before the implementation, commit it only if it leaves the branch in a sensible failing state. Otherwise continue directly to Task 2.

## Task 2: Build the SDK Session Helper With Explicit Tool Injection

**Files:**
- Modify: `test/helpers/oh_my_pi_workspace.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the SDK dependency if missing**

Ensure `package.json` contains:

```json
{
  "dependencies": {
    "@oh-my-pi/pi-coding-agent": "<current compatible version>",
    "pg": "^8.20.0"
  }
}
```

Then install dependencies using the repo’s current package manager workflow.

- [ ] **Step 2: Implement a small SDK helper instead of shelling out to `omp`**

Add a helper with a shape like:

```ts
export async function runWorkspaceSession(input: {
  home: string;
  model: string;
  prompt: string;
}): Promise<string> {
  const workspaceRoot = getWorkspaceRoot(input.home);
  const { session } = await createAgentSession({
    cwd: workspaceRoot,
    modelPattern: input.model,
    sessionManager: SessionManager.inMemory(),
    customTools: createSqlToolDefinitions(),
  });

  let output = "";
  const unsubscribe = session.subscribe(event => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      output += event.assistantMessageEvent.delta;
    }
  });

  try {
    await session.prompt(input.prompt);
    return output;
  } finally {
    unsubscribe();
    await session.dispose();
  }
}
```

- [ ] **Step 3: Build explicit tool definitions for the eight coarse SQL tools with real runners**

Create the smallest helper possible inside `test/helpers/oh_my_pi_workspace.ts` (or a tiny adjacent helper if the file gets too large) that instantiates:

- Postgres:
  - `createPostgresListTablesTool(...)`
  - `createPostgresSchemaTool(...)`
  - `createPostgresCheckerTool(...)`
  - `createPostgresQueryTool(...)`
- ClickHouse:
  - `createClickHouseListTablesTool(...)`
  - `createClickHouseSchemaTool(...)`
  - `createClickHouseCheckerTool(...)`
  - `createClickHouseQueryTool(...)`

Wire the real tool implementations to real runners:

```ts
const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT ?? "5432"),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});
```

```ts
const postgresRunner = async (sql: string) => {
  const result = await pool.query(sql);
  return Array.isArray(result) ? (result.at(-1)?.rows ?? []) : result.rows;
};
```

```ts
const clickhouseRunner = async (sql: string) => {
  const response = await fetch(`${process.env.CLICKHOUSE_URL}/?query=${encodeURIComponent(sql)}`);
  if (!response.ok) {
    throw new Error(`ClickHouse query failed: ${response.status} ${response.statusText}`);
  }
  return parseClickHouseJson(await response.text());
};
```

For the checker tools, use the real in-process `oh-my-pi` session path available to the SDK helper rather than mocked checker responses.

Then adapt each concrete tool into the SDK’s custom tool registration surface under the required names:

- `sql_db_list_tables`
- `sql_db_schema`
- `sql_db_checker`
- `sql_db_query`
- `clickhouse_db_list_tables`
- `clickhouse_db_schema`
- `clickhouse_db_checker`
- `clickhouse_db_query`

The helper should not rely on `cwd` alone to discover these tools. `cwd` is for
skills and context; the SQL tools still need explicit registration in
`customTools`.

- [ ] **Step 4: Run the focused test again**

Run:

```bash
npm test -- test/integration/oh_my_pi_session.test.ts
```

Expected: PASS when `OMP_MODEL` is unset via the existing honest skip path; otherwise the test should reach the SDK session path instead of failing on missing CLI-discovered tools.

- [ ] **Step 5: Commit the helper rewrite**

Run:

```bash
git add package.json test/helpers/oh_my_pi_workspace.ts test/integration/oh_my_pi_session.test.ts
git commit -m "test: use sdk for oh-my-pi session integration"
```

## Task 3: Verify the Live-Model Path and Clean Up Any Stale CLI Assumptions

**Files:**
- Modify: `README.md`
- Modify: `JOURNAL.md`

- [ ] **Step 1: Check whether README still overstates the CLI contract for the integration test**

If `README.md` or nearby docs say that `npm run test:model-integration` shells out to `omp`, update that wording narrowly so it says the test uses an `oh-my-pi` session against the generated workspace and remains live-model-based only when `OMP_MODEL` is set.

- [ ] **Step 2: Run the real integration command with a live model**

Run:

```bash
OMP_MODEL=google/gemini-3-flash-preview npm run test:model-integration
```

Expected: PASS, with the live session output containing at least `sql_db_list_tables` and `clickhouse_db_query`.

- [ ] **Step 3: Run the root verification checks**

Run:

```bash
npm test -- test/integration/oh_my_pi_session.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Record the root cause and fix in `JOURNAL.md`**

Add a note covering:

- the old integration test failed because the generated workspace did not provide a custom-tool extension path to the `omp` CLI
- the repo does not currently need an extension module because the integration goal is tool/session wiring, not CLI extension discovery
- the SDK-based session path now injects the eight SQL tools directly while still using the generated workspace for skills/context

- [ ] **Step 5: Commit the final verification/docs cleanup**

Run:

```bash
git add README.md JOURNAL.md
git commit -m "docs: record sdk-based oh-my-pi integration path"
```

## Self-Review

- Spec coverage: the plan keeps the generated workspace, switches the integration path to the SDK, preserves the live-model-only-when-configured behavior, and avoids introducing an unnecessary extension layer.
- Placeholder scan: every task names concrete files, commands, and expected outcomes.
- Type consistency: the plan consistently uses `runWorkspaceSession()` as the new helper entry point and the eight LangChain-style SQL tool names from the spec.
