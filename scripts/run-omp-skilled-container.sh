#!/usr/bin/env bash
# ABOUTME: Runs the OMP lab container with checkpoint skills and extension sources mounted.
# ABOUTME: Keeps the editable workspace separate from read-only checkpoint runtime mounts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/omp-lab-common.sh"

require_omp_model
export_gemini_api_key
export_default_db_env
WORKSPACE="$(resolve_lab_workspace_path OMP_LAB_WORKSPACE "${HOME}/.oh-my-pi-lab/skilled-workspace")"
validate_source_hidden_workspace_path OMP_LAB_WORKSPACE "${WORKSPACE}"

docker_args=()
append_base_docker_args docker_args "${WORKSPACE}"
docker_args+=(
  --label checkpoint.omp-lab.mode=skilled
  --env "CHECKPOINT_EXTENSION_SOURCE=/checkpoint-src/src/omp_extension/db_specialist_extension.ts"
)
append_git_ssh_args docker_args
finish_docker_args docker_args "${OMP_LAB_SKILLED_IMAGE}"

require_docker_for_container_run
if [[ "${OMP_LAB_RESET_WORKSPACE:-0}" == "1" ]]; then
  reset_lab_workspace OMP_LAB_WORKSPACE "${WORKSPACE}"
else
  ensure_workspace "${WORKSPACE}"
fi

run_or_print_docker_args docker_args
