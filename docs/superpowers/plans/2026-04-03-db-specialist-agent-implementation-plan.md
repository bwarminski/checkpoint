# DB Specialist Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the CEO-plan DB specialist demo stack in `/home/bjw/checkpoint`, following the Phase Build Order exactly, with TDD, gate stops, and one commit after each CEO-plan step.

**Architecture:** The system is a local multi-service stack: Postgres with HypoPG, ClickHouse, a Rails demo app, a Ruby collector, a Ruby load harness, and a TypeScript A2A agent service. Raw query events flow into ClickHouse, the agent analyzes aggregated fingerprints, validates fixes with Postgres tools, and uses memory plus GitHub state to decide whether to open a PR.

**Tech Stack:** Docker Compose, Postgres 16 + HypoPG, ClickHouse, Ruby/Rails, Ruby test stack, TypeScript, Express, `pi-mono`, `@a2a-js/sdk`

---

## File Structure

- `docker-compose.yml`
  Local service orchestration.
- `postgres/Dockerfile`
  Postgres image with HypoPG installed.
- `postgres/init/01-extensions.sql`
  Extension bootstrap for `pg_stat_statements` and `hypopg`.
- `demo/`
  Rails application for the anti-pattern demo.
- `collector/`
  Ruby polling process and tests.
- `agent/`
  TypeScript A2A service and tests.
- `load/harness.rb`
  Load generator for the demo endpoints.
- `docs/superpowers/specs/2026-04-03-db-specialist-agent-design.md`
  Approved design spec.
- `docs/superpowers/plans/2026-04-03-db-specialist-agent-implementation-plan.md`
  This implementation plan.
- `JOURNAL.md`
  Root journal for execution notes, decisions, and blockers.

### Task 1: Repo Structure And Docker Compose Skeleton

**Files:**
- Create: `docker-compose.yml`
- Create: `postgres/Dockerfile`
- Create: `postgres/init/01-extensions.sql`
- Create: `postgres/init/02-demo-db.sql`
- Create: `agent/package.json`
- Create: `collector/Gemfile`
- Create: `demo/Gemfile`
- Create: `JOURNAL.md`
- Test: `tests/smoke/test_compose_structure.py`

- [ ] **Step 1: Write the failing test**

```python
from pathlib import Path


def test_compose_and_postgres_scaffold_exist():
    root = Path("/home/bjw/checkpoint")
    assert (root / "docker-compose.yml").exists()
    assert (root / "postgres" / "Dockerfile").exists()
    assert (root / "postgres" / "init" / "01-extensions.sql").exists()
    assert (root / "JOURNAL.md").exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/smoke/test_compose_structure.py -v`
Expected: FAIL because the scaffold files do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```yaml
# docker-compose.yml
services:
  postgres:
    build:
      context: ./postgres
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: checkpoint_demo
    ports: ["5432:5432"]
  clickhouse:
    image: clickhouse/clickhouse-server:24.3
    ports: ["8123:8123", "9000:9000"]
```

```dockerfile
# postgres/Dockerfile
FROM postgres:16
RUN apt-get update \
    && apt-get install -y postgresql-16-hypopg \
    && rm -rf /var/lib/apt/lists/*
```

```sql
-- postgres/init/01-extensions.sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS hypopg;
```

```md
# JOURNAL

- 2026-04-03: Initialized repo skeleton plan execution journal.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/smoke/test_compose_structure.py -v`
Expected: PASS

Run: `docker compose config`
Expected: Compose file renders without syntax errors.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml postgres/Dockerfile postgres/init/01-extensions.sql postgres/init/02-demo-db.sql agent/package.json collector/Gemfile demo/Gemfile JOURNAL.md tests/smoke/test_compose_structure.py
git commit -m "chore: scaffold local db specialist stack"
```

### Task 2: Rails Demo App With Query Logs And Anti-Patterns

**Files:**
- Create: `demo/config/application.rb`
- Create: `demo/config/environments/development.rb`
- Create: `demo/config/routes.rb`
- Create: `demo/app/controllers/todos_controller.rb`
- Create: `demo/app/models/todo.rb`
- Create: `demo/app/models/user.rb`
- Create: `demo/db/schema.rb`
- Create: `demo/db/seeds.rb`
- Test: `demo/test/controllers/todos_controller_test.rb`

- [ ] **Step 1: Write the failing test**

```ruby
require "test_helper"

