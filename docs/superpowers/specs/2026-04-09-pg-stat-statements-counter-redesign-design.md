# pg_stat_statements Counter Redesign

## Goal

Redesign the collector pipeline so it treats `pg_stat_statements` as a cumulative
counter source instead of an interval metric source, while preserving the
checkpoint repo's existing findings contract.

## Scope

This design covers both repos:

- `/home/bjw/checkpoint-collector`
- `/home/bjw/checkpoint`

The work includes the collector query shape, raw ClickHouse schema, raw
`pg_stat_statements_info` capture, a read-time interval layer, reset SQL, and
checkpoint-side fixture/smoke updates needed to keep the end-to-end contract
green.

The work does not introduce backward compatibility for the old schema. Brett
approved a destructive schema break because the collector data is not in
production.

## Architecture

The collector remains a stateless poller. On each run it reads the full
`pg_stat_statements` snapshot and one `pg_stat_statements_info` snapshot,
enriches rows with sample SQL and source metadata, and writes both snapshots
into ClickHouse with normalized types.

The raw statement identity becomes the full Postgres row key:

- `dbid`
- `userid`
- `toplevel`
- `queryid`

`queryid` alone is not sufficient row identity because PostgreSQL keeps
distinct rows per `(dbid, userid, queryid, toplevel)` combination. The
collector still stores a `fingerprint` field derived from `queryid` so the
checkpoint consumer contract stays stable.

ClickHouse owns interval reasoning, but only at query time in this slice. Raw
snapshots are stored unchanged as cumulative values. A read-time interval layer
compares each snapshot to the previous snapshot for the same key within the same
`stats_reset` window. Valid monotonic growth emits interval deltas. A reset
boundary emits no delta and instead establishes a new baseline.

Checkpoint continues to consume ranked findings with the current contract:

- `fingerprint`
- `source_file`
- `sample_query`
- `total_exec_count`
- `total_exec_time_ms`
- `p95_exec_time_ms`

Those fields are still present, but they are now produced from correct
read-time delta aggregation instead of `calls * mean_exec_time`.

## Raw Data Model

### `query_events`

`query_events` becomes the raw cumulative statement snapshot table. It stores:

- `collected_at`
- `dbid`
- `userid`
- `toplevel`
- `queryid`
- `fingerprint`
- `source_file`
- `sample_query`
- `total_exec_count`
- `total_exec_time_ms`
- `rows_returned_or_affected`
- `shared_blks_hit`
- `shared_blks_read`
- `local_blks_hit`
- `local_blks_read`
- `temp_blks_read`
- `temp_blks_written`
- `total_block_accesses`
- `min_exec_time_ms`
- `max_exec_time_ms`
- `mean_exec_time_ms`
- `stddev_exec_time_ms`

`mean_block_accesses_per_call` is removed because it is not an honest interval
metric when computed from cumulative snapshots.

### `collector_state`

`collector_state` is a new raw snapshot table for `pg_stat_statements_info`.
It stores:

- `collected_at`
- `dealloc`
- `stats_reset`

This table is the source of truth for detecting global stats resets and
providing evidence when row disappearance may be caused by eviction pressure.

## Read Path

The ClickHouse read side in this slice has one interval-oriented layer.

### Statement Interval Layer

A statement interval layer computes per-interval deltas from successive rows in
`query_events` for the same `(dbid, userid, toplevel, queryid)` key.

Each interval row carries:

- `interval_started_at`
- `interval_ended_at`
- `interval_duration_ms`
- the same identity fields as the raw row
- representative metadata such as `fingerprint`, `source_file`, and
  `sample_query`
- delta values for the cumulative counters

The first snapshot for a key is baseline-only and emits no delta row. A
transition also emits no delta row when:

- `stats_reset` changed between snapshots
- any core cumulative counter moved backward

This keeps host restarts and extension resets honest. They are modeled as new
baselines instead of synthetic negative activity.

