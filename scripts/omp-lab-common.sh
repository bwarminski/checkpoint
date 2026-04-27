#!/usr/bin/env bash
# ABOUTME: Provides shared Docker argument construction for OMP lab run scripts.
# ABOUTME: Resolves lab workspaces, model credentials, database env, and optional Git credentials.

set -euo pipefail

OMP_LAB_CONTROL_IMAGE="${OMP_LAB_CONTROL_IMAGE:-checkpoint-omp-lab-control:local}"
OMP_LAB_SKILLED_IMAGE="${OMP_LAB_SKILLED_IMAGE:-checkpoint-omp-lab:local}"
OMP_LAB_CONTAINER_USER="${OMP_LAB_CONTAINER_USER:-codespace}"
OMP_LAB_CONTAINER_HOME="/home/${OMP_LAB_CONTAINER_USER}"
OMP_LAB_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
OMP_LAB_REPO_ROOT="$(cd "${OMP_LAB_COMMON_DIR}/.." && pwd -P)"

export_gemini_api_key() {
  if [[ -n "${GEMINI_API_KEY:-}" ]]; then
    export GEMINI_API_KEY
    return
  fi

  local key_path="${HOME}/.gemini-key"
  if [[ ! -f "${key_path}" ]]; then
    printf 'GEMINI_API_KEY is unset and %s does not exist\n' "${key_path}" >&2
    return 1
  fi

  GEMINI_API_KEY="$(tr -d '\n' < "${key_path}")"
  export GEMINI_API_KEY
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
  local image="$2"
  args_ref+=("${image}" --model "${OMP_MODEL}")
}

run_or_print_docker_args() {
  local -n args_ref="$1"

  if [[ "${OMP_LAB_DRY_RUN:-0}" == "1" ]]; then
    printf '%q' "${args_ref[0]}"
    printf ' %q' "${args_ref[@]:1}"
    printf '\n'
    return
  fi

  exec "${args_ref[@]}"
}
