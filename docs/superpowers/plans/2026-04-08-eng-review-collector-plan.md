# Collector Eng Review Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unvalidated `source_tag` field, delete the incomplete schema-validation path, remove dead Redpanda scaffolding, and add a real ClickHouse schema smoke test so the split collector stack is shippable.

**Architecture:** The work stays split across the two repos that now own the code: `/home/bjw/checkpoint-collector` owns the collector schema, Ruby ingestion code, and collector compose stack; `/home/bjw/checkpoint` owns the agent, root tools, and the slim smoke-test surface. The plan keeps changes minimal and sequential: first remove `source_tag` from collector-owned data flow, then remove checkpoint consumers of that field, then delete the dead schema-validation code, then strip Redpanda, and only then add the compose-level smoke test that proves the resulting ClickHouse image boots cleanly.

**Tech Stack:** Ruby, Minitest, TypeScript, Node test runner, Docker, Docker Compose, pytest

---

## File Structure

- `/home/bjw/checkpoint-collector/collector/db/clickhouse/001_query_events.sql`
  Raw event table; remove the `source_tag` column.
- `/home/bjw/checkpoint-collector/collector/db/clickhouse/002_query_fingerprints.sql`
  Aggregate table; remove `source_tag` and group only by `fingerprint`.
- `/home/bjw/checkpoint-collector/collector/db/clickhouse/003_top_offenders_mv.sql`
  Materialized view; remove all `source_tag` select and grouping logic.
- `/home/bjw/checkpoint-collector/collector/db/clickhouse/004_reset_query_fingerprints.sql`
  Rebuild script; keep it structurally aligned with `002` and `003`.
- `/home/bjw/checkpoint-collector/collector/lib/collector.rb`
  Shapes inserted rows; stop writing `source_tag`.
- `/home/bjw/checkpoint-collector/collector/lib/query_comment_parser.rb`
  Keep only `source_file` extraction.
- `/home/bjw/checkpoint-collector/collector/lib/redpanda_consumer.rb`
  Delete as dead scaffolding.
- `/home/bjw/checkpoint-collector/docker-compose.yml`
  Collector-owned stack; remove Redpanda service and env wiring.
- `/home/bjw/checkpoint-collector/Dockerfile`
  Collector-owned ClickHouse image; keep only packages that are still needed.
- `/home/bjw/checkpoint-collector/collector/test/collector_test.rb`
  Collector row-shaping tests; remove `source_tag` expectations.
- `/home/bjw/checkpoint-collector/collector/test/query_comment_parser_test.rb`
  Parser tests; keep only `source_file` assertions.
- `/home/bjw/checkpoint-collector/collector/test/sql/clickhouse_schema_test.rb`
  SQL text tests; update them to assert fingerprint-only grouping.
- `/home/bjw/checkpoint/src/tools/clickhouse_tool.ts`
  Remove `source_tag` from queries, result parsing, and schema-contract reads.
- `/home/bjw/checkpoint/src/tools/code_search_tool.ts`
  Require `source_file`; delete `source_tag` fallback lookup.
- `/home/bjw/checkpoint/src/tools/github_tool.ts`
  Remove `source_tag` from PR-body rendering.
- `/home/bjw/checkpoint/src/clickhouse_schema_contract.ts`
  Delete as part of schema-validation removal.
- `/home/bjw/checkpoint/agent/src/agent_tools.ts`
  Remove `source_tag` from input schemas and tool parsing.
- `/home/bjw/checkpoint/agent/src/runtime_dependencies.ts`
  Remove startup schema validation wiring.
- `/home/bjw/checkpoint/agent/src/server.ts`
  Stop calling runtime schema validation before listen.
- `/home/bjw/checkpoint/tests/smoke/test_clickhouse_schema.py`
  New compose-level smoke test that boots ClickHouse and proves the DDL executes.
- `/home/bjw/checkpoint/tests/smoke/test_compose_structure.py`
  Existing compose contract test; may need only light touch if any compose assumptions change.
- `/home/bjw/checkpoint/TODOS.md`
  Add the follow-up note for future schema version validation.

## Phase Boundaries

- **Task 1 ship criteria**
  Collector DDL, parser, and row-shaping tests no longer mention `source_tag`, and collector Ruby tests pass without touching checkpoint code yet.
- **Task 2 ship criteria**
  Checkpoint root and agent code no longer accept, emit, or depend on `source_tag`, and their focused tests pass.
