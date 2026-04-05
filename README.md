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
  - fallback branch used for PRs when DemoRepoTool is not configured;
    DemoRepoTool derives branch names from fingerprints
- `GITHUB_TOKEN`
  - GitHub token used by the REST API path in `GitHubTool`

Behavior:

- if `GITHUB_TOKEN` is unset, the agent uses `local://` PR URLs
- if `GITHUB_TOKEN` is set but `DEMO_REPO` is missing, the
  GitHub path fails fast with a configuration error

## Demo setup

1. Clone the demo app repo into `DEMO_APP_ROOT`.
2. Configure push access in that repo. SSH or HTTPS with a stored credential
   both work, but the agent must be able to run `git ls-remote` and `git push`
   there without prompting.
3. Set `DEMO_REPO`, `DEMO_BASE_REF`, `DEMO_HEAD_REF`, and `GITHUB_TOKEN` in
   your shell or local `.env` before running the live PR demo.
4. Before repeating a live proof, reset the demo repo back to `DEMO_BASE_REF`
   and remove any prior `agent/demo-fix-*` branches created by the agent.

## Local Run

```bash
docker compose up -d --build
cd agent && npm start
```

Then drive traffic:

```bash
ruby load/harness.rb
```
