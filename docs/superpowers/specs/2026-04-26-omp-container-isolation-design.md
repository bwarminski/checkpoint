# OMP Container Isolation Design

## Goal

Create repeatable Docker-based oh-my-pi evaluation environments that let Brett compare a generic agent against the checkpoint DB specialist setup without leaking checkpoint source code into the control run.

The first implementation should produce two equivalent runtime paths:

- A control container that has the same operating system, package set, model credentials, database access, and workspace ergonomics, but no repo-owned checkpoint skills, tools, extensions, or source tree.
- A skills-enabled container that uses the same image and service wiring, but mounts or creates the same `.omp` skill and extension layout that the current local workspace setup uses.

## Non-Goals

- Do not build a hostile minimal image in the first slice.
- Do not mount Brett's home directory, SSH keys, git config, or ambient dotfiles into either container.
- Do not copy `/home/bjw/checkpoint` into the control container.
- Do not create backward-compatible support for the existing root Dockerfile behavior that copies this repo into `/app`.

## Architecture

Use one Docker image and two run scripts.

The image should start from `mcr.microsoft.com/devcontainers/universal:2-linux` and install the shared agent-test workstation tools:

- `omp` from `@oh-my-pi/pi-coding-agent`
- Bun, when needed for the npm-distributed oh-my-pi runtime
- Postgres and MySQL client tools
- `pgcli`, `mycli`, `sqlite3`, `jq`, `ripgrep`, `fd`, `tmux`, `tree`, and related shell diagnostics
- Node, npm, Python, build tooling, git, curl, and CA certificates

The image should not copy the checkpoint repo. Runtime scripts provide all task-specific inputs through bind mounts and environment variables.

## Runtime Modes

`scripts/run-omp-control-container.sh` runs the source-blind control.

It should:

- Build or use the shared OMP lab image.
- Create a neutral host workspace outside the checkpoint checkout.
- Mount that neutral workspace at `/workspace`.
- Pass `GEMINI_API_KEY` from `~/.gemini-key` by default.
- Pass the selected model through `OMP_MODEL` or an explicit script argument.
- Configure Postgres and ClickHouse connection environment variables that resolve to the host compose stack from inside Docker.
- Avoid mounting this repo, `.omp` skills, `.omp` extensions, home directories, SSH keys, or API credential files.

`scripts/run-omp-skilled-container.sh` runs the checkpoint skills experiment.

It should:

- Use the same image as the control script.
- Create a container-visible generated workspace with `.omp/skills` and `.omp/extensions/db-specialist.ts` matching the current local setup semantics.
- Mount only the repo paths needed to load those skills and extension modules.
- Use the same model, API key, and database connection environment contract as the control script.
- Keep the working directory and task workspace separate from the checkpoint source mount so agent edits land in the intended test workspace.

## Database And Network Access

Both scripts should assume the existing checkpoint compose stack is already running on the host.

From the container, Postgres and ClickHouse should be reachable through Docker's host gateway:

- Postgres: `host.docker.internal:5432`
- ClickHouse HTTP: `host.docker.internal:8123`
- ClickHouse native: `host.docker.internal:9000`

The scripts should add `--add-host host.docker.internal:host-gateway` so this works on Linux Docker.

## Secret Handling

The scripts should read `GEMINI_API_KEY` from the existing environment when present, otherwise from `~/.gemini-key`.

The key should be passed as an environment variable only. The scripts must not mount the key file into the container.

## Error Handling

The run scripts should fail before starting the container when required inputs are unavailable:

- Docker is missing.
- `~/.gemini-key` is missing and `GEMINI_API_KEY` is unset.
- The neutral or skilled workspace cannot be created.

They should warn, but not fail, when the host database ports do not appear reachable, because Brett may intentionally start the agent before the collector stack.

## Testing

Add focused tests for the script contracts rather than trying to automate the interactive TUI:

- The control script's generated `docker run` arguments do not mount the checkpoint repo and do include the neutral workspace, `GEMINI_API_KEY`, model env, database env, and host gateway mapping.
- The skills script's generated `docker run` arguments use the same image and DB/model/secret contract, and mount the checkpoint paths needed for `.omp` skills and extension loading.
- The shared Dockerfile starts from Dev Containers Universal and does not copy the repo into the image.

Manual verification remains an interactive smoke loop:

1. Start the checkpoint compose stack.
2. Run the control container and confirm the agent can query the exposed databases without seeing checkpoint source or skills.
3. Run the skills-enabled container and confirm it can discover the DB specialist skill and extension tools.

## Documentation

Update `README.md` or a dedicated script output so Brett can run both modes with minimal setup:

- Build the lab image.
- Start the checkpoint compose stack.
- Run the control container.
- Run the skills-enabled container.
- Pass `GEMINI_API_KEY=$(cat ~/.gemini-key)` explicitly or rely on the default key-file lookup.