Checkpoint reads recent and all-time findings from this interval layer directly.
There is no live `AggregatingMergeTree` findings table in this slice. The raw
interval query still computes the current consumer-facing fields:

- `total_exec_count`
- `total_exec_time_ms`
- `p95_exec_time_ms`
- `source_file`
- `sample_query`

The interval query also carries the additional counters so they remain available
for future ranking and diagnostics without another collector rewrite:

- row counts
- block hit counters
- block read counters
- block write counters
- execution shape metrics where aggregation is still meaningful

Checkpoint does not surface those additional fields yet.

The live `AggregatingMergeTree` experiment is explicitly deferred. During
implementation we reproduced two blockers: the first interval materialization
SQL was not portable to the project's ClickHouse 24.3 runtime, and a
materialized view fed from a joined/windowed view did not preserve
late-arriving `collector_state` rows needed for reset-aware live aggregation.
That experiment is tracked in `TODOS.md` for a follow-on pass after end-to-end
correctness is restored.

## Reset And Gap Handling

The system treats resets and polling gaps explicitly.

The first observation for a statement key is stored as a baseline and does not
produce an interval delta. If the collector misses polls for a long period, the
next valid delta represents the full cumulative work since the previous
snapshot. That delta is kept because it is honest, but it includes
`interval_duration_ms` so the downstream query can reason about freshness.

Recent/ranked findings apply a freshness cap. Oversized intervals are excluded
from the recent window so a long outage does not dominate short-window ranking.
Those same interval rows remain eligible for all-time interval queries.

If a row disappears entirely, the system does not fabricate a negative event.
Disappearance may mean the statement went idle, the extension evicted it under
`pg_stat_statements.max`, or the stats window reset. `collector_state.dealloc`
and `collector_state.stats_reset` are preserved so diagnostics can distinguish
those cases later.

## Collector Query Contract

The collector query against `pg_stat_statements` should read the full table and
store cumulative counters instead of relying on ordered/limited queries for
ingestion.

The statement query will include at least:

- `dbid`
- `userid`
- `toplevel`
- `queryid`
- `calls`
- `total_exec_time`
- `min_exec_time`
- `max_exec_time`
- `mean_exec_time`
- `stddev_exec_time`
- `rows`
- `shared_blks_hit`
- `shared_blks_read`
- `local_blks_hit`
- `local_blks_read`
- `temp_blks_read`
- `temp_blks_written`

The collector also reads:

- `dealloc`
- `stats_reset`

from `pg_stat_statements_info`.

## Testing

### Collector Repo

The collector repo owns the primary behavior coverage.

Tests should pin:

- the widened `STATS_SQL` query shape
- the raw snapshot payload and stronger row identity
- baseline-only behavior for first observation
- reset behavior when `stats_reset` changes
- regression behavior when counters move backward
- the DDL contract for `query_events`, `collector_state`, and the interval-layer
  objects
- compose-level proof that the stack boots, schema loads, and a real polling
  cycle writes rows

### Checkpoint Repo

Checkpoint keeps its current findings contract. The work there is limited to
fixture, smoke, and validation updates needed to operate against the new
collector schema.

Tests should prove:

- the collector-owned ClickHouse schema still boots from the checkpoint compose
  path
- seeded fixture data matches the new schema
- the agent-facing findings shape remains unchanged

## Rollout

Implementation should proceed in this order:

1. update the collector query and raw payload tests
2. replace the ClickHouse DDLs and reset SQL for the new raw/state/interval
   model
3. update collector-side runtime and verification
4. update checkpoint-side fixture seeding and smoke assertions
5. run both repos' suites plus compose-level validation

## Non-Goals

- no backward compatibility layer for the old schema
- no collector-side durable state for previous snapshots
- no expansion of the checkpoint findings contract in this pass
- no live `AggregatingMergeTree` experiment in this slice
