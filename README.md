# Checkpoint DB Specialist

This repo owns the checkpoint agent runtime and orchestration glue.

The collector source of truth now lives in the sibling repo at
`/home/bjw/checkpoint-collector`. Brett can create the GitHub remote for that
repo while the follow-on tasks proceed.

The Rails demo app is no longer stored here. Its source of truth is the sibling
repo at `/home/bjw/db-specialist-demo`.

## Session Configuration

No environment variables are required for the slim local stack. Build the
local images in the sibling collector repo before starting the checkpoint
compose stack.

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
