# Eng Review 3 Design

## Goal

Address the 10 Eng Review 3 findings on `wip-db-specialist-agent-plan` without
changing the Phase 1 architecture. The result should preserve the current
vertical slice, keep the existing test suite green, and make the PR-generation
path honest for multiple findings.

## Scope

This design covers:

- ClickHouse offender ranking and severity
- Per-finding demo repo branches and PR wiring
- Demo repo mutation safety checks
- Demo repo cleanup and repeatable reset
- Missing classification and tool-path tests
- PR body evidence formatting
- README demo setup guidance
- TODOS documentation for the Phase 2 pi-agent-core loop

This design does not cover:

- New runtime services
- LLM-based classification
- A rewrite of the executor/tool architecture

## Constraints

- Follow TDD for every code change: failing test first, then minimal
  implementation, then green verification.
- Keep all existing passing tests green throughout the work.
- Make the smallest reasonable changes that satisfy the review.
- Preserve the current sibling demo repo model at `DEMO_APP_ROOT`.
- Keep `local://` PR fallback behavior when `GITHUB_TOKEN` is absent.

## Design Overview

The current implementation already proves a live vertical slice. The review
items are correctness fixes and hardening, not a new product slice. The design
therefore keeps the current boundaries:

- `ClickHouseTool` remains responsible for offender lookup and normalization.
- `DemoRepoTool` remains responsible for applying the smallest concrete change
  to the sibling demo repo.
- `GitHubTool` remains responsible for PR creation and idempotent existing-PR
  lookup.
- `DBSpecialistExecutor` remains the orchestration layer that moves data between
  tools.

The main behavioral change is that PR preparation becomes per finding rather
than global. Each finding gets its own branch and its own PR identity, which
removes the current collapse of multiple findings into a single shared branch
and cached PR URL.

## Component Changes

### ClickHouseTool

`ClickHouseTool` will rank offenders by total execution time rather than total
execution count.

For the time-windowed `query_events` path:

- keep the current direct query against `query_events`
- group by the same stable identity as the all-time path: `fingerprint + source_tag`
- keep `source_file` and `sample_query` as representative values rather than
  grouping keys
- compute `total_exec_time_ms` as `sum(total_exec_count * mean_exec_time_ms)`
- order by `total_exec_time_ms DESC`

For the all-time `query_fingerprints` path:

- keep the current aggregate-table query
- correct the aggregate read model so all-time table-scoped queries remain
  accurate when a fingerprint appears under multiple `source_tag` values over
  time
- compute `total_exec_time_ms` from a merged aggregate state in that corrected
  read model
- order by `total_exec_time_ms DESC`

Normalized results will expose `total_exec_time_ms`, and severity will switch
from count-based logic to `p95_exec_time_ms >= 100 ? "high" : "medium"`.

This adds one grouping requirement beyond the original review text: both the
windowed and all-time paths must preserve enough source-tag-specific identity
for table-scoped analysis to remain accurate when one fingerprint appears under
multiple tags. The stable grouping key should be `fingerprint + source_tag`;
`source_file` and `sample_query` remain representative values rather than part
of the aggregate identity, because `sample_query` is sampled raw SQL and would
fragment one logical offender if used as a grouping key. Those representative
fields should be stored and merged as one tuple state, not as separate states,
so the traced file and sampled query always describe the same underlying event.

### DemoRepoTool

`DemoRepoTool` will stop assuming one shared `DEMO_HEAD_REF` branch for all
findings.

For each `applyFix()` call:

- accept the finding fingerprint
- derive a branch name of the form `agent/demo-fix-{fingerprint}`
- truncate the fingerprint suffix to 12 characters if needed
- create the branch from `DEMO_BASE_REF` with `git checkout -b ... {base}`
- verify remote access with `git ls-remote origin` before mutating files

`applyFix()` will return structured metadata:

- `branchName`
- `diff`

