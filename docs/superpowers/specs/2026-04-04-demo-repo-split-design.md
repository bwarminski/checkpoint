# Demo Repo Split Design

## Purpose

This spec defines how the Rails demo app moves out of
`/home/bjw/checkpoint/demo` into a sibling repo at
`/home/bjw/db-specialist-demo`, while keeping the DB specialist stack working
locally and enabling real GitHub pull requests against the demo app repo.

## Source Context

- CEO source-of-truth plan:
  `/home/bjw/.gstack/projects/checkpoint/ceo-plans/2026-04-03-db-specialist-agent.md`
- Current implementation branch:
  `wip-db-specialist-agent-plan`
- Deferred-items note:
  `/home/bjw/checkpoint/TODOS.md`

## Goals

- Make the demo app a separate sibling repo and single source of truth.
- Rewire local compose, code search, and docs to use `DEMO_APP_ROOT` instead of
  the in-repo `demo/` directory.
- Preserve the current local end-to-end demo flow after the split.
- Add real GitHub PR creation when `GITHUB_TOKEN` and `DEMO_REPO` are set.
- Improve fix classification so the agent can emit different `fix_type` values
  based on traced source content.

## Non-Goals

- Do not add branch creation/push automation for GitHub in this slice.
- Do not implement deferred TODOS items such as ExplainTool transaction
  wrapping, HypoPG index validation, or memory `db_name` scoping.
- Do not keep a mirrored copy of the Rails demo app in this repo.

## Architecture

The checkpoint repo becomes the orchestration and analysis repo. It owns:

- `docker-compose.yml`
- Postgres, ClickHouse, collector, agent, and load harness code
- docs, plans, and tests for the orchestration stack

The sibling repo at `/home/bjw/db-specialist-demo` becomes the only owner of
the Rails demo app. This repo references that app through:

- `DEMO_APP_ROOT` for local filesystem access
- `DEMO_REPO` for GitHub API targeting

If `DEMO_APP_ROOT` is unset or points to a missing directory, runtime entry
points should fail fast with a clear error rather than silently falling back to
stale local paths.

## Runtime Boundaries

### Local demo app path

- New required env var: `DEMO_APP_ROOT`
- Expected local value: `/home/bjw/db-specialist-demo`
- Used by:
  - Docker Compose `demo` build context
  - Docker Compose volume mount for the code-search MCP server
  - agent code-search runtime configuration
  - docs and local verification commands

The in-repo `demo/` directory will be removed after the wiring is updated.

### Credentials and configuration

The implementation should keep secrets out of code, docs, and committed config.
Configuration should be injected through env vars only.

Required or supported vars:

- `DEMO_APP_ROOT`
  - local filesystem path for the sibling Rails repo
- `DEMO_REPO`
  - GitHub repo slug such as `username/db-specialist-demo`
- `DEMO_BASE_REF`
  - optional GitHub PR base branch, default `main`
- `DEMO_HEAD_REF`
  - required for real PR creation when `GITHUB_TOKEN` is set
- `GITHUB_TOKEN`
  - secret token for GitHub REST API access

Behavior contract:

- if `GITHUB_TOKEN` is unset, `GitHubTool` must use the `local://` fallback
- if `GITHUB_TOKEN` is set but `DEMO_REPO` or `DEMO_HEAD_REF` is missing,
  `GitHubTool` must fail with a clear configuration error
- the token must never be logged, written to repo files, or recorded in
  `JOURNAL.md`
- the repo should provide a checked-in `.env.example` with variable names only,
  while real secret-bearing env files remain untracked

### GitHub PR boundary

`GitHubTool` must keep the current `local://` fallback when `GITHUB_TOKEN` is
not set. When both `GITHUB_TOKEN` and `DEMO_REPO` are set, it should call the
GitHub REST API to open a real pull request against the configured repo.

This slice assumes the PR head branch already exists in the demo repo and is
provided by env vars:

- `DEMO_BASE_REF` with default `main`
- `DEMO_HEAD_REF` required for real PR creation

If `GITHUB_TOKEN` is set but the repo or head-ref configuration is incomplete,
the tool should fail clearly instead of silently downgrading to `local://`.

The PR body must include:

- fingerprint
- `source_tag`
- `fix_type`
- fix summary
- validation output from `EXPLAIN` rows or a before/after plan diff

## Fix Classification

`buildFixProposal` should stop returning a hard-coded `add_index` result.
Classification should use the traced source content from `CodeSearchTool`.

Rules for this slice:

- `LIKE '%...%'` in source content:
  - `fix_type: "rewrite_like"`
  - summary describes converting a leading-wildcard `LIKE` into a searchable
    alternative
- N+1 indicators in source content such as chained association access
  (`.user.name`) or collection iteration with association access:
  - `fix_type: "add_includes"`
  - summary describes eager loading the accessed association
- plain equality filter patterns such as `where(status: ...)` or
  `WHERE column = value`:
  - `fix_type: "add_index"`
  - summary names the filtered column when possible
- `count` called inside a loop:
  - `fix_type: "rewrite_count"`
  - summary describes moving the count out of the loop or precomputing it

If multiple heuristics match, use the first most specific match in this order:

1. `rewrite_count`
2. `rewrite_like`
3. `add_includes`
4. `add_index`

## ClickHouse Time Window

The note in `TODOS.md` is correct and becomes part of the accepted design:

- default window is `60` minutes
- time-windowed queries must read from `query_events`
- all-time queries may keep using `query_fingerprints`

This is an implementation note for the current follow-on work, not a separate
design branch. The plan should include it because the live demo query surface
should not keep a misleading window parameter.

## Testing Strategy

The implementation plan should use two commits:

1. Repo split plumbing
   - failing tests for `DEMO_APP_ROOT`-based path resolution
   - compose and code-search rewiring
   - remove tracked `demo/` from this repo
2. Real PR + classification
   - failing tests for GitHub fallback vs real REST call
   - failing tests for fix classification across at least two fix types
   - live proof with a real PR URL and a curl response showing at least two
     different `fix_type` values

Docker and live verification remain mandatory before claiming the work is done.

## Risks

- The repo stops being self-contained, so setup docs must become explicit.
- Cross-repo branch coordination can become confusing; env vars must make the
  active demo repo and PR target unambiguous.
- Real GitHub PR creation depends on credentials and a pre-existing head branch
  in the demo repo.
