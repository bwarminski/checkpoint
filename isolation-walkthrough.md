# OMP Container Isolation Walkthrough

*2026-04-26T21:33:28Z by Showboat 0.6.1*
<!-- showboat-id: 8c87a5a5-4f52-4837-809c-6db99bc66d33 -->

## Walkthrough Plan

This walkthrough follows the branch in the same order the runtime executes it:

1. Start with the design contract: one shared workstation image, two run modes, no checkpoint source in control mode, identical service/secret wiring in both modes.
2. Inspect the Docker image, which builds the common workstation without copying this repository.
3. Walk through `scripts/omp-lab-common.sh`, the shared shell library that resolves credentials, validates workspace paths, exports database defaults, assembles Docker arguments, and handles cleanup safety.
4. Follow `scripts/run-omp-control-container.sh`, the source-blind path.
5. Follow `scripts/run-omp-skilled-container.sh`, the checkpoint-enabled path.
6. Follow `scripts/clean-omp-lab.sh`, the path for fresh runs.
7. Close with the tests that prove the isolation, secret handling, SSH behavior, reset behavior, and Dockerfile contract.

## 1. The Contract From The Spec

The spec asks for a fair comparison: the control and skilled agents should have the same OS, tools, model key, and database access. The only intentional difference is whether checkpoint skills and source-mounted extension code are visible.

```bash
sed -n '1,70p' docs/superpowers/specs/2026-04-26-omp-container-isolation-design.md
```

```output
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

Use one Docker image and two run scripts.

The image should start from `mcr.microsoft.com/devcontainers/universal:2-linux` and install the shared agent-test workstation tools:

- `omp` from `@oh-my-pi/pi-coding-agent`
- Bun, when needed for the npm-distributed oh-my-pi runtime
- Postgres and MySQL client tools
- `pgcli`, `mycli`, `sqlite3`, `jq`, `ripgrep`, `fd`, `tmux`, `tree`, and related shell diagnostics
- Node, npm, Python, build tooling, git, curl, and CA certificates

The image should not copy the checkpoint repo. Runtime scripts provide all task-specific inputs through bind mounts and environment variables.

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

- Use the same image as the control script.
- Create a container-visible generated workspace with `.omp/skills` and `.omp/extensions/db-specialist.ts` matching the current local setup semantics.
- Reset the generated workspace before starting when `OMP_LAB_RESET_WORKSPACE=1`.
- Mount only the repo paths needed to load those skills and extension modules.
- Use the same model, API key, and database connection environment contract as the control script.
- Use the same optional Git SSH and GitHub CLI credential contract as the control script.
- Keep the working directory and task workspace separate from the checkpoint source mount so agent edits land in the intended test workspace.

## Database And Network Access

Both scripts should assume the existing checkpoint compose stack is already running on the host.

From the container, Postgres and ClickHouse should be reachable through Docker's host gateway:
```

## 2. Shared Workstation Image

The Dockerfile is the common runtime substrate. It starts from Dev Containers Universal, installs the command-line tools a generic development workstation would usually have, installs OMP globally through Bun, prepares extension dependencies under `/checkpoint-src`, and then switches to the image's non-root `codespace` user. There is no `COPY . .`, so the image itself does not contain this checkout.

```bash
sed -n '1,95p' Dockerfile
```

```output
# ABOUTME: Builds the shared workstation image for isolated oh-my-pi lab containers.
# ABOUTME: Installs OMP, database clients, GitHub tooling, and common diagnostics without copying this repo.
FROM mcr.microsoft.com/devcontainers/universal:2-linux

USER root

COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

ENV BUN_INSTALL="/usr/local"
ENV PATH="/usr/local/bin:${PATH}"

RUN rm -f /etc/apt/sources.list.d/yarn.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    default-mysql-client \
    direnv \
    fd-find \
    gh \
    git \
    htop \
    jq \
    mycli \
    netcat-openbsd \
    openssh-client \
    pgcli \
    pkg-config \
    postgresql-client \
    python3 \
    python3-pip \
    pipx \
    ripgrep \
    sqlite3 \
    tmux \
    tree \
    wget \
  && rm -rf /var/lib/apt/lists/*

RUN bun install -g @oh-my-pi/pi-coding-agent

RUN mkdir -p /checkpoint-src \
  && cd /checkpoint-src \
  && npm init -y \
  && npm install \
    @oh-my-pi/pi-ai@^14.1.2 \
    @sinclair/typebox@^0.34.49 \
    pg@^8.20.0

RUN mkdir -p /etc/ssh/ssh_known_hosts.d \
  && ssh-keyscan github.com > /etc/ssh/ssh_known_hosts

RUN mkdir -p /home/codespace/.ssh \
  && printf 'Host github.com\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/id_rsa\n  IdentitiesOnly yes\n' > /home/codespace/.ssh/config \
  && chown -R codespace:codespace /home/codespace/.ssh \
  && chmod 700 /home/codespace/.ssh \
  && chmod 600 /home/codespace/.ssh/config

RUN mkdir -p /workspace \
  && chown codespace:codespace /workspace

WORKDIR /workspace

USER codespace

ENTRYPOINT ["omp"]
```

