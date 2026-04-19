# DB Specialist Extension Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the DB specialist manual TUI runtime from discovered `.omp/tools` shims to an `oh-my-pi` extension-owned runtime without changing the underlying SQL domain behavior.

**Architecture:** Keep `src/tools/*` as the domain layer and move the host/runtime integration into a thin extension layer under `src/omp_extension/`. The generated workspace should expose a project-local `.omp/extensions` entrypoint instead of `.omp/tools/<name>/index.ts` shims for the eight SQL tools, and the SDK helper should validate the same extension-owned runtime path rather than a separate custom-tool-only path.

**Tech Stack:** TypeScript, Bun, `@oh-my-pi/pi-coding-agent`, `@sinclair/typebox`, Postgres (`pg`), ClickHouse HTTP runner, Vitest, shell workspace scripts.

---

## File Map

- **Create:** `src/omp_extension/db_specialist_extension.ts`  
  Registers the eight DB specialist tools through the `oh-my-pi` extension API and owns the host-aware runtime wiring for checker execution.

- **Create:** `src/omp_extension/tool_runtime.ts`  
  Shared extension-side runtime helpers for Postgres/ClickHouse runners, result adaptation, and extension-local tool registration helpers.

- **Create:** `test/integration/omp_extension_runtime.test.ts`  
  Focused integration coverage for the extension-owned runtime shape and the absence of `.omp/tools/<name>/index.ts` generation for the DB specialist surface.

- **Modify:** `scripts/setup-oh-my-pi-workspace.sh`  
  Stop generating DB specialist `.omp/tools/<name>/index.ts` shims; generate or symlink a `.omp/extensions` entrypoint for the DB specialist extension and keep `.omp/skills`.

- **Modify:** `scripts/reset-oh-my-pi-workspace.sh`  
  Reset the extension-based workspace shape consistently with the setup script.

- **Modify:** `test/helpers/oh_my_pi_workspace.ts`  
  Stop constructing the DB specialist runtime as standalone custom tool definitions. Load the extension-owned runtime for SDK integration instead, while keeping the generated workspace as `cwd`.

- **Modify:** `test/helpers/oh_my_pi_workspace_utils.test.ts`  
  Rewrite workspace-shape assertions to expect `.omp/extensions` for the DB specialist runtime instead of discoverable `.omp/tools/<name>/index.ts` tool shims.

- **Modify:** `test/integration/oh_my_pi_session.test.ts`  
  Update live integration expectations so they validate the extension-owned runtime path rather than the old discovered-custom-tool path.

- **Modify:** `src/omp_tools/live_query_checker.ts`  
  Remove the assumption that the manual TUI path can import repo-local `@oh-my-pi/pi-ai` inside the running `omp` process. Extract shared prompt/result parsing from runtime-specific model invocation.

- **Modify:** `src/omp_tools/postgres_custom_tools.ts`
- **Modify:** `src/omp_tools/clickhouse_custom_tools.ts`  
  Either retire these as the manual TUI runtime path or reduce them to SDK-only helpers so they stop pretending to be the host-facing runtime layer.

- **Modify:** `README.md`
- **Modify:** `scripts/workspace-smoke.sh`  
  Document the extension-based workspace shape and manual loop accurately.

- **Modify:** `JOURNAL.md`  
  Record the runtime-boundary insight and the extension cutover decision.

## Task 1: Replace the Workspace Shape Contract

**Files:**
- Modify: `test/helpers/oh_my_pi_workspace_utils.test.ts`
- Modify: `scripts/setup-oh-my-pi-workspace.sh`
- Modify: `scripts/reset-oh-my-pi-workspace.sh`
- Test: `test/helpers/oh_my_pi_workspace_utils.test.ts`

- [ ] **Step 1: Write the failing workspace-shape test**

```ts
it("creates an extension-based DB specialist workspace instead of tool shims", async () => {
  const home = await createTempHome();

  await setupWorkspace(home);

  const workspaceRoot = getWorkspaceRoot(home);
  expect(existsSync(join(workspaceRoot, ".omp", "extensions"))).toBe(true);
  expect(existsSync(join(workspaceRoot, ".omp", "extensions", "db-specialist.ts"))).toBe(true);

  expect(existsSync(join(workspaceRoot, ".omp", "tools", "sql_db_checker", "index.ts"))).toBe(false);
  expect(existsSync(join(workspaceRoot, ".omp", "tools", "clickhouse_db_query", "index.ts"))).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/helpers/oh_my_pi_workspace_utils.test.ts`

Expected: FAIL because `scripts/setup-oh-my-pi-workspace.sh` still creates `.omp/tools/<name>/index.ts` DB specialist shims and no `.omp/extensions/db-specialist.ts`.

- [ ] **Step 3: Write the minimal workspace script change**

