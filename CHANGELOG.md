# Changelog

All notable changes to this project will be documented in this file.

## [0.4.0] - 2026-04-19

oh-my-pi MVP: replace A2A/pi-mono runtime with 8 coarse SQL tools exposed through the oh-my-pi extension API.

### Removed
- `src/a2a_bridge/` — A2A server and all protocol handlers
- `src/agent_tools.ts` — fine-grained specialist tool aggregator
- `agent/` package — pi-mono / pi-agent-core runtime
- `clickhouse_tool.ts`, `demo_repo_tool.ts`, `github_tool.ts` — specialist tools

### Added
- `src/omp_extension/db_specialist_extension.ts` — oh-my-pi extension entry point registering all 8 tools
- `src/omp_extension/tool_runtime.ts` — extension-owned model invocation and tool adaptation
- `src/omp_tools/` — SDK adapter layer: Postgres and ClickHouse tool definitions with injectable completion
- 8 coarse SQL tools (4 Postgres + 4 ClickHouse): query, schema, list_tables, checker
- `src/tools/shared/` — shared contracts: result_formatter, schema_formatter, identifier, query_limits, query_checker
- `scripts/setup-oh-my-pi-workspace.sh` and `scripts/reset-oh-my-pi-workspace.sh`
- `skills/db-investigation/SKILL.md` — ClickHouse catalog and investigation workflow
- `omp-walkthrough.md` — showboat code walkthrough of the three-layer architecture
- `AGENTS.md` — model integration gate policy

### Changed
- Query tools enforce row caps and timeouts (LangChain SQL agent pattern)
- Schema tools fetch 3 sample rows and return formatted text
- Postgres pool now configured with `idleTimeoutMillis` and `connectionTimeoutMillis`
- ClickHouse HTTP fetch now has a 30-second abort timeout
- `@oh-my-pi/pi-ai` declared as explicit devDependency (was implicit via hoisting)
- ESM module cache busted in extension load and workspace session creation

### Fixed
- SQL checker prompt extracted to shared constant (`CHECKER_SYSTEM_PROMPT`)
- SDK extension fields mirrored in local ToolDefinition types (`hidden`, `defaultInactive`, `deferrable`, etc.)
- Dead NativeCustomToolFactory exports removed, eliminating omp_tools → omp_extension layering violation

## [0.1.0.0] - 2026-04-12

Collector correctness: adopt queryid, comment_metadata, and postgres_logs source-location join.

### Changed

**ClickHouse findings contract**
- Findings now use `queryid` (Postgres internal query ID from `pg_stat_statements`) instead of `fingerprint` everywhere: tool interfaces, agent parameters, branch naming, PR body, and all tests
- `statement_text` replaces `sample_query` as the field name for the representative SQL statement
- `avg_exec_time_ms` replaces `p95_exec_time_ms` as the execution-time metric; the 100 ms high-severity threshold is retained

**Source location via comment metadata**
- `ClickHouseTool` now joins `postgres_logs` to resolve source location from `comment_metadata['source_location']` rather than a dedicated `source_file` column; falls back to `query_intervals.comment_metadata['source_location']` when no raw-log row matches
- `ClickHouse Map['key']` returns `''` for missing keys; the SQL uses `nullIf(..., '')` before `coalesce` to make the fallback robust
- `postgres_logs` and `postgres_log_state` added to the supported table whitelist

**Schema smoke test**
- Smoke test now validates `comment_metadata Map` is present in `query_events`, `query_intervals`, and `postgres_logs`, and that the old `source_file`/`source_location` columns are absent
- Switched from `docker compose` to standalone `docker run` so the smoke test is isolated from the project's compose stack

### Fixed

- Removed a dead `?? row.statement_text` fallback in `parseOffenderRows` that could silently mask a missing `latest_statement_text` column alias
- Renamed stale `fingerprint` type in the `githubTool.openPullRequest` dependency interface to `queryid`

## [0.2.0.0] - 2026-04-06

Phase 2: LLM reasoning loop, per-loop evidence guardrails, and security hardening.

### Added

**LLM Agent Loop**
- `DBSpecialistExecutor` now drives a full pi-agent-core agent loop instead of deterministic orchestration
- Provider-agnostic model config via `LLM_MODEL` env var (supports `openai/`, `anthropic/`, etc.)
- `cancelTask` A2A method that aborts the active pi-agent-core agent and publishes a `canceled` status event
- `LoopRunEvidence` per-request guardrails: `apply_fix` requires prior `query_findings` call, validated query, and source lookup; `open_pull_request` requires a prepared fix from the same loop run
- `analyze_query` tool wrapping `ExplainTool` for guarded EXPLAIN ANALYZE validation
- `locate_source` tool wrapping `CodeSearchTool` to load source context by file or tag
- Memory tools (`search_memory`, `record_memory`) exposed to the agent loop
- Hybrid markdown + append-only JSONL memory backend for durable agent memory
- A2A `submitted` / `working` / `completed` / `failed` / `canceled` lifecycle events

**Security Fixes**
- `DemoRepoTool` now rejects `source_file` paths that escape the demo repo root (path traversal guard)
- `MemoryTool` writeQueue poison fixed: a failed append no longer permanently blocks subsequent `record()` calls
- `MemoryTool` walks memory root gracefully when the directory does not yet exist (no unhandled ENOENT)
- `DBSpecialistExecutor` publishes a `failed` status event when `agent.prompt()` throws, closing the SSE stream
- `preparationsByFingerprint` now keys on `(fingerprint, fix_type)` pair, preventing second `apply_fix` call from clobbering the first preparation

**Tests**
- 75 agent TypeScript unit and integration tests (up from 51), covering agent loop event bridging, A2A lifecycle, guardrail enforcement, path traversal rejection, writeQueue recovery, cancelTask, and the full default pi-agent-core path with a local streamFn

### Changed

- `DBSpecialistExecutor` constructor accepts `createAgent` and `streamFn` overrides for test injection
- Fallback task/context IDs extracted to named constants (`FALLBACK_TASK_ID`, `FALLBACK_CONTEXT_ID`)
- `ClickHouseTool.queryFindings` returns `allTime: false` (60-minute window) by default; all-time aggregates use `query_fingerprints` AggregatingMergeTree

---

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
