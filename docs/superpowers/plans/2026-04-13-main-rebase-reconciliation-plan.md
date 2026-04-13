# Main Rebase and Collector Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebase `wip/brainstorm-2026-04-12` onto the latest `origin/main`, keep the approved oh-my-pi MVP cut intact, and reconcile the reduced branch with the current collector `queryid` / `comment_metadata` / `postgres_logs` data model.

**Architecture:** Treat this as a flag-day rebase onto `origin/main`, not a compatibility merge. Keep the hard cut of the A2A and fine-grained runtime path, then update only the surviving oh-my-pi skill, smoke checks, and supporting docs that still assume the older ClickHouse schema. Do not reintroduce deleted runtime code to preserve upstream checkpoint consumer behavior.

**Tech Stack:** Git rebase workflow, TypeScript root package, Markdown skills/docs, Python smoke test, Docker-based ClickHouse schema verification.

---

## Key Upstream Findings

- `checkpoint origin/main` moved forward by commit `667b9dd` (`feat: adopt queryid, comment_metadata, and postgres_logs source-location join (#3)`).
- `checkpoint-collector origin/master` already contains PR #2 (`ecf2885`), which changed the ClickHouse source of truth to:
  - `query_events.queryid`
  - `query_events.statement_text`
  - `query_events.comment_metadata`
  - `query_intervals.statement_text`
  - `query_intervals.comment_metadata`
  - `postgres_logs`
  - `postgres_log_state`
- The reduced oh-my-pi branch still assumes the pre-PR shape in two live places:
  - `skills/db-investigation.md`
  - `scripts/validate.sh`
- The branch also reverted the stronger standalone smoke assertions from `origin/main` in:
  - `tests/smoke/test_clickhouse_schema.py`
- Most of upstream commit `667b9dd` touched files deliberately removed by the approved MVP cut. Those upstream edits should not be resurrected.

## Reconciliation Rules

- Keep the approved hard cut. Do not restore `agent/`, `src/tools/clickhouse_tool.ts`, `src/tools/demo_repo_tool.ts`, `src/tools/github_tool.ts`, `extensions/db-specialist.ts`, or any A2A bridge files.
- Rebase onto `origin/main`, not local `main`, because local `main` is ahead by one repo-specific housekeeping commit.
- Prefer carrying forward upstream fixes only when they apply to files that still exist in the reduced MVP.
- Delete `scripts/validate.sh` unless Brett explicitly wants a replacement. It is an A2A-era path and no longer matches the approved MVP.

### Task 1: Safety Checkpoint Before Rebase

**Files:**
- Review: `JOURNAL.md`
- Review: `brainstorm-scope-reduction-walkthrough.md`
- Review: `langchain-walkthrough.md`

- [ ] **Step 1: Confirm the worktree still only has the expected untracked walkthroughs**

Run:

```bash
git -C /home/bjw/.config/superpowers/worktrees/checkpoint/wip-brainstorm-2026-04-12 status --short --branch
```

Expected: clean branch state except the two untracked walkthrough markdown files.

- [ ] **Step 2: Record a safety branch or tag before rebasing**

Run:

```bash
git -C /home/bjw/checkpoint branch wip/brainstorm-2026-04-12-pre-rebase-2026-04-13 wip/brainstorm-2026-04-12
```

Expected: a recoverable pointer exists before the history rewrite.

- [ ] **Step 3: Re-read the surviving MVP spec before resolving conflicts**

Review:

```text
docs/superpowers/specs/2026-04-12-oh-my-pi-mvp-redesign-design.md
```

Expected: the conflict resolver is operating from the approved target architecture, not from habit.

- [ ] **Step 4: Commit any planning-only notes needed before the rebase starts**

Run:

```bash
git add JOURNAL.md docs/superpowers/plans/2026-04-13-main-rebase-reconciliation-plan.md
git commit -m "docs: plan main rebase reconciliation"
```

Expected: the pre-rebase planning state is tracked in git.

### Task 2: Rebase the Branch Onto Updated `origin/main`

**Files:**
- Modify during conflict resolution: `.gitignore`
- Modify during conflict resolution: `JOURNAL.md`
- Modify during conflict resolution: `TODOS.md`
- Modify during conflict resolution: `tests/smoke/test_clickhouse_schema.py`
- Delete during conflict resolution: `scripts/validate.sh`
- Keep deleted: `agent/**`, `extensions/db-specialist.ts`, `src/a2a_bridge/**`, `src/tools/clickhouse_tool.ts`, `src/tools/demo_repo_tool.ts`, `src/tools/github_tool.ts`, `test/extensions/db_specialist.test.ts`, `test/tools/clickhouse_tool.test.ts`

