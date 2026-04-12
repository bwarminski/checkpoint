# DB Specialist Agent Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deterministic Phase 1 executor path with a `pi-agent-core` loop while keeping Phase 2 narrow: clean local config, collect richer `pg_stat_statements` row and block metrics, expose ClickHouse discovery/query tools, add a hybrid memory system for durable discoveries and preferences, and finish with a live smoke test.

**Architecture:** The A2A server remains the entrypoint, but `DBSpecialistExecutor` becomes a thin bridge around a `pi-agent-core` agent. The LLM interacts through focused agent tools built over ClickHouse, code search, explain, memory, demo-repo, and GitHub boundaries. Memory is for long-lived context and failed-attempt learning, not routine query-loop bookkeeping. Model selection is provider-agnostic through `LLM_MODEL`, not Anthropic-specific env wiring.

**Tech Stack:** TypeScript, `@a2a-js/sdk`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, Ruby collector, ClickHouse, Postgres, pytest, Node test runner

---

## File Structure

- `agent/src/server.ts`
  Loads repo-root `.env` and keeps the A2A transport stable while the executor changes underneath.
- `agent/src/runtime_dependencies.ts`
  Builds the default runtime tools, memory roots, and selected model/provider.
- `agent/src/executor.ts`
  Bridges A2A task lifecycle events to the `pi-agent-core` agent session.
- `agent/src/agent_tools.ts`
  New file. Defines the `pi-agent-core` tool wrappers over runtime dependencies.
- `agent/src/llm_config.ts`
  New file. Parses `LLM_MODEL` as a provider-qualified model reference.
- `agent/src/tools/clickhouse_tool.ts`
  Exposes schema discovery and guarded query execution to the LLM.
- `agent/src/tools/memory_tool.ts`
  New hybrid memory surface over markdown knowledge and JSONL event history.
- `agent/test/*.test.ts`
  Unit coverage for config, ClickHouse, memory, executor bridge, and tool wrappers.
- `agent/test/integration/*.test.ts`
  Mocked integration coverage for A2A-to-agent-loop behavior without real network calls.
- `collector/lib/collector.rb`
  Adds `rows` and block-counter capture from `pg_stat_statements`.
- `collector/db/clickhouse/*.sql`
  Adds row-count plus block-access diagnostics to the ClickHouse write/read model.
- `tests/conftest.py`
  New file. Loads `.env` for pytest using stdlib code.
- `collector/test/support/env.rb`
  New file. Loads `.env` for collector tests.
- `agent/memory/`
  New directory containing markdown memory and JSONL event history.
- `.env.example`
  Documents the smaller config contract, including provider-agnostic LLM config.
- `README.md`
  Keeps setup instructions aligned with the actual config behavior.

### Task 1: Config And Env Cleanup

**Files:**
- Modify: `agent/src/tools/demo_repo_tool.ts`
- Modify: `agent/src/server.ts`
- Modify: `agent/package.json`
- Create: `tests/conftest.py`
- Create: `collector/test/support/env.rb`
- Modify: `collector/test/collector_test.rb`
- Modify: `collector/test/query_comment_parser_test.rb`
- Modify: `collector/test/clickhouse_connection_test.rb`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Write the failing test**

```typescript
test("DemoRepoTool falls back to the sibling db-specialist-demo path when DEMO_APP_ROOT is unset", async () => {
  const tool = new DemoRepoTool(
    { exec: async () => "" },
    { env: { DEMO_BASE_REF: "main" } },
  );

  await assert.rejects(
    () =>
      tool.applyFix({
        finding: { fingerprint: "config-check" },
        fix: { fix_type: "rewrite_like", summary: "summary" },
        source: {
          content: '3: Todo.where("title LIKE ?", "%#{params[:q]}%")',
          source_file: "app/controllers/todos_controller.rb:3",
        },
      }),
    /db-specialist-demo/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent && npm test -- --test-name-pattern "falls back to the sibling"`

Expected: FAIL because `DemoRepoTool` still throws `DemoRepoTool requires DEMO_APP_ROOT.`

- [ ] **Step 3: Write minimal implementation**

```typescript
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function defaultDemoAppRoot(): string {
  return resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../db-specialist-demo");
}

const root = this.env.DEMO_APP_ROOT ?? defaultDemoAppRoot();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent && npm test -- --test-name-pattern "falls back to the sibling"`

