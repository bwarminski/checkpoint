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
    printf '%q' "$1"
    shift
    printf ' %q' "$@"
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
    run_cleanup_command docker image rm "${OMP_LAB_CONTROL_IMAGE}"
    run_cleanup_command docker image rm "${OMP_LAB_SKILLED_IMAGE}"
  elif [[ "${DOCKER_AVAILABLE}" == "1" ]]; then
    for image in "${OMP_LAB_CONTROL_IMAGE}" "${OMP_LAB_SKILLED_IMAGE}"; do
      if docker image inspect "${image}" >/dev/null 2>&1; then
        run_cleanup_command docker image rm "${image}"
      else
        printf 'Docker image %s not found; skipping image removal\n' "${image}" >&2
      fi
    done
  fi
fi