## 3. Shared Shell Library: Constants And Required Inputs

Both run scripts source `omp-lab-common.sh`. The top of the file establishes the shared image name, the container user/home, and the repository root used for source-visibility checks. It also defines the required model and Gemini key behavior: `GEMINI_API_KEY` wins when already exported; otherwise the scripts read `${HOME}/.gemini-key` and export the value for Docker env-name passthrough.

```bash
sed -n '1,65p' scripts/omp-lab-common.sh
```

```output
#!/usr/bin/env bash
# ABOUTME: Provides shared Docker argument construction for OMP lab run scripts.
# ABOUTME: Resolves lab workspaces, model credentials, database env, and optional Git credentials.

set -euo pipefail

OMP_LAB_IMAGE="${OMP_LAB_IMAGE:-checkpoint-omp-lab:local}"
OMP_LAB_CONTAINER_USER="${OMP_LAB_CONTAINER_USER:-codespace}"
OMP_LAB_CONTAINER_HOME="/home/${OMP_LAB_CONTAINER_USER}"
OMP_LAB_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
OMP_LAB_REPO_ROOT="$(cd "${OMP_LAB_COMMON_DIR}/.." && pwd -P)"

resolve_gemini_api_key() {
  if [[ -n "${GEMINI_API_KEY:-}" ]]; then
    printf '%s\n' "${GEMINI_API_KEY}"
    return
  fi

  local key_path="${HOME}/.gemini-key"
  if [[ ! -f "${key_path}" ]]; then
    printf 'GEMINI_API_KEY is unset and %s does not exist\n' "${key_path}" >&2
    return 1
  fi

  tr -d '\n' < "${key_path}"
}

require_omp_model() {
  if [[ -z "${OMP_MODEL:-}" ]]; then
    printf 'OMP_MODEL must be set, for example google/gemini-2.5-pro\n' >&2
    return 1
  fi
}

ensure_workspace() {
  local workspace="$1"
  mkdir -p "${workspace}"
}

require_docker_for_container_run() {
  if [[ "${OMP_LAB_DRY_RUN:-0}" == "1" ]]; then
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    printf 'docker not found; cannot run OMP lab container\n' >&2
    exit 127
  fi

  if ! docker info >/dev/null 2>&1; then
    printf 'Docker daemon unavailable; cannot run OMP lab container\n' >&2
    exit 1
  fi
}

resolve_lab_workspace_path() {
  local env_name="$1"
  local default_path="$2"

  if [[ -v "${env_name}" ]]; then
    printf '%s\n' "${!env_name}"
    return
  fi

  printf '%s\n' "${default_path}"
```

## 4. Workspace Validation: Source-Hidden For Runs, Lab-Owned For Deletion

There are two different safety rules because mounting and deleting have different risk profiles.

For a run, the workspace must be source-hidden: it cannot be empty, `/`, the checkpoint repo, below the checkpoint repo, or an ancestor that would reveal the repo inside `/workspace`. That rule is shared by both control and skilled runs.

For deletion, the rule is stricter: reset and cleanup are allowed only under `${HOME}/.oh-my-pi-lab`, and they refuse home, repo root, lab root, `/`, empty paths, and paths outside the lab root.

```bash
sed -n '66,155p' scripts/omp-lab-common.sh
```

