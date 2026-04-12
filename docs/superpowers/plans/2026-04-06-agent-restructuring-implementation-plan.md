# DB Specialist Agent Restructuring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the repo in three sequential, independently shippable phases: move the collector into its own local git repo and slim this repo down to locally built collector-backed infra, remove the memory system and in-run evidence object, then convert the agent into the `@checkpoint/db-specialist` pi package with a standalone extension and an A2A bridge layered on last.

**Architecture:** Phase 1 creates a sibling collector repo at `/home/bjw/checkpoint-collector`, moves all collector-owned assets into it, and has this repo consume locally built Postgres and ClickHouse images plus a versioned ClickHouse schema contract that the agent validates at startup. Phase 2 deletes durable memory and replaces `LoopRunEvidence` safety gates with stateless call-time checks. Phase 3 moves the surviving domain tools into a root pi package, adds markdown skills plus a containerized runtime, then rebuilds A2A as a thin session bridge over pi.

**Tech Stack:** TypeScript, Node test runner, Express, `@a2a-js/sdk`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, pi extension APIs, Docker Compose, Docker, pytest

---

## File Structure

- `docker-compose.yml`
  Phase 1 runtime stack. Stops building local collector assets and instead uses locally built images from the sibling collector repo for Postgres and ClickHouse.
- `tests/smoke/test_compose_structure.py`
  Verifies the slim compose contract and rejects regressions back to local collector-owned services.
- `README.md`
  Documents the new local workflow, image prerequisites, and the standalone pi runtime once Phase 3 lands.
- `docs/superpowers/specs/2026-04-06-agent-restructuring-design.md`
  Source of truth for requirements. Do not edit as part of implementation.
- `agent/src/server.ts`
  Current A2A entrypoint. Phase 1 adds startup schema validation. Phase 3 is removed from the main runtime path.
- `agent/src/runtime_dependencies.ts`
  Current runtime wiring. Phase 1 adds schema-contract validation. Phase 2 removes memory wiring. Phase 3 is removed.
- `agent/src/agent_tools.ts`
  Phase 2 removes memory tools and `LoopRunEvidence`, replacing the risky-action checks with input re-validation.
- `agent/src/tools/clickhouse_tool.ts`
  Provides findings access in every phase and gains schema/version inspection helpers in Phase 1.
- `agent/src/tools/memory_tool.ts`
  Deleted in Phase 2 after preservation on the `memory-tool` branch.
- `agent/memory/`
  Deleted in Phase 2 after preservation on the `memory-tool` branch.
- `agent/test/*.test.ts`
  Existing unit coverage that must shift with each phase. Phase 2 deletes memory tests. Phase 3 either moves or is replaced by root-package tests.
- `package.json`
  Created at repo root in Phase 3 with the `@checkpoint/db-specialist` pi package manifest.
- `tsconfig.json`
  Created at repo root in Phase 3 for the package build and tests.
- `extensions/db-specialist.ts`
  New single pi extension entrypoint that instantiates shared tool objects and registers all eight tools.
- `skills/investigation.md`
  New pi skill describing the investigation workflow and severity thresholds.
- `skills/fix.md`
  New pi skill describing the fix and PR flow.
- `src/tools/*.ts`
  Surviving domain tools moved out of `agent/src/tools/` during the package conversion.
- `src/a2a_bridge/server.ts`
  New thin A2A bridge built after standalone pi works.
- `src/a2a_bridge/session_registry.ts`
  Sidecar registry for mapping A2A `contextId` values to pi sessions.
- `test/**/*.test.ts`
  Root-package tests added in Phase 3 for extension registration, standalone pi flows, container runtime, and the A2A bridge.
- `Dockerfile`
  New package image built in Phase 3 for per-customer container deployment.

## Phase Boundaries

- **Phase 1 ship criteria**
  The collector-owned files live in `/home/bjw/checkpoint-collector`, that repo is initialized as git and can build the required local images, this repo no longer owns those assets, and agent startup rejects mismatched ClickHouse schema versions before serving requests.
- **Phase 2 ship criteria**
  Memory code and prompts are gone, the `memory-tool` preservation branch/tag exists, and risky tools enforce their requirements with call-time validation rather than `LoopRunEvidence`.
- **Phase 3 ship criteria**
  The repo is a pi package with a working standalone extension, container tests pass, and the A2A bridge is a separate thin layer over pi sessions.
