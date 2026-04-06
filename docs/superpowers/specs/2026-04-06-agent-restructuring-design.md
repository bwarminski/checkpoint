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

- Docker images pushed to GitHub Container Registry
- A standalone compose file for running the full pipeline locally
- ClickHouse DDLs baked into the image or applied on startup

### Impact on agent dev workflow

- `docker compose up` pulls pre-built images instead of building from local source
- ClickHouse schema changes happen in the collector repo

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

`LoopRunEvidence` is created per-investigation-run (not per-session — a session
can contain multiple investigations). The extension resets evidence when the user
starts a new investigation prompt. Evidence gates remain unchanged.

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
- `LoopRunEvidence` is per-session, no cross-session bleed
- Target repo isolation via separate working directories or volume mounts

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
