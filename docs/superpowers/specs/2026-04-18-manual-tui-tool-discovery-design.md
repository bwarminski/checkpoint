# Manual TUI Tool Discovery Design

## Goal

Make the manual `oh-my-pi` TUI loop in `README.md` true for a fresh generated workspace. After running `bash scripts/setup-oh-my-pi-workspace.sh` and starting `omp` from `~/.oh-my-pi-workspaces/checkpoint`, the generated workspace must expose the coarse SQL tools through native `.omp/tools` discovery.

## Root Cause

The generated workspace currently symlinks:

- `.omp/skills -> <repo>/skills`
- `.omp/tools -> <repo>/src/tools`

That works for skills, but it does not work for native custom-tool discovery. `oh-my-pi` discovers custom tools from executable files directly under `.omp/tools` or from subdirectories that contain `index.ts`. The repo’s `src/tools` tree is domain code, not a discoverable custom-tool layout. It contains nested source files like `src/tools/postgres/*.ts`, `src/tools/clickhouse/*.ts`, and `src/tools/shared/*.ts`, so a fresh TUI session only sees built-in tools.

The SDK-backed tests still pass because they inject tool definitions explicitly. The manual TUI path and the SDK path are currently using different runtime wiring.

## Approach

Keep the repo as the source of truth for tool logic, but generate a real `.omp/tools` directory in the workspace instead of symlinking `src/tools` directly.

The generated workspace should contain one discoverable custom-tool directory per coarse SQL tool:

- `.omp/tools/sql_db_list_tables/index.ts`
- `.omp/tools/sql_db_schema/index.ts`
- `.omp/tools/sql_db_checker/index.ts`
- `.omp/tools/sql_db_query/index.ts`
- `.omp/tools/clickhouse_db_list_tables/index.ts`
- `.omp/tools/clickhouse_db_schema/index.ts`
- `.omp/tools/clickhouse_db_checker/index.ts`
- `.omp/tools/clickhouse_db_query/index.ts`

Each generated `index.ts` should be a thin shim that imports a repo-owned `CustomToolFactory` from a small adapter layer and exports it as default.

## Adapter Boundary

The repo-owned adapter layer should bridge the current domain logic into native `oh-my-pi` custom tools:

- create real Postgres and ClickHouse runners from the existing environment variables
- expose the eight LangChain-style tool names
- reuse the current coarse SQL tool behavior and output contracts
- share one live model-backed checker adapter between the native TUI custom tools and the SDK-backed integration helper

The adapter layer should not move the domain logic out of `src/tools`. It should only provide the native custom-tool surface and the runtime glue that the SDK helper can also reuse.

## Verification

The implementation is complete when all of the following are true:

- the workspace setup test fails before implementation because the workspace still exposes a `.omp/tools` symlink instead of discoverable custom-tool directories
- the generated workspace contains discoverable `.omp/tools/<name>/index.ts` modules
- the README/manual smoke path is updated to match the actual CLI invocation
- the Bun SDK live integration path still passes
- a fresh manual run from `~/.oh-my-pi-workspaces/checkpoint` lists the coarse SQL tools in the TUI
