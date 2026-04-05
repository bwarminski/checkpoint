# Phase 2 Architecture Addendum

## Purpose

This addendum replaces stale assumptions in
`docs/superpowers/plans/2026-04-05-phase2-implementation-plan.md` before Phase 2
implementation starts. It keeps the task order intact while correcting the
architecture to match the current repo and the approved design discussion with Brett.

## Approved Changes

### 1. ClickHouseTool moves to a new primary interface with no compatibility layer

Phase 2 will not preserve `ClickHouseTool.topOffenders()` for backward compatibility.
That would violate the repo rule requiring explicit approval before adding backward
compatibility, and Brett chose the clean break instead.

The approved direction is:

- `ClickHouseTool` exposes discovery/query methods for the agent loop
- the executor bridge and tests move to those methods directly
- any deterministic helper logic needed during migration should live outside the
  compatibility surface

This keeps the tool interface aligned with the `pi-agent-core` loop instead of
anchoring Phase 2 to the deterministic executor shape.

### 2. Memory storage format is not changing yet

The earlier draft widened Phase 2 by replacing the current SQL-backed `MemoryTool`
with a JSONL store. That is not approved for the main path.

The current repo already has:

- SQL schema in `agent/db/001_memory_schema.sql`
- runtime bootstrap in `agent/src/runtime_dependencies.ts`
- tests in `agent/test/memory_tool.test.ts`

Phase 2 will keep that storage model unless a later checkpoint proves it is the wrong
 fit. The approved plan is:

- stabilize the `pi-agent-core` loop first
- keep the existing memory contract available during that work
- add a checkpoint after the loop is stable that exercises memory through the real
  agent flow
- decide after that checkpoint whether SQL-backed memory is sufficient or whether a
  follow-on migration is justified

### 3. LLM provider choice stays open

Phase 2 must not require `ANTHROPIC_API_KEY` as the default configuration contract.
The runtime should remain open to multiple providers and local/self-hosted models.

The plan will therefore treat model selection as provider-agnostic:

- `LLM_MODEL` is the primary configuration input
- its value should be a canonical provider-qualified model reference
- provider credentials come from the selected backend's normal environment variables
- optional fallback models may be added after the primary path works

This direction is informed by OpenClaw's provider-qualified model selection and
provider-specific credential handling, but without importing OpenClaw's full auth and
model registry system into this repo.

### 4. Task 1 stays small and practical

The Config Cleanup task remains a warm-up task, but the implementation plan should not
add avoidable dependency churn just to load `.env` during tests.

Approved refinements:

- the Node agent may use `dotenv` because it is part of the runtime startup path
- Python test startup should prefer a tiny stdlib loader in `tests/conftest.py`
  instead of adding a new Python dependency system solely for `python-dotenv`
- Ruby test startup should prefer a small helper over extra global setup unless a gem
  is clearly justified by the existing collector test shape
- `.env.example` and `README.md` should be updated together so the documented contract
  matches the actual runtime behavior

### 5. The rewritten plan replaces the untracked draft

Brett approved replacing the existing untracked
`docs/superpowers/plans/2026-04-05-phase2-implementation-plan.md` rather than trying
to patch stale assumptions in place. `JOURNAL.md` records that approval.

## Resulting Task Shape

The implementation plan should keep the user-approved task order, with one important
checkpoint inserted:

1. Config and env cleanup
2. Collector rows examined support
3. ClickHouseTool query/discovery interface
4. Memory integration cleanup without storage migration
5. `pi-agent-core` loop and executor bridge
6. Memory usefulness checkpoint through the stabilized loop
7. End-to-end smoke test

This sequencing preserves the intended vertical slice while preventing the storage
rewrite and provider lock-in from expanding the critical path.
