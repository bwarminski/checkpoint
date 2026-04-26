#!/usr/bin/env bash
# ABOUTME: Provides shared Docker argument construction for OMP lab run scripts.
# ABOUTME: Resolves lab workspaces, model credentials, database env, and optional Git credentials.

set -euo pipefail

OMP_LAB_IMAGE="${OMP_LAB_IMAGE:-checkpoint-omp-lab:local}"
OMP_LAB_CONTAINER_USER="${OMP_LAB_CONTAINER_USER:-codespace}"
OMP_LAB_CONTAINER_HOME="/home/${OMP_LAB_CONTAINER_USER}"

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

append_base_docker_args() {
  local -n args_ref="$1"
  local workspace="$2"
  local gemini_api_key="$3"

  args_ref+=(
    docker run --rm -it
    --name "${OMP_LAB_CONTAINER_NAME:-oh-my-pi-lab}"
    --label checkpoint.omp-lab=true
    --add-host host.docker.internal:host-gateway
    --mount "type=bind,source=${workspace},target=/workspace"
    --env "GEMINI_API_KEY=${gemini_api_key}"
    --env "OMP_MODEL=${OMP_MODEL}"
    --env "PGHOST=${PGHOST:-host.docker.internal}"
    --env "PGPORT=${PGPORT:-5432}"
    --env "PGDATABASE=${PGDATABASE:-checkpoint_demo}"
    --env "PGUSER=${PGUSER:-postgres}"
    --env "PGPASSWORD=${PGPASSWORD:-postgres}"
    --env "CLICKHOUSE_URL=${CLICKHOUSE_URL:-http://host.docker.internal:8123}"
    --env "CLICKHOUSE_HOST=${CLICKHOUSE_HOST:-host.docker.internal}"
    --env "CLICKHOUSE_PORT=${CLICKHOUSE_PORT:-9000}"
  )

  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    args_ref+=(--env "GITHUB_TOKEN=${GITHUB_TOKEN}")
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
    --env OMP_LAB_ENABLE_SSH=1
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
