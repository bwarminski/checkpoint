# DB Specialist Agent Design

## Purpose

This document translates the CEO plan into a repo-specific build design for
`/home/bjw/checkpoint`. The CEO plan remains the source of truth. This spec
defines the file layout, implementation boundaries, phase gates, and execution
rules needed to build the system step by step without inventing extra scope.

## Source Documents

- CEO plan: `/home/bjw/.gstack/projects/checkpoint/ceo-plans/2026-04-03-db-specialist-agent.md`
- Engineering review test plan:
  `/home/bjw/.gstack/projects/checkpoint/bjw-master-eng-review-test-plan-20260403-232244.md`

## Constraints

- Follow the CEO plan Phase Build Order exactly.
- Work in `/home/bjw/checkpoint`.
- Use TDD for every feature and bugfix.
- Commit after each CEO-plan step completes.
- Create and maintain `JOURNAL.md` at the repo root during implementation.
- Stop and report at marked gates before proceeding.
- Avoid adding backward compatibility unless Brett approves it explicitly.
- Keep the implementation simple and phase-scoped.

## Build Sequence

The implementation plan will cover all ten CEO-plan steps in one document, with
execution stop points at:

1. Step 6 Gate A: verify `pi-agent-core` MCP client support before building the
   pluggable `CodeSearchTool`.
2. Step 8 completion: end-to-end demo working before optional follow-on work in
   Steps 9 and 10.

Steps 9 and 10 remain in the plan so execution order stays aligned with the CEO
plan, but they are follow-on phases after the end-to-end demo is proven.

## Repository Layout

The repo is effectively empty today, so the plan will define the initial
project structure instead of integrating into an existing application layout.

- `docker-compose.yml`
  Orchestrates Postgres with HypoPG, ClickHouse, Rails demo app, collector, and
  TypeScript agent service for local development.
- `postgres/`
  Custom Postgres image with HypoPG installed from the `postgres:16` base image.
- `demo/`
  Rails application that exposes four deliberate query anti-patterns and seed
  data. Query logs must include controller/action/source metadata.
- `collector/`
  Ruby polling process that reads `pg_stat_statements` and `pg_stat_activity`,
  parses ActiveRecord query comments, and inserts raw events into ClickHouse.
- `agent/`
  TypeScript service using `pi-mono` packages and `@a2a-js/sdk` to expose the
  A2A interface and run the DB specialist loop.
- `load/`
  Ruby harness that drives repeatable traffic against the Rails demo at safe
  local throughput.
- `docs/`
  Planning and design documents.
- `JOURNAL.md`
  Ongoing notes capturing what was built, decisions not already in the CEO
  plan, and anything that blocked execution.

## Phase Boundaries

### Step 1: Repo structure and Docker foundation

This step creates the local multi-service skeleton and proves the Postgres
image includes HypoPG. The design target is a runnable local stack, not a
production deployment system.

### Step 2: Rails demo app

This step creates a minimal Rails app with:

- QueryLogs metadata enabled
- Four fixed anti-pattern endpoints from the CEO plan
- Seed data sufficient to surface stable fingerprints under load

The anti-patterns are intentional demo behavior and should stay isolated to the
demo app rather than leaking into shared abstractions.

### Step 3: ClickHouse schema

This step defines raw event ingestion and aggregated fingerprints:

- `query_events` as the write target
- materialized view from raw events to aggregate states
- `query_fingerprints` as the read model

The spec explicitly preserves the CEO correction: no `ORDER BY` in the
materialized view definition.

### Step 4: Ruby collector

This step owns:

- polling `pg_stat_statements`
- sampling matching SQL from `pg_stat_activity`
- parsing Rails query comments
- inserting raw rows into `query_events`

The collector should fail clearly on transport errors and handle empty result
sets without crashing.

### Step 5: Load harness

This step creates a repeatable load driver for the four demo endpoints and
verifies that ClickHouse receives enough events to make fingerprints visible.
Target throughput stays in the CEO-plan range of roughly 10-20 req/s.

### Step 6: TypeScript agent service