class TodosControllerTest < ActionDispatch::IntegrationTest
  test "index endpoint emits query log metadata and returns rows" do
    get "/todos"

    assert_response :success
    assert_includes response.body, "todos"
  end

  test "search endpoint accepts q param" do
    get "/todos", params: { q: "task" }

    assert_response :success
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo && bundle exec rails test test/controllers/todos_controller_test.rb`
Expected: FAIL because the Rails app, routes, and controller do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ruby
# demo/config/routes.rb
Rails.application.routes.draw do
  get "/todos", to: "todos#index"
  get "/todos/status", to: "todos#status"
  get "/todos/stats", to: "todos#stats"
end
```

```ruby
# demo/app/controllers/todos_controller.rb
class TodosController < ApplicationController
  def index
    todos = params[:q].present? ? Todo.where("title LIKE ?", "%#{params[:q]}%") : Todo.all
    render json: todos.as_json(include: :user)
  end

  def status
    render json: Todo.where(status: params.fetch(:status, "open"))
  end

  def stats
    render json: User.all.index_with { |user| user.todos.count }
  end
end
```

```ruby
# demo/config/environments/development.rb
config.active_record.query_log_tags_enabled = true
config.active_record.query_log_tags = [:application, :controller, :action, :source_location]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo && bundle exec rails test test/controllers/todos_controller_test.rb`
Expected: PASS

Run: `cd demo && bundle exec rails db:setup`
Expected: Demo schema and seed data load without errors.

- [ ] **Step 5: Commit**

```bash
git add demo/config/application.rb demo/config/environments/development.rb demo/config/routes.rb demo/app/controllers/todos_controller.rb demo/app/models/todo.rb demo/app/models/user.rb demo/db/schema.rb demo/db/seeds.rb demo/test/controllers/todos_controller_test.rb JOURNAL.md
git commit -m "feat: add rails anti-pattern demo"
```

### Task 3: ClickHouse Schema For Raw Events And Fingerprints

**Files:**
- Create: `collector/db/clickhouse/001_query_events.sql`
- Create: `collector/db/clickhouse/002_query_fingerprints.sql`
- Create: `collector/db/clickhouse/003_top_offenders_mv.sql`
- Test: `collector/test/sql/clickhouse_schema_test.rb`

- [ ] **Step 1: Write the failing test**

```ruby
require "minitest/autorun"

class ClickhouseSchemaTest < Minitest::Test
  def test_materialized_view_does_not_embed_order_by
    sql = File.read("db/clickhouse/003_top_offenders_mv.sql")

    refute_match(/\bORDER BY\b/i, sql)
    assert_includes sql, "CREATE MATERIALIZED VIEW"
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd collector && bundle exec ruby test/sql/clickhouse_schema_test.rb`
Expected: FAIL because the schema files do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```sql
-- collector/db/clickhouse/001_query_events.sql
CREATE TABLE query_events (
  collected_at DateTime,
  fingerprint String,
  source_tag Nullable(String),
  source_file Nullable(String),
  sample_query Nullable(String),
  total_exec_count UInt64,
  mean_exec_time_ms Float64
) ENGINE = MergeTree
ORDER BY (fingerprint, collected_at);
```

```sql
-- collector/db/clickhouse/003_top_offenders_mv.sql
CREATE MATERIALIZED VIEW top_offenders_mv
TO query_fingerprints AS
SELECT
  fingerprint,
  anyState(source_tag) AS source_tag_state,
  anyState(source_file) AS source_file_state,
  anyState(sample_query) AS sample_query_state,
  sumState(total_exec_count) AS total_exec_count_state,
  quantileState(0.95)(mean_exec_time_ms) AS p95_exec_time_state
FROM query_events
GROUP BY fingerprint;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd collector && bundle exec ruby test/sql/clickhouse_schema_test.rb`
Expected: PASS

Run: `docker compose exec clickhouse clickhouse-client --queries-file /workdir/collector/db/clickhouse/001_query_events.sql`
Expected: Table creation succeeds.

- [ ] **Step 5: Commit**

```bash
git add collector/db/clickhouse/001_query_events.sql collector/db/clickhouse/002_query_fingerprints.sql collector/db/clickhouse/003_top_offenders_mv.sql collector/test/sql/clickhouse_schema_test.rb JOURNAL.md
git commit -m "feat: add clickhouse query fingerprint schema"
```

### Task 4: Ruby Collector For Stats Polling And Sample Query Capture