```bash
mkdir -p "${WORKSPACE_ROOT}/.omp/extensions"
rm -rf "${WORKSPACE_ROOT}/.omp/tools"

cat > "${WORKSPACE_ROOT}/.omp/extensions/db-specialist.ts" <<EOF
export { default } from "${REPO_ROOT}/src/omp_extension/db_specialist_extension.ts";
EOF
```

Also update `reset-oh-my-pi-workspace.sh` so it removes `.omp/extensions/db-specialist.ts` and recreates the generated extension-based layout rather than preserving stale tool shims.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- test/helpers/oh_my_pi_workspace_utils.test.ts`

Expected: PASS with the workspace asserting `.omp/extensions/db-specialist.ts` exists and the old DB specialist `.omp/tools/<name>/index.ts` files do not.

- [ ] **Step 5: Commit**

```bash
git add test/helpers/oh_my_pi_workspace_utils.test.ts scripts/setup-oh-my-pi-workspace.sh scripts/reset-oh-my-pi-workspace.sh
git commit -m "test: expect extension-based db specialist workspace"
```

## Task 2: Introduce the Extension-Owned DB Specialist Runtime

**Files:**
- Create: `src/omp_extension/db_specialist_extension.ts`
- Create: `src/omp_extension/tool_runtime.ts`
- Modify: `src/omp_tools/live_query_checker.ts`
- Modify: `src/tools/shared/query_checker.ts`
- Test: `test/tools/live_query_checker.test.ts`

- [ ] **Step 1: Write the failing runtime test**

```ts
it("builds checker prompts and parses checker JSON without importing repo-local pi-ai in the extension adapter", async () => {
  const result = parseQueryCheckResult('{"verdict":"safe","rewrittenQuery":"select 1","notes":["ok"]}');

  expect(result).toEqual({
    verdict: "safe",
    rewrittenQuery: "select 1",
    notes: ["ok"],
  });
});
```

Add a second focused assertion around any newly extracted runtime helper that accepts an injected completion function instead of hard-coding `import("@oh-my-pi/pi-ai")`.

- [ ] **Step 2: Run the focused test to verify the current shape fails**

Run: `npm test -- test/tools/live_query_checker.test.ts`

Expected: FAIL because the current implementation still couples prompt building, parsing, and runtime module import inside `createLiveQueryChecker()`.

- [ ] **Step 3: Write the minimal runtime split**

```ts
export type QueryCompletion = (input: {
  model: ToolModel;
  apiKey: string;
  sessionId: string;
  prompt: string;
}) => Promise<string>;

