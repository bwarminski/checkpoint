# OMP Container Isolation Design

## Goal

Create repeatable Docker-based oh-my-pi evaluation environments that let Brett compare a generic agent against the checkpoint DB specialist setup without leaking checkpoint source code into the control run.

The first implementation should produce two equivalent runtime paths:

- A control container that has the same operating system, package set, model credentials, database access, and workspace ergonomics, but no repo-owned checkpoint skills, tools, extensions, or source tree.
- A skills-enabled container that uses the same image and service wiring, but mounts or creates the same `.omp` skill and extension layout that the current local workspace setup uses.

## Non-Goals

- Do not build a hostile minimal image in the first slice.
- Do not mount Brett's home directory, full `.ssh` directory, git config, or ambient dotfiles into either container.
- Do not copy `/home/bjw/checkpoint` into the control container.
- Do not create backward-compatible support for the existing root Dockerfile behavior that copies this repo into `/app`.

## Architecture

Use one shared Docker base with separate control and skilled image targets, plus two run scripts.

The image should start from `mcr.microsoft.com/devcontainers/universal:3-linux` and install the shared agent-test workstation tools:

- `omp` from `@oh-my-pi/pi-coding-agent`
- Bun, when needed for the npm-distributed oh-my-pi runtime
- Postgres and MySQL client tools
- `pgcli`, `mycli`, `sqlite3`, `jq`, `ripgrep`, `fd`, `tmux`, `tree`, and related shell diagnostics
- Node, npm, Python, build tooling, git, curl, and CA certificates

The control image should not copy the checkpoint repo. The skilled image should copy only the checkpoint `src/` and `skills/` trees into image-owned paths so the skilled runtime no longer depends on host source bind mounts.

Lab workspaces are disposable state owned by these scripts. The default control
and skills workspaces should live under `~/.oh-my-pi-lab/`, and deleting them
must be safe. Brett should put durable source checkouts elsewhere and mount or
clone them into a fresh lab workspace intentionally.

## Runtime Modes

`scripts/run-omp-control-container.sh` runs the source-blind control.

It should:

- Build or use the shared OMP lab image.
- Create a neutral host workspace outside the checkpoint checkout.
- Mount that neutral workspace at `/workspace`.
- Reset the neutral workspace before starting when `OMP_LAB_RESET_WORKSPACE=1`.
- Pass `GEMINI_API_KEY` from `~/.gemini-key` by default.
- Pass the selected model through `OMP_MODEL` or an explicit script argument.
- Configure Postgres and ClickHouse connection environment variables that resolve to the host compose stack from inside Docker.
- Avoid mounting this repo, `.omp` skills, `.omp` extensions, home directories, or API credential files.
- Mount Git SSH and GitHub CLI credentials only when Brett explicitly enables that run option.

`scripts/run-omp-skilled-container.sh` runs the checkpoint skills experiment.

It should:

- Use the same base image as the control script through a skilled image target.
- Let the skilled image entrypoint create a container-visible generated workspace with `.omp/skills` and `.omp/extensions/db-specialist.ts` matching the current local setup semantics.
- Reset the generated workspace before starting when `OMP_LAB_RESET_WORKSPACE=1`.
- Avoid host source and skills bind mounts by using the checkpoint paths baked into the skilled image.
- Use the same model, API key, and database connection environment contract as the control script.
- Use the same optional Git SSH and GitHub CLI credential contract as the control script.
- Keep the working directory and task workspace separate from the checkpoint source baked into the image so agent edits land in the intended test workspace.

## Database And Network Access

Both scripts should assume the existing checkpoint compose stack is already running on the host.

From the container, Postgres and ClickHouse should be reachable through Docker's host gateway:

- Postgres: `host.docker.internal:5432`
- ClickHouse HTTP: `host.docker.internal:8123`
- ClickHouse native: `host.docker.internal:9000`

The scripts should add `--add-host host.docker.internal:host-gateway` so this works on Linux Docker.

## Cleanup

`scripts/clean-omp-lab.sh` should remove lab-created artifacts so Brett can
force a fresh control or skills run.

By default it should remove:

- Lab containers labeled with `checkpoint.omp-lab=true`.
- The default control workspace under `~/.oh-my-pi-lab/control-workspace`.
- The default skills workspace under `~/.oh-my-pi-lab/skilled-workspace`.
- Any named Docker volumes labeled with `checkpoint.omp-lab=true` if future work adds them.

It should remove the control and skilled lab images only when Brett
passes an explicit image cleanup option such as `--image`, because image rebuilds
are slower than workspace cleanup.

The run scripts should label containers with `checkpoint.omp-lab=true` and a
mode-specific label so cleanup can target only the lab's Docker artifacts.

## Secret Handling

The scripts should read `GEMINI_API_KEY` from the existing environment when present, otherwise from `~/.gemini-key`.

The key should be passed as an environment variable only. The scripts must not mount the key file into the container.

Git and GitHub access should be opt-in per run.

The first implementation can support mounting Brett's `~/.ssh/id_rsa` because that matches the current lab need. The mount should be:

- Explicitly requested by an environment variable or script flag.
- Read-only.
- Mounted as the container user's private key, not by mounting the whole host `.ssh` directory.
- Paired with a container-owned `.ssh/config` entry that points GitHub SSH traffic at that key.
- Paired with `known_hosts` setup for `github.com`, preferably generated inside the container image or startup path rather than copied from Brett's home directory.

The scripts should not mount `~/.gitconfig` by default. If commits from inside the lab need a name and email, the script should set neutral lab-local git config values inside the container or document the explicit override.

`gh` API access should use `GITHUB_TOKEN` when the environment provides it. If Brett wants to reuse `gh auth login` state later, that should be a separate explicit mount of the minimum needed GitHub CLI config, not part of the default SSH-key option.

## Error Handling

The run scripts should fail before starting the container when required inputs are unavailable:

- Docker is missing.
- `~/.gemini-key` is missing and `GEMINI_API_KEY` is unset.
- Git SSH access is requested but `~/.ssh/id_rsa` is missing.
- The neutral or skilled workspace cannot be created, reset, or removed when requested.

They should warn, but not fail, when the host database ports do not appear reachable, because Brett may intentionally start the agent before the collector stack.

## Testing

Add focused tests for the script contracts rather than trying to automate the interactive TUI:

- The control script's generated `docker run` arguments do not mount the checkpoint repo and do include the neutral workspace, `GEMINI_API_KEY`, model env, database env, and host gateway mapping.
- The skills script's generated `docker run` arguments use the same image and DB/model/secret contract, and mount the checkpoint paths needed for `.omp` skills and extension loading.
- The optional SSH mode mounts only `~/.ssh/id_rsa` read-only, does not mount the host `.ssh` directory, and passes `GITHUB_TOKEN` only when present.
- The reset mode removes and recreates the selected lab workspace before building Docker arguments.
- The cleanup script removes only labeled lab containers, labeled lab volumes, and default lab workspace directories unless image removal is explicitly requested.
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
- Reset or clean lab state before a fresh run.
- Pass `GEMINI_API_KEY=$(cat ~/.gemini-key)` explicitly or rely on the default key-file lookup.
- Enable Git SSH access explicitly when the lab agent needs to pull private repos.
