#!/usr/bin/env bash
# ABOUTME: Creates the external oh-my-pi workspace skeleton used by the current MVP.
# ABOUTME: Symlinks repo-owned skills and generates the DB specialist extension entrypoint with a persistent working directory.
set -euo pipefail

WORKSPACE_ROOT="${HOME}/.oh-my-pi-workspaces/checkpoint"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${WORKSPACE_ROOT}/.omp" "${WORKSPACE_ROOT}/workdir"
rm -rf "${WORKSPACE_ROOT}/.omp/skills" "${WORKSPACE_ROOT}/.omp/tools" "${WORKSPACE_ROOT}/.omp/extensions"
ln -s "${REPO_ROOT}/skills" "${WORKSPACE_ROOT}/.omp/skills"
mkdir -p "${WORKSPACE_ROOT}/.omp/extensions"
printf 'export { default } from "%s";\n' "${REPO_ROOT}/src/omp_extension/db_specialist_extension.ts" > "${WORKSPACE_ROOT}/.omp/extensions/db-specialist.ts"