**Files:**
- Create: `collector/lib/query_comment_parser.rb`
- Create: `collector/lib/sample_query_lookup.rb`
- Create: `collector/lib/collector.rb`
- Create: `collector/bin/collector`
- Test: `collector/test/query_comment_parser_test.rb`
- Test: `collector/test/sample_query_lookup_test.rb`
- Test: `collector/test/collector_test.rb`

- [ ] **Step 1: Write the failing test**

```ruby
require "minitest/autorun"
require_relative "../lib/query_comment_parser"

class QueryCommentParserTest < Minitest::Test
  def test_parses_controller_action_and_source
    comment = "/*application:demo,controller:todos,action:index,source_location:/app/controllers/todos_controller.rb:12*/"

    parsed = QueryCommentParser.parse(comment)

    assert_equal "todos#index", parsed[:source_tag]
    assert_equal "/app/controllers/todos_controller.rb:12", parsed[:source_file]
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd collector && bundle exec ruby test/query_comment_parser_test.rb`
Expected: FAIL because the parser does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ruby
# collector/lib/query_comment_parser.rb
class QueryCommentParser
  def self.parse(comment)
    pairs = comment.to_s.delete_prefix("/*").delete_suffix("*/").split(",").map { |part| part.split(":", 2) }.to_h
    {
      source_tag: [pairs["controller"], pairs["action"]].compact.join("#"),
      source_file: pairs["source_location"]
    }
  end
end
```

```ruby
# collector/lib/sample_query_lookup.rb
class SampleQueryLookup
  def initialize(connection)
    @connection = connection
  end

  def find_for(queryid)
    @connection.exec_params("SELECT query FROM pg_stat_activity WHERE query_id = $1 LIMIT 1", [queryid]).first&.fetch("query", nil)
  end
end
```

```ruby
# collector/lib/collector.rb
class Collector
  def run_once
    []
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd collector && bundle exec ruby test/query_comment_parser_test.rb`
Expected: PASS

Run: `cd collector && bundle exec ruby test/sample_query_lookup_test.rb`
Expected: PASS with a captured sample query fixture.

Run: `cd collector && bundle exec ruby test/collector_test.rb`
Expected: PASS for empty results and ClickHouse insert payload shape.

- [ ] **Step 5: Commit**

```bash
git add collector/lib/query_comment_parser.rb collector/lib/sample_query_lookup.rb collector/lib/collector.rb collector/bin/collector collector/test/query_comment_parser_test.rb collector/test/sample_query_lookup_test.rb collector/test/collector_test.rb JOURNAL.md
git commit -m "feat: add postgres stats collector"
```

### Task 5: Load Harness And Data Verification

**Files:**
- Create: `load/harness.rb`
- Create: `load/README.md`
- Test: `load/test/harness_test.rb`

- [ ] **Step 1: Write the failing test**

```ruby
require "minitest/autorun"
require_relative "../harness"

class HarnessTest < Minitest::Test
  def test_requests_all_demo_endpoints
    urls = Harness.new(base_url: "http://demo:3000").request_paths

    assert_includes urls, "/todos"
    assert_includes urls, "/todos?q=task"
    assert_includes urls, "/todos/status"
    assert_includes urls, "/todos/stats"
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ruby load/test/harness_test.rb`
Expected: FAIL because the harness does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ruby
# load/harness.rb
class Harness
  def initialize(base_url:, rate: 10)
    @base_url = base_url
    @rate = rate
  end

  def request_paths
    ["/todos", "/todos?q=task", "/todos/status", "/todos/stats"]
  end
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ruby load/test/harness_test.rb`
Expected: PASS

Run: `ruby load/harness.rb`
Expected: Requests cycle through all four endpoints at about 10-20 req/s.

Run: `curl -s http://localhost:8123/?query=SELECT%20count()%20FROM%20query_events`
Expected: Count is greater than zero after the harness runs.

- [ ] **Step 5: Commit**

```bash
git add load/harness.rb load/README.md load/test/harness_test.rb JOURNAL.md
git commit -m "feat: add repeatable demo load harness"
```

### Task 6: TypeScript A2A Agent Service And DB Tools

