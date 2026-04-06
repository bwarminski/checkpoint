# Agent Restructuring Design

Split the monorepo into focused components and convert the agent into a pi package
with Docker-based isolation.

## Context

The checkpoint repo currently contains three concerns in one repository:

1. A Ruby stats collector that polls Postgres and feeds ClickHouse
2. A memory tool for cross-run agent state
3. A TypeScript agent that investigates database performance issues

The agent is only exercisable through A2A (JSON-RPC/REST), which limits iteration
speed. The goal is to separate these concerns and make the agent interactive,
testable, and deployable in isolated customer containers.

## Decisions

- **Approach B (sequential splits)** — extract collector first, branch memory, then
  convert to pi package. Each phase is independently shippable.
- **Pi package** over standalone harness — we already depend on pi-agent-core and
  pi-ai; pi's extension system gives us TUI, session management, and model cycling
  for free.
- **Single package** — all tools and skills ship together as one pi package.
- **Docker container per customer** — each customer gets a container that can host
  multiple pi sessions. Firecracker VMs are a future deployment detail.
- **A2A as a thin bridge** — not the primary interface. It creates/manages pi
  sessions inside containers.
- **Lightweight safety gates** — `apply_fix` and `open_pull_request` re-validate
  preconditions at call time against DB/tool state rather than an in-memory audit
  trail. This preserves deterministic guardrails without the per-run evidence object.
- **Versioned schema contract** — collector images are tagged with a schema version.
  The agent verifies the ClickHouse table shape at startup and integration tests pin
  to a specific collector image version.

---

## Phase 1: Extract Collector to Separate Repo

### What moves out

- `collector/` — all Ruby code, tests, Gemfile, Dockerfile, `bin/`
- `collector/db/clickhouse/` — all ClickHouse DDL files
- `clickhouse/users.d/` — ClickHouse user config
- `postgres/` — init SQL and Dockerfile
- `load/` — load harness
- Compose service definitions for: postgres, clickhouse, redpanda, collector, demo

### What stays

- `agent/` — untouched
- A new slim `docker-compose.yml` that pulls published images for ClickHouse (with
  data flowing) and Postgres (with demo schema)
- `tests/smoke/` — updated for new compose structure
- `docs/`, `JOURNAL.md`, `README.md` — updated references

### New collector repo produces

- Docker images pushed to GitHub Container Registry, tagged with a `SCHEMA_VERSION`
  label (e.g. `ghcr.io/checkpoint/collector:latest` + `SCHEMA_VERSION=2`)