- [ ] **Step 1: Start the rebase**

Run:

```bash
git -C /home/bjw/.config/superpowers/worktrees/checkpoint/wip-brainstorm-2026-04-12 rebase origin/main
```

Expected: modify/delete conflicts appear for files changed in `origin/main` but removed by the MVP cut, plus text conflicts in the small set of surviving files.

- [ ] **Step 2: Resolve deleted old-runtime files by keeping the hard cut**

Resolve the conflicts by staging the deletions for the pre-oh-my-pi runtime files:

```bash
git -C /home/bjw/.config/superpowers/worktrees/checkpoint/wip-brainstorm-2026-04-12 add agent extensions src/a2a_bridge src/tools test
```

Expected: the rebase keeps the approved cut instead of reviving deleted runtime code.

- [ ] **Step 3: Keep the safe `.gitignore` improvement from upstream**

Make sure `.gitignore` contains:

```gitignore
.worktrees/
```

Expected: local in-repo worktrees stay ignored even though the current MVP uses an external workspace.

- [ ] **Step 4: Continue until the branch is replayed onto `origin/main`**

Run after each conflict batch:

```bash
git -C /home/bjw/.config/superpowers/worktrees/checkpoint/wip-brainstorm-2026-04-12 rebase --continue
```

Expected: the branch finishes on top of `origin/main` with the old runtime still removed.

- [ ] **Step 5: Verify the rebased tree still reflects the MVP cut**

Run:

```bash
git -C /home/bjw/checkpoint diff --name-status origin/main..wip/brainstorm-2026-04-12
```

Expected: old runtime files remain deleted relative to `origin/main`; surviving additions are the oh-my-pi skills, tools, scripts, and tests.

### Task 3: Reconcile the Surviving ClickHouse Guidance With the Collector Schema

**Files:**
- Modify: `skills/db-investigation.md`
- Test: `test/integration/db_investigation_skill.test.ts`
- Review for consistency: `README.md`

- [ ] **Step 1: Write the failing skill test for the new collector vocabulary**

Update the test to assert the skill references the current schema:

```ts
assert.match(markdown, /queryid/);
assert.match(markdown, /comment_metadata/);
assert.match(markdown, /postgres_logs/);
assert.doesNotMatch(markdown, /sample_query Nullable\(String\)/);
```

Expected: FAIL because the current skill still documents `fingerprint`, `source_file`, and `sample_query`.

- [ ] **Step 2: Run the focused test to confirm the failure**

Run:

```bash
npm test -- test/integration/db_investigation_skill.test.ts
```

Expected: FAIL on the old ClickHouse catalog text.

- [ ] **Step 3: Update the skill to match the collector-owned schema and upstream query pattern**

Revise `skills/db-investigation.md` so the ClickHouse catalog and example query use:

```md
- `queryid String` — pg_stat_statements identity key
- `statement_text Nullable(String)` — normalized SQL text from pg_stat_statements
- `comment_metadata Map(String, String)` — parsed SQL comment metadata
- `postgres_logs` — raw Postgres JSON log rows keyed by `query_id`
```

Use an offender query pattern shaped like:

```sql
SELECT
  queryid,
  argMax(query_intervals.statement_text, interval_ended_at) AS latest_statement_text,
  coalesce(
    nullIf(argMax(postgres_logs.comment_metadata['source_location'], postgres_logs.log_timestamp), ''),
    argMax(query_intervals.comment_metadata['source_location'], interval_ended_at)
  ) AS latest_source_location,
  sum(total_exec_count) AS call_count,
  round(sum(delta_exec_time_ms), 2) AS total_exec_time_ms,
  round(if(sum(total_exec_count) = 0, 0, sum(delta_exec_time_ms) / sum(total_exec_count)), 2) AS avg_exec_time_ms
FROM query_intervals
LEFT JOIN postgres_logs
  ON postgres_logs.query_id = query_intervals.queryid
  AND postgres_logs.log_timestamp >= query_intervals.interval_started_at
  AND postgres_logs.log_timestamp < query_intervals.interval_ended_at
GROUP BY queryid
ORDER BY total_exec_time_ms DESC
LIMIT 5
```

Expected: the agent learns the schema it will actually query in the demo stack.

- [ ] **Step 4: Re-run the focused skill test**

Run:

