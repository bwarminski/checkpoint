# Eng Review: checkpoint-collector Implementor Instructions

Date: 2026-04-08
Branch: `master` (checkpoint-collector repo at `/home/bjw/checkpoint-collector`)
Also touches: `wip/task1-collector-split` (checkpoint repo at `/home/bjw/checkpoint`)

## Context

The eng review of the checkpoint-collector repo found three architectural issues
that need to be fixed before the collector split is shippable. All three follow
the same principle: reduce moving parts until we've tested with a real LLM.

## Fix 1: Remove `source_tag` from the entire stack

**Why:** `source_tag` (the `controller#action` string parsed from Rails SQL
comments) is a pre-computed data point that we've never validated with a real
LLM agent. The agent can derive this information itself using `source_file` and
`locate_source`. Removing it also fixes the ClickHouse DDL crash (error 44:
nullable column in ORDER BY key).

### Collector repo changes (`/home/bjw/checkpoint-collector`)

#### ClickHouse DDL files

**`collector/db/clickhouse/001_query_events.sql`:**
- Remove the `source_tag Nullable(String)` column

**`collector/db/clickhouse/002_query_fingerprints.sql`:**
- Remove `source_tag Nullable(String)` column
- Change `ORDER BY (fingerprint, source_tag)` to `ORDER BY (fingerprint)`

**`collector/db/clickhouse/003_top_offenders_mv.sql`:**
- Remove `source_tag,` from SELECT and GROUP BY
- Change `GROUP BY fingerprint, source_tag` to `GROUP BY fingerprint`

**`collector/db/clickhouse/004_reset_query_fingerprints.sql`:**
- Same changes as 002 and 003 (this file recreates the table and MV)
- Remove `source_tag` from the CREATE TABLE, INSERT INTO SELECT, and
  CREATE MATERIALIZED VIEW sections

#### Ruby source

**`collector/lib/collector.rb`:**
- Remove `source_tag: presence(parsed[:source_tag])` from `build_row`
- The `QueryCommentParser` import and `extract_comment` call stay because
  they're still needed for `source_file`

**`collector/lib/query_comment_parser.rb`:**
- Remove `source_tag` from the return hash of `parse()`
- Only return `{ source_file: pairs["source_location"] }`
- The class stays because `source_file` is still needed

**`collector/lib/redpanda_consumer.rb`:**
- DELETE this file entirely (see Fix 3)

#### Ruby tests

**`collector/test/collector_test.rb`:**
- Remove `source_tag:` from all expected row hashes
- Update `test_inserts_query_event_rows_with_source_metadata` expected row
- Update `test_uses_only_the_rails_metadata_block_when_query_has_multiple_comments`:
  remove `assert_equal "todos#index", row[:source_tag]`
- Update `test_extracts_source_tag_from_live_rails_equals_style_comments`:
  this test is ONLY about source_tag, so DELETE it entirely

**`collector/test/query_comment_parser_test.rb`:**
- Remove all `assert_equal "...", parsed[:source_tag]` assertions
- Remove `test_returns_partial_tag_when_only_controller_is_present` (only
  tests source_tag)
- Keep `test_parses_controller_action_and_source` but only assert source_file
- Keep `test_returns_empty_tag_when_comment_is_missing` but rename and only
  assert source_file is nil

**`collector/test/sql/clickhouse_schema_test.rb`:**
- Remove all `source_tag` assertions from every test method
- Remove `assert_includes sql, "source_tag,"` and
  `assert_includes sql, "GROUP BY fingerprint, source_tag"` etc.
- Update `test_fingerprint_table_stores_source_tag_rows`: rename to
  `test_fingerprint_table_groups_by_fingerprint` and update assertions

**`collector/test/redpanda_consumer_test.rb`:**
- DELETE this file entirely (see Fix 3)

### Checkpoint repo changes (`/home/bjw/checkpoint`)

**`src/tools/clickhouse_tool.ts`:**
- In `buildOffenderQuery()` (line ~63): remove `source_tag IS NOT NULL` from
  conditions, remove `source_tag,` from SELECT, remove `source_tag` from
  GROUP BY
- In `buildWindowedQuery()` (line ~88): same removals
- In the `TopOffender` return type / row parsing (~line 157): remove
  `source_tag` field
- Delete `readSchemaContract()` method (see Fix 2)
- Delete `parseSchemaContract()` function (see Fix 2)

**`src/clickhouse_schema_contract.ts`:**
- DELETE this file entirely (see Fix 2)

**`src/tools/code_search_tool.ts`:**
- Remove the `source_tag` property from the locate input type (~line 22)
- Remove the `if (input.source_tag)` branch (~line 147-148) and the
  `deriveSourceFileFromTag()` function (~line 258)
- `locate()` now only works with `source_file`

**`src/tools/github_tool.ts`:**
- Remove `source_tag` from the input type (~line 6)
- Remove `source_tag: ${input.finding?.source_tag ?? "unknown"}` from PR
  body (~line 178)

**`agent/src/agent_tools.ts`:**
- Remove `source_tag` from all tool input schemas (locate_source, finding
  shapes)
- `locate_source` requires only `source_file` (remove `source_tag` from
  the union requirement)
- Remove `source_tag` from `parseLocateSourceInput()` and
  `parseApplyFixInput()`

**`extensions/db-specialist.ts`:**
- Remove `source_tag` from the `locate_source` execute call (~line 88)

**Test files to update:**
- `agent/test/clickhouse_tool.test.ts`: remove source_tag from expected
  queries and results