Expected: PASS

- [ ] **Step 5: Write the failing config-load tests**

```typescript
test("server startup loads repo-root .env without overriding existing shell vars", async () => {
  process.env.DEMO_REPO = "shell/value";
  const { createServer } = await import("../src/server.ts");
  createServer({ executor: {} as any });
  assert.equal(process.env.DEMO_REPO, "shell/value");
});
```

```python
def test_pytest_config_loader_sets_demo_repo(monkeypatch):
    monkeypatch.delenv("DEMO_REPO", raising=False)
    import conftest  # noqa: F401
    assert "DEMO_REPO" in os.environ
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd agent && npm test -- --test-name-pattern "loads repo-root .env"`

Run: `cd /home/bjw/checkpoint && python3 -m pytest tests/docs/readme_config_test.py -v`

Expected: FAIL because the environment is not auto-loaded yet.

- [ ] **Step 7: Write minimal implementation**

```typescript
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

loadDotenv({
  path: resolve(fileURLToPath(new URL(".", import.meta.url)), "../../.env"),
  override: false,
});
```

```python
# ABOUTME: Loads repo-root .env for pytest without adding a Python dependency manager.
# ABOUTME: Preserves existing shell variables and fills only missing values from .env.
import os
from pathlib import Path

env_path = Path(__file__).resolve().parents[1] / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key, value)
```

```ruby
# ABOUTME: Loads repo-root .env before collector tests run.
# ABOUTME: Preserves exported shell values and fills only missing test variables.
env_path = File.expand_path("../../../.env", __dir__)
if File.exist?(env_path)
  File.readlines(env_path, chomp: true).each do |line|
    stripped = line.strip
    next if stripped.empty? || stripped.start_with?("#") || !stripped.include?("=")
    key, value = stripped.split("=", 2)
    ENV[key] ||= value
  end
end
```

- [ ] **Step 8: Wire collector test startup**

```ruby
require_relative "support/env"
```

- [ ] **Step 9: Update config docs**

```dotenv
# Optional: override the auto-detected sibling demo repo path
# DEMO_APP_ROOT=/home/yourname/db-specialist-demo

# Required for live GitHub PR creation
GITHUB_TOKEN=
DEMO_REPO=bwarminski/db-specialist-demo

# Provider-qualified model selection for the agent loop
LLM_MODEL=openai/gpt-4o-mini

```

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd agent && npm test`

Run: `cd /home/bjw/checkpoint && python3 -m pytest tests/ -v`

Run: `cd collector && bundle exec ruby -Itest test/collector_test.rb test/query_comment_parser_test.rb test/clickhouse_connection_test.rb`

Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add agent/src/tools/demo_repo_tool.ts agent/src/server.ts agent/package.json \
  tests/conftest.py collector/test/support/env.rb \
  collector/test/collector_test.rb collector/test/query_comment_parser_test.rb \
  collector/test/clickhouse_connection_test.rb .env.example README.md
git commit -m "feat: auto-load local env and detect demo repo path"
```

### Task 2: Collector Row And Block Diagnostics

**Files:**
- Modify: `collector/lib/collector.rb`
- Modify: `collector/db/clickhouse/001_query_events.sql`
- Modify: `collector/db/clickhouse/002_query_fingerprints.sql`
- Modify: `collector/db/clickhouse/003_top_offenders_mv.sql`
- Modify: `collector/db/clickhouse/004_reset_query_fingerprints.sql`
- Modify: `collector/test/collector_test.rb`
- Modify: `collector/test/sql/clickhouse_schema_test.rb`

- [ ] **Step 1: Write the failing collector test**