The `diff` value will be the committed change diff from
`git diff HEAD~1 HEAD -- {path}` so the PR body can show code evidence.

Mutation safety will also be tightened. The string-replacement helpers for
`rewrite_count`, `rewrite_like`, and `add_includes` must verify that the target
content actually changed. If not, they will raise a clear drift error rather
than silently committing a no-op.

### Demo Repo Reset

The demo flow needs a repeatable reset path so live PR creation can be rerun
without manual cleanup after each proof.

The design will add a small reset mechanism that restores the sibling demo repo
to a known base state before or between proof runs. The reset behavior should:

- target the sibling repo at `DEMO_APP_ROOT`
- remove or rewind per-finding `agent/demo-fix-*` branches created by the agent
- restore the working tree to `DEMO_BASE_REF`
- avoid mutating unrelated branches or untracked user work

The implementation should keep this explicit and local to the demo workflow,
not a hidden side effect of normal agent execution. The likely shape is a small
script or documented command path that operators can run before a new demo
session to return the demo repo to a clean baseline.

For ClickHouse read-model repairs, any rebuild path must also document that
ingestion is stopped during the reset so no raw events are missed while the
materialized view is recreated.

### GitHubTool

`GitHubTool` will become per-PR rather than globally cached.

- remove the instance-level cached PR URL
- accept an optional `headRef` input
- use `headRef` when present and fall back to `DEMO_HEAD_REF` only when absent
- preserve the existing 422-based "PR already exists" lookup so repeated calls
  for the same head branch stay idempotent

The PR body will include both:

- `## Code Change` with the git diff returned by `DemoRepoTool`
- `## EXPLAIN (after fix)` with the validation rows already produced by the
  explain path

The missing-env failure mode stays explicit: when `GITHUB_TOKEN` is present,
missing `DEMO_REPO` or missing head-ref configuration is an error.

### DBSpecialistExecutor

`DBSpecialistExecutor` will pass the new per-finding data through the existing
orchestration flow.

For PR-eligible findings:

1. locate source
2. classify fix
3. validate
4. check memory
5. call `DemoRepoTool.applyFix({ finding, fix, source })`
6. receive `{ branchName, diff }`
7. call `GitHubTool.openPullRequest({ finding, fix, source, validation, headRef, codeDiff })`

The classification logic itself stays deterministic. The only behavioral
addition required by this review is explicit test coverage for the existing
`add_includes` classification path.

## Documentation Changes

### README

`README.md` will gain a `Demo setup` section that documents:

1. clone the external demo app at `DEMO_APP_ROOT`
2. configure push-capable git credentials in that repo
3. set `DEMO_REPO`, `DEMO_BASE_REF`, `DEMO_HEAD_REF`, and `GITHUB_TOKEN`
4. reset the demo repo to the base branch before repeating the live PR demo

This is additive to the current session configuration guidance, not a
replacement for it.

### TODOS

`TODOS.md` will gain the requested Phase 2 pi-agent-core note describing:

- the current deterministic executor state
- why Phase 1 does not use pi-agent-core yet
- where the future integration will land

No other TODO entries are part of this design.

## Testing Strategy

The implementation will use grouped TDD commits:

1. `ClickHouseTool` ranking/severity correction
2. `DemoRepoTool` per-finding branch model, drift checks, and missing-path tests
3. `Executor` and `GitHubTool` wiring/tests, including PR body evidence
4. Demo repo reset path plus `README.md` and `TODOS.md` documentation updates

Required verification at the end:

- all pre-existing tests remain green
- new/updated tests cover each requested review item
- `cd agent && npm test` passes
- the demo repo reset path is documented and verified against the sibling repo
- report test count before and after
- report which items were code changes versus test-only changes

## Execution Notes

This review batch is tightly coupled enough to stay in one implementation plan.
Commit granularity should follow dependency chains rather than a strict one-item
per commit rule:

- Item 1
- Items 2 through 4
- Items 5 through 8
- Items 9 through 10
