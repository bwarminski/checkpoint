# DB Specialist Agent Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deterministic Phase 1 executor path with a `pi-agent-core` loop while keeping Phase 2 narrow: clean local config, collect `rows_examined`, expose ClickHouse discovery/query tools, preserve the existing SQL-backed memory path until a real checkpoint proves otherwise, and finish with a live smoke test.

**Architecture:** The A2A server remains the entrypoint, but `DBSpecialistExecutor` becomes a thin bridge around a `pi-agent-core` agent. The LLM interacts through focused agent tools built over the existing ClickHouse, code search, explain, memory, demo-repo, and GitHub boundaries. Model selection is provider-agnostic through `LLM_MODEL`, not Anthropic-specific env wiring.

**Tech Stack:** TypeScript, `@a2a-js/sdk`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, Ruby collector, ClickHouse, Postgres, pytest, Node test runner

---

## File Structure

- `agent/src/server.ts`
  Loads repo-root `.env` and keeps the A2A transport stable while the executor changes underneath.
- `agent/src/runtime_dependencies.ts`
  Builds the default runtime tools and resolves the selected model/provider.
- `agent/src/executor.ts`
  Bridges A2A task lifecycle events to the `pi-agent-core` agent session.
- `agent/src/agent_tools.ts`
  New file. Defines the `pi-agent-core` tool wrappers over existing runtime dependencies.
- `agent/src/llm_config.ts`
  New file. Parses `LLM_MODEL`, optional fallback models, and provider-specific credential expectations.
- `agent/src/tools/clickhouse_tool.ts`
  Moves from ranked-offender helper to discovery/query surface for the LLM.
- `agent/src/tools/memory_tool.ts`
  Keeps the SQL-backed storage path, expands only where the agent loop needs richer reads/writes.
- `agent/test/*.test.ts`
  Unit coverage for config, ClickHouse, memory, executor bridge, and tool wrappers.
- `agent/test/integration/*.test.ts`
  Mocked integration coverage for A2A-to-agent-loop behavior without real network calls.
- `collector/lib/collector.rb`
  Adds `rows` capture from `pg_stat_statements`.
- `collector/db/clickhouse/*.sql`
  Adds `rows_examined` and `mean_rows_examined` to the ClickHouse write/read model.
- `tests/conftest.py`
  New file. Loads `.env` for pytest using stdlib code.