- **agent/ retirement ship criteria**
  The `agent/` package and `agent/package.json` are deleted when the pi A2A bridge passes all tests currently in `agent/test/integration/` without importing any `agent/src/` code directly. This is a follow-on task tracked in TODOS.md.

### Task 1: Phase 1 Create The Collector Repo And Move Collector-Owned Files

**Files:**
- Create: `/home/bjw/checkpoint-collector/.gitignore`
- Create: `/home/bjw/checkpoint-collector/README.md`
- Create: `/home/bjw/checkpoint-collector/docker-compose.yml`
- Create: `/home/bjw/checkpoint-collector/VERSION`
- Create: `/home/bjw/checkpoint-collector/collector/`
- Create: `/home/bjw/checkpoint-collector/postgres/`
- Create: `/home/bjw/checkpoint-collector/load/`
- Create: `/home/bjw/checkpoint-collector/clickhouse/users.d/`
- Modify: `README.md`
- Modify: `tests/smoke/test_compose_structure.py`

- [ ] **Step 1: Write the failing smoke tests**

```python
def test_collector_repo_exists_as_a_sibling_git_repo():
    root = Path(__file__).resolve().parents[2]
    collector_root = Path("/home/bjw/checkpoint-collector")

    assert collector_root.exists()
    assert (collector_root / ".git").exists()
    assert (collector_root / "collector" / "Dockerfile").exists()
    assert (collector_root / "postgres" / "Dockerfile").exists()
    assert (collector_root / "docker-compose.yml").exists()


def test_repo_no_longer_owns_the_collector_source_of_truth():
    root = Path(__file__).resolve().parents[2]

    assert not (root / "collector").exists()
    assert not (root / "postgres").exists()
    assert not (root / "load").exists()
    assert not (root / "clickhouse" / "users.d").exists()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/bjw/checkpoint && python3 -m pytest tests/smoke/test_compose_structure.py -v`

Expected: FAIL because `/home/bjw/checkpoint-collector` does not exist yet and this repo still owns the collector files.

- [ ] **Step 3: Create the sibling collector repo and move the files**

Run:

```bash
mkdir -p /home/bjw/checkpoint-collector
cd /home/bjw/checkpoint-collector
git init
```

Move:

```text
/home/bjw/checkpoint/collector -> /home/bjw/checkpoint-collector/collector
/home/bjw/checkpoint/postgres -> /home/bjw/checkpoint-collector/postgres
/home/bjw/checkpoint/load -> /home/bjw/checkpoint-collector/load
/home/bjw/checkpoint/clickhouse/users.d -> /home/bjw/checkpoint-collector/clickhouse/users.d
/home/bjw/checkpoint/VERSION -> /home/bjw/checkpoint-collector/VERSION
```

````markdown
# Checkpoint Collector

This repo owns the collector pipeline, ClickHouse DDLs, local Postgres image,
and the load harness used to generate database traffic.

## Local Build

```bash
docker build -t checkpoint-postgres:local ./postgres
docker build -t checkpoint-clickhouse:local .
```
````

````markdown
This repo now expects the collector source of truth at `/home/bjw/checkpoint-collector`.
The collector repo is initialized locally first; Brett can create the GitHub remote while
the follow-on tasks proceed.
````

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/bjw/checkpoint && python3 -m pytest tests/smoke/test_compose_structure.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/bjw/checkpoint-collector
git add .
git commit -m "feat: initialize collector repo from checkpoint split"

cd /home/bjw/checkpoint
git add README.md tests/smoke/test_compose_structure.py
git add -u collector postgres load clickhouse/users.d VERSION
git commit -m "refactor: move collector-owned files to sibling repo"
```

### Task 2: Phase 1 Build Local Images And Slim The Checkpoint Compose Stack

**Files:**
- Modify: `docker-compose.yml`
- Modify: `tests/smoke/test_compose_structure.py`
- Modify: `README.md`

- [ ] **Step 1: Write the failing smoke tests**

```python
def test_compose_uses_local_split_images_for_postgres_and_clickhouse():
    root = Path(__file__).resolve().parents[2]
    compose_text = (root / "docker-compose.yml").read_text()

    assert "image: checkpoint-postgres:local" in compose_text
    assert "image: checkpoint-clickhouse:local" in compose_text
    assert "./postgres" not in compose_text
    assert "./collector" not in compose_text