```output
}

refuse_unsafe_lab_workspace_path() {
  local env_name="$1"
  local workspace="$2"

  if [[ -z "${workspace}" ]]; then
    workspace="<empty>"
  fi

  printf 'Refusing to remove unsafe workspace path for %s: %s\n' "${env_name}" "${workspace}" >&2
  exit 2
}

refuse_source_visible_workspace_path() {
  local env_name="$1"
  local workspace="$2"

  if [[ -z "${workspace}" ]]; then
    workspace="<empty>"
  fi

  printf 'Refusing source-visible workspace for %s: %s\n' "${env_name}" "${workspace}" >&2
  exit 2
}

validate_source_hidden_workspace_path() {
  local env_name="$1"
  local workspace="$2"
  local normalized_repo
  local normalized_workspace

  if [[ -z "${workspace}" ]]; then
    refuse_source_visible_workspace_path "${env_name}" "${workspace}"
  fi

  normalized_repo="$(realpath -m -- "${OMP_LAB_REPO_ROOT}")"
  normalized_workspace="$(realpath -m -- "${workspace}")"

  if [[ "${normalized_workspace}" == "/" ]]; then
    refuse_source_visible_workspace_path "${env_name}" "${workspace}"
  fi

  if [[ "${normalized_workspace}" == "${normalized_repo}" || "${normalized_workspace}" == "${normalized_repo}/"* ]]; then
    refuse_source_visible_workspace_path "${env_name}" "${workspace}"
  fi

  if [[ "${normalized_repo}" == "${normalized_workspace}/"* ]]; then
    refuse_source_visible_workspace_path "${env_name}" "${workspace}"
  fi
}

validate_lab_workspace_removal_path() {
  local env_name="$1"
  local workspace="$2"
  local lab_root
  local normalized_home
  local normalized_repo
  local normalized_workspace

  if [[ -z "${workspace}" ]]; then
    refuse_unsafe_lab_workspace_path "${env_name}" "${workspace}"
  fi

  lab_root="$(realpath -m -- "${HOME}/.oh-my-pi-lab")"
  normalized_home="$(realpath -m -- "${HOME}")"
  normalized_repo="$(realpath -m -- "${OMP_LAB_REPO_ROOT}")"
  normalized_workspace="$(realpath -m -- "${workspace}")"

  if [[ "${normalized_workspace}" == "/" ]]; then
    refuse_unsafe_lab_workspace_path "${env_name}" "${workspace}"
  fi

  if [[ "${normalized_workspace}" == "${normalized_home}" ]]; then
    refuse_unsafe_lab_workspace_path "${env_name}" "${workspace}"
  fi

  if [[ "${normalized_workspace}" == "${normalized_repo}" ]]; then
    refuse_unsafe_lab_workspace_path "${env_name}" "${workspace}"
  fi

  if [[ "${normalized_workspace}" == "${lab_root}" || "${normalized_workspace}" != "${lab_root}/"* ]]; then
    refuse_unsafe_lab_workspace_path "${env_name}" "${workspace}"
  fi
}

reset_lab_workspace() {
  local env_name="$1"
  local workspace="$2"

```

## 5. Docker Arguments: Same Model, Same DB, Same Secrets Contract

The shared Docker argument builder is where the control and skilled modes stay comparable. Both get the same image, host gateway mapping, `/workspace` mount, OMP model, Gemini env passthrough, Postgres env, ClickHouse env, and optional GitHub token passthrough.

The important detail is that secrets and database credentials are passed as env names, not `KEY=value` argv entries. That keeps dry-run output and Docker process argv from containing secret values.

```bash
sed -n '156,235p' scripts/omp-lab-common.sh
```

