# Checkpoint DB Specialist

This repo owns the checkpoint agent runtime and orchestration glue.

The collector source of truth now lives in the sibling repo at
`/home/bjw/checkpoint-collector`. That repo owns the collector pipeline, the
ClickHouse DDLs, the demo Postgres image, and the load harness. Brett can
create the GitHub remote for that repo while the follow-on tasks proceed.

The Rails demo app is no longer stored here. Its source of truth is the sibling
repo at `/home/bjw/db-specialist-demo`.

## Standalone Pi Runtime

Build the package image from this repo root:

```bash
docker build -t checkpoint-db-specialist .
```

Run a standalone Pi session with the runtime environment the package uses for
its database and repo tools, plus an explicit Pi provider/model selection:

```bash
docker run --rm \
  --add-host host.docker.internal:host-gateway \
  -e OPENAI_API_KEY=... \
  -e CLICKHOUSE_URL=http://host.docker.internal:8123 \
  -e POSTGRES_URL=postgresql://... \
  -e DEMO_BASE_REF=main \
  -e CODE_SEARCH_ROOT=/work/db-specialist-demo \
  -v /path/to/db-specialist-demo:/work/db-specialist-demo \
  checkpoint-db-specialist \
  -e ./extensions/db-specialist.ts \
  --provider openai \
  --model gpt-4o-mini \
  -p "List the available DB specialist tools."
```

This image uses `@mariozechner/pi-coding-agent`, which provides the `pi`
binary. `@mariozechner/pi` exposes `pi-pods` instead.

The standalone runtime uses `CLICKHOUSE_URL`, `POSTGRES_URL`,
`DEMO_BASE_REF`, and `CODE_SEARCH_ROOT` for its tool integrations.
Set `GITHUB_TOKEN` and `DEMO_REPO` only when you want real GitHub pull request
creation instead of the local fallback URL. Choose the Pi model with CLI flags
such as `--provider openai --model gpt-4o-mini` plus the matching provider API
key env var.

## Session Configuration

Build the local images in the sibling collector repo before starting the
checkpoint compose stack.

## Local Run

Build the locally consumed images first from the sibling collector repo:

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