```ruby
def test_run_once_captures_row_and_block_metrics
  stats_connection = Object.new
  def stats_connection.exec(_sql)
    [{
      "queryid" => "123",
      "calls" => "10",
      "mean_exec_time" => "15.5",
      "rows" => "2500",
      "shared_blks_hit" => "100",
      "shared_blks_read" => "40",
      "local_blks_hit" => "20",
      "local_blks_read" => "5",
      "temp_blks_read" => "3",
      "temp_blks_written" => "2"
    }]
  end

  collector = Collector.new(stats_connection: stats_connection, clock: -> { Time.utc(2026, 4, 5, 12, 0, 0) })
  row = collector.run_once.first

  assert_equal 2500, row[:rows_returned_or_affected]
  assert_equal 170, row[:total_block_accesses]
  assert_in_delta 17.0, row[:mean_block_accesses_per_call], 0.001
  assert_equal 100, row[:shared_blks_hit]
  assert_equal 2, row[:temp_blks_written]
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd collector && bundle exec ruby -Itest test/collector_test.rb`

Expected: FAIL because the collector does not read the row and block columns yet.

- [ ] **Step 3: Write minimal implementation**

```ruby
STATS_SQL = [
  "SELECT queryid, calls, mean_exec_time, rows,",
  "shared_blks_hit, shared_blks_read, local_blks_hit, local_blks_read,",
  "temp_blks_read, temp_blks_written",
  "FROM pg_stat_statements",
].join(" ").freeze

calls = stats_row.fetch("calls").to_i
total_block_accesses = %w[
  shared_blks_hit
  shared_blks_read
  local_blks_hit
  local_blks_read
  temp_blks_read
  temp_blks_written
].sum { |key| stats_row.fetch(key, 0).to_i }
mean_block_accesses_per_call = calls.zero? ? 0.0 : total_block_accesses.to_f / calls
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd collector && bundle exec ruby -Itest test/collector_test.rb`

Expected: PASS

- [ ] **Step 5: Write the failing schema test**

```ruby
def test_query_events_schema_tracks_row_and_block_metrics
  sql = File.read(File.expand_path("../db/clickhouse/001_query_events.sql", __dir__))

  assert_match(/rows_returned_or_affected\s+UInt64/, sql)
  assert_match(/shared_blks_hit\s+UInt64/, sql)
  assert_match(/temp_blks_written\s+UInt64/, sql)
  assert_match(/total_block_accesses\s+UInt64/, sql)
  assert_match(/mean_block_accesses_per_call\s+Float64/, sql)
end
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd collector && bundle exec ruby -Itest test/sql/clickhouse_schema_test.rb`

Expected: FAIL because the DDLs do not contain the new row and block columns yet.

- [ ] **Step 7: Write minimal implementation**

```sql
rows_returned_or_affected UInt64,
shared_blks_hit UInt64,
shared_blks_read UInt64,
local_blks_hit UInt64,
local_blks_read UInt64,
temp_blks_read UInt64,
temp_blks_written UInt64,
total_block_accesses UInt64,
mean_block_accesses_per_call Float64,
rows_returned_or_affected_state AggregateFunction(sum, UInt64),
shared_blks_hit_state AggregateFunction(sum, UInt64),
shared_blks_read_state AggregateFunction(sum, UInt64),
local_blks_hit_state AggregateFunction(sum, UInt64),
local_blks_read_state AggregateFunction(sum, UInt64),
temp_blks_read_state AggregateFunction(sum, UInt64),
temp_blks_written_state AggregateFunction(sum, UInt64),
total_block_accesses_state AggregateFunction(sum, UInt64)
```

```sql
sumState(rows_returned_or_affected) AS rows_returned_or_affected_state,
sumState(shared_blks_hit) AS shared_blks_hit_state,
sumState(shared_blks_read) AS shared_blks_read_state,
sumState(local_blks_hit) AS local_blks_hit_state,
sumState(local_blks_read) AS local_blks_read_state,
sumState(temp_blks_read) AS temp_blks_read_state,
sumState(temp_blks_written) AS temp_blks_written_state,
sumState(total_block_accesses) AS total_block_accesses_state
```

Update `004_reset_query_fingerprints.sql` to rebuild the same aggregate columns and MV projection so the reset path stays in sync with the live schema.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd collector && bundle exec ruby -Itest test/collector_test.rb test/sql/clickhouse_schema_test.rb`

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add collector/lib/collector.rb collector/db/clickhouse/001_query_events.sql \
  collector/db/clickhouse/002_query_fingerprints.sql collector/db/clickhouse/003_top_offenders_mv.sql \
  collector/db/clickhouse/004_reset_query_fingerprints.sql \
  collector/test/collector_test.rb collector/test/sql/clickhouse_schema_test.rb
git commit -m "feat: capture query row and block diagnostics"
```

