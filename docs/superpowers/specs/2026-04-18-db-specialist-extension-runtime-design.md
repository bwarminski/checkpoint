# DB Specialist Extension Runtime Design

## Goal

Replace the current discovered-custom-tool runtime for the DB specialist with an `oh-my-pi` extension-owned runtime. The manual TUI loop should stop depending on generated `.omp/tools/<name>/index.ts` shims for the eight SQL tools and instead load the DB specialist tool surface through a generated project-local extension.

This change is specifically about runtime integration. The repo should continue to own the SQL domain logic, output formatting, and testable tool behavior in normal source modules.

## Root Cause

The current manual TUI integration uses discovered custom tools generated under `.omp/tools/`. That was enough for list, schema, and query tools, but it breaks down for checker tools because the checker needs model execution inside the running `omp` process.

The discovered custom-tool API gives the tool:

- `ctx.model`
- `ctx.modelRegistry`
- `ctx.sessionManager`

but it does not provide a first-class host-owned model completion helper. The current checker fills that gap by importing `@oh-my-pi/pi-ai` from repo-owned code. In the manual TUI path, that causes the running `omp` process to load a second copy of `@oh-my-pi/pi-natives` from the repo worktree after the global `omp` runtime has already loaded its own copy. On Linux this fails with `cannot allocate memory in static TLS block`.

This is not just one bad import. It is a runtime-boundary mistake:

- discovered custom tools are intended to rely on injected host dependencies
- the checker needs a host-owned model execution capability that the current custom-tool surface does not expose
- our current implementation escapes that boundary and imports repo-local runtime packages directly

## Approach

Stop using discovered custom tools as the runtime integration mechanism for the DB specialist. Use an extension as the host-facing runtime layer instead.

The generated workspace should expose a project-local extension under `.omp/extensions/` that loads repo-owned extension code. That extension should register the DB specialist tool family directly with `oh-my-pi` and own the session-aware runtime wiring needed for model-backed checker execution.

This is a flag-day cut for the DB specialist runtime. The generated `.omp/tools/<name>/index.ts` shims for the eight SQL tools should be removed rather than maintained in parallel with the extension path.

## Boundary

The extension runtime should be thin.

The extension should own:

- registration of the eight LangChain-style SQL tools
- creation of real Postgres and ClickHouse runners from environment variables
- host-aware checker execution against the running `omp` session/runtime
- adaptation from repo-owned tool logic to `oh-my-pi` extension/tool registration APIs

The repo-owned source modules should continue to own:

- query/list/schema/checker domain behavior
- identifier validation and limits
- schema and result formatting
- ClickHouse catalog content
- focused unit and integration tests that do not depend on the manual TUI runtime

This keeps the runtime boundary explicit:

- extension = host/runtime integration
- repo modules = DB specialist product logic

## Workspace Model

The generated workspace should continue to symlink or expose repo-owned skills in the current way. For the DB specialist runtime surface, it should stop generating `.omp/tools` shims and instead generate or symlink a `.omp/extensions` entrypoint for the DB specialist extension.

The manual TUI loop and the SDK-backed integration path should no longer depend on two unrelated runtime mechanisms for the same tool family. Where practical, the SDK test path should validate the same repo-owned extension/runtime adapter layer that the manual workspace uses.

## Verification

The implementation is complete when all of the following are true:

- the generated workspace contains an extension-based DB specialist runtime rather than `.omp/tools/<name>/index.ts` shims for the eight SQL tools
- a fresh manual TUI session from `~/.oh-my-pi-workspaces/checkpoint` can see and execute the DB specialist tools
- the checker path no longer loads repo-local `@oh-my-pi/pi-ai` into the running `omp` process
- the manual TUI checker path does not trigger the duplicate-`pi_natives` TLS failure
- the live integration path is updated so it validates the extension-owned runtime shape instead of the old discovered-custom-tool shape
- tests that assert the old `.omp/tools` DB specialist layout are removed or rewritten to match the extension-based runtime