- `collector/test/support/env.rb`
  New file. Loads `.env` for collector tests.
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
  const commands: Array<string> = [];
  const tool = new DemoRepoTool(
    {
      exec: async (args, cwd) => {
        commands.push(`${cwd}: ${args.join(" ")}`);
        return "";
      },
    },
    {
      env: { DEMO_BASE_REF: "main" },
    },
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

// inside applyFix()
const root = this.env.DEMO_APP_ROOT ?? defaultDemoAppRoot();
if (!(await pathExists(root))) {
  throw new Error(`DemoRepoTool: demo app not found at ${root}. Set DEMO_APP_ROOT to override.`);
}
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
// agent/src/server.ts
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

loadDotenv({
  path: resolve(fileURLToPath(new URL(".", import.meta.url)), "../../.env"),
  override: false,
});
```

```python
# tests/conftest.py
# ABOUTME: Loads repo-root .env for pytest without adding a Python dependency manager.
# ABOUTME: Preserves existing shell variables and fills only missing values from .env.
import os
from pathlib import Path

for line in (Path(__file__).resolve().parents[1] / ".env").read_text().splitlines():
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        continue
    key, value = stripped.split("=", 1)
    os.environ.setdefault(key, value)
```

```ruby
# collector/test/support/env.rb
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
# add to the top of each collector test file
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

# Optional comma-separated fallbacks
# LLM_FALLBACK_MODELS=ollama/llama3.1:8b,anthropic/claude-sonnet-4-20250514
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

### Task 2: Collector Rows Examined Support

**Files:**
- Modify: `collector/lib/collector.rb`
- Modify: `collector/db/clickhouse/001_query_events.sql`
- Modify: `collector/db/clickhouse/002_query_fingerprints.sql`
- Modify: `collector/db/clickhouse/003_top_offenders_mv.sql`
- Modify: `collector/test/collector_test.rb`
- Modify: `collector/test/sql/clickhouse_schema_test.rb`

- [ ] **Step 1: Write the failing collector test**

```ruby
def test_run_once_captures_rows_examined_metrics
  stats_connection = Object.new
  def stats_connection.exec(_sql)
    [{
      "queryid" => "123",
      "calls" => "10",
      "mean_exec_time" => "15.5",
      "rows" => "2500"
    }]
  end

  collector = Collector.new(
    stats_connection: stats_connection,
    sample_query_lookup: nil,
    clock: -> { Time.utc(2026, 4, 5, 12, 0, 0) }
  )

  row = collector.run_once.first

  assert_equal 2500, row[:rows_examined]
  assert_in_delta 250.0, row[:mean_rows_examined], 0.001
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd collector && bundle exec ruby -Itest test/collector_test.rb`

Expected: FAIL because the collector does not read the `rows` column yet.

- [ ] **Step 3: Write minimal implementation**

```ruby
STATS_SQL = "SELECT queryid, calls, mean_exec_time, rows FROM pg_stat_statements".freeze

# inside build_row
rows_examined = stats_row.fetch("rows", 0).to_i
calls = stats_row.fetch("calls").to_i

{
  # existing keys...
  total_exec_count: calls,
  mean_exec_time_ms: stats_row.fetch("mean_exec_time").to_f,
  rows_examined: rows_examined,
  mean_rows_examined: calls.zero? ? 0.0 : rows_examined.to_f / calls
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd collector && bundle exec ruby -Itest test/collector_test.rb`

Expected: PASS

- [ ] **Step 5: Write the failing schema test**

```ruby
def test_query_events_schema_tracks_rows_examined
  sql = File.read(File.expand_path("../db/clickhouse/001_query_events.sql", __dir__))

  assert_match(/rows_examined\s+UInt64/, sql)
  assert_match(/mean_rows_examined\s+Float64/, sql)
end
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd collector && bundle exec ruby -Itest test/sql/clickhouse_schema_test.rb`

Expected: FAIL because the DDLs do not contain the new columns yet.

- [ ] **Step 7: Write minimal implementation**

```sql
rows_examined UInt64,
mean_rows_examined Float64,
rows_examined_state AggregateFunction(sum, UInt64),
mean_rows_examined_state AggregateFunction(avg, Float64)
```

```sql
sumState(rows_examined) AS rows_examined_state,
avgState(mean_rows_examined) AS mean_rows_examined_state
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd collector && bundle exec ruby -Itest test/collector_test.rb test/sql/clickhouse_schema_test.rb`

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add collector/lib/collector.rb collector/db/clickhouse/001_query_events.sql \
  collector/db/clickhouse/002_query_fingerprints.sql \
  collector/db/clickhouse/003_top_offenders_mv.sql \
  collector/test/collector_test.rb collector/test/sql/clickhouse_schema_test.rb
git commit -m "feat: capture rows examined in collector pipeline"
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

- [ ] **Step 5: Write the failing executor-follow-on test**

```typescript
test("DBSpecialistExecutor no longer depends on topOffenders", async () => {
  const toolCalls: Array<string> = [];
  const executor = new DBSpecialistExecutor({
    clickhouseTool: {
      listTables: async () => ["query_events"],
      describeTable: async () => "fingerprint\tString",
      executeQuery: async (sql: string) => {
        toolCalls.push(sql);
        return "fingerprint\tsource_tag\tsource_file\tsample_query\ttotal_exec_time_ms\tp95_exec_time_ms\trows_examined\tmean_rows_examined\n";
      },
    },
  } as any);

  await executor.execute({ userMessage: { text: "analyze_db" } } as any, {
    enqueueEvent() {},
  } as any);

  assert.equal(toolCalls.length > 0, true);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd agent && npm test -- --test-name-pattern "no longer depends on topOffenders"`

Expected: FAIL because the executor still reads the old method.

- [ ] **Step 7: Write minimal implementation**

```typescript
// executor helper
const rows = await this.deps.clickhouseTool.executeQuery(DEFAULT_TOP_OFFENDERS_SQL);
const findings = parseTopOffenders(rows);
```

Remove the old `topOffenders()` dependency from the executor contract instead of preserving it.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd agent && npm test -- --test-name-pattern "ClickHouseTool|no longer depends on topOffenders"`

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add agent/src/tools/clickhouse_tool.ts agent/test/clickhouse_tool.test.ts \
  agent/src/executor.ts agent/test/executor.test.ts
git commit -m "feat: switch to ClickHouse discovery and query interface"
```

### Task 4: Memory Integration Without Storage Migration

**Files:**
- Modify: `agent/src/tools/memory_tool.ts`
- Modify: `agent/test/memory_tool.test.ts`
- Modify: `agent/src/runtime_dependencies.ts`
- Modify: `agent/src/executor.ts`

- [ ] **Step 1: Write the failing tests for richer memory operations**

```typescript
test("MemoryTool records a finding row", async () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const tool = new MemoryTool({
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return [];
    },
  } as any);

  await tool.recordFinding({
    fingerprint: "fp-1",
    finding_type: "slow_query",
    severity: "high",
    details: { source_tag: "todos#index" },
  });

  assert.match(calls[0]?.sql ?? "", /INSERT INTO findings/i);
});

test("MemoryTool records a pending suggestion row", async () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const tool = new MemoryTool({
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return [];
    },
  } as any);

  await tool.recordSuggestion({
    fingerprint: "fp-1",
    fixType: "add_index",
    status: "pending",
    prUrl: "https://example.test/pr/1",
  });

  assert.match(calls[0]?.sql ?? "", /INSERT INTO suggestions/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd agent && npm test -- --test-name-pattern "records a finding row|records a pending suggestion row"`

Expected: FAIL because `MemoryTool` currently exposes only `shouldSuggest()`.

- [ ] **Step 3: Write minimal implementation**

```typescript
async recordFinding(input: {
  fingerprint: string;
  finding_type: string;
  severity: string;
  details: unknown;
}): Promise<void> {
  await this.db.query(
    "INSERT INTO findings (fingerprint, finding_type, severity, details) VALUES ($1, $2, $3, $4)",
    [input.fingerprint, input.finding_type, input.severity, JSON.stringify(input.details)],
  );
}

async recordSuggestion(input: {
  fingerprint: string;
  fixType: string;
  status: string;
  prUrl?: string;
}): Promise<void> {
  await this.db.query(
    "INSERT INTO suggestions (fingerprint, fix_type, status, pr_url) VALUES ($1, $2, $3, $4)",
    [input.fingerprint, input.fixType, input.status, input.prUrl ?? null],
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd agent && npm test -- --test-name-pattern "records a finding row|records a pending suggestion row"`

Expected: PASS

- [ ] **Step 5: Write the failing executor-memory test**

```typescript
test("executor records findings before opening a PR", async () => {
  const calls: Array<string> = [];
  const executor = new DBSpecialistExecutor({
    clickhouseTool: {
      listTables: async () => ["query_events"],
      describeTable: async () => "fingerprint\tString",
      executeQuery: async () => [
        "fingerprint\tsource_tag\tsource_file\tsample_query\ttotal_exec_time_ms\tp95_exec_time_ms",
        "fp-1\ttodos#index\tapp/controllers/todos_controller.rb:1\tSELECT 1\t5000\t150",
      ].join("\n"),
    },
    codeSearchTool: {
      locate: async () => ({ content: "1: Todo.where(user_id: 7)", source_file: "app/controllers/todos_controller.rb:1" }),
    },
    explainTool: { analyze: async () => ({ validated: true }) },
    memoryTool: {
      shouldSuggest: async () => true,
      recordFinding: async () => { calls.push("recordFinding"); },
      recordSuggestion: async () => { calls.push("recordSuggestion"); },
    },
    demoRepoTool: { applyFix: async () => ({ branchName: "agent/demo-fix-fp-1", diff: "diff" }) },
    githubTool: { openPullRequest: async () => ({ url: "https://example.test/pr/1" }) },
  } as any);

  await executor.execute({ userMessage: { text: "analyze_db" } } as any, { enqueueEvent() {} } as any);

  assert.deepEqual(calls, ["recordFinding", "recordSuggestion"]);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd agent && npm test -- --test-name-pattern "records findings before opening a PR"`

Expected: FAIL because the executor does not persist through memory yet.

- [ ] **Step 7: Write minimal implementation**

```typescript
await this.deps.memoryTool?.recordFinding({
  fingerprint: finding.fingerprint,
  finding_type: "slow_query",
  severity: String(finding.severity ?? "unknown"),
  details: { source_tag: finding.source_tag, source_file: finding.source_file },
});

if (pr?.url) {
  await this.deps.memoryTool?.recordSuggestion({
    fingerprint: finding.fingerprint,
    fixType: fix.fix_type,
    status: "pending",
    prUrl: pr.url,
  });
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd agent && npm test -- --test-name-pattern "MemoryTool|records findings before opening a PR"`

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add agent/src/tools/memory_tool.ts agent/test/memory_tool.test.ts \
  agent/src/runtime_dependencies.ts agent/src/executor.ts
git commit -m "feat: persist agent memory through existing SQL store"
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
    LLM_FALLBACK_MODELS: "openai/gpt-4o-mini,anthropic/claude-sonnet-4-20250514",
  });

  assert.equal(config.primary.provider, "ollama");
  assert.equal(config.primary.model, "llama3.1:8b");
  assert.deepEqual(config.fallbacks.map((entry) => entry.provider), ["openai", "anthropic"]);
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
export type QualifiedModelRef = { provider: string; model: string };