### Task 3: ClickHouseTool Discovery And Query Interface

**Files:**
- Modify: `agent/src/tools/clickhouse_tool.ts`
- Modify: `agent/test/clickhouse_tool.test.ts`
- Modify: `agent/src/executor.ts`
- Modify: `agent/test/executor.test.ts`

- [ ] **Step 1: Write the failing ClickHouseTool tests**

```typescript
test("ClickHouseTool lists tables from SHOW TABLES", async () => {
  const tool = new ClickHouseTool(undefined, {
    transport: { query: async () => "query_events\nquery_fingerprints\n" },
  });

  assert.deepEqual(await tool.listTables(), ["query_events", "query_fingerprints"]);
});

test("ClickHouseTool describes a whitelisted table", async () => {
  let sql = "";
  const tool = new ClickHouseTool(undefined, {
    transport: { query: async (value) => ((sql = value), "fingerprint\tString\n") },
  });

  await tool.describeTable("query_events");
  assert.equal(sql, "DESCRIBE TABLE query_events FORMAT TSV");
});

test("ClickHouseTool rejects non-SELECT queries", async () => {
  const tool = new ClickHouseTool(undefined, {
    transport: { query: async () => "unused" },
  });

  await assert.rejects(() => tool.executeQuery("DELETE FROM query_events"), /SELECT-only/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd agent && npm test -- --test-name-pattern "lists tables|describes a whitelisted table|rejects non-SELECT"`

Expected: FAIL because the methods do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```typescript
async listTables(): Promise<Array<string>> {
  const payload = await this.transport!.query("SHOW TABLES FORMAT TSV");
  return payload.split("\n").map((line) => line.trim()).filter(Boolean);
}

async describeTable(table: string): Promise<string> {
  if (!/^[a-z0-9_]+$/i.test(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
  return this.transport!.query(`DESCRIBE TABLE ${table} FORMAT TSV`);
}

async executeQuery(sql: string): Promise<string> {
  if (!/^\s*select\b/i.test(sql)) {
    throw new Error("SELECT-only queries are allowed");
  }
  return this.transport!.query(sql);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd agent && npm test -- --test-name-pattern "lists tables|describes a whitelisted table|rejects non-SELECT"`

Expected: PASS

- [ ] **Step 5: Write the failing executor follow-on test**

```typescript
test("DBSpecialistExecutor no longer depends on topOffenders", async () => {
  const queries: Array<string> = [];
  const executor = new DBSpecialistExecutor({
    clickhouseTool: {
      listTables: async () => ["query_events"],
      describeTable: async () => "fingerprint\tString",
      executeQuery: async (sql: string) => {
        queries.push(sql);
        return "fingerprint\tsource_tag\tsource_file\tsample_query\ttotal_exec_time_ms\tp95_exec_time_ms\n";
      },
    },
  } as any);

  await executor.execute({ userMessage: { text: "analyze_db" } } as any, { enqueueEvent() {} } as any);
  assert.equal(queries.length > 0, true);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd agent && npm test -- --test-name-pattern "no longer depends on topOffenders"`

Expected: FAIL because the executor still reads the old method.

- [ ] **Step 7: Write minimal implementation**

Keep the MCP-style LLM-facing methods in `ClickHouseTool`, but do not move TSV parsing into the executor. `ClickHouseTool` should own:

- `listTables()`
- `describeTable()`
- `executeQuery()`
- one typed internal helper for the app's own default findings lookup

The executor should consume typed findings from `ClickHouseTool`, not transport-format TSV. The raw query guard should also be stricter than a simple `SELECT` prefix check: reject multi-statement input and restrict the raw interface to the supported ClickHouse tables used by this repo.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd agent && npm test -- --test-name-pattern "ClickHouseTool|no longer depends on topOffenders"`

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add agent/src/tools/clickhouse_tool.ts agent/test/clickhouse_tool.test.ts \
  agent/src/executor.ts agent/test/executor.test.ts
git commit -m "feat: switch to ClickHouse discovery and query interface"
```

### Task 4: Hybrid Memory System

