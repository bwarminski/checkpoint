# Checkpoint DB Specialist

This repo owns the checkpoint agent runtime and orchestration glue.

The collector source of truth now lives in the sibling repo at
`/home/bjw/checkpoint-collector`. Brett can create the GitHub remote for that
repo while the follow-on tasks proceed.

The Rails demo app is no longer stored here. Its source of truth is the sibling
repo at `/home/bjw/db-specialist-demo`.

## Session Configuration

Set these variables before running the local stack or the live PR demo.
`docker-compose.yml` reads `DEMO_APP_ROOT` directly for the `demo` build
context, so set it to the local Rails demo repo path before running
`docker compose up -d --build`:

```bash
export DEMO_APP_ROOT='/home/bjw/db-specialist-demo'
export DEMO_REPO='bwarminski/db-specialist-demo'
export DEMO_BASE_REF='main'
export GITHUB_TOKEN='...'
export LLM_MODEL='openai/gpt-4o-mini'
export OPENAI_API_KEY='...'
```

What each variable does:

- `DEMO_APP_ROOT`
  - required local filesystem path to the sibling Rails demo repo used by the
    `demo` service build context
- `DEMO_REPO`
  - GitHub repo slug used for real PR creation
- `DEMO_BASE_REF`
  - base branch for PRs, defaults to `main`
- `GITHUB_TOKEN`
  - GitHub token used by the REST API path in `GitHubTool`
- `LLM_MODEL`
  - provider-agnostic model name for the agent loop, in `provider/model` form
  - set the matching provider API key too, for example `OPENAI_API_KEY`,
    `ANTHROPIC_API_KEY`, or `GOOGLE_API_KEY`

Behavior:

- if `GITHUB_TOKEN` is unset, the agent uses `local://` PR URLs
- if `GITHUB_TOKEN` is set but `DEMO_REPO` is missing, the
  GitHub path fails fast with a configuration error
- if `LLM_MODEL` is unset, the agent runtime uses its configured default model

## Demo setup

1. Clone the demo app repo into `/home/bjw/db-specialist-demo`, or set
   `DEMO_APP_ROOT` if you want the agent to use a different path.
2. Configure push access in that repo. SSH or HTTPS with a stored credential
   both work, but the agent must be able to run `git ls-remote` and `git push`
   there without prompting.
3. Set `DEMO_REPO`, `DEMO_BASE_REF`, and `GITHUB_TOKEN` in
   your shell or local `.env` before running the live PR demo.
4. Set `LLM_MODEL` to the provider/model string for the agent loop. The
   default example uses `openai/gpt-4o-mini`. Set the matching provider API
   key too, for example `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or
   `GOOGLE_API_KEY`.
5. Before repeating a live proof, reset the demo repo back to `DEMO_BASE_REF`
   and remove any prior `agent/demo-fix-*` branches created by the agent.

## Local Run

Build the local collector-owned images first:

```bash
cd /home/bjw/checkpoint-collector
docker build -t checkpoint-postgres:local ./postgres
docker build -t checkpoint-clickhouse:local .
```

Then start the checkpoint stack:

```bash
cd /home/bjw/checkpoint
docker compose up -d
```

Then start the agent:

```bash
cd agent && npm start
```

Use the load harness from `/home/bjw/checkpoint-collector` when you need to
generate database traffic.

## Live Validation

For a manual live-provider proof, run:

```bash
bash scripts/validate.sh
```

The script brings up the local stack, seeds fixture ClickHouse data, sends a
real `message/stream` A2A request to the agent, and prints the completed tool
results plus the agent response. It skips cleanly if `LLM_MODEL` is unset or if
the selected provider key is missing.

For the same flow as a manual node test, run:

```bash
cd agent && node --import tsx --test test/e2e/live_provider_validation.test.ts
```
