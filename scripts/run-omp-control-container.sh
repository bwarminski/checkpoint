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
WORKSPACE="${OMP_LAB_WORKSPACE:-${HOME}/.oh-my-pi-lab/control-workspace}"
ensure_workspace "${WORKSPACE}"
if [[ "${OMP_LAB_RESET_WORKSPACE:-0}" == "1" ]]; then
  rm -rf "${WORKSPACE}"
  ensure_workspace "${WORKSPACE}"
fi

docker_args=()
append_base_docker_args docker_args "${WORKSPACE}"
docker_args+=(--label checkpoint.omp-lab.mode=control)
append_git_ssh_args docker_args
finish_docker_args docker_args
run_or_print_docker_args docker_args
