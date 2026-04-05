# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0.0] - 2026-04-05

Initial alpha release of the DB Specialist Agent scaffolding. This is a portfolio
demonstration project: a vertical slice of an autonomous database performance agent
that detects slow queries, locates the responsible application code, and opens a
pull request with a fix.

### Added

**Infrastructure**
- Docker Compose stack: Postgres (with pg_stat_statements), ClickHouse, and Redpanda
- Postgres custom image with `pg_stat_statements` and HypoPG extensions pre-loaded
- ClickHouse query fingerprint schema using AggregatingMergeTree and materialized view
- `.env.example` with all required configuration variables documented

**Query Collection**
- Ruby collector that reads `pg_stat_statements`, normalizes SQL fingerprints, and
  ships query events to ClickHouse via HTTP bulk insert
- Redpanda consumer for streaming query events (alternative to direct collector path)
- Query comment parser that extracts `source_tag` and `source_file` from pg comments

**A2A Agent Service**
- TypeScript A2A agent server implementing `analyze_db` and `analyze_table` skills
- `DBSpecialistExecutor` orchestrating the full fix pipeline: detect → locate → validate → propose → record → open PR
- `ClickHouseTool` that ranks top query offenders by total execution time with severity tiers
- `ExplainTool` that runs `EXPLAIN ANALYZE` with a SELECT-only guard against destructive SQL
- `MemoryTool` backed by SQLite that prevents duplicate suggestions and tracks fix history
- `CodeSearchTool` that finds Rails source files by controller/action from query comments
- `DemoRepoTool` that applies code fixes to the demo Rails repo, creates per-fingerprint git branches, and returns a diff for PR creation
- `GitHubTool` that opens pull requests against the demo repo with diff evidence and EXPLAIN output
- `IndexValidationTool` stub (wired for Phase 2 HypoPG implementation)

**Demo App**
- Rails demo app with four seeded anti-patterns: N+1 query, slow LIKE scan, missing index, unscoped query
- Repeatable load harness to drive realistic pg_stat_statements data
- Smoke tests that verify the demo app scaffold via `DEMO_APP_ROOT` environment variable

**Tests**
- 51 agent TypeScript unit and integration tests (A2A flow, per-fingerprint branches, memory tool, explain guard, ClickHouse tool)
- 12 Ruby collector tests (query parsing, comment extraction, ClickHouse connection)
- 9 Python smoke/docs tests (compose structure, demo repo split, README accuracy)

### Fixed

- ClickHouse offender ranking now uses `total_exec_time_ms` (not count) so heavy queries surface correctly
- Demo repo branch names are sanitized and include a SHA suffix to avoid collisions
- `git checkout -B` used for idempotent branch recreation on demo retries
- PR metadata (`headRef`, `codeDiff`) properly threaded from DemoRepoTool through executor to GitHubTool
- Smoke tests updated to use `DEMO_APP_ROOT` env var after demo app moved to sibling repo

### Infrastructure

- Security TODOs documented: ClickHouse port binding (localhost-only) and A2A endpoint auth (bearer token)
- `.gstack/` added to `.gitignore` so local review reports stay off remote