- **Task 3 ship criteria**
  Schema-validation code and tests are deleted, startup no longer blocks on nonexistent contract tables, and the TODO follow-up is recorded.
- **Task 4 ship criteria**
  Redpanda code, compose wiring, and package dependencies are gone from the collector repo, and the collector stack definition reflects the real direct-to-Postgres polling model.
- **Task 5 ship criteria**
  The slim checkpoint compose stack can prove the ClickHouse image boots and exposes `query_events` plus `query_fingerprints`, with full cross-repo verification green.

### Task 1: Collector Repo Remove `source_tag` From The Owned Schema And Ruby Pipeline

**Repo:** `/home/bjw/checkpoint-collector`

**Files:**
- Modify: `/home/bjw/checkpoint-collector/collector/test/collector_test.rb`
- Modify: `/home/bjw/checkpoint-collector/collector/test/query_comment_parser_test.rb`
- Modify: `/home/bjw/checkpoint-collector/collector/test/sql/clickhouse_schema_test.rb`
- Modify: `/home/bjw/checkpoint-collector/collector/db/clickhouse/001_query_events.sql`
- Modify: `/home/bjw/checkpoint-collector/collector/db/clickhouse/002_query_fingerprints.sql`
- Modify: `/home/bjw/checkpoint-collector/collector/db/clickhouse/003_top_offenders_mv.sql`
- Modify: `/home/bjw/checkpoint-collector/collector/db/clickhouse/004_reset_query_fingerprints.sql`
- Modify: `/home/bjw/checkpoint-collector/collector/lib/collector.rb`
- Modify: `/home/bjw/checkpoint-collector/collector/lib/query_comment_parser.rb`
- Delete: `/home/bjw/checkpoint-collector/collector/test/redpanda_consumer_test.rb`

- [ ] **Step 1: Write the failing collector tests**

```ruby
def test_inserts_query_event_rows_with_source_metadata
  rows = collector.run_once

  assert_equal "app/models/todo.rb:12", rows.first[:source_file]
  refute_includes rows.first.keys, :source_tag
end

def test_parse_returns_only_source_file_metadata
  parsed = QueryCommentParser.parse("/*controller='todos',action='index',source_location='app/controllers/todos_controller.rb:14'*/")

  assert_equal "app/controllers/todos_controller.rb:14", parsed[:source_file]
  refute parsed.key?(:source_tag)
end

def test_fingerprint_table_groups_by_fingerprint
  sql = read_sql("002_query_fingerprints.sql")

  refute_includes sql, "source_tag"
  assert_includes sql, "ORDER BY (fingerprint)"
end
```

- [ ] **Step 2: Run the focused collector tests to prove failure**

Run:

```bash
cd /home/bjw/checkpoint-collector/collector
bundle exec ruby -Itest test/collector_test.rb test/query_comment_parser_test.rb test/sql/clickhouse_schema_test.rb
```

Expected: FAIL because the parser still returns `source_tag`, the row builder still writes it, and the SQL fixtures still group by it.

- [ ] **Step 3: Make the minimal collector implementation changes**

```ruby
# /home/bjw/checkpoint-collector/collector/lib/query_comment_parser.rb
{
  source_file: pairs["source_location"]
}
```

```ruby
# /home/bjw/checkpoint-collector/collector/lib/collector.rb
{
  collected_at: collected_at,
  fingerprint: queryid,
  source_file: presence(parsed[:source_file]),
  sample_query: sample_query,
  total_exec_count: stats_row.fetch("calls").to_i,
  # remaining metrics unchanged
}
```

```sql
-- /home/bjw/checkpoint-collector/collector/db/clickhouse/002_query_fingerprints.sql
CREATE TABLE query_fingerprints
(
    fingerprint String,
    representative_state AggregateFunction(argMax, Tuple(Nullable(String), Nullable(String)), DateTime64(3)),
    total_exec_count_state AggregateFunction(sum, UInt64),
    total_exec_time_ms_state AggregateFunction(sum, Float64),
    p95_exec_time_state AggregateFunction(quantile(0.95), Float64)
)
ENGINE = AggregatingMergeTree
ORDER BY (fingerprint);
```

