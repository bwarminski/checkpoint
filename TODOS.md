# TODOS

Deferred items from plan and eng review. Each item has a concrete scope and
a reason it was intentionally deferred rather than forgotten.

---

## ExplainTool: BEGIN/ROLLBACK transaction wrapper

**What:** Wrap `EXPLAIN ANALYZE {sql}` in an explicit `BEGIN; EXPLAIN ANALYZE ...; ROLLBACK;`
transaction so the query executes for real plan capture but its effects are discarded.

**Why:** The current implementation runs EXPLAIN ANALYZE without a transaction. The
SELECT-only guard prevents obvious disasters, but EXPLAIN ANALYZE still touches
indexes, updates statistics, and can fire read-side triggers. Deferred because the
demo Postgres is local and single-user — the risk is minimal. This becomes important
if the agent is ever pointed at a shared or production replica.

**Where:** `agent/src/tools/explain_tool.ts` — `analyze()` method. Add test asserting
ROLLBACK fires even on query error.

---

## IndexValidationTool: HypoPG implementation

**What:** Implement the HypoPG validation path: `hypopg_create_index(sql)` → `EXPLAIN query`
→ diff estimated cost → `hypopg_reset()`. Currently a stub that throws `"IndexValidationTool
is pending implementation."` Not wired in `runtime_dependencies.ts`.

**Why:** The plan has two validation paths: ExplainTool for N+1/LIKE fixes,
IndexValidationTool for index suggestions. Only ExplainTool is wired. Index findings
currently report `validated: false` unconditionally.

**Where:** `agent/src/tools/index_validation_tool.ts` — replace stub with real HypoPG
calls. Wire into `runtime_dependencies.ts` when `POSTGRES_URL` is set.
The HypoPG Postgres image is already built (`postgres/Dockerfile`).

**Demo value:** Before/after EXPLAIN showing seq scan → index scan is a compelling diff.

---

## ClickHouse time window: query query_events directly

**What:** The `time_window_minutes` task parameter is accepted but not applied.
`ClickHouseTool.topOffenders()` reads from `query_fingerprints` (AggregatingMergeTree),
which has no time column post-aggregation. Time filtering cannot be applied there.

**Fix:** For time-windowed queries, query `query_events` (MergeTree) directly with
`WHERE collected_at > now() - INTERVAL {minutes} MINUTE`, then aggregate inline:

```sql
SELECT
  fingerprint,
  argMax((source_tag, source_file, sample_query), collected_at) AS representative,
  sum(total_exec_count) AS total_exec_count,
  quantile(0.95)(mean_exec_time_ms) AS p95_exec_time_ms
FROM query_events
WHERE collected_at > now() - INTERVAL 60 MINUTE
GROUP BY fingerprint
HAVING tupleElement(representative, 1) IS NOT NULL
ORDER BY total_exec_count DESC
LIMIT 5
FORMAT TSVWithNames
```

Use `query_fingerprints` only for all-time aggregates (when no time window is given).
Default window: 60 minutes.

**Where:** `agent/src/tools/clickhouse_tool.ts` — `buildTopOffendersQuery()`. Parse
`time_window_minutes` from scope text (e.g. "analyze_db 30" or via structured params).

---

## db_name identifier in memory schema

**What:** The `findings` and `suggestions` tables have no database identity column.
Fingerprints are normalized SQL patterns that can match across different databases.

**Why deferred:** Single-demo Docker Compose setup — no risk of cross-database
fingerprint collision. Becomes important for multi-tenant or multi-database deployments.

**Fix:** Add `db_name TEXT NOT NULL` to `findings` and `suggestions`, populate from
`DB_NAME` env var, scope all memory queries with `WHERE db_name = $1`.

**Where:** `agent/db/001_memory_schema.sql`, `agent/src/tools/memory_tool.ts`.

---

## Concurrent task deduplication

**What:** If two A2A tasks run concurrently and both hit the same fingerprint, both
will read "no pending suggestion" and both will open PRs. The fix is a partial unique
index on `suggestions`:

```sql
CREATE UNIQUE INDEX suggestions_pending_unique
  ON suggestions (fingerprint, fix_type)
  WHERE status = 'pending';
```

Then use `INSERT ... ON CONFLICT DO NOTHING` in MemoryTool.

**Why deferred:** The demo is single-threaded. This is the production correctness fix.

---

## LLM-based fix classification (Phase 2 agent capability)

**What:** Replace the deterministic pattern-matching in `buildFixProposal()` with an
LLM reasoning step. The agent reads the source content and reasons about the correct
fix type and concrete suggestion, rather than matching known patterns.

**Why:** The Phase 1 classifier handles 4 known anti-patterns via regex. For arbitrary
codebases (not the purpose-built demo app), the patterns won't be known in advance.
LLM classification generalizes across codebases and can propose fixes the rules don't
cover.

**When:** After the demo proves the vertical slice with deterministic classification.
The interface (`buildFixProposal(source: LocatedSource): FixProposal`) stays the same —
swap the implementation.

**Where:** `agent/src/executor.ts` — `buildFixProposal()`. Wire through pi-mono's
`pi-agent-core` LLM loop (currently the executor doesn't use LLM reasoning at all).

---

## pg_stat_monitor upgrade path

**What:** Evaluate `pg_stat_monitor` (Percona) as a drop-in replacement for
`pg_stat_statements`. It adds time buckets, plan capture, and richer grouping.

**Why deferred:** pg_stat_statements works for the demo. pg_stat_monitor requires
a Percona-packaged Postgres image (or manual extension build) and changes the
collector query surface.

**When to revisit:** After the demo proves the vertical slice works end-to-end.
