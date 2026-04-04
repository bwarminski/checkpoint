# Demo Repo Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the Rails demo app into a sibling repo at `/home/bjw/db-specialist-demo`, rewire this repo to consume it through env vars, and then add real GitHub PR creation plus deterministic fix classification.

**Architecture:** This repo becomes the orchestration repo and stops owning `demo/`. Runtime access to the Rails app flows through `DEMO_APP_ROOT`, while real PR creation flows through `DEMO_REPO`, `DEMO_HEAD_REF`, `DEMO_BASE_REF`, and `GITHUB_TOKEN`. The executor keeps deterministic classification logic based on traced source content rather than an LLM classifier.

**Tech Stack:** Git, Docker Compose, Ruby/Rails, Python/pytest, TypeScript, Express, `@a2a-js/sdk`, GitHub REST API

---

## File Structure

- `/home/bjw/db-specialist-demo/`
  New sibling git repo containing the Rails app formerly tracked under `demo/`.
- `.env.example`
  Non-secret configuration template for `DEMO_APP_ROOT`, `DEMO_REPO`, `DEMO_BASE_REF`, `DEMO_HEAD_REF`, and `GITHUB_TOKEN`.
- `docker-compose.yml`
  Must read the demo app from `DEMO_APP_ROOT` and fail fast when unset.
- `agent/.mcporter.json`
  Must point code search at the external demo repo path.
- `agent/src/runtime_dependencies.ts`
  Must provide the demo-app root to runtime code-search wiring.
- `agent/src/tools/github_tool.ts`
  Must support real GitHub PR creation with env-driven configuration and `local://` fallback.
- `agent/src/executor.ts`
  Must classify fixes from traced source content and produce specific summaries.
- `agent/src/tools/clickhouse_tool.ts`
  Must honor the 60-minute default time window by querying `query_events` directly for time-scoped requests.
- `agent/test/*.test.ts`
  Must cover GitHub behavior, fix classification, and ClickHouse time-window query selection.
- `tests/smoke/`
  Must cover `DEMO_APP_ROOT`-based compose/config expectations.
- `JOURNAL.md`
  Must capture the repo split, credential contract, and any blockers.

### Task 1: External Demo Repo Split

**Files:**
- Create: `.env.example`
- Create: `tests/smoke/test_demo_repo_split.py`
- Modify: `docker-compose.yml`
- Modify: `agent/.mcporter.json`
- Modify: `docs/code-search.md`
- Modify: `JOURNAL.md`
- Delete: `demo/` tracked files after copying them to `/home/bjw/db-specialist-demo`

- [ ] **Step 1: Write the failing test**

```python
from pathlib import Path


def test_demo_app_root_is_declared_in_env_example():
    text = Path(".env.example").read_text()
    assert "DEMO_APP_ROOT=/home/bjw/db-specialist-demo" in text


def test_compose_uses_demo_app_root_for_demo_service():
    text = Path("docker-compose.yml").read_text()
    assert "${DEMO_APP_ROOT}" in text
    assert "./demo" not in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/smoke/test_demo_repo_split.py -v`
Expected: FAIL because `.env.example` and the external-path compose wiring do not exist yet.

- [ ] **Step 3: Create the sibling repo and minimal implementation**

```bash
mkdir -p /home/bjw/db-specialist-demo
cd /home/bjw/db-specialist-demo
git init
```

Copy the tracked Rails app files from `demo/` into `/home/bjw/db-specialist-demo/`, preserving history in this repo by committing the split here after the wiring change.

```dotenv
# .env.example
DEMO_APP_ROOT=/home/bjw/db-specialist-demo
DEMO_REPO=username/db-specialist-demo
DEMO_BASE_REF=main
DEMO_HEAD_REF=agent/demo-fix
GITHUB_TOKEN=
```

Update `docker-compose.yml` so the `demo` build context and any demo-related volume mounts use `${DEMO_APP_ROOT:?DEMO_APP_ROOT is required}` instead of `./demo`.

Update `agent/.mcporter.json` so the code-search server root comes from `DEMO_APP_ROOT`.

