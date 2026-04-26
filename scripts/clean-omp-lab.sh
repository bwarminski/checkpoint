#!/usr/bin/env bash
# ABOUTME: Removes disposable OMP lab workspaces and labeled Docker artifacts.
# ABOUTME: Keeps image removal explicit so routine cleanup stays fast.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/omp-lab-common.sh"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"

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

resolve_workspace_path() {
  local env_name="$1"
  local default_path="$2"

  if [[ -v "${env_name}" ]]; then
    printf '%s\n' "${!env_name}"
    return
  fi

  printf '%s\n' "${default_path}"
}

refuse_unsafe_workspace_path() {
  local env_name="$1"
  local workspace="$2"

  if [[ -z "${workspace}" ]]; then
    workspace="<empty>"
  fi

  printf 'Refusing to remove unsafe workspace path for %s: %s\n' "${env_name}" "${workspace}" >&2
  exit 2
}

validate_workspace_path() {
  local env_name="$1"
  local workspace="$2"
  local lab_root
  local normalized_home
  local normalized_repo
  local normalized_workspace

  if [[ -z "${workspace}" ]]; then
    refuse_unsafe_workspace_path "${env_name}" "${workspace}"
  fi

  lab_root="$(realpath -m -- "${HOME}/.oh-my-pi-lab")"
  normalized_home="$(realpath -m -- "${HOME}")"
  normalized_repo="$(realpath -m -- "${REPO_ROOT}")"
  normalized_workspace="$(realpath -m -- "${workspace}")"

  if [[ "${normalized_workspace}" == "/" ]]; then
    refuse_unsafe_workspace_path "${env_name}" "${workspace}"
  fi

  if [[ "${normalized_workspace}" == "${normalized_home}" ]]; then
    refuse_unsafe_workspace_path "${env_name}" "${workspace}"
  fi

  if [[ "${normalized_workspace}" == "${normalized_repo}" ]]; then
    refuse_unsafe_workspace_path "${env_name}" "${workspace}"
  fi

  if [[ "${normalized_workspace}" == "${lab_root}" || "${normalized_workspace}" != "${lab_root}/"* ]]; then
    refuse_unsafe_workspace_path "${env_name}" "${workspace}"
  fi
}

CONTROL_WORKSPACE="$(resolve_workspace_path OMP_LAB_CONTROL_WORKSPACE "${HOME}/.oh-my-pi-lab/control-workspace")"
SKILLED_WORKSPACE="$(resolve_workspace_path OMP_LAB_SKILLED_WORKSPACE "${HOME}/.oh-my-pi-lab/skilled-workspace")"

validate_workspace_path OMP_LAB_CONTROL_WORKSPACE "${CONTROL_WORKSPACE}"
validate_workspace_path OMP_LAB_SKILLED_WORKSPACE "${SKILLED_WORKSPACE}"

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

if [[ "${OMP_LAB_DRY_RUN:-0}" == "1" ]]; then
  printf '%s\n' 'docker ps -aq --filter label=checkpoint.omp-lab=true | xargs -r docker rm -f'
  printf '%s\n' 'docker volume ls -q --filter label=checkpoint.omp-lab=true | xargs -r docker volume rm'
else
  if command -v docker >/dev/null 2>&1; then
    docker ps -aq --filter label=checkpoint.omp-lab=true | xargs -r docker rm -f
    docker volume ls -q --filter label=checkpoint.omp-lab=true | xargs -r docker volume rm
  else
    printf 'docker not found; skipping Docker artifact cleanup\n' >&2
  fi
fi

if [[ "${REMOVE_IMAGE}" == "1" ]]; then
  if [[ "${OMP_LAB_DRY_RUN:-0}" == "1" ]]; then
    run_cleanup_command docker image rm "${OMP_LAB_IMAGE}"
  elif command -v docker >/dev/null 2>&1; then
    if docker image inspect "${OMP_LAB_IMAGE}" >/dev/null 2>&1; then
      run_cleanup_command docker image rm "${OMP_LAB_IMAGE}"
    else
      printf 'Docker image %s not found; skipping image removal\n' "${OMP_LAB_IMAGE}" >&2
    fi
  fi
fi