```sql
-- /home/bjw/checkpoint-collector/collector/db/clickhouse/003_top_offenders_mv.sql
CREATE MATERIALIZED VIEW top_offenders_mv
TO query_fingerprints AS
SELECT
    fingerprint,
    argMaxState((source_file, sample_query), collected_at) AS representative_state,
    sumState(total_exec_count) AS total_exec_count_state,
    sumState(total_exec_count * mean_exec_time_ms) AS total_exec_time_ms_state,
    quantileState(0.95)(mean_exec_time_ms) AS p95_exec_time_state
FROM query_events
GROUP BY fingerprint;
```

Apply the same `source_tag` removals in `001_query_events.sql` and `004_reset_query_fingerprints.sql`, and delete the source-tag-only tests named in the eng-review instructions.

- [ ] **Step 4: Run the focused collector tests again**

Run:

```bash
cd /home/bjw/checkpoint-collector/collector
bundle exec ruby -Itest test/collector_test.rb test/query_comment_parser_test.rb test/sql/clickhouse_schema_test.rb
```

Expected: PASS

- [ ] **Step 5: Commit in the collector repo**

```bash
cd /home/bjw/checkpoint-collector
git status --short
git add collector/db/clickhouse/001_query_events.sql \
  collector/db/clickhouse/002_query_fingerprints.sql \
  collector/db/clickhouse/003_top_offenders_mv.sql \
  collector/db/clickhouse/004_reset_query_fingerprints.sql \
  collector/lib/collector.rb \
  collector/lib/query_comment_parser.rb \
  collector/test/collector_test.rb \
  collector/test/query_comment_parser_test.rb \
  collector/test/sql/clickhouse_schema_test.rb \
  collector/test/redpanda_consumer_test.rb
git commit -m "refactor: remove source tag from collector pipeline"
```

### Task 2: Checkpoint Repo Remove `source_tag` Consumers From Root Tools, Agent Tools, And Tests

**Repo:** `/home/bjw/checkpoint`

**Files:**
- Modify: `/home/bjw/checkpoint/src/tools/clickhouse_tool.ts`
- Modify: `/home/bjw/checkpoint/src/tools/code_search_tool.ts`
- Modify: `/home/bjw/checkpoint/src/tools/github_tool.ts`
- Modify: `/home/bjw/checkpoint/agent/src/agent_tools.ts`
- Modify: `/home/bjw/checkpoint/extensions/db-specialist.ts`
- Modify: `/home/bjw/checkpoint/agent/test/clickhouse_tool.test.ts`
- Modify: `/home/bjw/checkpoint/agent/test/code_search_tool.test.ts`
- Modify: `/home/bjw/checkpoint/agent/test/agent_tools.test.ts`
- Modify: `/home/bjw/checkpoint/test/tools/clickhouse_tool.test.ts`
- Modify: `/home/bjw/checkpoint/test/tools/code_search_tool.test.ts`
- Modify: `/home/bjw/checkpoint/test/extensions/db_specialist.test.ts`

- [ ] **Step 1: Write the failing checkpoint tests**

```ts
test("queryFindings groups by fingerprint only", async () => {
  const sql = captureQueryFrom(new ClickHouseTool({ transport }));

  await tool.queryFindings("analyze_table todos");

  assert.doesNotMatch(sql, /source_tag/);
  assert.match(sql, /GROUP BY fingerprint/);
});

test("CodeSearchTool requires source_file input", async () => {
  const tool = new CodeSearchTool(fakeClient);

  await assert.rejects(() => tool.locate({}), /source_file is required/);
});

test("locate_source schema rejects source_tag-only requests", async () => {
  assert.throws(() => parseLocateSourceInput({ source_tag: "todos#index" }), /source_file/i);
});
```

- [ ] **Step 2: Run the focused checkpoint tests to prove failure**

Run:

```bash
cd /home/bjw/checkpoint
node --import tsx --test test/tools/code_search_tool.test.ts test/tools/clickhouse_tool.test.ts test/extensions/db_specialist.test.ts
cd /home/bjw/checkpoint/agent
npm test -- --test-name-pattern="clickhouse|code_search|agent_tools"
```

Expected: FAIL because root and agent code still mention `source_tag`.

- [ ] **Step 3: Make the minimal checkpoint implementation changes**

