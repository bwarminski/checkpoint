# LangChain-Style SQL Tool Ergonomics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the reduced Postgres and ClickHouse SQL tools closer to LangChain's ergonomics by returning readable text for table lists, schema plus sample rows, and query results, while preserving the current MVP safety boundaries and tool split.

**Architecture:** Keep the current Postgres and ClickHouse tool families and injected runner pattern. Add shared formatting helpers for schema blocks and query result rendering. Each dialect-specific schema tool remains responsible for fetching its own metadata and sample rows. Each query tool remains responsible for applying limits and timeouts, but now returns formatted text or `Error: ...` strings instead of raw row arrays.

**Tech Stack:** TypeScript, Node.js test runner, PostgreSQL, ClickHouse

---

## File Map

### New files

- `src/tools/shared/result_formatter.ts`
  Shared helpers for stringifying bounded query results in a deterministic, readable format.
- `src/tools/shared/schema_formatter.ts`
  Shared helpers for rendering per-table schema blocks plus sample rows.
- `test/tools/result_formatter.test.ts`
  Focused tests for shared query-result rendering rules.
- `test/tools/schema_formatter.test.ts`
  Focused tests for shared schema rendering rules.

### Modified files

- `src/tools/postgres/list_tables_tool.ts`
  Return a plain text list instead of an array of table names.
- `src/tools/postgres/schema_tool.ts`
  Fetch column metadata and sample rows, then render LangChain-style schema text.
- `src/tools/postgres/query_tool.ts`
  Return formatted result text or `Error: ...` text, and make the runner contract explicit for multi-statement execution.
- `src/tools/clickhouse/list_tables_tool.ts`
  Return a plain text list instead of an array of table names.
- `src/tools/clickhouse/schema_tool.ts`
  Fetch column metadata and sample rows, then render formatted schema text.
- `src/tools/clickhouse/query_tool.ts`
  Return formatted result text or `Error: ...` text.
- `test/tools/postgres_list_tables_tool.test.ts`
- `test/tools/postgres_schema_tool.test.ts`
- `test/tools/postgres_query_tool.test.ts`
- `test/tools/clickhouse_list_tables_tool.test.ts`
- `test/tools/clickhouse_schema_tool.test.ts`
- `test/tools/clickhouse_query_tool.test.ts`
  Update existing tests to assert formatted text contracts instead of raw row arrays.
- `brainstorm-scope-reduction-walkthrough.md`
  Refresh the walkthrough notes if the live examples materially change after implementation.
- `JOURNAL.md`
  Record the ergonomic shift and any notable runtime findings.

---

## Task 1: Lock Down Shared Formatting Behavior First

**Files:**
- Create: `src/tools/shared/result_formatter.ts`
- Create: `src/tools/shared/schema_formatter.ts`
- Create: `test/tools/result_formatter.test.ts`
- Create: `test/tools/schema_formatter.test.ts`
- Test: `test/tools/result_formatter.test.ts`, `test/tools/schema_formatter.test.ts`

- [ ] **Step 1: Write failing tests for query-result rendering**

Cover at least:
- multiple rows render deterministically
- empty results render cleanly
- values are stringified readably without dropping column names when present

- [ ] **Step 2: Write failing tests for schema-block rendering**

Cover at least:
- a single table block includes the table name, columns, and a sample-row section
- multiple tables render as separate deterministic blocks
- empty sample rows still render a stable sample section

- [ ] **Step 3: Run the new formatter tests and confirm failure**

Run: `npm test -- test/tools/result_formatter.test.ts test/tools/schema_formatter.test.ts`
Expected: FAIL with missing-module or missing-export errors.

- [ ] **Step 4: Implement the minimal shared formatters**

Keep these helpers string-focused and small. Do not introduce a generic database abstraction. The helpers should accept normalized inputs from the dialect-specific tools and return final strings only.

- [ ] **Step 5: Run the formatter tests and confirm success**

Run: `npm test -- test/tools/result_formatter.test.ts test/tools/schema_formatter.test.ts`
Expected: PASS.

---

## Task 2: Shift Table-Listing Tools To Plain Text

**Files:**
- Modify: `src/tools/postgres/list_tables_tool.ts`
- Modify: `src/tools/clickhouse/list_tables_tool.ts`
- Modify: `test/tools/postgres_list_tables_tool.test.ts`
- Modify: `test/tools/clickhouse_list_tables_tool.test.ts`
- Test: `test/tools/postgres_list_tables_tool.test.ts`, `test/tools/clickhouse_list_tables_tool.test.ts`

- [ ] **Step 1: Update the list-table tests to expect plain text output**

Use a deterministic format such as comma-separated table names.