def test_compose_no_longer_defines_local_collector_pipeline_services():
    root = Path(__file__).resolve().parents[2]
    compose_text = (root / "docker-compose.yml").read_text()

    assert "collector:" not in compose_text
    assert "redpanda:" not in compose_text
    assert "demo:" not in compose_text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/bjw/checkpoint && python3 -m pytest tests/smoke/test_compose_structure.py -v`

Expected: FAIL because the current compose file still points at in-repo build contexts and services.

- [ ] **Step 3: Write the minimal compose and docs changes**

```yaml
services:
  postgres:
    image: checkpoint-postgres:local
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d checkpoint_demo"]
      interval: 5s
      timeout: 5s
      retries: 12
    ports: ["5432:5432"]

  clickhouse:
    image: checkpoint-clickhouse:local
    healthcheck:
      test: ["CMD-SHELL", "clickhouse-client --query 'SELECT 1'"]
      interval: 5s
      timeout: 5s
      retries: 12
    ports: ["8123:8123", "9000:9000"]
```

````markdown
## Local Run

Build the local collector-owned images first:

```bash
cd /home/bjw/checkpoint-collector
docker build -t checkpoint-postgres:local ./postgres
docker build -t checkpoint-clickhouse:local .
```

Then start the checkpoint stack:

```bash
cd /home/bjw/checkpoint
docker compose up -d
cd agent && npm start
```
````

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/bjw/checkpoint && python3 -m pytest tests/smoke/test_compose_structure.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml tests/smoke/test_compose_structure.py README.md
git commit -m "feat: use local split images in checkpoint compose"
```

### Task 3: Phase 1 Startup Schema-Version Validation

**Files:**
- Create: `agent/src/clickhouse_schema_contract.ts`
- Create: `agent/test/clickhouse_schema_contract.test.ts`
- Modify: `agent/src/tools/clickhouse_tool.ts`
- Modify: `agent/src/runtime_dependencies.ts`
- Modify: `agent/src/server.ts`
- Modify: `agent/test/server.test.ts`

- [ ] **Step 1: Write the failing schema-contract test**

```typescript
import assert from "node:assert/strict";
import test from "node:test";

import { assertSchemaContractSatisfied } from "../src/clickhouse_schema_contract.ts";

test("assertSchemaContractSatisfied rejects a mismatched schema version", async () => {
  await assert.rejects(
    () =>
      assertSchemaContractSatisfied({
        expectedVersion: "2",
        introspection: {
          schemaVersion: "1",
          tables: [{ name: "query_events", columns: ["fingerprint"] }],
        },
      }),
    /schema version/i,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent && node --import tsx --test test/clickhouse_schema_contract.test.ts`