```ts
// /home/bjw/checkpoint/src/tools/clickhouse_tool.ts
return [
  "SELECT",
  "  fingerprint,",
  "  tupleElement(argMaxMerge(representative_state), 1) AS source_file,",
  "  tupleElement(argMaxMerge(representative_state), 2) AS sample_query,",
  "  sumMerge(total_exec_count_state) AS total_exec_count,",
  "  sumMerge(total_exec_time_ms_state) AS total_exec_time_ms,",
  "  round(quantileMerge(0.95)(p95_exec_time_state), 2) AS p95_exec_time_ms",
  "FROM query_fingerprints",
  "GROUP BY fingerprint",
  "ORDER BY total_exec_time_ms DESC",
  "LIMIT 5",
  "FORMAT TSVWithNames",
].join("\n");
```

```ts
// /home/bjw/checkpoint/src/tools/code_search_tool.ts
type CodeSearchInput = {
  source_file?: string | null;
};

async function toRelativeSourceFile(input: CodeSearchInput): Promise<string> {
  if (input.source_file) {
    return normalizeSourceFile(input.source_file);
  }

  throw new Error("source_file is required");
}
```

```ts
// /home/bjw/checkpoint/src/tools/github_tool.ts
const findingDetails = [
  `fingerprint: ${input.finding?.fingerprint ?? "unknown"}`,
  `source_file: ${input.finding?.source_file ?? "unknown"}`,
].join("\n");
```

Remove `source_tag` from the agent-side Zod schemas, `parseLocateSourceInput()`, `parseApplyFixInput()`, and the `locate_source` call in `/home/bjw/checkpoint/extensions/db-specialist.ts`.

- [ ] **Step 4: Run the focused checkpoint tests again**

Run:

```bash
cd /home/bjw/checkpoint
node --import tsx --test test/tools/code_search_tool.test.ts test/tools/clickhouse_tool.test.ts test/extensions/db_specialist.test.ts
cd /home/bjw/checkpoint/agent
npm test -- --test-name-pattern="clickhouse|code_search|agent_tools"
```

Expected: PASS

- [ ] **Step 5: Commit in the checkpoint repo**

```bash
cd /home/bjw/checkpoint
git status --short
git add src/tools/clickhouse_tool.ts \
  src/tools/code_search_tool.ts \
  src/tools/github_tool.ts \
  agent/src/agent_tools.ts \
  extensions/db-specialist.ts \
  agent/test/clickhouse_tool.test.ts \
  agent/test/code_search_tool.test.ts \
  agent/test/agent_tools.test.ts \
  test/tools/clickhouse_tool.test.ts \
  test/tools/code_search_tool.test.ts \
  test/extensions/db_specialist.test.ts
git commit -m "refactor: remove source tag from checkpoint tools"
```

### Task 3: Checkpoint Repo Remove Startup Schema Validation And Record The Follow-Up

**Repo:** `/home/bjw/checkpoint`

**Files:**
- Delete: `/home/bjw/checkpoint/src/clickhouse_schema_contract.ts`
- Delete: `/home/bjw/checkpoint/agent/test/clickhouse_schema_contract.test.ts`
- Modify: `/home/bjw/checkpoint/agent/src/runtime_dependencies.ts`
- Modify: `/home/bjw/checkpoint/agent/src/server.ts`
- Modify: `/home/bjw/checkpoint/test/tools/clickhouse_tool.test.ts`
- Modify: `/home/bjw/checkpoint/agent/test/server.test.ts`
- Modify: `/home/bjw/checkpoint/TODOS.md`

- [ ] **Step 1: Write the failing tests for the removal**

```ts
test("startServer does not validate ClickHouse schema before listening", async () => {
  const { startServer } = await loadServerModule();
  const server = await startServer({ host: "127.0.0.1", port: 0 });

  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("clickhouse_tool source does not reference schema contract helpers", async () => {
  const source = await readFile(new URL("../../src/tools/clickhouse_tool.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /readSchemaContract/);
  assert.doesNotMatch(source, /clickhouse_schema_contract/);
});
```

- [ ] **Step 2: Run the focused tests to prove failure**

Run:

```bash
cd /home/bjw/checkpoint
node --import tsx --test test/tools/clickhouse_tool.test.ts
cd /home/bjw/checkpoint/agent
npm test -- --test-name-pattern="schema|startServer"
```

Expected: FAIL because schema-validation symbols still exist and the startup test still expects validation.

- [ ] **Step 3: Delete the feature, not just the call sites**