**Files:**
- Rewrite: `agent/src/tools/memory_tool.ts`
- Rewrite: `agent/test/memory_tool.test.ts`
- Modify: `agent/src/runtime_dependencies.ts`
- Create: `agent/memory/MEMORY.md`
- Create: `agent/memory/events.jsonl`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing memory tests**

```typescript
test("MemoryTool returns markdown preferences and constraints in search results", async () => {
  const tool = new MemoryTool({
    rootDir: memoryRoot,
  });

  await writeFile(join(memoryRoot, "MEMORY.md"), [
    "## Preferences",
    "- Brett prefers provider-agnostic model configuration.",
    "",
    "## Constraints",
    "- Do not preserve backward compatibility without explicit approval.",
  ].join("\n"));

  const results = await tool.search("provider configuration");
  assert.equal(results.some((entry) => entry.kind === "preference"), true);
});

test("MemoryTool appends failed attempts to JSONL history", async () => {
  const tool = new MemoryTool({ rootDir: memoryRoot });

  await tool.record({
    kind: "failed_attempt",
    summary: "Adding an index did not improve the query plan.",
    details: { fingerprint: "fp-1" },
  });

  const events = await readFile(join(memoryRoot, "events.jsonl"), "utf8");
  assert.match(events, /failed_attempt/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd agent && npm test -- --test-name-pattern "MemoryTool returns markdown|MemoryTool appends failed attempts"`

Expected: FAIL because the current memory tool is still workflow-oriented.

- [ ] **Step 3: Write minimal implementation**

```typescript
type MemoryEntryKind = "preference" | "constraint" | "discovery" | "failed_attempt";

async search(query: string): Promise<Array<MemoryEntry>> {
  const markdownEntries = await readMarkdownMemory(this.rootDir);
  const eventEntries = await readJsonlEvents(this.rootDir);
  return [...markdownEntries, ...eventEntries].filter((entry) => matchesQuery(entry, query));
}

async record(input: {
  kind: MemoryEntryKind;
  summary: string;
  details?: unknown;
}): Promise<void> {
  await appendFile(
    join(this.rootDir, "events.jsonl"),
    `${JSON.stringify({ ts: new Date().toISOString(), ...input })}\n`,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd agent && npm test -- --test-name-pattern "MemoryTool returns markdown|MemoryTool appends failed attempts"`

Expected: PASS

- [ ] **Step 5: Write the failing runtime test**

```typescript
test("runtime dependencies point MemoryTool at agent/memory", async () => {
  const deps = createRuntimeDependencies({ cwd: repoRoot });
  assert.match(String(deps.memoryToolRoot), /agent\/memory$/);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd agent && npm test -- --test-name-pattern "point MemoryTool at agent/memory"`

Expected: FAIL because runtime dependencies do not expose the new memory root yet.

- [ ] **Step 7: Write minimal implementation**

```typescript
const memoryRoot = fileURLToPath(new URL("../memory/", import.meta.url));
const memoryTool = new MemoryTool({ rootDir: memoryRoot });
```

- [ ] **Step 8: Seed the memory directory**

Create `agent/memory/MEMORY.md` with starter sections:

```md
# Agent Memory

## Preferences

## Constraints

## Discoveries
```

Create `agent/memory/events.jsonl` as an empty tracked file.

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd agent && npm test -- --test-name-pattern "MemoryTool|point MemoryTool at agent/memory"`

Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add agent/src/tools/memory_tool.ts agent/test/memory_tool.test.ts \
  agent/src/runtime_dependencies.ts agent/memory/MEMORY.md agent/memory/events.jsonl .gitignore
git commit -m "feat: add hybrid markdown and jsonl memory"
```

### Task 5: pi-agent-core Loop And Provider-Agnostic Model Config

**Files:**
- Create: `agent/src/agent_tools.ts`
- Create: `agent/src/llm_config.ts`
- Modify: `agent/src/executor.ts`
- Modify: `agent/src/runtime_dependencies.ts`
- Modify: `agent/src/server.ts`
- Modify: `agent/package.json`
- Modify: `agent/test/executor.test.ts`
- Modify: `agent/test/integration/analyze_db.test.ts`
- Modify: `agent/test/server.test.ts`
- Create: `agent/test/llm_config.test.ts`
- Create: `agent/test/agent_tools.test.ts`