- [ ] **Step 2: Run the list-table tests and confirm failure**

Run: `npm test -- test/tools/postgres_list_tables_tool.test.ts test/tools/clickhouse_list_tables_tool.test.ts`
Expected: FAIL because the current tools return arrays.

- [ ] **Step 3: Update both list-table tools to return formatted text**

Keep identifier validation unchanged.

- [ ] **Step 4: Run the list-table tests and confirm success**

Run: `npm test -- test/tools/postgres_list_tables_tool.test.ts test/tools/clickhouse_list_tables_tool.test.ts`
Expected: PASS.

---

## Task 3: Rework Schema Tools Around Schema Plus Sample Rows

**Files:**
- Modify: `src/tools/postgres/schema_tool.ts`
- Modify: `src/tools/clickhouse/schema_tool.ts`
- Modify: `test/tools/postgres_schema_tool.test.ts`
- Modify: `test/tools/clickhouse_schema_tool.test.ts`
- Test: `test/tools/postgres_schema_tool.test.ts`, `test/tools/clickhouse_schema_tool.test.ts`

- [ ] **Step 1: Rewrite the schema-tool tests to expect formatted text**

Cover at least:
- one requested table
- multiple requested tables
- empty table list rejection still throws
- invalid identifiers still throw
- sample rows are included in the rendered output

- [ ] **Step 2: Run the schema-tool tests and confirm failure**

Run: `npm test -- test/tools/postgres_schema_tool.test.ts test/tools/clickhouse_schema_tool.test.ts`
Expected: FAIL because the current tools only return raw column rows.

- [ ] **Step 3: Implement Postgres schema rendering**

Fetch column metadata and a bounded sample-row query per requested table, then feed normalized data into the shared schema formatter.

- [ ] **Step 4: Implement ClickHouse schema rendering**

Fetch column metadata from `system.columns` and a bounded sample-row query per requested table, then render through the same shared formatter.

- [ ] **Step 5: Run the schema-tool tests and confirm success**

Run: `npm test -- test/tools/postgres_schema_tool.test.ts test/tools/clickhouse_schema_tool.test.ts`
Expected: PASS.

---

## Task 4: Rework Query Tools Around Formatted Results And Error Strings

**Files:**
- Modify: `src/tools/postgres/query_tool.ts`
- Modify: `src/tools/clickhouse/query_tool.ts`
- Modify: `test/tools/postgres_query_tool.test.ts`
- Modify: `test/tools/clickhouse_query_tool.test.ts`
- Test: `test/tools/postgres_query_tool.test.ts`, `test/tools/clickhouse_query_tool.test.ts`

- [ ] **Step 1: Rewrite the query-tool tests around string output**

Cover at least:
- successful multi-row output renders deterministically
- query errors surface as `Error: ...` strings
- the bounded limit and timeout logic is still applied
- Postgres runner behavior explicitly assumes the final result rows are returned for `SET; SELECT`

- [ ] **Step 2: Run the query-tool tests and confirm failure**

Run: `npm test -- test/tools/postgres_query_tool.test.ts test/tools/clickhouse_query_tool.test.ts`
Expected: FAIL because the current tools return raw row arrays and do not normalize errors into strings.

- [ ] **Step 3: Implement formatted query output and in-band error handling**

Preserve the current timeout and row-cap logic. Do not broaden the execution surface or loosen validation.

- [ ] **Step 4: Run the query-tool tests and confirm success**

Run: `npm test -- test/tools/postgres_query_tool.test.ts test/tools/clickhouse_query_tool.test.ts`
Expected: PASS.

---

## Task 5: Verify The New Ergonomics End To End

**Files:**
- Modify: `brainstorm-scope-reduction-walkthrough.md` (if outputs changed materially)
- Modify: `JOURNAL.md`
- Test: focused unit slice plus `npm run typecheck`

- [ ] **Step 1: Run the focused SQL-tool test slice**

Run: `npm test -- test/tools/result_formatter.test.ts test/tools/schema_formatter.test.ts test/tools/postgres_list_tables_tool.test.ts test/tools/postgres_schema_tool.test.ts test/tools/postgres_query_tool.test.ts test/tools/clickhouse_list_tables_tool.test.ts test/tools/clickhouse_schema_tool.test.ts test/tools/clickhouse_query_tool.test.ts`
Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Refresh the walkthrough only if the live examples materially changed**

If the rendered output changed enough to make the current walkthrough misleading, update the live examples and notes. Otherwise leave it alone.

- [ ] **Step 4: Record the completed shift in the journal**

Add a concise note describing the move to LangChain-style list/schema/query output and any runtime findings about Postgres multi-statement result normalization.