- A standalone compose file for running the full pipeline locally
- ClickHouse DDLs baked into the image or applied on startup
- A machine-readable schema contract file listing expected table names and column
  shapes (consumed by the agent's startup check)

### Hard prerequisite

**The collector repo must publish at least one image before Phase 1 merges here.**
The slim compose in this repo pulls pre-built images. If those images don't exist,
local dev is broken. Create the collector repo and run its CI first.

### Impact on agent dev workflow

- `docker compose up` pulls pre-built images instead of building from local source
- ClickHouse schema changes happen in the collector repo and require a version bump
- Agent startup validates the connected ClickHouse schema version matches expectations

---

## Phase 2: Branch Out Memory

### What gets removed

- `agent/src/tools/memory_tool.ts`
- `agent/memory/` directory
- `search_memory` and `record_memory` tool definitions in `agent_tools.ts`
- `memoryTool` field from `AgentToolDependencies`
- `MemoryTool` instantiation in `runtime_dependencies.ts`
- Memory-related test files
- System prompt lines about searching/recording memory

### What gets created

- A `memory-tool` branch preserving the implementation for later reintroduction
- A tag or commit marker for clean cherry-pick

### What stays

- `LoopRunEvidence` (per-run state, not persistent memory)
- Everything else in `agent_tools.ts`

### Impact

The LLM loses cross-run memory. The core investigation flow is unaffected — evidence
gates are entirely in-run state. The optional deps pattern means nothing breaks;
`buildAgentTools` just skips the memory tools.

---

## Phase 3: Convert Agent to Pi Package

### 3a. Package Structure

The repo root becomes a pi package with this manifest in `package.json`:

```json
{
  "name": "@checkpoint/db-specialist",
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"]
  }
}
```

**Extension** (TypeScript, registers custom tools via pi's `registerTool` API):

| Tool | Source |
|------|--------|
| `query_findings` | `clickhouse_tool.ts` |
| `list_tables` | `clickhouse_tool.ts` |
| `describe_table` | `clickhouse_tool.ts` |
| `query_database` | `clickhouse_tool.ts` |
| `analyze_query` | `explain_tool.ts` |
| `locate_source` | `code_search_tool.ts` |
| `apply_fix` | `demo_repo_tool.ts` |
| `open_pull_request` | `github_tool.ts` |

**Extension entry point pattern:** A single `extensions/db-specialist.ts` file
exports a default function `(pi: ExtensionAPI) => void`. It instantiates shared
tool objects once at load time from env vars (one `ClickHouseTool`, one
`ExplainTool`, etc.) and registers all eight tools. Tool instances are reused
across calls within a session.

**Safety gates (lightweight re-validation):** `apply_fix` and `open_pull_request`
do not use an in-memory audit trail. Instead each gated tool re-validates its
preconditions at call time:

- `apply_fix` — re-reads the finding severity from the LLM's provided fingerprint
  by calling `queryFindings` internally (or accepts it from the LLM input and
  validates `severity === "high"`), checks that `analyze_query` was called by
  requiring a non-empty `validation` input from the LLM, and requires
  `source_file` to be present.
- `open_pull_request` — requires `headRef` and `codeDiff` to be non-empty inputs
  (only `apply_fix` produces these; the LLM cannot invent valid values).

This preserves deterministic enforcement without a per-run shared object. The LLM
cannot bypass `apply_fix` severity or validation requirements via conversational
context alone.

**Skills** (markdown, loaded on demand):

- Investigation skill — describes the DB specialist workflow, severity thresholds,
  expected tool-call sequence
- Fix skill — guides the apply-fix to PR flow

**What goes away:**

| File | Replacement |
|------|-------------|
| `server.ts` | A2A becomes a separate thin entry point (3c) |
| `executor.ts` | Pi's `Agent` + `AgentSession` |
| `runtime_dependencies.ts` | Extension initialization |
| `llm_config.ts` | Pi handles model selection natively |

**What survives, restructured:**

- All six tool implementation files — these are the domain logic
- `agent_tools.ts` evidence gate logic — adapted to pi's `registerTool` API
- Test files — adapted to the new structure

### 3b. Container Image

The deployment unit is a Docker image per customer supporting multiple pi sessions.

**Image contents:**

- Node.js runtime
- `pi` CLI installed globally
- `@checkpoint/db-specialist` package installed
- System dependencies: git, pg client libs

**Runtime configuration (environment variables):**

| Variable | Purpose |
|----------|---------|
| `CLICKHOUSE_URL` | Collector's ClickHouse |
| `POSTGRES_URL` | Target app's Postgres (for EXPLAIN) |
| `GITHUB_TOKEN` | PR creation |
| `DEMO_REPO` | Target GitHub repo |
| `DEMO_BASE_REF` | PR base branch |
| `CODE_SEARCH_ROOT` | Path to mounted target repo |
| `LLM_MODEL` | Provider/model for the LLM |

**Session isolation within a container:**

- Pi sessions are independent — separate conversation history and context
- Target repo isolation via separate working directories or volume mounts
- Concurrent sessions share the Node process; LLM call concurrency is bounded by
  the provider's rate limits. No hard session cap is enforced for now — revisit
  once observed memory/CPU usage under multi-session load is known.

**Testing:**

- Unit tests run bare, locally
- Integration tests `docker run` a fresh container, use pi's print/RPC mode to
  drive sessions programmatically, assert on output
- Container connects to ClickHouse/Postgres from a test compose stack

### 3c. A2A Bridge

A2A becomes a thin entry point layered on top of pi sessions. Built last.

**Architecture:**

- Small Node service that speaks A2A externally
- `message/send` maps to a pi session: creates one if new context, resumes if existing
- Uses pi's SDK (`createAgentSession`) or RPC mode to drive sessions
- Translates pi session events to A2A status updates

**Session registry:**

The bridge maintains a sidecar JSON file (`/var/lib/checkpoint/sessions.json`)
mapping A2A `contextId` to pi session path:

```json
{ "ctx-abc123": { "sessionPath": "/sessions/abc123", "createdAt": "...", "lastActiveAt": "..." } }
```

Rules:
- One pi session per A2A `contextId`. New `contextId` → new pi session.
- Concurrent `message/send` calls for the same `contextId` are serialized (queued,
  not parallelized) to prevent interleaving.
- Sessions with `lastActiveAt` older than 24 hours are eligible for cleanup on
  bridge startup or on a background interval.
- On bridge restart, the registry is read from disk — session resume works across
  restarts. If a session path no longer exists on disk, the entry is dropped and
  a fresh session is created on the next request.
- Cancellation (`tasks/cancel`) calls pi's session abort and marks the entry as
  cancelled in the registry.

**Sequence:**

1. Pi package works standalone first — `pi` in terminal, extension loads, interactive
   DB specialist conversation
2. A2A bridge is layered on once standalone works
3. Firecracker VM isolation is a future deployment concern, out of scope here

---

## Out of Scope

- Firecracker VM orchestration and per-customer provisioning
- Memory tool reimplementation (preserved on branch for later)
- Collector repo setup and CI (separate effort)
- Multi-database support beyond the demo Postgres app