```output
  validate_lab_workspace_removal_path "${env_name}" "${workspace}"
  rm -rf "${workspace}"
  ensure_workspace "${workspace}"
}

export_default_db_env() {
  export PGHOST="${PGHOST:-host.docker.internal}"
  export PGPORT="${PGPORT:-5432}"
  export PGDATABASE="${PGDATABASE:-checkpoint_demo}"
  export PGUSER="${PGUSER:-postgres}"
  export PGPASSWORD="${PGPASSWORD:-postgres}"
  export CLICKHOUSE_URL="${CLICKHOUSE_URL:-http://host.docker.internal:8123}"
  export CLICKHOUSE_HOST="${CLICKHOUSE_HOST:-host.docker.internal}"
  export CLICKHOUSE_PORT="${CLICKHOUSE_PORT:-9000}"
}

append_base_docker_args() {
  local -n args_ref="$1"
  local workspace="$2"

  args_ref+=(
    docker run --rm -it
    --name "${OMP_LAB_CONTAINER_NAME:-oh-my-pi-lab}"
    --label checkpoint.omp-lab=true
    --add-host host.docker.internal:host-gateway
    --mount "type=bind,source=${workspace},target=/workspace"
    --env GEMINI_API_KEY
    --env "OMP_MODEL=${OMP_MODEL}"
    --env PGHOST
    --env PGPORT
    --env PGDATABASE
    --env PGUSER
    --env PGPASSWORD
    --env CLICKHOUSE_URL
    --env CLICKHOUSE_HOST
    --env CLICKHOUSE_PORT
  )

  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    args_ref+=(--env GITHUB_TOKEN)
  fi
}

append_git_ssh_args() {
  local -n args_ref="$1"

  if [[ "${OMP_LAB_ENABLE_SSH:-0}" != "1" ]]; then
    return
  fi

  local ssh_key="${OMP_LAB_SSH_KEY:-${HOME}/.ssh/id_rsa}"
  if [[ ! -f "${ssh_key}" ]]; then
    printf 'OMP_LAB_ENABLE_SSH=1 but SSH key %s does not exist\n' "${ssh_key}" >&2
    return 1
  fi

  args_ref+=(
    --mount "type=bind,source=${ssh_key},target=${OMP_LAB_CONTAINER_HOME}/.ssh/id_rsa,readonly"
  )
}

finish_docker_args() {
  local -n args_ref="$1"
  args_ref+=("${OMP_LAB_IMAGE}" --model "${OMP_MODEL}")
}

run_or_print_docker_args() {
  local -n args_ref="$1"

  if [[ "${OMP_LAB_DRY_RUN:-0}" == "1" ]]; then
    printf '%q ' "${args_ref[@]}"
    printf '\n'
    return
  fi

  exec "${args_ref[@]}"
}
```

## 6. Control Runner: The Source-Blind Path

The control script is intentionally boring. It resolves the required model and key, exports DB defaults, chooses a workspace, validates that the workspace cannot reveal this checkout, assembles Docker args, preflights Docker for real runs, creates or resets the workspace, and then starts OMP.

The control-specific Docker difference is only the mode label. It does not mount `skills/`, `src/`, `.omp`, the repo root, home, SSH by default, or Git config.

```bash
sed -n '1,90p' scripts/run-omp-control-container.sh
```

```output
#!/usr/bin/env bash
# ABOUTME: Runs the source-blind OMP control lab container.
# ABOUTME: Mounts only a neutral workspace while sharing model and database connectivity.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/omp-lab-common.sh"

require_omp_model
GEMINI_KEY="$(resolve_gemini_api_key)"
export GEMINI_API_KEY="${GEMINI_KEY}"
export_default_db_env
WORKSPACE="$(resolve_lab_workspace_path OMP_LAB_WORKSPACE "${HOME}/.oh-my-pi-lab/control-workspace")"
validate_source_hidden_workspace_path OMP_LAB_WORKSPACE "${WORKSPACE}"

docker_args=()
append_base_docker_args docker_args "${WORKSPACE}"
docker_args+=(--label checkpoint.omp-lab.mode=control)
append_git_ssh_args docker_args
finish_docker_args docker_args

require_docker_for_container_run
if [[ "${OMP_LAB_RESET_WORKSPACE:-0}" == "1" ]]; then
  reset_lab_workspace OMP_LAB_WORKSPACE "${WORKSPACE}"
else
  ensure_workspace "${WORKSPACE}"
fi

run_or_print_docker_args docker_args
```

A dry-run shows the control container's shape without starting the TUI. This command uses a deterministic neutral workspace and synthetic credentials; the output includes env names but not the synthetic secret value.

```bash
tmp_home=/tmp/checkpoint-showboat-home-control; tmp_ws=/tmp/checkpoint-showboat-workspace-control; rm -rf "$tmp_home" "$tmp_ws"; mkdir -p "$tmp_home" "$tmp_ws"; OMP_LAB_DRY_RUN=1 HOME="$tmp_home" OMP_MODEL=google/gemini-2.5-pro GEMINI_API_KEY=demo-secret OMP_LAB_WORKSPACE="$tmp_ws" bash scripts/run-omp-control-container.sh; rm -rf "$tmp_home" "$tmp_ws"
```

