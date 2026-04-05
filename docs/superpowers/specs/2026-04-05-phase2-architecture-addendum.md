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

- `ClickHouseTool` exposes discovery and query methods for the agent loop
- the executor bridge and tests move to those methods directly
- deterministic helper logic, if temporarily needed, stays outside the public tool
  interface

### 2. Memory becomes agent memory, not a workflow ledger

The earlier draft was still treating memory as a structured workflow store for routine
agent-loop findings and PR dedupe. That is no longer the design.

The approved role for `MemoryTool` is:

- persist durable discoveries that matter across turns or sessions
- persist user preferences and architectural constraints
- persist lessons from failed or invalid fix attempts
- provide retrieval during investigation and solution exploration

The agent loop should not write every ordinary finding from a query analysis pass into
memory. The loop should look at current statistics, source, and plans directly, then
use memory selectively when:

- looking for prior context that code and metrics do not reveal
- checking whether a similar attempt failed before
- understanding user intent or architecture constraints
- recording a durable lesson after a failed or constrained attempt

### 3. Memory storage becomes a hybrid markdown-plus-JSONL model

Phase 2 will not keep the SQL-backed memory schema in the main path.

The approved direction is a hybrid inspired by OpenClaw and gstack:

- markdown memory for human-readable durable knowledge
- JSONL append-only event storage for machine-friendly history
- one `MemoryTool` that searches both and returns normalized results

The planned responsibilities are:

- `MEMORY.md` and `memory/*.md`
  - durable preferences
  - architecture constraints
  - curated discoveries worth keeping visible to humans
- `memory/events.jsonl`
  - failed attempts
  - notable outcomes
  - machine-friendly event history that should not be hand-edited

This keeps memory readable and inspectable while still giving the agent a structured
append path.

### 4. LLM provider choice stays open

Phase 2 must not require `ANTHROPIC_API_KEY` as the default configuration contract.
The runtime should remain open to multiple providers and local/self-hosted models.

The plan will therefore treat model selection as provider-agnostic:

- `LLM_MODEL` is the primary configuration input
- its value uses canonical `provider/model` format
- provider credentials come from the selected backend's normal environment variables
- optional fallback models may be added after the primary path works

This direction is informed by OpenClaw's provider-qualified model selection without
pulling its full auth and model registry system into this repo.

### 5. Task 1 stays small and practical

The Config Cleanup task remains a warm-up task, but the implementation plan should not
add avoidable dependency churn just to load `.env` during tests.

Approved refinements:

- the Node agent may use `dotenv` because it is part of the runtime startup path
- Python test startup should prefer a tiny stdlib loader in `tests/conftest.py`
- Ruby test startup should prefer a small helper over extra global setup unless a gem
  is clearly justified
- `.env.example` and `README.md` should be updated together so the documented contract
  matches the actual runtime behavior

### 6. The rewritten plan replaces the untracked draft

Brett approved replacing the existing untracked
`docs/superpowers/plans/2026-04-05-phase2-implementation-plan.md` rather than trying
to patch stale assumptions in place. `JOURNAL.md` records that approval and the updated
memory direction.

## Resulting Task Shape

The implementation plan should keep the approved task order in this form:

1. Config and env cleanup
2. Collector rows examined support
3. ClickHouseTool query and discovery interface
4. Hybrid memory system for preferences, discoveries, and failed attempts
5. `pi-agent-core` loop and executor bridge
6. End-to-end smoke test

This sequencing preserves the intended vertical slice while removing both the old SQL
memory assumption and the no-longer-needed memory checkpoint task.