Update `docs/code-search.md` to document the external demo repo requirement.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/smoke/test_demo_repo_split.py -v`
Expected: PASS

Run: `docker compose config`
Expected: PASS when `DEMO_APP_ROOT=/home/bjw/db-specialist-demo` is exported.

- [ ] **Step 5: Commit**

```bash
git add .env.example docker-compose.yml agent/.mcporter.json docs/code-search.md tests/smoke/test_demo_repo_split.py JOURNAL.md
git commit -m "refactor: externalize the demo app repo"
```

### Task 2: Real GitHub PR Path And Fix Classification

**Files:**
- Modify: `agent/src/tools/github_tool.ts`
- Modify: `agent/src/runtime_dependencies.ts`
- Modify: `agent/src/executor.ts`
- Modify: `agent/src/tools/clickhouse_tool.ts`
- Modify: `agent/test/github_tool.test.ts`
- Modify: `agent/test/executor.test.ts`
- Modify: `agent/test/clickhouse_tool.test.ts`
- Modify: `agent/test/integration/analyze_db.test.ts`
- Modify: `JOURNAL.md`

- [ ] **Step 1: Write the failing tests**

```typescript
test("GitHubTool posts a real pull request when token and repo config are present", async () => {
  // stub fetch, assert POST to /repos/{repo}/pulls and PR body content
});

test("DBSpecialistExecutor classifies at least two different fix types from source content", async () => {
  // use two findings with different traced source snippets and assert differing fix_type values
});

test("ClickHouseTool uses query_events for time-windowed requests", async () => {
  // assert generated SQL references query_events and collected_at
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd agent && node --import tsx --test test/github_tool.test.ts test/executor.test.ts test/clickhouse_tool.test.ts`
Expected: FAIL because the real GitHub path, multi-type classification, and time-window query logic are not implemented yet.

- [ ] **Step 3: Write minimal implementation**

Implement `GitHubTool` so:

- it returns `local://...` when `GITHUB_TOKEN` is unset
- it throws a configuration error when `GITHUB_TOKEN` is set but `DEMO_REPO` or `DEMO_HEAD_REF` is missing
- it calls `POST https://api.github.com/repos/{DEMO_REPO}/pulls`
- it sends a body including fingerprint, `source_tag`, `fix_type`, fix summary, and validation rows/diff

Implement deterministic classification in `buildFixProposal` using `source.content`.

Implement time-window query selection in `ClickHouseTool`:

- default to 60 minutes for `analyze_db` and `analyze_table`
- use `query_events` with `collected_at > now() - INTERVAL {minutes} MINUTE`
- preserve `query_fingerprints` only for explicit all-time behavior

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd agent && node --import tsx --test test/github_tool.test.ts test/executor.test.ts test/clickhouse_tool.test.ts`
Expected: PASS

Run: `cd agent && npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Live verification**

Export:

```bash
export DEMO_APP_ROOT=/home/bjw/db-specialist-demo
export DEMO_REPO=<your-github-slug/db-specialist-demo>
export DEMO_HEAD_REF=<existing-head-branch>
export GITHUB_TOKEN=<token>
```

Run the local stack and agent, then:

```bash
curl -sS -X POST http://127.0.0.1:3001/a2a/jsonrpc \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":"demo-pr","method":"message/send","params":{"message":{"kind":"message","messageId":"demo-pr-msg","role":"user","parts":[{"kind":"text","text":"analyze_db"}]}}}'
```

Expected:

- response includes a real GitHub PR URL
- findings include at least two different `fix_type` values

- [ ] **Step 6: Commit**

```bash
git add agent/src/tools/github_tool.ts agent/src/runtime_dependencies.ts agent/src/executor.ts agent/src/tools/clickhouse_tool.ts agent/test/github_tool.test.ts agent/test/executor.test.ts agent/test/clickhouse_tool.test.ts agent/test/integration/analyze_db.test.ts JOURNAL.md
git commit -m "feat: add real PR automation and fix classification"
```

## Self-Review

- Spec coverage:
  - external sibling repo split: covered by Task 1
  - credential contract: covered by Task 1 `.env.example` and Task 2 GitHub config behavior
  - real GitHub PR creation: covered by Task 2
  - deterministic fix classification: covered by Task 2
  - ClickHouse time-window correction: covered by Task 2
- Placeholder scan:
  - no TODO/TBD placeholders remain in task steps
- Type consistency:
  - `DEMO_APP_ROOT`, `DEMO_REPO`, `DEMO_BASE_REF`, `DEMO_HEAD_REF`, and `GITHUB_TOKEN` names match the approved spec
  - `rewrite_like`, `add_includes`, `add_index`, and `rewrite_count` names match the approved fix taxonomy
