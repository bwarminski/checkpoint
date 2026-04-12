# oh-my-pi MVP Redesign

## Goal

Reduce the current checkpoint scope to an MVP that proves real agent behavior
before rebuilding higher-level runtime plumbing. The MVP should let Brett run
manual verification loops in an `oh-my-pi` TUI, observe the agent inspect real
database state, and see it produce a local diff in a demo application checkout.

## Scope

This redesign applies to the `checkpoint` repo only.

The new MVP:

- removes the current A2A runtime path from the main implementation
- replaces `pi-mono` with `oh-my-pi`
- removes `applyLoopEvent` and moves the intended behavior into agent skills
- replaces fine-grained specialist tools with coarse SQL exploration tools
- runs the agent from a generated external workspace instead of the main repo
- clones or refreshes the demo app into a dedicated agent working directory
- keeps local orchestration for the databases and manual verification loop

The MVP does not include:

- GitHub PR automation
- A2A support
- permission sandboxing beyond Brett's normal local permissions
- compatibility shims for the removed runtime path

Before the cut, the repo should receive a git tag so the current architecture
remains easy to recover from history if needed.

## Architecture

After the redesign, this repo remains the source of truth for:

- custom tool implementations
- agent skills
- SDK integration tests
- local orchestration scripts and config
- documentation for the manual verification flow

The runnable agent lives in a generated `oh-my-pi` workspace outside the main
checkout. That workspace is the runtime surface for the TUI and SDK session
tests, while this repo remains the maintained codebase.

The agent workspace should contain:

- the minimal `oh-my-pi` project structure needed to run the agent
- symlinks back to repo-owned skills and tools
- a working area for the demo app clone
- runtime configuration for Postgres and ClickHouse access

This separation keeps the agent's writable surface away from the main repo while
still allowing the repo to preserve its useful test and orchestration structure.

## Workspace Model

The generated agent workspace is persistent by default so Brett can iterate in
the TUI without paying full setup cost on every run. The repo should also
provide a reset path that recreates or cleans the workspace for reproducible
verification runs.

The demo application is not stored in this repo. The agent workflow clones or
refreshes the external demo repo into the dedicated working area inside the
generated workspace.

The agent runs with Brett's inherited local permissions for the MVP. The design
assumes the agent can write files in its working area and may create local git
commits there, but the redesign does not add new permission enforcement
machinery.

## Tool Surface

The current specialist tools are too fine-grained for the MVP. The redesign
replaces them with coarse SQL exploration tools that let the agent inspect
database state directly.

### Postgres

Expose four Postgres tools modeled on the LangChain SQL agent pattern:

- `sql_db_list_tables`
- `sql_db_schema`
- `sql_db_checker`
- `sql_db_query`

### ClickHouse

Expose the parallel ClickHouse tool family:

- `clickhouse_db_list_tables`
- `clickhouse_db_schema`
- `clickhouse_db_checker`
- `clickhouse_db_query`

Postgres and ClickHouse remain separate tool families. The dialects, safety
checks, and expected usage differ enough that a single generic SQL tool would
make the MVP less clear.

The ClickHouse surface also needs a supporting catalog that explains the
available performance tables and the meaning of the important columns so the
agent can reason about the observability model without reverse engineering it
from raw DDL alone.

The redesign removes the current `clickhouse_tool`, `demo_repo_tool`, and
`github_tool`. The agent should focus on diagnosis and local fixing. Repo
mutation and PR automation can return later if the MVP proves they are still
worth the complexity.

## Agent Workflow

The agent should be guided by an explicit skill rather than hidden runtime event
logic. That skill should instruct it to:

1. inspect the demo repo checkout and relevant application files
2. explore Postgres schema and ClickHouse performance data
3. form a concrete hypothesis about the highest-value issue
4. validate that hypothesis with real queries
5. make a conservative local code change
6. verify the change with the same evidence path when possible
7. optionally create a local git commit

This replaces `applyLoopEvent` with inspectable, editable instructions that can
evolve without adding orchestration machinery prematurely.

## Verification

The redesign uses two verification layers.

### Manual TUI loop

This is the primary proof. Brett runs the generated `oh-my-pi` workspace in the
TUI, gives the agent a plain-language objective, and inspects the agent's tool
use, reasoning, local diff, and optional commit.

### SDK integration tests

The repo should also provide a thin automated harness that creates an
`oh-my-pi` session against the generated workspace and verifies the agent can
load the custom tools, follow the intended workflow, and complete constrained
scenarios without the removed runtime stack.

## Success Criteria

The redesign is successful when:

- the old A2A and `pi-mono` path is removed from the main implementation
- the code footprint is materially smaller
- the agent runs from a generated external workspace
- the agent can clone or refresh the demo repo into that workspace
- the agent can inspect both Postgres and ClickHouse through coarse tools
- Brett can run a manual TUI loop that reaches diagnosis and a local diff

## Open Decisions Resolved During Brainstorming

- Hard cut the current runtime path instead of a compatibility phase
- Add a git tag immediately before the cut
- Rebuild around `oh-my-pi`
- Keep local orchestration in this repo
- Run the agent from a generated external workspace with symlinked tools/skills
- Make the workspace persistent by default with a reset path
- Support both Postgres and ClickHouse from day one
- Allow local file edits and optional local commits in the demo checkout
