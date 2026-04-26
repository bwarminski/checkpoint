# Checkpoint DB Specialist

This repo owns the oh-my-pi-based DB specialist MVP.

The generated oh-my-pi workspace skeleton lives at
`~/.oh-my-pi-workspaces/checkpoint`.
That skeleton keeps `.omp/skills` as a symlink into this repo, materializes
`.omp/extensions/db-specialist.ts` as the DB specialist runtime entrypoint, and
provides a persistent `workdir` for the demo clone and local agent state.

This checkout remains the source of truth for the DB specialist tools, skills,
tests, and the local database stack that workspace uses.

Create or refresh the workspace skeleton with
`bash scripts/setup-oh-my-pi-workspace.sh`.
Reset it to a clean generated state with
`bash scripts/reset-oh-my-pi-workspace.sh`.
Run the live model-backed integration path with
`npm run test:model-integration`.
That command skips cleanly when `OMP_MODEL` is unset and otherwise runs the
SDK-backed session test under Bun against the generated workspace.
Before opening a pull request or merging to `main`, run that command when the
required oh-my-pi live model environment is available. If the live environment
is unavailable, stop and report the PR or merge gate as blocked instead of
treating the skip as a pass. Intermediate local commits on working branches do
not need that live-model gate.
Print the manual workspace smoke loop with
`bash scripts/workspace-smoke.sh`.

The collector source of truth lives in the sibling repo at
`/home/bjw/checkpoint-collector`. That repo owns the collector pipeline, the
ClickHouse DDLs, the demo Postgres image, and the load harness.

## Manual TUI Loop

1. Run `bash scripts/setup-oh-my-pi-workspace.sh`.
2. Export the database connection env the tools expect:

   ```bash
   export PGHOST=127.0.0.1
   export PGPORT=5432
   export PGDATABASE=checkpoint_demo
   export PGUSER=postgres
   export PGPASSWORD=postgres
   export CLICKHOUSE_URL=http://127.0.0.1:8123
   ```

3. Set `OMP_MODEL` to the real model you want to use.
4. Start the oh-my-pi TUI from `~/.oh-my-pi-workspaces/checkpoint` with
   `omp --model "$OMP_MODEL"`.
5. Use the DB investigation skill with one of the prompts printed by
   `bash scripts/workspace-smoke.sh`.
6. Inspect the resulting diff or local commit in
   `~/.oh-my-pi-workspaces/checkpoint/workdir`.

## Docker Lab Containers

Build the shared lab image from this repo:

```bash
docker build -t checkpoint-omp-lab:local .
```

Start the source-blind control container with a model and Gemini key:

```bash
OMP_MODEL=google/gemini-2.5-pro \
GEMINI_API_KEY="$(cat ~/.gemini-key)" \
bash scripts/run-omp-control-container.sh
```

Start the skills-enabled container with the same model and Gemini key:

```bash
OMP_MODEL=google/gemini-2.5-pro \
GEMINI_API_KEY="$(cat ~/.gemini-key)" \
bash scripts/run-omp-skilled-container.sh
```

Both runners connect from the container to the host compose stack through
`host.docker.internal`. The default Postgres and ClickHouse env values point at
that host name, and the Docker args add the host-gateway mapping for Linux.

The lab workspaces under `~/.oh-my-pi-lab/` are disposable. Set
`OMP_LAB_RESET_WORKSPACE=1` to remove the selected workspace before starting the
container:

```bash
OMP_MODEL=google/gemini-2.5-pro \
GEMINI_API_KEY="$(cat ~/.gemini-key)" \
OMP_LAB_RESET_WORKSPACE=1 \
bash scripts/run-omp-skilled-container.sh
```

Clean disposable lab workspaces and labeled lab containers/volumes with:

```bash
bash scripts/clean-omp-lab.sh
```

Remove the shared lab image too with:

```bash
bash scripts/clean-omp-lab.sh --image
```

SSH is off by default. When `OMP_LAB_ENABLE_SSH=1` is set, the runners mount
only `~/.ssh/id_rsa` read-only into the container. They do not mount the host
`.ssh` directory or git config. Set `GITHUB_TOKEN` when you want `gh` API
access inside the container.

Dry-run mode avoids printing secret values where possible by passing Docker env
names, such as `GEMINI_API_KEY`, `GITHUB_TOKEN`, and database password vars,
instead of `KEY=value` arguments.

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