- `agent/test/code_search_tool.test.ts`: remove source_tag tests
- `agent/test/agent_tools.test.ts`: remove source_tag from schema tests
  (if they exist)
- `test/tools/clickhouse_tool.test.ts`: remove source_tag from expected
  queries
- `test/tools/code_search_tool.test.ts`: remove source_tag from test
  inputs
- `test/extensions/db_specialist.test.ts`: remove source_tag from test
  inputs and expected outputs

## Fix 2: Remove schema validation entirely

**Why:** The `schema_contract` and `schema_contract_tables` tables don't exist
in any DDL. The validation was an incomplete feature that blocks real agent
startup. Rather than finishing it, remove it and add a TODO for later.

### Checkpoint repo changes

**DELETE `src/clickhouse_schema_contract.ts`** (already covered by Fix 1)

**DELETE `agent/src/clickhouse_schema_contract.ts`** (if it still exists after
the eng-review follow-ups — check first)

**`agent/src/runtime_dependencies.ts`:**
- Remove the `assertSchemaContractSatisfied` import
- Remove the `validateRuntimeSchema` export function
- Remove `readSchemaContract()` call

**`agent/src/server.ts`:**
- Remove `validateRuntimeSchema` import
- Remove `validateRuntimeSchema?: () => Promise<void>` from ServerOptions
- Remove the `if (!options.executor) { await validate(); }` block from
  `startServer()`

**`src/tools/clickhouse_tool.ts`:**
- Remove `readSchemaContract()` method
- Remove `parseSchemaContract()` function
- Remove the `ClickHouseSchemaContract` import

**Test files:**
- `agent/test/clickhouse_schema_contract.test.ts`: DELETE
- `agent/test/server.test.ts`: remove
  `test_startServer_validates_the_runtime_schema_before_listening`
- `test/tools/clickhouse_tool.test.ts`: remove any schema_contract query
  assertions

**Add to TODOS.md:**
```
- ClickHouse schema version validation at agent startup (removed pending
  DDL design for schema_contract table)
```

## Fix 3: Remove Redpanda scaffolding

**Why:** The Redpanda infrastructure (compose service, C library, Ruby class)
has no working integration. The collector polls Postgres directly. No Kafka
gem in Gemfile. Dead code.

### Collector repo changes

**DELETE `collector/lib/redpanda_consumer.rb`**
**DELETE `collector/test/redpanda_consumer_test.rb`**

**`collector/docker-compose.yml`:**
- Remove the entire `redpanda:` service block
- Remove `redpanda:` from the collector service's `depends_on:`
- Remove `REDPANDA_BROKERS: redpanda:9092` from collector environment

**`collector/Dockerfile`:**
- Remove `librdkafka-dev` from the apt-get install line

## Fix 4: Add compose-level ClickHouse schema smoke test

**Why:** The existing schema tests only check SQL text content but never
execute it. The nullable ORDER BY crash proved that text tests miss real
ClickHouse errors.

### Checkpoint repo changes

**Add to `tests/smoke/` (pytest):**

A new test file (e.g., `tests/smoke/test_clickhouse_schema.py`) that:
1. Runs `docker compose up -d clickhouse` using the checkpoint slim compose
2. Waits for the healthcheck to pass (or fails after timeout)
3. Runs `docker compose exec clickhouse clickhouse-client --query 'SHOW TABLES'`
4. Asserts `query_events` and `query_fingerprints` are present
5. Tears down with `docker compose down`

This test requires the `checkpoint-clickhouse:local` image to be built from
the collector repo first. The test should skip if the image doesn't exist
rather than failing.

### Collector repo changes

Consider adding a similar smoke test in the collector repo itself, so that
the ClickHouse DDL is validated in the repo that owns it. The test would
use the collector's own docker-compose.yml.

## Verification

After all fixes, confirm:

1. **Collector tests pass:**
   ```bash
   cd /home/bjw/checkpoint-collector/collector
   bundle exec ruby -Itest test/collector_test.rb test/clickhouse_connection_test.rb \
     test/query_comment_parser_test.rb test/sql/clickhouse_schema_test.rb
   ```

2. **Checkpoint root tests pass:**
   ```bash
   cd /home/bjw/checkpoint
   npm test
   ```

3. **Checkpoint agent tests pass:**
   ```bash
   cd /home/bjw/checkpoint/agent
   npm test
   ```

4. **Checkpoint pytest passes:**
   ```bash
   cd /home/bjw/checkpoint
   python3 -m pytest tests/
   ```

5. **ClickHouse image boots cleanly:**
   ```bash
   cd /home/bjw/checkpoint-collector
   docker build -t checkpoint-clickhouse:local .
   docker run --rm checkpoint-clickhouse:local clickhouse-client --query 'SHOW TABLES'
   ```
   Should show `query_events` and `query_fingerprints` (no `source_tag` in
   fingerprints ORDER BY, no crash).

6. **Full collector stack starts:**
   ```bash
   cd /home/bjw/checkpoint-collector
   docker compose up -d
   docker compose ps  # all services healthy, no redpanda
   docker compose down
   ```

## TDD order

For each fix, follow the standard TDD loop:
1. Write/update the failing test first
2. Run the test to confirm it fails
3. Make the code change
4. Run the test to confirm it passes
5. Commit

Suggested order: Fix 1 (source_tag removal) first because it's the biggest
and touches both repos. Fix 2 (schema validation removal) second. Fix 3
(Redpanda removal) third — it's collector-only and mechanical. Fix 4 (smoke
test) last because it validates the other three.