```output
docker run --rm -it --name oh-my-pi-lab --label checkpoint.omp-lab=true --add-host host.docker.internal:host-gateway --mount type=bind\,source=/tmp/checkpoint-showboat-workspace-control\,target=/workspace --env GEMINI_API_KEY --env OMP_MODEL=google/gemini-2.5-pro --env PGHOST --env PGPORT --env PGDATABASE --env PGUSER --env PGPASSWORD --env CLICKHOUSE_URL --env CLICKHOUSE_HOST --env CLICKHOUSE_PORT --label checkpoint.omp-lab.mode=control checkpoint-omp-lab:local --model google/gemini-2.5-pro 
```

## 7. Skilled Runner: Same Base, Deliberate Checkpoint Mounts

The skilled script uses the same shared setup and validation as control. Its extra work is to prepare an OMP project workspace and mount only the checkpoint paths required for the specialist runtime.

It clears generated `.omp` state in the selected workspace, writes `.omp/extensions/db-specialist.ts`, mounts repo `skills/` read-only at `/workspace/.omp/skills`, and mounts repo `src/` read-only at `/checkpoint-src/src`. The task workspace remains `/workspace`; the checkpoint source is separate and read-only.

```bash
sed -n '1,120p' scripts/run-omp-skilled-container.sh
```

```output
#!/usr/bin/env bash
# ABOUTME: Runs the OMP lab container with checkpoint skills and extension sources mounted.
# ABOUTME: Keeps the editable workspace separate from read-only checkpoint runtime mounts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/omp-lab-common.sh"

require_omp_model
GEMINI_KEY="$(resolve_gemini_api_key)"
export GEMINI_API_KEY="${GEMINI_KEY}"
export_default_db_env
WORKSPACE="$(resolve_lab_workspace_path OMP_LAB_WORKSPACE "${HOME}/.oh-my-pi-lab/skilled-workspace")"
validate_source_hidden_workspace_path OMP_LAB_WORKSPACE "${WORKSPACE}"

docker_args=()
append_base_docker_args docker_args "${WORKSPACE}"
docker_args+=(
  --label checkpoint.omp-lab.mode=skilled
  --mount "type=bind,source=${REPO_ROOT}/skills,target=/workspace/.omp/skills,readonly"
  --mount "type=bind,source=${REPO_ROOT}/src,target=/checkpoint-src/src,readonly"
  --env "CHECKPOINT_EXTENSION_SOURCE=/checkpoint-src/src/omp_extension/db_specialist_extension.ts"
)
append_git_ssh_args docker_args
finish_docker_args docker_args

require_docker_for_container_run
if [[ "${OMP_LAB_RESET_WORKSPACE:-0}" == "1" ]]; then
  reset_lab_workspace OMP_LAB_WORKSPACE "${WORKSPACE}"
else
  ensure_workspace "${WORKSPACE}"
fi
rm -rf "${WORKSPACE}/.omp/skills" "${WORKSPACE}/.omp/tools" "${WORKSPACE}/.omp/extensions"
mkdir -p "${WORKSPACE}/.omp/extensions"

cat > "${WORKSPACE}/.omp/extensions/db-specialist.ts" <<'ENTRYPOINT'
export { default } from "/checkpoint-src/src/omp_extension/db_specialist_extension.ts";
ENTRYPOINT

run_or_print_docker_args docker_args
```

The skilled dry-run has the same model, key, DB, and image contract as control, plus the deliberate read-only `skills/` and `src/` mounts. The generated extension entrypoint is materialized in the selected workspace before Docker starts.

```bash
tmp_home=/tmp/checkpoint-showboat-home-skilled; tmp_ws=/tmp/checkpoint-showboat-workspace-skilled; rm -rf "$tmp_home" "$tmp_ws"; mkdir -p "$tmp_home" "$tmp_ws"; OMP_LAB_DRY_RUN=1 HOME="$tmp_home" OMP_MODEL=google/gemini-2.5-pro GEMINI_API_KEY=demo-secret OMP_LAB_WORKSPACE="$tmp_ws" bash scripts/run-omp-skilled-container.sh; printf "\n--- generated extension ---\n"; sed -n "1,5p" "$tmp_ws/.omp/extensions/db-specialist.ts"; rm -rf "$tmp_home" "$tmp_ws"
```