```ts
// /home/bjw/checkpoint/agent/src/runtime_dependencies.ts
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

```ts
// /home/bjw/checkpoint/agent/src/server.ts
export async function startServer(options: ServerOptions = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3001;
  const server = createServer({ ...options, port });

  return server.app.listen(port, host);
}
```

```md
- ClickHouse schema version validation at agent startup (removed pending DDL design for schema_contract table)
```

Delete `src/clickhouse_schema_contract.ts`, ensure `agent/src/clickhouse_schema_contract.ts` stays absent, remove the `validateRuntimeSchema` option from `ServerOptions`, and delete the obsolete tests rather than weakening them.

- [ ] **Step 4: Run the focused tests again**

Run:

```bash
cd /home/bjw/checkpoint
node --import tsx --test test/tools/clickhouse_tool.test.ts
cd /home/bjw/checkpoint/agent
npm test -- --test-name-pattern="server"
```

Expected: PASS

- [ ] **Step 5: Commit in the checkpoint repo**

```bash
cd /home/bjw/checkpoint
git status --short
git add agent/src/runtime_dependencies.ts \
  agent/src/server.ts \
  test/tools/clickhouse_tool.test.ts \
  agent/test/server.test.ts \
  TODOS.md
git add -u src/clickhouse_schema_contract.ts agent/test/clickhouse_schema_contract.test.ts
git commit -m "refactor: remove clickhouse schema validation"
```

### Task 4: Collector Repo Remove Dead Redpanda Scaffolding

**Repo:** `/home/bjw/checkpoint-collector`

**Files:**
- Modify: `/home/bjw/checkpoint-collector/docker-compose.yml`
- Modify: `/home/bjw/checkpoint-collector/Dockerfile`
- Delete: `/home/bjw/checkpoint-collector/collector/lib/redpanda_consumer.rb`
- Delete: `/home/bjw/checkpoint-collector/collector/test/redpanda_consumer_test.rb`

- [ ] **Step 1: Write the failing contract test**

```ruby
def test_collector_stack_no_longer_mentions_redpanda
  compose = File.read(File.expand_path("../../docker-compose.yml", __dir__))

  refute_includes compose, "redpanda:"
  refute_includes compose, "REDPANDA_BROKERS"
end
```

If there is no existing collector compose test file, add a minimal one at `/home/bjw/checkpoint-collector/collector/test/compose_stack_test.rb` rather than changing runtime code first.

- [ ] **Step 2: Run the focused collector tests to prove failure**

Run:

```bash
cd /home/bjw/checkpoint-collector/collector
bundle exec ruby -Itest test/compose_stack_test.rb
```

Expected: FAIL because the collector stack still defines Redpanda and the runtime class still exists.

- [ ] **Step 3: Make the minimal runtime and compose changes**

```yaml
# /home/bjw/checkpoint-collector/docker-compose.yml
services:
  collector:
    build:
      context: ./collector
    command: ["bash", "-lc", "while true; do bundle exec ruby bin/collector; sleep ${COLLECTOR_INTERVAL_SECONDS:-5}; done"]
    depends_on:
      postgres:
        condition: service_healthy
      clickhouse:
        condition: service_healthy
    environment:
      POSTGRES_URL: postgresql://postgres:postgres@postgres:5432/checkpoint_demo
      CLICKHOUSE_URL: http://clickhouse:8123
```

```dockerfile
# /home/bjw/checkpoint-collector/Dockerfile
FROM clickhouse/clickhouse-server:24.3