- [ ] **Step 1: Install the agent loop dependencies**

Run: `cd agent && npm install @mariozechner/pi-agent-core @mariozechner/pi-ai @sinclair/typebox dotenv`

Expected: `package.json` and `package-lock.json` update cleanly.

- [ ] **Step 2: Write the failing provider-config tests**

```typescript
test("parseLlmConfig reads provider-qualified model refs", async () => {
  const config = parseLlmConfig({
    LLM_MODEL: "ollama/llama3.1:8b",
  });

  assert.equal(config.primary.provider, "ollama");
  assert.equal(config.primary.model, "llama3.1:8b");
});

test("parseLlmConfig rejects an unqualified model ref", async () => {
  assert.throws(() => parseLlmConfig({ LLM_MODEL: "claude-sonnet" } as any), /provider\/model/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd agent && npm test -- --test-name-pattern "parseLlmConfig"`

Expected: FAIL because `llm_config.ts` does not exist yet.

- [ ] **Step 4: Write minimal provider-config implementation**

```typescript
export function parseQualifiedModelRef(value: string) {
  const [provider, ...modelParts] = value.split("/");
  if (!provider || modelParts.length === 0) {
    throw new Error("LLM_MODEL must use provider/model format");
  }
  return { provider, model: modelParts.join("/") };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd agent && npm test -- --test-name-pattern "parseLlmConfig"`

Expected: PASS

- [ ] **Step 6: Write the failing agent-tools tests**