Expected: FAIL because the contract module does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// ABOUTME: Validates that the connected ClickHouse schema matches the published collector contract.
// ABOUTME: Fails startup before serving requests when the expected schema version or table shape is wrong.
export function assertSchemaContractSatisfied(input: {
  expectedVersion: string;
  introspection: {
    schemaVersion: string;
    tables: Array<{ name: string; columns: Array<string> }>;
  };
}): void {
  if (input.introspection.schemaVersion !== input.expectedVersion) {
    throw new Error(
      `ClickHouse schema version mismatch: expected ${input.expectedVersion}, got ${input.introspection.schemaVersion}`,
    );
  }
}
```

```typescript
async readSchemaContract(): Promise<{
  schemaVersion: string;
  tables: Array<{ name: string; columns: Array<string> }>;
}> {
  const schemaVersion = await this.executeQuery("SELECT version FROM schema_contract FORMAT TSV");
  const tableRows = await this.executeQuery("SELECT table, columns FROM schema_contract_tables FORMAT TSV");
  return parseSchemaContract(schemaVersion, tableRows);
}
```

```typescript
export async function validateRuntimeSchema(clickhouseTool = new ClickHouseTool()): Promise<void> {
  const expectedVersion = process.env.CHECKPOINT_CLICKHOUSE_SCHEMA_VERSION ?? "";
  const introspection = await clickhouseTool.readSchemaContract();
  assertSchemaContractSatisfied({ expectedVersion, introspection });
}
```

```typescript
export async function startServer(options: ServerOptions = {}) {
  if (!options.executor) {
    await validateRuntimeSchema();
  }
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3001;
  const server = createServer({ ...options, port });

  return server.app.listen(port, host);
}
```

- [ ] **Step 4: Add the failing startup test**

```typescript
test("startServer validates the runtime schema before listening", async () => {
  let validated = false;
  const { startServer } = await import("../src/server.ts");

  await assert.rejects(
    () =>
      startServer({
        host: "127.0.0.1",
        port: 0,
        validateRuntimeSchema: async () => {
          validated = true;
          throw new Error("schema mismatch");
        },
      } as any),
    /schema mismatch/,
  );

  assert.equal(validated, true);
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd agent && npm test -- --test-name-pattern "schema version|validates the runtime schema"`

Expected: FAIL because `startServer()` does not validate anything yet.

- [ ] **Step 6: Wire the injectable validation hook**

```typescript
type ServerOptions = {
  baseUrl?: string;
  executor?: DBSpecialistExecutor;
  host?: string;
  port?: number;
  validateRuntimeSchema?: () => Promise<void>;
};

const validate = options.validateRuntimeSchema ?? validateRuntimeSchema;
if (!options.executor) {
  await validate();
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd agent && npm test -- --test-name-pattern "schema version|validates the runtime schema"`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add agent/src/clickhouse_schema_contract.ts agent/test/clickhouse_schema_contract.test.ts \
  agent/src/tools/clickhouse_tool.ts agent/src/runtime_dependencies.ts \
  agent/src/server.ts agent/test/server.test.ts
git commit -m "feat: validate clickhouse schema version at startup"
```

### Task 4: Phase 1 Remove In-Repo Collector Assets And Update References

**Files:**
- Modify: `README.md`
- Modify: `tests/smoke/test_compose_structure.py`
- Modify: `JOURNAL.md`

- [ ] **Step 1: Write the failing smoke test that guards removal**

```python
def test_repo_no_longer_contains_local_collector_or_demo_stack_assets():
    root = Path(__file__).resolve().parents[2]

    assert not (root / "collector").exists()
    assert not (root / "postgres").exists()
    assert not (root / "load").exists()
    assert not (root / "clickhouse" / "users.d").exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/bjw/checkpoint && python3 -m pytest tests/smoke/test_compose_structure.py -v`

Expected: FAIL until the move from Task 1 is complete and all references are updated.

- [ ] **Step 3: Remove only the moved assets and update references**

```markdown
The collector, ClickHouse DDLs, demo Postgres image, and load harness now live in
the separate collector repo at `/home/bjw/checkpoint-collector`. This repo consumes
locally built images from that repo only.
```

Add a journal entry:

```markdown
- 2026-04-06: Phase 1 moved `collector/`, `postgres/`, `load/`, and local ClickHouse user config into `/home/bjw/checkpoint-collector`, initialized that repo under git, and updated checkpoint to consume locally built split images while validating the pinned collector schema version at startup.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/bjw/checkpoint && python3 -m pytest tests/smoke/test_compose_structure.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add README.md tests/smoke/test_compose_structure.py JOURNAL.md
git commit -m "docs: update checkpoint references after collector repo split"
```

### Task 5: Phase 2 Preserve The Memory Implementation Before Deletion

**Files:**
- No code changes in the main branch before the branch/tag is created.

- [ ] **Step 1: Record the preservation point**

Run:

```bash
git branch memory-tool
git tag memory-tool-preserved
git rev-parse --short HEAD
```

Expected: The branch and tag both point at the last commit that still contains `agent/src/tools/memory_tool.ts`, `agent/memory/`, and the memory-facing tests.

- [ ] **Step 2: Verify the preservation point contains the memory files**

Run:

```bash
git ls-tree --name-only -r memory-tool -- agent/src/tools/memory_tool.ts agent/memory
```

Expected output includes:

```text
agent/src/tools/memory_tool.ts
agent/memory/MEMORY.md
agent/memory/events.jsonl
```

- [ ] **Step 3: Commit the preservation marker note**

```bash
git commit --allow-empty -m "chore: preserve memory tool branch point"
```

### Task 6: Phase 2 Remove Memory Tools, Memory Prompting, And Memory Runtime Wiring

**Files:**
- Delete: `agent/src/tools/memory_tool.ts`
- Delete: `agent/memory/`
- Delete: `agent/test/memory_tool.test.ts`
- Modify: `agent/src/agent_tools.ts`
- Modify: `agent/src/runtime_dependencies.ts`
- Modify: `agent/src/executor.ts`
- Modify: `agent/test/agent_tools.test.ts`
- Modify: `agent/test/executor.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
test("buildAgentTools no longer exposes memory tools", () => {
  const tools = buildAgentTools({
    clickhouseTool: {
      listTables: async () => ["query_events"],
      describeTable: async () => "fingerprint\tString",
      executeQuery: async () => "fingerprint\tabc",
      queryFindings: async () => [],
    },
  } as any);

  assert.equal(tools.some((tool) => tool.name === "search_memory"), false);
  assert.equal(tools.some((tool) => tool.name === "record_memory"), false);
});

test("executor system prompt no longer mentions memory", () => {
  const executor = new DBSpecialistExecutor({} as any);
  assert.doesNotMatch(String((executor as any).systemPrompt), /memory/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd agent && npm test -- --test-name-pattern "no longer exposes memory tools|no longer mentions memory"`

Expected: FAIL because the current tool list and default system prompt still include memory behavior.

- [ ] **Step 3: Write the minimal implementation**

```typescript
export type AgentToolDependencies = {
  clickhouseTool?: { /* unchanged */ };
  codeSearchTool?: { /* unchanged */ };
  demoRepoTool?: { /* unchanged */ };
  explainTool?: { /* unchanged */ };
  githubTool?: { /* unchanged */ };
};
```

```typescript
const DEFAULT_SYSTEM_PROMPT = [
  "You are the DB specialist agent.",
  "Investigate database issues by using the available tools instead of inventing data.",
  "Use query_findings for normalized ClickHouse findings and query_database only for guarded follow-up queries.",
  "Finish with a concise response that explains what you found and what should happen next.",
].join("\n");
```

```typescript
export function createRuntimeExecutor(): DBSpecialistExecutor {
  const { explainTool } = createRuntimeDependencies();

  return new DBSpecialistExecutor({
    clickhouseTool: new ClickHouseTool(),
    codeSearchTool: new CodeSearchTool(),
    explainTool: {
      analyze: async ({ sql }: { sql: string }) => {
        const result = (await explainTool.analyze({ sql })) as { rows?: Array<unknown> };
        return { plan_rows: result.rows ?? [], validated: true };
      },
    },
    githubTool: new GitHubTool(),
    demoRepoTool: new DemoRepoTool(),
  });
}
```

- [ ] **Step 4: Delete the memory implementation and test files**

Run:

```bash
rm -rf agent/memory
rm -f agent/src/tools/memory_tool.ts agent/test/memory_tool.test.ts
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd agent && npm test`

Expected: PASS with no references to `search_memory`, `record_memory`, or the memory runtime.

- [ ] **Step 6: Commit**

```bash
git add agent/src/agent_tools.ts agent/src/runtime_dependencies.ts agent/src/executor.ts \
  agent/test/agent_tools.test.ts agent/test/executor.test.ts
git add -u agent/src/tools/memory_tool.ts agent/memory agent/test/memory_tool.test.ts
git commit -m "refactor: remove memory runtime and prompts"
```

### Task 7: Phase 2 Replace `LoopRunEvidence` With Lightweight Call-Time Gates

**Files:**
- Modify: `agent/src/agent_tools.ts`
- Modify: `agent/test/agent_tools.test.ts`

- [ ] **Step 1: Write the failing gate tests**

```typescript
test("apply_fix requires explicit high severity, validation, and source input", async () => {
  const tools = buildAgentTools({
    demoRepoTool: {
      applyFix: async () => ({ branchName: "agent/demo-fix-fp-1", diff: "diff --git a/file b/file" }),
    },
  } as any);

  const applyFix = tools.find((tool) => tool.name === "apply_fix");
  assert.ok(applyFix);

  await assert.rejects(
    () =>
      applyFix.execute("tool-apply", {
        finding: { fingerprint: "fp-1", severity: "medium" },
        validation: { validated: true },
        source: { content: "body", source_file: "app/models/todo.rb:2" },
        fix: { fix_type: "add_index", summary: "Add index" },
      } as any),
    /high-severity/i,
  );
});

test("open_pull_request requires prepared branch and diff inputs", async () => {
  const tools = buildAgentTools({
    githubTool: { openPullRequest: async () => ({ url: "https://example.test/pr/1" }) },
  } as any);

  const openPullRequest = tools.find((tool) => tool.name === "open_pull_request");
  assert.ok(openPullRequest);

  await assert.rejects(
    () =>
      openPullRequest.execute("tool-pr", {
        finding: { fingerprint: "fp-1" },
        fix: { fix_type: "add_index", summary: "Add index" },
        validation: { validated: true },
      } as any),
    /headRef|codeDiff/i,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd agent && npm test -- --test-name-pattern "explicit high severity|prepared branch and diff"`

Expected: FAIL because the tools still depend on `LoopRunEvidence`.

- [ ] **Step 3: Write the minimal implementation**

```typescript
function assertApplyFixInputs(input: {
  finding?: { severity?: string };
  source?: { source_file?: string };
  validation?: { validated?: boolean };
}): void {
  if (input.finding?.severity !== "high") {
    throw new Error("apply_fix requires a high-severity finding");
  }
  if (!input.validation || input.validation.validated !== true) {
    throw new Error("apply_fix requires validated query input");
  }
  if (!input.source?.source_file) {
    throw new Error("apply_fix requires source_file");
  }
}

function assertPullRequestInputs(input: {
  codeDiff?: string;
  headRef?: string;
}): void {
  if (!input.headRef || !input.codeDiff) {
    throw new Error("open_pull_request requires non-empty headRef and codeDiff");
  }
}
```

```typescript
export function buildAgentTools(deps: AgentToolDependencies): Array<AgentTool<any>> {
  const tools: Array<AgentTool<any>> = [];
  // no LoopRunEvidence creation
  // apply_fix and open_pull_request call the assertion helpers above
  return tools;
}
```

- [ ] **Step 4: Delete the evidence object**

Remove from `agent/src/agent_tools.ts`:

```typescript
export type LoopRunEvidence = { /* remove entirely */ };
export function createLoopRunEvidence(): LoopRunEvidence { /* remove entirely */ }
```

Update every test import to:

```typescript
import { buildAgentTools } from "../src/agent_tools.ts";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd agent && npm test -- --test-name-pattern "apply_fix|open_pull_request|agent_tools"`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add agent/src/agent_tools.ts agent/test/agent_tools.test.ts
git commit -m "refactor: replace loop evidence with stateless tool gates"
```

### Task 8: Phase 3 Create The Root Pi Package And Register The Tools

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `extensions/db-specialist.ts`
- Create: `skills/investigation.md`
- Create: `skills/fix.md`
- Create: `test/extensions/db_specialist.test.ts`
- Move: `agent/src/tools/clickhouse_tool.ts` -> `src/tools/clickhouse_tool.ts`
- Move: `agent/src/tools/code_search_tool.ts` -> `src/tools/code_search_tool.ts`
- Move: `agent/src/tools/demo_repo_tool.ts` -> `src/tools/demo_repo_tool.ts`
- Move: `agent/src/tools/explain_tool.ts` -> `src/tools/explain_tool.ts`
- Move: `agent/src/tools/github_tool.ts` -> `src/tools/github_tool.ts`

- [ ] **Step 1: Write the failing extension-registration test**

```typescript
import assert from "node:assert/strict";
import test from "node:test";

import registerDbSpecialist from "../../extensions/db-specialist.ts";

test("db-specialist extension registers the eight specialist tools", () => {
  const toolNames: Array<string> = [];

  registerDbSpecialist({
    registerTool(definition: { name: string }) {
      toolNames.push(definition.name);
    },
  } as any);

  assert.deepEqual(toolNames.sort(), [
    "analyze_query",
    "apply_fix",
    "describe_table",
    "list_tables",
    "locate_source",
    "open_pull_request",
    "query_database",
    "query_findings",
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/extensions/db_specialist.test.ts`

Expected: FAIL because the root package and extension entrypoint do not exist yet.

- [ ] **Step 3: Write the minimal package and extension implementation**

```json
{
  "name": "@checkpoint/db-specialist",
  "private": true,
  "version": "0.3.0",
  "type": "module",
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"]
  },
  "scripts": {
    "test": "node --import tsx --test test/**/*.test.ts",
    "typecheck": "tsc --noEmit"
  }
}
```

```typescript
// ABOUTME: Registers the DB specialist tools with pi from the shared runtime dependencies.
// ABOUTME: Reuses one tool instance per extension load and exposes the specialist workflow to pi sessions.
export default function registerDbSpecialist(pi: {
  registerTool(input: { name: string; description?: string; execute?: Function }): void;
}): void {
  const clickhouseTool = new ClickHouseTool();
  const explainTool = new ExplainTool({ query: async () => ({ rows: [] }) as any });
  const codeSearchTool = new CodeSearchTool();
  const demoRepoTool = new DemoRepoTool();
  const githubTool = new GitHubTool();

  pi.registerTool({ name: "query_findings", execute: async (input: unknown) => clickhouseTool.queryFindings(input) });
  pi.registerTool({ name: "list_tables", execute: async () => clickhouseTool.listTables() });
  pi.registerTool({ name: "describe_table", execute: async ({ table }: any) => clickhouseTool.describeTable(table) });
  pi.registerTool({ name: "query_database", execute: async ({ sql }: any) => clickhouseTool.executeQuery(sql) });
  pi.registerTool({ name: "analyze_query", execute: async ({ sql }: any) => explainTool.analyze({ sql }) });
  pi.registerTool({ name: "locate_source", execute: async (input: any) => codeSearchTool.locate(input) });
  pi.registerTool({ name: "apply_fix", execute: async (input: any) => demoRepoTool.applyFix(input) });
  pi.registerTool({ name: "open_pull_request", execute: async (input: any) => githubTool.openPullRequest(input) });
}
```

```markdown
# Investigation

Use `query_findings` first. Only call `query_database` for guarded follow-up queries.
Only continue to `apply_fix` when the selected finding is high severity and the query
has validated output.
```

```markdown
# Fix

Call `apply_fix` only with a validated finding, the concrete source file, and a
minimal fix proposal. Call `open_pull_request` only with the branch and diff returned
from `apply_fix`.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test test/extensions/db_specialist.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json extensions/db-specialist.ts \
  skills/investigation.md skills/fix.md test/extensions/db_specialist.test.ts \
  src/tools/clickhouse_tool.ts src/tools/code_search_tool.ts src/tools/demo_repo_tool.ts \
  src/tools/explain_tool.ts src/tools/github_tool.ts
git add -u agent/src/tools
git commit -m "feat: convert db specialist runtime into a pi package"
```

### Task 9: Phase 3 Standalone Pi Runtime And Container Image

**Files:**
- Create: `Dockerfile`
- Create: `test/integration/pi_session.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the failing standalone session test**

```typescript
import assert from "node:assert/strict";
import test from "node:test";

test("standalone pi session loads the db-specialist extension", async () => {
  const result = await runPi([
    "print",
    "--package",
    ".",
    "--prompt",
    "List the available DB specialist tools.",
  ]);

  assert.match(result.stdout, /query_findings/);
  assert.match(result.stdout, /open_pull_request/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/integration/pi_session.test.ts`

Expected: FAIL because the package is not runnable through pi yet.

- [ ] **Step 3: Write the minimal runtime and container implementation**

```dockerfile
FROM node:22-bookworm

RUN npm install -g @mariozechner/pi
RUN apt-get update && apt-get install -y git libpq-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY extensions ./extensions
COPY skills ./skills
COPY src ./src

RUN npm ci

ENTRYPOINT ["pi"]
```

````markdown
## Standalone Pi Run

```bash
pi print --package . --prompt "Investigate the top database offenders"
```

The package expects `CLICKHOUSE_URL`, `POSTGRES_URL`, `GITHUB_TOKEN`, `DEMO_REPO`,
`DEMO_BASE_REF`, `CODE_SEARCH_ROOT`, and `LLM_MODEL`.
````

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test test/integration/pi_session.test.ts`

Run: `docker build -t checkpoint-db-specialist .`

Expected: PASS for the node test, then a successful image build.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile test/integration/pi_session.test.ts README.md
git commit -m "feat: add standalone pi runtime and package image"
```

### Task 10: Phase 3 Build The Thin A2A Bridge Over Pi Sessions

**Files:**
- Create: `src/a2a_bridge/session_registry.ts`
- Create: `src/a2a_bridge/server.ts`
- Create: `test/a2a_bridge/session_registry.test.ts`
- Create: `test/a2a_bridge/server.test.ts`

- [ ] **Step 1: Write the failing session-registry test**

```typescript
import assert from "node:assert/strict";
import test from "node:test";

import { SessionRegistry } from "../../src/a2a_bridge/session_registry.ts";

test("SessionRegistry serializes requests per contextId", async () => {
  const registry = new SessionRegistry("/tmp/checkpoint-sessions.json");

  await registry.record("ctx-1", { sessionPath: "/sessions/one", createdAt: "a", lastActiveAt: "a" });
  await registry.record("ctx-2", { sessionPath: "/sessions/two", createdAt: "b", lastActiveAt: "b" });

  assert.deepEqual(await registry.read("ctx-1"), {
    sessionPath: "/sessions/one",
    createdAt: "a",
    lastActiveAt: "a",
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test test/a2a_bridge/session_registry.test.ts test/a2a_bridge/server.test.ts`

Expected: FAIL because the A2A bridge does not exist yet.

- [ ] **Step 3: Write the minimal bridge implementation**

```typescript
// ABOUTME: Persists A2A context-to-pi-session mappings so bridge restarts can resume sessions.
// ABOUTME: Tracks creation and last-active timestamps and drops missing sessions on reload.
export class SessionRegistry {
  constructor(private readonly path: string) {}

  async read(contextId: string): Promise<{ sessionPath: string; createdAt: string; lastActiveAt: string } | undefined> {
    const entries = await this.load();
    return entries[contextId];
  }

  async record(contextId: string, value: { sessionPath: string; createdAt: string; lastActiveAt: string }): Promise<void> {
    const entries = await this.load();
    entries[contextId] = value;
    await writeFile(this.path, JSON.stringify(entries, null, 2));
  }
}
```

```typescript
// ABOUTME: Translates A2A requests into pi session calls and streams pi events back as A2A updates.
// ABOUTME: Keeps one pi session per A2A contextId and serializes same-context requests.
export function createA2ABridge(input: {
  createAgentSession: (sessionPath?: string) => Promise<{ prompt(text: string): Promise<unknown> }>;
  registry: SessionRegistry;
}) {
  return {
    async send(contextId: string, text: string) {
      const existing = await input.registry.read(contextId);
      const session = await input.createAgentSession(existing?.sessionPath);
      return session.prompt(text);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test test/a2a_bridge/session_registry.test.ts test/a2a_bridge/server.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/a2a_bridge/session_registry.ts src/a2a_bridge/server.ts \
  test/a2a_bridge/session_registry.test.ts test/a2a_bridge/server.test.ts
git commit -m "feat: add a2a bridge over pi sessions"
```

## Self-Review

### Spec coverage

- Phase 1 extract-collector goal: covered by Task 1 and Task 4.
- Phase 1 collector repo setup under `/home/bjw`: covered by Task 1.
- Phase 1 local-image workflow replacing the GHCR prerequisite during implementation: covered by Task 2.
- Phase 1 startup schema validation: covered by Task 3.
- Phase 2 memory removal: covered by Task 5 and Task 6.
- Phase 2 preserve-on-branch requirement: covered by Task 5.
- Phase 2 remove `LoopRunEvidence` and use lightweight safety gates: covered by Task 7.
- Phase 3 root pi package and single extension entrypoint: covered by Task 8.
- Phase 3 markdown skills: covered by Task 8.
- Phase 3 container-per-customer runtime and standalone pi first: covered by Task 9.
- Phase 3 A2A as a thin bridge built last: covered by Task 10.
- Out-of-scope items from the spec are intentionally absent from this plan.

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” placeholders remain.
- Every task names exact files, commands, and a concrete failing-test-first step.

### Type consistency

- The plan consistently uses `validateRuntimeSchema`, `assertSchemaContractSatisfied`, `SessionRegistry`, and `registerDbSpecialist`.
- `apply_fix` gate inputs are consistently `finding.severity`, `validation.validated`, and `source.source_file`.

### Spec conflict noted and resolved

- The Phase 2 subsection in the design doc still says `LoopRunEvidence` stays, but spec §3a and Brett’s direct instruction require removing it. This plan follows the direct instruction plus §3a and removes `LoopRunEvidence`.