COPY clickhouse/users.d/default-user.xml /etc/clickhouse-server/users.d/default-user.xml
COPY collector/db/clickhouse/*.sql /docker-entrypoint-initdb.d/
```

Delete both Redpanda Ruby files instead of leaving dead code behind.

- [ ] **Step 4: Run the focused collector tests again**

Run:

```bash
cd /home/bjw/checkpoint-collector/collector
bundle exec ruby -Itest test/compose_stack_test.rb
```

Expected: PASS

- [ ] **Step 5: Commit in the collector repo**

```bash
cd /home/bjw/checkpoint-collector
git status --short
git add docker-compose.yml Dockerfile collector/test/compose_stack_test.rb
git add -u collector/lib/redpanda_consumer.rb collector/test/redpanda_consumer_test.rb
git commit -m "refactor: remove redpanda collector scaffolding"
```

### Task 5: Checkpoint Repo Add The Real ClickHouse Schema Smoke Test And Run Full Verification

**Repo:** `/home/bjw/checkpoint`

**Files:**
- Create: `/home/bjw/checkpoint/tests/smoke/test_clickhouse_schema.py`
- Modify: `/home/bjw/checkpoint/tests/smoke/test_compose_structure.py` (only if needed for shared helpers)

- [ ] **Step 1: Write the failing smoke test**

```python
import json
import subprocess
import time
from pathlib import Path

import pytest


def image_exists(image: str) -> bool:
    result = subprocess.run(
        ["docker", "image", "inspect", image],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def test_clickhouse_image_boots_and_loads_schema():
    if not image_exists("checkpoint-clickhouse:local"):
        pytest.skip("checkpoint-clickhouse:local is not built")

    root = Path(__file__).resolve().parents[2]

    subprocess.run(["docker", "compose", "up", "-d", "clickhouse"], cwd=root, check=True)
    try:
        for _ in range(30):
            ps = subprocess.run(
                ["docker", "compose", "ps", "--format", "json", "clickhouse"],
                cwd=root,
                check=True,
                capture_output=True,
                text=True,
            )
            status = json.loads(ps.stdout)[0]["Health"]
            if status == "healthy":
                break
            time.sleep(1)
        else:
            raise AssertionError("clickhouse did not become healthy")

        tables = subprocess.run(
            ["docker", "compose", "exec", "-T", "clickhouse", "clickhouse-client", "--query", "SHOW TABLES"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.splitlines()

        assert "query_events" in tables
        assert "query_fingerprints" in tables
    finally:
        subprocess.run(["docker", "compose", "down"], cwd=root, check=True)
```

- [ ] **Step 2: Run the new smoke test to prove failure**

Run:

```bash
cd /home/bjw/checkpoint
python3 -m pytest tests/smoke/test_clickhouse_schema.py -v
```

Expected: FAIL if the image boots with a DDL error, or SKIP if `checkpoint-clickhouse:local` is not built yet. If it skips, build the image first in the collector repo and re-run the test before continuing.

- [ ] **Step 3: Build the collector-owned images and make only the test changes needed**

Run:

```bash
cd /home/bjw/checkpoint-collector
docker build -t checkpoint-postgres:local ./postgres
docker build -t checkpoint-clickhouse:local .
```

If the smoke test needs a shared helper in `tests/smoke/test_compose_structure.py`, extract it there; otherwise keep that file unchanged.

- [ ] **Step 4: Run the full verification matrix**

Run:

```bash
cd /home/bjw/checkpoint-collector/collector
bundle exec ruby -Itest test/collector_test.rb test/clickhouse_connection_test.rb test/query_comment_parser_test.rb test/sql/clickhouse_schema_test.rb

cd /home/bjw/checkpoint
npm test
python3 -m pytest tests/ -v

cd /home/bjw/checkpoint/agent
npm test

cd /home/bjw/checkpoint-collector
docker run --rm checkpoint-clickhouse:local clickhouse-client --query "SHOW TABLES"
docker compose up -d
docker compose ps
docker compose down
```

Expected:
- collector Ruby suite PASS
- checkpoint `npm test` PASS
- checkpoint `python3 -m pytest tests/ -v` PASS
- checkpoint agent `npm test` PASS
- `docker run --rm checkpoint-clickhouse:local ...` prints `query_events` and `query_fingerprints`
- collector `docker compose ps` shows healthy `postgres`, `clickhouse`, and `collector`, with no `redpanda` service present

- [ ] **Step 5: Commit the smoke-test task in the checkpoint repo**

```bash
cd /home/bjw/checkpoint
git status --short
git add tests/smoke/test_clickhouse_schema.py tests/smoke/test_compose_structure.py
git commit -m "test: validate clickhouse schema through compose"
```

## Self-Review

- **Spec coverage:** The plan maps directly to all four required fixes from [2026-04-08-eng-review-collector-instructions.md](/home/bjw/checkpoint/docs/superpowers/plans/2026-04-08-eng-review-collector-instructions.md): `source_tag` removal, schema-validation removal, Redpanda removal, and the compose-level ClickHouse smoke test. The optional collector-local smoke test was intentionally left out to avoid adding scope before the required checkpoint smoke is green.
- **Placeholder scan:** Every task lists exact file paths, concrete test code, exact commands, expected failure/pass conditions, and commit commands. There are no `TODO` or “similar to above” placeholders inside execution steps.
- **Type consistency:** The plan consistently treats `source_file` as the only locator signal, deletes the schema-contract feature rather than reworking it, and keeps Redpanda removal collector-only except where checkpoint verification consumes the built image.