```output
docker run --rm -it --name oh-my-pi-lab --label checkpoint.omp-lab=true --add-host host.docker.internal:host-gateway --mount type=bind\,source=/tmp/checkpoint-showboat-workspace-skilled\,target=/workspace --env GEMINI_API_KEY --env OMP_MODEL=google/gemini-2.5-pro --env PGHOST --env PGPORT --env PGDATABASE --env PGUSER --env PGPASSWORD --env CLICKHOUSE_URL --env CLICKHOUSE_HOST --env CLICKHOUSE_PORT --label checkpoint.omp-lab.mode=skilled --mount type=bind\,source=/home/bjw/checkpoint/skills\,target=/workspace/.omp/skills\,readonly --mount type=bind\,source=/home/bjw/checkpoint/src\,target=/checkpoint-src/src\,readonly --env CHECKPOINT_EXTENSION_SOURCE=/checkpoint-src/src/omp_extension/db_specialist_extension.ts checkpoint-omp-lab:local --model google/gemini-2.5-pro 

--- generated extension ---
export { default } from "/checkpoint-src/src/omp_extension/db_specialist_extension.ts";
```

## 8. Optional Git SSH And GitHub CLI Access

SSH access is opt-in. When `OMP_LAB_ENABLE_SSH=1`, the scripts mount exactly one private-key file into the container user's SSH directory. They do not mount the host `.ssh` directory, home directory, or git config. If `GITHUB_TOKEN` is present, Docker receives the env name `GITHUB_TOKEN`; the token value is not placed into argv.

```bash
tmp_home=/tmp/checkpoint-showboat-home-ssh; tmp_ws=/tmp/checkpoint-showboat-workspace-ssh; rm -rf "$tmp_home" "$tmp_ws"; mkdir -p "$tmp_home/.ssh" "$tmp_ws"; printf fake-key > "$tmp_home/.ssh/id_rsa"; chmod 600 "$tmp_home/.ssh/id_rsa"; OMP_LAB_DRY_RUN=1 HOME="$tmp_home" OMP_MODEL=google/gemini-2.5-pro GEMINI_API_KEY=demo-secret GITHUB_TOKEN=demo-token OMP_LAB_ENABLE_SSH=1 OMP_LAB_WORKSPACE="$tmp_ws" bash scripts/run-omp-control-container.sh; rm -rf "$tmp_home" "$tmp_ws"
```

```output
docker run --rm -it --name oh-my-pi-lab --label checkpoint.omp-lab=true --add-host host.docker.internal:host-gateway --mount type=bind\,source=/tmp/checkpoint-showboat-workspace-ssh\,target=/workspace --env GEMINI_API_KEY --env OMP_MODEL=google/gemini-2.5-pro --env PGHOST --env PGPORT --env PGDATABASE --env PGUSER --env PGPASSWORD --env CLICKHOUSE_URL --env CLICKHOUSE_HOST --env CLICKHOUSE_PORT --env GITHUB_TOKEN --label checkpoint.omp-lab.mode=control --mount type=bind\,source=/tmp/checkpoint-showboat-home-ssh/.ssh/id_rsa\,target=/home/codespace/.ssh/id_rsa\,readonly checkpoint-omp-lab:local --model google/gemini-2.5-pro 
```

## 9. Cleanup: Fresh Runs Without Unsafe Deletes

The cleanup script removes disposable state: the default lab workspaces plus Docker containers and volumes carrying the lab label. It validates the workspace paths before deleting them, skips Docker artifact cleanup when Docker is unavailable, and removes the shared image only with `--image`.

```bash
sed -n '1,130p' scripts/clean-omp-lab.sh
```

