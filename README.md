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
Run the live model-backed integration path with
`npm run test:model-integration`.
That command skips cleanly when `OMP_MODEL` is unset and otherwise expects an
oh-my-pi runtime on `PATH` as `pi` unless `OH_MY_PI_COMMAND` overrides it.
Print the manual workspace smoke loop with
`bash scripts/workspace-smoke.sh`.

The collector source of truth lives in the sibling repo at
`/home/bjw/checkpoint-collector`. That repo owns the collector pipeline, the
ClickHouse DDLs, the demo Postgres image, and the load harness.

## Manual TUI Loop

1. Run `bash scripts/setup-oh-my-pi-workspace.sh`.
2. Set `OMP_MODEL` to the real model you want to use.
3. Start the oh-my-pi TUI from `~/.oh-my-pi-workspaces/checkpoint` with
   `pi --model "$OMP_MODEL"`.
4. Use the DB investigation skill with one of the prompts printed by
   `bash scripts/workspace-smoke.sh`.
5. Inspect the resulting diff or local commit in
   `~/.oh-my-pi-workspaces/checkpoint/workdir`.

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