export function parseQualifiedModelRef(value: string): QualifiedModelRef {
  const [provider, ...modelParts] = value.split("/");
  if (!provider || modelParts.length === 0) {
    throw new Error("LLM_MODEL must use provider/model format");
  }

  return { provider, model: modelParts.join("/") };
}
```

```typescript
import { getModel } from "@mariozechner/pi-ai";

export function resolvePrimaryModel(env: NodeJS.ProcessEnv) {
  const primary = parseQualifiedModelRef(env.LLM_MODEL ?? "ollama/llama3.1:8b");
  return {
    ref: primary,
    model: getModel(primary.provider, primary.model),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd agent && npm test -- --test-name-pattern "parseLlmConfig"`

Expected: PASS

- [ ] **Step 6: Write the failing agent-tools tests**

```typescript
test("buildAgentTools exposes list_tables and query_database", async () => {
  const tools = buildAgentTools({
    clickhouseTool: {
      listTables: async () => ["query_events"],
      describeTable: async () => "fingerprint\tString",
      executeQuery: async () => "fingerprint\tabc",
    },
  } as any);

  assert.deepEqual(tools.map((tool) => tool.name).slice(0, 3), [
    "list_tables",
    "describe_table",
    "query_database",
  ]);
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `cd agent && npm test -- --test-name-pattern "buildAgentTools exposes"`

Expected: FAIL because `agent_tools.ts` does not exist yet.

- [ ] **Step 8: Write minimal agent-tools implementation**

```typescript
export function buildAgentTools(deps: RuntimeDeps): AgentTool[] {
  return [
    {
      name: "list_tables",
      description: "List available ClickHouse tables.",
      parameters: Type.Object({}),
      execute: async () => textResult((await deps.clickhouseTool.listTables()).join("\n")),
    },
    {
      name: "describe_table",
      description: "Describe the schema for one ClickHouse table.",
      parameters: Type.Object({ table: Type.String() }),
      execute: async (_id, { table }) => textResult(await deps.clickhouseTool.describeTable(table)),
    },
    {
      name: "query_database",
      description: "Run a SELECT query against ClickHouse.",
      parameters: Type.Object({ sql: Type.String() }),
      execute: async (_id, { sql }) => textResult(await deps.clickhouseTool.executeQuery(sql)),
    },
  ];
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd agent && npm test -- --test-name-pattern "buildAgentTools exposes"`

Expected: PASS

- [ ] **Step 10: Write the failing executor bridge tests**

```typescript
test("executor bridges pi-agent-core events into working and completed task events", async () => {
  const events: Array<unknown> = [];
  const executor = new DBSpecialistExecutor(mockDeps, {
    createAgent: () => ({
      subscribe(handler: (event: any) => void) {
        handler({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "thinking" } });
        handler({ type: "agent_end", messages: [] });
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

```typescript
const agent = this.agentFactory.createAgent({
  initialState: {
    systemPrompt: DB_SPECIALIST_SYSTEM_PROMPT,
    model: this.deps.modelConfig.primary.model,
    tools: buildAgentTools(this.deps),
  },
});

agent.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    this.publishWorking(requestContext, eventSink, event.assistantMessageEvent.delta);
  }
});

await agent.prompt(userText ?? "Analyze the database for performance issues.");
await agent.waitForIdle();
```

- [ ] **Step 13: Run tests to verify they pass**

Run: `cd agent && npm test -- --test-name-pattern "bridges pi-agent-core events|parseLlmConfig|buildAgentTools exposes"`

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
- skip any live eval that needs external credentials unless the selected provider env is present

- [ ] **Step 17: Run all agent tests to verify they pass**

Run: `cd agent && npm test`

Expected: PASS

- [ ] **Step 18: Commit**

```bash
git add agent/src/agent_tools.ts agent/src/llm_config.ts agent/src/executor.ts \
  agent/src/runtime_dependencies.ts agent/src/server.ts agent/package.json \
  agent/package-lock.json agent/test/executor.test.ts \
  agent/test/integration/analyze_db.test.ts agent/test/server.test.ts \
  agent/test/llm_config.test.ts agent/test/agent_tools.test.ts
git commit -m "feat: wire pi-agent-core loop with provider-agnostic model config"
```

### Task 6: Memory Usefulness Checkpoint

**Files:**
- Modify: `agent/test/integration/analyze_db.test.ts`
- Create: `agent/test/eval/memory_loop_checkpoint.test.ts`
- Modify: `JOURNAL.md`

- [ ] **Step 1: Write the failing checkpoint test**

```typescript
test("the stabilized agent loop suppresses a duplicate PR on the second pass", async () => {
  const opened: Array<string> = [];
  const memory = createInMemorySqlStyleMemory();
  const executor = buildLoopExecutor({ memory, onPrOpen: (url: string) => opened.push(url) });

  await runAnalyzeDb(executor, "Users report /todos is slow");
  await runAnalyzeDb(executor, "Users report /todos is slow");

  assert.equal(opened.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent && npm test -- test/eval/memory_loop_checkpoint.test.ts`

Expected: FAIL until the loop consistently records and consults memory in the same path.

- [ ] **Step 3: Make the smallest implementation needed**

Only implement the missing glue needed for the loop to:

- record the first finding and pending suggestion
- consult `shouldSuggest()` before a second PR attempt
- leave the storage backend unchanged

Do not migrate away from SQL-backed memory in this task.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent && npm test -- test/eval/memory_loop_checkpoint.test.ts`

Expected: PASS

- [ ] **Step 5: Record the checkpoint result**

Add a `JOURNAL.md` entry stating whether the SQL-backed memory path was sufficient in the stabilized loop or whether a follow-on migration should be planned.

- [ ] **Step 6: Commit**

```bash
git add agent/test/integration/analyze_db.test.ts agent/test/eval/memory_loop_checkpoint.test.ts JOURNAL.md
git commit -m "test: prove memory suppression through the loop"
```

### Task 7: End-To-End Smoke Test

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
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"role":"user","parts":[{"kind":"text","text":"Users are reporting the /todos endpoint is slow. Please investigate and fix if possible."}]}}}'
```

Expected: a submitted task, working updates, and a completed result that reflects the loop path rather than the deterministic executor.

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
  - no JSONL memory migration in the main path
  - explicit memory checkpoint after the loop stabilizes
- Placeholder scan: no `TODO`, `TBD`, or implicit “figure it out later” tasks remain in the critical path.
- Type consistency: the plan uses `LLM_MODEL`, `recordFinding`, `recordSuggestion`, `listTables`, `describeTable`, and `executeQuery` consistently across tasks.