```bash
npm test -- test/integration/db_investigation_skill.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the skill reconciliation**

Run:

```bash
git add skills/db-investigation.md test/integration/db_investigation_skill.test.ts JOURNAL.md
git commit -m "docs: align db investigation skill with collector schema"
```

Expected: the surviving agent instructions are updated independently of the smoke/test cleanup.

### Task 4: Keep the Stronger Collector Smoke Assertions and Remove the Stale Live Script

**Files:**
- Modify: `tests/smoke/test_clickhouse_schema.py`
- Delete: `scripts/validate.sh`
- Modify: `README.md`
- Modify: `JOURNAL.md`

- [ ] **Step 1: Write the failing smoke assertion changes**

Update `tests/smoke/test_clickhouse_schema.py` to assert:

```py
assert "postgres_logs" in tables
assert "postgres_log_state" in tables
assert "comment_metadata\tMap" in query_intervals_schema
assert "comment_metadata\tMap" in query_events_schema
assert "comment_metadata\tMap" in postgres_logs_schema
assert "source_file" not in query_events_schema
assert "source_file" not in query_intervals_schema
```

Expected: FAIL or remain unimplemented until the test file is brought back to the upstream stronger version.

- [ ] **Step 2: Restore the standalone-container smoke structure from `origin/main`**

Update the smoke test to use:

```py
container_name = f"checkpoint-clickhouse-smoke-{int(time.time() * 1000)}"
subprocess.run(["docker", "run", "-d", "--name", container_name, "checkpoint-clickhouse:local"], ...)
```

Expected: the smoke test no longer depends on the project compose stack or host port `8123`.

- [ ] **Step 3: Delete the stale A2A-era validation script**

Run:

```bash
git rm scripts/validate.sh
```

Expected: the reduced branch stops carrying a live validation path that no longer matches the approved MVP or the collector schema.

- [ ] **Step 4: Remove or update any remaining references to `scripts/validate.sh`**

Run:

```bash
rg -n "validate\\.sh" README.md JOURNAL.md docs test scripts
```

Expected: either no references remain, or each surviving reference clearly describes why the script was removed.

- [ ] **Step 5: Run the focused smoke test**

Run:

```bash
python3 -m pytest tests/smoke/test_clickhouse_schema.py -v
```

Expected: PASS if `checkpoint-clickhouse:local` is built; otherwise a clean skip.

- [ ] **Step 6: Commit the smoke-path reconciliation**

Run:

```bash
git add tests/smoke/test_clickhouse_schema.py README.md JOURNAL.md
git commit -m "test: align smoke checks with collector schema"
```

Expected: the reduced branch’s remaining collector-facing checks now match the real schema.

### Task 5: Final Verification and Spec Consistency Check

**Files:**
- Modify if needed: `docs/superpowers/specs/2026-04-12-oh-my-pi-mvp-redesign-design.md`
- Modify if needed: `docs/superpowers/plans/2026-04-12-langchain-style-sql-tool-ergonomics-implementation-plan.md`
- Modify: `JOURNAL.md`

- [ ] **Step 1: Check whether the spec needs a small addendum**

If the spec or README still imply the old ClickHouse shape, add a narrow clarification:

```md
The coarse ClickHouse tools remain unchanged, but the collector-owned schema now uses `queryid`, `statement_text`, `comment_metadata`, and `postgres_logs`; the investigation skill and smoke checks must follow that shape.
```

Expected: the written design matches the live collector model without changing the approved MVP boundaries.

- [ ] **Step 2: Run the root automated checks**

Run:

```bash
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run the live-model gate honestly**

Run:

```bash
npm run test:model-integration
```

Expected: PASS when `OMP_MODEL` is configured; otherwise a clean blocked/skip result that is reported honestly.

- [ ] **Step 4: Record the rebase outcome in the journal**

Add a `JOURNAL.md` entry covering:

```md
- Rebasing onto `origin/main` kept the oh-my-pi hard cut intact.
- The surviving ClickHouse guidance now follows collector `queryid` / `comment_metadata` / `postgres_logs`.
- `scripts/validate.sh` was removed because it was an off-spec A2A-era path.
```

Expected: future work starts from the reconciled mental model.

- [ ] **Step 5: Commit the final reconciliation state**

Run:

```bash
git add .gitignore README.md JOURNAL.md TODOS.md docs skills test tests
git commit -m "feat: rebase oh-my-pi branch onto collector schema changes"
```

Expected: the branch is clean, rebased, and still aligned with the approved MVP spec.

## Self-Review

- Spec coverage: this plan preserves the approved hard cut, updates the surviving agent skill to the current collector schema, keeps the smoke checks honest, and avoids reviving any removed runtime plumbing.
- Placeholder scan: each task names exact files and commands; the only conditional behavior is the already-approved live-model gate skip/block path.
- Type consistency: the plan standardizes the surviving ClickHouse vocabulary on `queryid`, `statement_text`, `comment_metadata`, and `postgres_logs`.
