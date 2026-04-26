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
run_or_print_docker_args docker_args