```output
#!/usr/bin/env bash
# ABOUTME: Removes disposable OMP lab workspaces and labeled Docker artifacts.
# ABOUTME: Keeps image removal explicit so routine cleanup stays fast.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/omp-lab-common.sh"

REMOVE_IMAGE=0
for arg in "$@"; do
  case "${arg}" in
    --image)
      REMOVE_IMAGE=1
      ;;
    *)
      printf 'Unknown option: %s\n' "${arg}" >&2
      exit 2
      ;;
  esac
done

CONTROL_WORKSPACE="$(resolve_lab_workspace_path OMP_LAB_CONTROL_WORKSPACE "${HOME}/.oh-my-pi-lab/control-workspace")"
SKILLED_WORKSPACE="$(resolve_lab_workspace_path OMP_LAB_SKILLED_WORKSPACE "${HOME}/.oh-my-pi-lab/skilled-workspace")"

validate_lab_workspace_removal_path OMP_LAB_CONTROL_WORKSPACE "${CONTROL_WORKSPACE}"
validate_lab_workspace_removal_path OMP_LAB_SKILLED_WORKSPACE "${SKILLED_WORKSPACE}"

run_cleanup_command() {
  if [[ "${OMP_LAB_DRY_RUN:-0}" == "1" ]]; then
    printf '%q ' "$@"
    printf '\n'
    return
  fi

  "$@"
}

run_cleanup_command rm -rf "${CONTROL_WORKSPACE}"
run_cleanup_command rm -rf "${SKILLED_WORKSPACE}"

DOCKER_AVAILABLE=0
if [[ "${OMP_LAB_DRY_RUN:-0}" != "1" ]]; then
  if command -v docker >/dev/null 2>&1; then
    if docker info >/dev/null 2>&1; then
      DOCKER_AVAILABLE=1
    else
      printf 'Docker daemon unavailable; skipping Docker artifact cleanup\n' >&2
    fi
  else
    printf 'docker not found; skipping Docker artifact cleanup\n' >&2
  fi
fi

if [[ "${OMP_LAB_DRY_RUN:-0}" == "1" ]]; then
  printf '%s\n' 'docker ps -aq --filter label=checkpoint.omp-lab=true | xargs -r docker rm -f'
  printf '%s\n' 'docker volume ls -q --filter label=checkpoint.omp-lab=true | xargs -r docker volume rm'
elif [[ "${DOCKER_AVAILABLE}" == "1" ]]; then
  docker ps -aq --filter label=checkpoint.omp-lab=true | xargs -r docker rm -f
  docker volume ls -q --filter label=checkpoint.omp-lab=true | xargs -r docker volume rm
fi

if [[ "${REMOVE_IMAGE}" == "1" ]]; then
  if [[ "${OMP_LAB_DRY_RUN:-0}" == "1" ]]; then
    run_cleanup_command docker image rm "${OMP_LAB_IMAGE}"
  elif [[ "${DOCKER_AVAILABLE}" == "1" ]]; then
    if docker image inspect "${OMP_LAB_IMAGE}" >/dev/null 2>&1; then
      run_cleanup_command docker image rm "${OMP_LAB_IMAGE}"
    else
      printf 'Docker image %s not found; skipping image removal\n' "${OMP_LAB_IMAGE}" >&2
    fi
  fi
fi
```

Cleanup dry-run output shows exactly what would be removed without touching Docker or deleting state.

```bash
tmp_home=/tmp/checkpoint-showboat-home-clean; rm -rf "$tmp_home"; mkdir -p "$tmp_home"; OMP_LAB_DRY_RUN=1 HOME="$tmp_home" bash scripts/clean-omp-lab.sh --image; rm -rf "$tmp_home"
```

```output
rm -rf /tmp/checkpoint-showboat-home-clean/.oh-my-pi-lab/control-workspace 
rm -rf /tmp/checkpoint-showboat-home-clean/.oh-my-pi-lab/skilled-workspace 
docker ps -aq --filter label=checkpoint.omp-lab=true | xargs -r docker rm -f
docker volume ls -q --filter label=checkpoint.omp-lab=true | xargs -r docker volume rm
docker image rm checkpoint-omp-lab:local 
```

## 10. Tests That Prove The Contract

The test file is intentionally contract-heavy rather than TUI-heavy. It verifies the Dockerfile, dry-run Docker arguments, secret non-leakage, source-hidden workspace validation, optional SSH behavior, reset and cleanup safety, and the generated skilled workspace entrypoint.

```bash
rg -n "lab Dockerfile|control dry run|source-visible|SSH|skills dry run|allows neutral|cleanup|reset mode|does not expose" test/scripts/omp_lab_scripts.test.ts
```