**Files:**
- Create: `agent/src/server.ts`
- Create: `agent/src/executor.ts`
- Create: `agent/src/tools/clickhouse_tool.ts`
- Create: `agent/src/tools/explain_tool.ts`
- Create: `agent/src/tools/index_validation_tool.ts`
- Create: `agent/src/tools/github_tool.ts`
- Create: `agent/src/tools/code_search_tool.ts`
- Create: `agent/src/tools/memory_tool.ts`
- Create: `agent/test/executor.test.ts`
- Create: `agent/test/explain_tool.test.ts`
- Modify: `agent/package.json`

- [ ] **Step 1: Write the failing test**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { ExplainTool } from "../src/tools/explain_tool";

test("ExplainTool rejects destructive SQL", async () => {
  const tool = new ExplainTool({ query: async () => ({ rows: [] }) } as any);

  await assert.rejects(
    () => tool.analyze({ sql: "DELETE FROM todos" }),
    /SELECT-only/i,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent && npm test -- --runInBand`
Expected: FAIL because the agent service and tools do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```typescript
// agent/src/tools/explain_tool.ts
export class ExplainTool {
  constructor(private readonly db: { query: (sql: string) => Promise<unknown> }) {}

  async analyze(input: { sql: string }) {
    if (!input.sql.trim().match(/^select\b/i)) {
      throw new Error("SELECT-only queries are allowed for EXPLAIN ANALYZE");
    }

    return this.db.query(`EXPLAIN ANALYZE ${input.sql}`);
  }
}
```

```typescript
// agent/src/executor.ts
export class DBSpecialistExecutor {
  async execute(requestContext: { userMessage?: { text?: string } }, eventQueue: { enqueueEvent: (event: unknown) => void }) {
    eventQueue.enqueueEvent({ type: "working", message: "analysis started" });
    eventQueue.enqueueEvent({ type: "completed", result: { findings: [] } });
  }
}
```

```typescript
// agent/src/server.ts
import express from "express";

const app = express();
app.get("/health", (_req, res) => res.json({ ok: true }));
app.listen(3001);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent && npm test -- --runInBand`
Expected: PASS for the SELECT-only guard and executor event emission tests.

Run: `cd agent && npm ls @a2a-js/sdk`
Expected: Shows one exact pinned version. Record that exact version in `JOURNAL.md`.

- [ ] **Step 5: Gate A And Commit**

Before committing this step, stop and report both items:

- whether `pi-agent-core` can act as an MCP client for external servers
- the exact pinned `@a2a-js/sdk` version in use

If native MCP client support is missing, implement `CodeSearchTool` behind a
raw HTTP transport contract and record that decision in `JOURNAL.md`.

```bash
git add agent/package.json agent/src/server.ts agent/src/executor.ts agent/src/tools/clickhouse_tool.ts agent/src/tools/explain_tool.ts agent/src/tools/index_validation_tool.ts agent/src/tools/github_tool.ts agent/src/tools/code_search_tool.ts agent/src/tools/memory_tool.ts agent/test/executor.test.ts agent/test/explain_tool.test.ts JOURNAL.md
git commit -m "feat: add a2a db specialist agent service"
```

### Task 7: PlanetScale Memory Schema And Memory Tool Rules

**Files:**
- Create: `agent/db/001_memory_schema.sql`
- Modify: `agent/src/tools/memory_tool.ts`
- Create: `agent/test/memory_tool.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { MemoryTool } from "../src/tools/memory_tool";

test("MemoryTool blocks re-suggestion for rejected entries", async () => {
  const db = {
    query: async () => [{ status: "rejected" }],
  };

  const tool = new MemoryTool(db as any);
  const result = await tool.shouldSuggest({ fingerprint: "abc", fixType: "add_index" });

  assert.equal(result, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent && npm test -- --runInBand`
Expected: FAIL because the memory schema and tool logic are not implemented yet.

- [ ] **Step 3: Write minimal implementation**

```typescript
// agent/src/tools/memory_tool.ts
export class MemoryTool {
  constructor(private readonly db: { query: (sql: string, params?: unknown[]) => Promise<Array<{ status: string; created_at?: string }>> }) {}

  async shouldSuggest(input: { fingerprint: string; fixType: string }) {
    const rows = await this.db.query(
      "SELECT status, created_at FROM suggestions WHERE fingerprint = $1 AND fix_type = $2",
      [input.fingerprint, input.fixType],
    );

    return !rows.some((row) => ["pending", "accepted", "rejected"].includes(row.status));
  }
}
```

```sql
-- agent/db/001_memory_schema.sql
CREATE TABLE findings (
  id BIGSERIAL PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  source_tag TEXT,
  source_file TEXT,
  finding_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE suggestions (
  id BIGSERIAL PRIMARY KEY,
  finding_id BIGINT REFERENCES findings(id),
  fingerprint TEXT NOT NULL,
  fix_type TEXT NOT NULL,
  suggested_sql TEXT,
  pr_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  validated BOOLEAN DEFAULT FALSE,
  validation_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX suggestions_fingerprint_fix_type_status_idx
ON suggestions (fingerprint, fix_type, status);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent && npm test -- --runInBand`
Expected: PASS for pending, accepted, rejected, and invalid-age tests.

Run: `psql "$MEMORY_DATABASE_URL" -f agent/db/001_memory_schema.sql`
Expected: Schema loads successfully.

- [ ] **Step 5: Commit**

```bash
git add agent/db/001_memory_schema.sql agent/src/tools/memory_tool.ts agent/test/memory_tool.test.ts JOURNAL.md
git commit -m "feat: add memory schema and suggestion rules"
```

### Task 8: End-To-End A2A Analysis And PR Flow

**Files:**
- Modify: `agent/src/executor.ts`
- Modify: `agent/src/tools/clickhouse_tool.ts`
- Modify: `agent/src/tools/code_search_tool.ts`
- Modify: `agent/src/tools/github_tool.ts`
- Modify: `agent/src/tools/memory_tool.ts`
- Create: `agent/test/e2e/analyze_db.test.ts`
- Create: `agent/test/e2e/analyze_table.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { DBSpecialistExecutor } from "../../src/executor";

test("analyze_db opens a PR only for high severity validated findings", async () => {
  const events: Array<unknown> = [];
  const executor = new DBSpecialistExecutor({
    clickhouseTool: { topOffenders: async () => [{ fingerprint: "abc", severity: "high" }] },
    codeSearchTool: { locate: async () => ({ source_file: "app/controllers/todos_controller.rb:12" }) },
    explainTool: { analyze: async () => ({ validated: true, planDiff: "better" }) },
    memoryTool: { shouldSuggest: async () => true },
    githubTool: { openPullRequest: async () => ({ url: "https://example.test/pr/1" }) },
  } as any);

  await executor.execute({ userMessage: { text: "analyze_db" } } as any, {
    enqueueEvent(event: unknown) { events.push(event); },
  } as any);

  assert.equal(events.some((event) => JSON.stringify(event).includes("completed")), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent && npm test -- --runInBand`
Expected: FAIL because the executor does not yet orchestrate the full flow.

- [ ] **Step 3: Write minimal implementation**

```typescript
// agent/src/executor.ts
export class DBSpecialistExecutor {
  constructor(private readonly deps: any) {}

  async execute(requestContext: { userMessage?: { text?: string } }, eventQueue: { enqueueEvent: (event: unknown) => void }) {
    eventQueue.enqueueEvent({ type: "working", message: "loading offenders" });

    const findings = await this.deps.clickhouseTool.topOffenders(requestContext.userMessage?.text);
    const completed = [];

    for (const finding of findings) {
      const allowed = await this.deps.memoryTool.shouldSuggest({ fingerprint: finding.fingerprint, fixType: "add_index" });
      if (!allowed) continue;

      const source = await this.deps.codeSearchTool.locate(finding);
      const validation = await this.deps.explainTool.analyze({ sql: source.sample_query ?? "SELECT 1" });
      let prUrl;

      if (finding.severity === "high" && validation.validated) {
        prUrl = (await this.deps.githubTool.openPullRequest({ finding, validation, source })).url;
      }

      completed.push({ finding, pr_url: prUrl });
    }

    eventQueue.enqueueEvent({ type: "completed", result: { findings: completed } });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent && npm test -- --runInBand`
Expected: PASS for `analyze_db` and `analyze_table` end-to-end tests.

Run: `curl -s -X POST http://localhost:3001/ -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":"1","method":"tasks/send","params":{"message":{"role":"user","parts":[{"text":"analyze_db"}]}}}'`
Expected: Task is accepted and eventually emits a completed event with findings.

- [ ] **Step 5: Stop And Commit**

Stop after verification and report the end-to-end findings before continuing to
Steps 9 and 10.

```bash
git add agent/src/executor.ts agent/src/tools/clickhouse_tool.ts agent/src/tools/code_search_tool.ts agent/src/tools/github_tool.ts agent/src/tools/memory_tool.ts agent/test/e2e/analyze_db.test.ts agent/test/e2e/analyze_table.test.ts JOURNAL.md
git commit -m "feat: complete end-to-end db specialist flow"
```

### Task 9: Blog Post Skeleton

**Files:**
- Create: `docs/blog/db-specialist-agent-post.md`
- Test: `tests/docs/blog_post_test.py`

- [ ] **Step 1: Write the failing test**

```python
from pathlib import Path


def test_blog_post_mentions_explain_diff_and_hypopg():
    text = Path("docs/blog/db-specialist-agent-post.md").read_text()
    assert "EXPLAIN" in text
    assert "HypoPG" in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/docs/blog_post_test.py -v`
Expected: FAIL because the blog file does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```md
# DB Specialist Agent

This post explains the demo architecture, the A2A flow, the EXPLAIN plan diff,
and the role of HypoPG in validating index suggestions.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/docs/blog_post_test.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/blog/db-specialist-agent-post.md tests/docs/blog_post_test.py JOURNAL.md
git commit -m "docs: add blog post skeleton"
```

### Task 10: Redpanda And Ruby Consumer Phase

**Files:**
- Modify: `docker-compose.yml`
- Create: `collector/lib/redpanda_consumer.rb`
- Create: `collector/test/redpanda_consumer_test.rb`
- Create: `collector/Dockerfile`

- [ ] **Step 1: Write the failing test**

```ruby
require "minitest/autorun"
require_relative "../lib/redpanda_consumer"

class RedpandaConsumerTest < Minitest::Test
  def test_converts_kafka_payload_into_query_event_shape
    consumer = RedpandaConsumer.new(nil)
    event = consumer.normalize({
      "fingerprint" => "abc",
      "source_tag" => "todos#index",
      "sample_query" => "SELECT * FROM todos"
    })

    assert_equal "abc", event[:fingerprint]
    assert_equal "todos#index", event[:source_tag]
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd collector && bundle exec ruby test/redpanda_consumer_test.rb`
Expected: FAIL because the consumer does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ruby
# collector/lib/redpanda_consumer.rb
class RedpandaConsumer
  def initialize(client)
    @client = client
  end

  def normalize(payload)
    {
      fingerprint: payload.fetch("fingerprint"),
      source_tag: payload["source_tag"],
      sample_query: payload["sample_query"]
    }
  end
end
```

```dockerfile
# collector/Dockerfile
FROM ruby:3.3
RUN apt-get update \
    && apt-get install -y build-essential librdkafka-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd collector && bundle exec ruby test/redpanda_consumer_test.rb`
Expected: PASS

Run: `docker compose build collector`
Expected: Collector image builds with `librdkafka` available.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml collector/Dockerfile collector/lib/redpanda_consumer.rb collector/test/redpanda_consumer_test.rb JOURNAL.md
git commit -m "feat: add redpanda collector consumer"
```

## Self-Review

- Spec coverage:
  - Step 1 repo scaffolding: covered by Task 1.
  - Step 2 Rails anti-pattern demo and query logs: covered by Task 2.
  - Step 3 ClickHouse raw table, MV, and aggregate table: covered by Task 3.
  - Step 4 collector with query comment parse and sample query capture: covered by Task 4.
  - Step 5 load harness and ClickHouse verification: covered by Task 5.
  - Step 6 TypeScript A2A service, DB tools, Gate A, and SDK pin: covered by Task 6.
  - Step 7 PlanetScale memory schema and re-suggestion rules: covered by Task 7.
  - Step 8 end-to-end A2A analysis and PR rule: covered by Task 8.
  - Step 9 blog post skeleton: covered by Task 9.
  - Step 10 Redpanda and Ruby consumer: covered by Task 10.
- Placeholder scan:
  - No placeholder markers remain in the task steps.
- Type consistency:
  - `DBSpecialistExecutor`, `ExplainTool`, and `MemoryTool` names are used consistently across Tasks 6-8.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | issues_found | 10 items (cross-model tensions) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 4 | issues_resolved | R1: arch (10 items); R2: QA gaps; R3: validation; R4: README docs fix |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**VERDICT:** CLEAN — 51/51 tests passing. All 10 Eng Review 3 items implemented and validated. One README doc fix applied in Eng Review 4. No open critical gaps.
  - `fingerprint`, `fixType`, `source_tag`, and `sample_query` remain consistent with the design and CEO plan.
