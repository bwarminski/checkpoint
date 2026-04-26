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

CONTROL_WORKSPACE="${OMP_LAB_CONTROL_WORKSPACE:-${HOME}/.oh-my-pi-lab/control-workspace}"
SKILLED_WORKSPACE="${OMP_LAB_SKILLED_WORKSPACE:-${HOME}/.oh-my-pi-lab/skilled-workspace}"

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
  docker ps -aq --filter label=checkpoint.omp-lab=true | xargs -r docker rm -f
  docker volume ls -q --filter label=checkpoint.omp-lab=true | xargs -r docker volume rm
fi

if [[ "${REMOVE_IMAGE}" == "1" ]]; then
  run_cleanup_command docker image rm "${OMP_LAB_IMAGE}"
fi