```output
23:  "OMP_LAB_ENABLE_SSH",
24:  "OMP_LAB_SSH_KEY",
28:test("lab Dockerfile uses the universal dev container base and does not copy the repo", async () => {
204:test("cleanup dry run removes disposable workspaces and labeled docker artifacts", async () => {
220:test("cleanup image flag includes shared image removal", async () => {
261:test("cleanup refuses dangerous workspace override paths before printing removals", async () => {
282:        assert.fail("cleanup should reject dangerous workspace paths");
297:test("cleanup skips docker artifacts when docker is unavailable after workspace cleanup", async () => {
321:    assert.match(result.stderr, /docker not found; skipping Docker artifact cleanup/);
330:test("cleanup image flag skips absent shared image", async () => {
370:test("cleanup skips docker artifacts when docker daemon is unavailable after workspace cleanup", async () => {
401:    assert.match(result.stderr, /Docker daemon unavailable; skipping Docker artifact cleanup/);
410:test("control dry run mounts only the neutral workspace and shared service env", async () => {
469:      assert.match(error.stderr ?? "", /Refusing source-visible workspace/);
498:    assert.match(error.stderr ?? "", /Refusing source-visible workspace/);
523:    assert.match(error.stderr ?? "", /Refusing source-visible workspace/);
551:test("control SSH mode mounts only id_rsa read-only and forwards GitHub token when present", async () => {
564:      OMP_LAB_ENABLE_SSH: "1",
573:    assert.ok(!args.includes("OMP_LAB_ENABLE_SSH=1"));
582:test("SSH mode fails before docker run when id_rsa is missing", async () => {
592:          OMP_LAB_ENABLE_SSH: "1",
594:      /SSH key .* does not exist/,
602:test("SSH missing-key failure does not invoke docker outside dry run", async () => {
632:            OMP_LAB_ENABLE_SSH: "1",
636:        assert.match(error.stderr ?? "", /SSH key .* does not exist/);
648:test("control dry run ignores scoped host env by default", async () => {
656:    OMP_LAB_ENABLE_SSH: process.env.OMP_LAB_ENABLE_SSH,
657:    OMP_LAB_SSH_KEY: process.env.OMP_LAB_SSH_KEY,
665:    process.env.OMP_LAB_ENABLE_SSH = "1";
666:    process.env.OMP_LAB_SSH_KEY = fakeKey;
676:    assert.ok(!args.includes("OMP_LAB_ENABLE_SSH=1"));
693:test("control reset mode clears existing workspace contents before dry run", async () => {
713:test("reset mode refuses unsafe workspaces before deleting markers", async () => {
766:test("reset mode refuses an explicit empty workspace before docker run", async () => {
792:test("control dry run shell-escapes arguments containing spaces", async () => {
817:test("control dry run does not expose database connection values", async () => {
842:test("skills dry run mounts generated workspace plus checkpoint skill and extension sources", async () => {
873:test("skills mode refuses source-visible workspaces before replacing OMP state", async () => {
878:    { workspace: "", expected: /Refusing source-visible workspace .*<empty>/ },
879:    { workspace: "/", expected: /Refusing source-visible workspace/ },
880:    { workspace: repoRoot, expected: /Refusing source-visible workspace/ },
881:    { workspace: repoChild, expected: /Refusing source-visible workspace/ },
882:    { workspace: repoAncestor, expected: /Refusing source-visible workspace/ },
893:        assert.fail("skills mode should reject source-visible workspaces");
910:test("skills mode allows neutral outside workspaces", async () => {
930:test("skills dry run replaces stale generated OMP state", async () => {
```

The focused script suite runs without requiring interactive OMP. The Docker image smoke is gated behind `OMP_LAB_DOCKER_SMOKE=1`, so the ordinary run skips only that real image/container check.

```bash
node --import tsx --test test/scripts/omp_lab_scripts.test.ts | grep -E '^# (tests|suites|pass|fail|cancelled|skipped|todo)'
```

```output
# tests 29
# suites 0
# pass 28
# fail 0
# cancelled 0
# skipped 1
# todo 0
```

## 11. Operational Summary

To run the lab manually:

- Build the shared image with `docker build -t checkpoint-omp-lab:local .`.
- Start the host compose stack separately, as usual for checkpoint.
- Run the control script with `OMP_MODEL` and either exported `GEMINI_API_KEY` or `~/.gemini-key`.
- Run the skilled script with the same model and key to isolate the effect of checkpoint skills/source.
- Use `OMP_LAB_RESET_WORKSPACE=1` when a single run needs a clean workspace.
- Use `scripts/clean-omp-lab.sh` for broad cleanup and `--image` only when the image itself should be removed.

The important invariant is that the two run modes differ only where intended: skilled receives the read-only checkpoint `skills/` and `src/` mounts plus a generated extension entrypoint; control does not.