```typescript
test("buildAgentTools exposes memory search and memory record tools", async () => {
  const tools = buildAgentTools({
    memoryTool: {
      search: async () => [],
      record: async () => {},
    },
    clickhouseTool: {
      listTables: async () => ["query_events"],
      describeTable: async () => "fingerprint\tString",
      executeQuery: async () => "fingerprint\tabc",
    },
  } as any);

  assert.equal(tools.some((tool) => tool.name === "search_memory"), true);
  assert.equal(tools.some((tool) => tool.name === "record_memory"), true);
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `cd agent && npm test -- --test-name-pattern "buildAgentTools exposes memory search"`

Expected: FAIL because `agent_tools.ts` does not exist yet.

- [ ] **Step 8: Write minimal agent-tools implementation**

```typescript
{
  name: "search_memory",
  description: "Search prior discoveries, preferences, constraints, and failed attempts.",
  parameters: Type.Object({ query: Type.String() }),
  execute: async (_id, { query }) => textResult(JSON.stringify(await deps.memoryTool.search(query))),
},
{
  name: "record_memory",
  description: "Record a durable lesson, preference, discovery, or failed attempt.",
  parameters: Type.Object({
    kind: Type.Union([
      Type.Literal("preference"),
      Type.Literal("constraint"),
      Type.Literal("discovery"),
      Type.Literal("failed_attempt"),
    ]),
    summary: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
  execute: async (_id, params) => {
    await deps.memoryTool.record(params);
    return textResult("Memory recorded.");
  },
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd agent && npm test -- --test-name-pattern "buildAgentTools exposes memory search"`

Expected: PASS

- [ ] **Step 10: Write the failing executor bridge tests**

```typescript
test("executor bridges pi-agent-core events into working and completed task events", async () => {
  const events: Array<unknown> = [];
  const executor = new DBSpecialistExecutor(mockDeps, {
    createAgent: () => ({
      subscribe(handler: (event: any) => void) {
        handler({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "thinking" } });
        return () => {};
      },
      prompt: async () => {},
      waitForIdle: async () => {},
    }),
  });

  await executor.execute({ userMessage: { text: "users report slow checkout" } } as any, {
    enqueueEvent(event: unknown) {
      events.push(event);
    },
  } as any);

  assert.equal(events.some((event) => JSON.stringify(event).includes("working")), true);
  assert.equal(events.some((event) => JSON.stringify(event).includes("completed")), true);
});
```

- [ ] **Step 11: Run test to verify it fails**

Run: `cd agent && npm test -- --test-name-pattern "bridges pi-agent-core events"`

Expected: FAIL because the executor still runs the deterministic path.

- [ ] **Step 12: Write minimal executor implementation**

The loop should:

- create a `pi-agent-core` agent with provider-qualified model resolution
- expose ClickHouse, code search, explain, demo-repo, GitHub, and memory tools
- consult memory during exploration and planning
- write memory only for durable lessons, preferences, constraints, discoveries, or failed attempts
- avoid treating memory as the routine sink for every normal finding

- [ ] **Step 13: Run tests to verify they pass**

Run: `cd agent && npm test -- --test-name-pattern "bridges pi-agent-core events|parseLlmConfig|buildAgentTools exposes memory search"`

Expected: PASS

- [ ] **Step 14: Write the failing integration test**

```typescript
test("analyze_db publishes submitted, working, and completed events through the pi-agent-core path", async () => {
  const server = createServer({ executor: buildMockLoopExecutor() });
  const response = await sendAnalyzeDb(server.app, "Users report /todos is slow");
  assert.match(JSON.stringify(response), /completed/);
});
```

- [ ] **Step 15: Run test to verify it fails**

Run: `cd agent && npm test -- test/integration/analyze_db.test.ts`

Expected: FAIL because the integration test still assumes deterministic executor behavior.

- [ ] **Step 16: Write minimal integration updates**

Update the integration test and server test to:

- inject a loop-backed executor
- verify the A2A lifecycle still publishes `submitted`, `working`, and `completed`
- verify the model config defaults to a provider-qualified ref
- verify memory can be searched and recorded through tool wiring with mocks

- [ ] **Step 17: Run all agent tests to verify they pass**

Run: `cd agent && npm test`

Expected: PASS

- [ ] **Step 18: Commit**

```bash
git add agent/src/agent_tools.ts agent/src/llm_config.ts agent/src/executor.ts \
  agent/src/runtime_dependencies.ts agent/src/server.ts agent/package.json agent/package-lock.json \
  agent/test/executor.test.ts agent/test/integration/analyze_db.test.ts \
  agent/test/server.test.ts agent/test/llm_config.test.ts agent/test/agent_tools.test.ts
git commit -m "feat: wire pi-agent-core loop with provider-agnostic model config"
```

### Task 6: End-To-End Smoke Test

**Files:**
- Modify only if the smoke test exposes a real defect

- [ ] **Step 1: Start the stack**

Run: `docker compose up -d`

Expected: Postgres, ClickHouse, collector, and supporting services are healthy.

- [ ] **Step 2: Generate query traffic**

Run: `ruby load/harness.rb`

Expected: the load harness exercises the demo endpoints and leaves fresh rows in ClickHouse.

- [ ] **Step 3: Start the agent**

Run: `cd agent && npm start`

Expected: the server starts with the configured `LLM_MODEL` and advertises the same A2A endpoints as Phase 1.

- [ ] **Step 4: Send the live request**

Run:

```bash
curl -sS -X POST http://127.0.0.1:3001/a2a/jsonrpc \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"kind":"message","messageId":"task-6-smoke","role":"user","parts":[{"kind":"text","text":"Users are reporting the /todos endpoint is slow. Please investigate and fix if possible."}]}}}'
```

Expected: a submitted task, working updates, and a completed result that reflects the loop path rather than the deterministic executor. If a fix attempt fails or the caller supplies an architectural constraint, the agent records that durable lesson to memory.

- [ ] **Step 5: Run the full verification suite**

Run: `cd agent && npm test`

Run: `cd /home/bjw/checkpoint && python3 -m pytest tests/ -v`

Run: `cd collector && bundle exec ruby -Itest test/collector_test.rb test/query_comment_parser_test.rb test/clickhouse_connection_test.rb`

Expected: PASS

- [ ] **Step 6: Commit any smoke-driven fixes**

```bash
git add <only the files changed to fix real smoke-test defects>
git commit -m "fix: address phase 2 smoke test defects"
```

## Self-Review

- Spec coverage: the addendum decisions are all represented here.
  - no ClickHouse compatibility layer
  - no required Anthropic-only config
  - hybrid markdown-plus-JSONL memory in the main path
  - no memory checkpoint task
- Placeholder scan: no `TODO`, `TBD`, or implicit “figure it out later” tasks remain in the critical path.
- Type consistency: the plan uses `LLM_MODEL`, `search_memory`, `record_memory`, `listTables`, `describeTable`, and `executeQuery` consistently across tasks.
