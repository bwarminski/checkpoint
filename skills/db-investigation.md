# DB Investigation

Use this skill when asked to identify and fix a database performance issue in the demo app.

Workflow:
1. Inspect the repo checkout and the application code involved in the slow path before querying the databases.
2. Use the Postgres tools to list tables, inspect schema, and confirm how the app reads and writes the relevant data.
3. Use the ClickHouse tools to inspect the captured performance evidence for the same path.
4. Form one concrete hypothesis about the highest-value issue.
5. Validate that hypothesis with bounded queries before changing code.
6. Make the smallest reasonable local code change that addresses the confirmed issue.
7. Re-run the evidence queries and confirm the results still support the fix.
8. Create a local commit only after the evidence still supports the fix.

ClickHouse catalog:
- `query_events`: raw cumulative statement snapshots keyed by statement identity.
- `query_intervals`: reset-aware interval deltas derived from successive snapshots.
- `collector_state`: global `pg_stat_statements_info` snapshots, including `stats_reset`.
