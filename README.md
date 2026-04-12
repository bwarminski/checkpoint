# Checkpoint DB Specialist

This repo owns the oh-my-pi-based DB specialist MVP.

The generated oh-my-pi workspace skeleton lives at
`~/.oh-my-pi-workspaces/checkpoint`.
Today that skeleton contains repo-backed `.omp/skills` and `.omp/tools`
symlinks plus a persistent `workdir` for the demo clone and local agent state.

This checkout remains the source of truth for the DB specialist tools, skills,
tests, and the local database stack that workspace uses.

Create or refresh the workspace skeleton with
`bash scripts/setup-oh-my-pi-workspace.sh`.
Reset it to a clean generated state with
`bash scripts/reset-oh-my-pi-workspace.sh`.

The collector source of truth lives in the sibling repo at
`/home/bjw/checkpoint-collector`. That repo owns the collector pipeline, the
ClickHouse DDLs, the demo Postgres image, and the load harness.

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