This step introduces the A2A surface and tool package. The design target is a
single TypeScript service, not a polyglot control plane.

Expected responsibilities:

- Express-based A2A endpoint mounting with `@a2a-js/sdk`
- task lifecycle and event emission
- DB tools package containing ClickHouse, EXPLAIN, index validation, memory,
  GitHub, and code search integration points
- executor wiring that can support `analyze_db` and `analyze_table`

#### Gate A

Before implementing `CodeSearchTool`, execution must verify whether
`pi-agent-core` supports external MCP servers as clients. If native MCP client
support is missing or unsuitable, the fallback design is a raw HTTP-backed
`CodeSearchTool` with the same tool-facing contract.

#### SDK version pin

This step must record the exact pinned `@a2a-js/sdk` version chosen during
implementation. The pinned version must be reported, not left implicit in
`package.json`.

### Step 7: PlanetScale memory schema

This step is required before the final end-to-end workflow. The design keeps
the memory schema exactly aligned with the CEO plan:

- `findings`
- `suggestions`
- `pattern_log`

The key behavior is re-suggestion control based on
`fingerprint + fix_type + status`.

### Step 8: End-to-end demo

This step proves the system flow:

1. A2A task submitted
2. top offenders loaded from ClickHouse
3. source traced to code context
4. fix proposed
5. validation executed
6. PR decision applied

The PR open rule is fixed by the CEO plan and should be tested directly:
open a PR only when `severity=high`, `validated=true`, and there is no prior
`pending`, `accepted`, or `rejected` suggestion for the same
`fingerprint + fix_type`.

### Step 9: Blog skeleton

This is documentation work after the main demo is proven. It should stay out of
the critical path for Steps 1-8.

### Step 10: Redpanda phase

This extends ingestion transport without changing the ClickHouse read model.
Because it introduces native dependencies, the plan must include explicit
Docker-based validation before considering the step complete.

## Tool Boundaries

The implementation plan should keep the TypeScript tools narrow and separate:

- `ClickHouseTool`
  Reads top offenders and scoped offender data from ClickHouse.
- `ExplainTool`
  Runs `EXPLAIN ANALYZE` inside a rolled-back transaction and rejects
  destructive SQL before execution.
- `IndexValidationTool`
  Uses HypoPG to estimate index benefit without creating a real index.
- `CodeSearchTool`
  Resolves source context through a pluggable MCP-facing interface.
- `GitHubTool`
  Opens or updates PRs against the configured demo repo.
- `MemoryTool`
  Reads and writes the suggestion history and pattern log.

These tools should share only the smallest common contracts needed by the
executor.

## Test Strategy

The implementation plan should encode TDD directly into each task. For each
phase step, the plan should break work into micro-steps:

1. write a failing test
2. run it and confirm failure
3. implement the smallest change
4. rerun tests and confirm success
5. commit the completed CEO-plan step

The supporting engineering review already identified the first critical tests to
land:

- query comment parser edge cases
- `ExplainTool` SELECT-only safety guard
- `MemoryTool` re-suggestion rules
- collector sample query capture
- full `analyze_db` end-to-end flow
- full `analyze_table` end-to-end flow

The implementation plan should fold those tests into the matching phase steps
instead of adding a detached test-only phase.

## Gate Reporting

When execution reaches a gate, it must stop and report findings before moving
forward. The plan should make those pause points explicit so they are not lost
inside larger tasks.

- Step 6 Gate A report: `pi-agent-core` MCP client support findings
- Step 6 report item: exact `@a2a-js/sdk` version pinned

## Non-Goals

The implementation plan must not add work outside the CEO plan’s accepted scope.
In particular, it should not introduce:

- Go services
- Python services
- gRPC transport
- `pg_stat_monitor`
- extra multi-database scoping
- production concurrency deduplication beyond what the CEO plan already deferred

## Expected Output of Planning

The next document should be a single implementation plan that:

- follows CEO-plan Steps 1-10 in order
- names exact files for each task
- uses explicit TDD micro-steps
- includes exact test commands and commit boundaries
- marks gate stop points clearly
- remains small and practical rather than speculative
