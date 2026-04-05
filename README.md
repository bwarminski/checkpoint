# Checkpoint DB Specialist

This repo owns the DB-specialist orchestration stack:

- Postgres
- ClickHouse
- collector
- agent
- load harness

The Rails demo app is no longer stored here. Its source of truth is the sibling
repo at `/home/bjw/db-specialist-demo`.

## Session Configuration

Set these variables before running the local stack or the live PR demo:

```bash
export DEMO_APP_ROOT=/home/bjw/db-specialist-demo
export DEMO_REPO='bwarminski/db-specialist-demo'
export DEMO_BASE_REF='main'
export DEMO_HEAD_REF='agent/demo-fix'
export GITHUB_TOKEN='...'
```

What each variable does:

- `DEMO_APP_ROOT`
  - local filesystem path to the sibling Rails demo repo
- `DEMO_REPO`
  - GitHub repo slug used for real PR creation
- `DEMO_BASE_REF`
  - base branch for PRs, defaults to `main`
- `DEMO_HEAD_REF`
  - existing head branch for PRs in the demo repo
- `GITHUB_TOKEN`
  - GitHub token used by the REST API path in `GitHubTool`

Behavior:

- if `GITHUB_TOKEN` is unset, the agent uses `local://` PR URLs
- if `GITHUB_TOKEN` is set but `DEMO_REPO` or `DEMO_HEAD_REF` is missing, the
  GitHub path fails fast with a configuration error

## Local Run

```bash
docker compose up -d --build
cd agent && npm start
```

Then drive traffic:

```bash
ruby load/harness.rb
```