export function createLiveQueryChecker(runCompletion: QueryCompletion, ctx: LiveCheckerContext) {
  return {
    async runCheck(input: QueryCheckInput) {
      const output = await runCompletion({
        model: ctx.model!,
        apiKey: apiKey,
        sessionId: ctx.sessionManager.getSessionId(),
        prompt: buildCheckerPrompt(input),
      });
      return parseQueryCheckResult(output);
    },
  };
}
```

Then create `src/omp_extension/db_specialist_extension.ts` so the extension runtime owns the host-specific completion implementation and registers the eight tool names through the extension API rather than discovered custom-tool shims.

- [ ] **Step 4: Run the focused runtime tests to verify they pass**

Run: `npm test -- test/tools/live_query_checker.test.ts`

Expected: PASS with prompt/result parsing covered and the runtime import assumption removed from the shared checker helper.

- [ ] **Step 5: Commit**

```bash
git add src/omp_extension/db_specialist_extension.ts src/omp_extension/tool_runtime.ts src/omp_tools/live_query_checker.ts src/tools/shared/query_checker.ts test/tools/live_query_checker.test.ts
git commit -m "feat: add db specialist extension runtime"
```

## Task 3: Rewire SDK Integration to the Same Runtime Boundary

**Files:**
- Modify: `test/helpers/oh_my_pi_workspace.ts`
- Modify: `test/integration/oh_my_pi_session.test.ts`
- Create: `test/integration/omp_extension_runtime.test.ts`
- Test: `test/integration/oh_my_pi_session.test.ts`
- Test: `test/integration/omp_extension_runtime.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
it("loads the DB specialist runtime from the generated extension-based workspace", async () => {
  const home = await createTempHome();
  await setupWorkspace(home);

  const text = await runWorkspaceSession({
    home,
    model: process.env.OMP_MODEL!,
    prompt: "List the available database investigation tools by name only.",
  });

  expect(text).toMatch(/sql_db_list_tables/);
  expect(text).toMatch(/clickhouse_db_query/);
});
```

If the helper needs a lower-level assertion first, add a test that inspects the generated workspace and proves the helper loads the extension-owned runtime rather than assembling standalone custom tool definitions directly.

- [ ] **Step 2: Run the integration slice to verify it fails**

Run: `npm test -- test/integration/oh_my_pi_session.test.ts test/integration/omp_extension_runtime.test.ts`

Expected: FAIL because `test/helpers/oh_my_pi_workspace.ts` still builds SQL tool definitions directly from `src/omp_tools/*_custom_tools.ts` and does not validate the extension-owned runtime path.

- [ ] **Step 3: Write the minimal helper change**

```ts
const extensionModule = await import(join(workspaceRoot, ".omp", "extensions", "db-specialist.ts"));
await registerDbSpecialistExtension(extensionModule.default, session);
```

The helper should stop treating the DB specialist runtime as a detached `customTools` array. It should instead load the extension-owned runtime path or the same repo-owned adapter layer that the generated extension uses, with the generated workspace still set as `cwd`.

- [ ] **Step 4: Run the integration slice to verify it passes**

Run: `npm test -- test/integration/oh_my_pi_session.test.ts test/integration/omp_extension_runtime.test.ts`

Expected: PASS, with the live-model assertions still skipping honestly when `OMP_MODEL` is unset and the extension-owned runtime path covered when it is set.

- [ ] **Step 5: Commit**

```bash
git add test/helpers/oh_my_pi_workspace.ts test/integration/oh_my_pi_session.test.ts test/integration/omp_extension_runtime.test.ts
git commit -m "test: use extension runtime for oh my pi sessions"
```

## Task 4: Remove the Old DB Specialist Tool-Shim Assumptions and Update Docs

**Files:**
- Modify: `README.md`
- Modify: `scripts/workspace-smoke.sh`
- Modify: `src/omp_tools/postgres_custom_tools.ts`
- Modify: `src/omp_tools/clickhouse_custom_tools.ts`
- Modify: `JOURNAL.md`
- Test: `npm test`
- Test: `npm run typecheck`
- Test: `npm run test:model-integration`

- [ ] **Step 1: Write the failing documentation/runtime assertion**

```ts
it("documents the manual loop as extension-based rather than tool-shim-based", async () => {
  const readme = await fs.promises.readFile("README.md", "utf8");

  expect(readme).toContain(".omp/extensions");
  expect(readme).not.toContain(".omp/tools/<name>/index.ts shims");
});
```

If there is no existing docs test harness, use this step to update an existing focused integration or smoke assertion that reads the generated workspace shape instead of adding a throwaway docs-only test.

- [ ] **Step 2: Run the relevant test slice to verify it fails**

Run: `npm test -- test/helpers/oh_my_pi_workspace_utils.test.ts test/integration/omp_extension_runtime.test.ts`

Expected: FAIL until the docs, smoke script, and any remaining old runtime assumptions are aligned.

- [ ] **Step 3: Write the minimal cleanup**

```md
The generated oh-my-pi workspace now exposes the DB specialist runtime through
`.omp/extensions/db-specialist.ts` and keeps `.omp/skills` linked to this repo.
```

Also trim or repurpose `src/omp_tools/postgres_custom_tools.ts` and `src/omp_tools/clickhouse_custom_tools.ts` so they are no longer presented as the manual TUI runtime path if they remain for SDK-only support.

- [ ] **Step 4: Run the full verification sequence**

Run: `npm test`
Expected: PASS with existing live-model tests still skipping honestly when `OMP_MODEL` is unset

Run: `npm run typecheck`
Expected: PASS

Run: `npm run test:model-integration`
Expected: PASS when `OMP_MODEL` is set, otherwise explicit skip/block status

- [ ] **Step 5: Commit**

```bash
git add README.md scripts/workspace-smoke.sh src/omp_tools/postgres_custom_tools.ts src/omp_tools/clickhouse_custom_tools.ts JOURNAL.md
git commit -m "docs: switch db specialist runtime to extension path"
```

## Self-Review

- **Spec coverage:**  
  - Extension-owned runtime replaces discovered custom-tool DB specialist path: Tasks 1-2  
  - Generated workspace uses `.omp/extensions`: Tasks 1 and 4  
  - Checker no longer depends on repo-local `pi-ai` in the running `omp` process: Task 2  
  - SDK/live integration validates the extension-owned runtime: Task 3  
  - Old `.omp/tools` DB specialist assertions removed or rewritten: Tasks 1, 3, and 4

- **Placeholder scan:**  
  No `TBD`, `TODO`, or “handle appropriately” placeholders remain. Each task names exact files, commands, expected outcomes, and commit boundaries.

- **Type consistency:**  
  The plan keeps one naming scheme throughout: `db_specialist_extension.ts`, `tool_runtime.ts`, `createLiveQueryChecker`, and the existing LangChain-style SQL tool names.

Plan complete and saved to `docs/superpowers/plans/2026-04-18-db-specialist-extension-runtime-plan.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
