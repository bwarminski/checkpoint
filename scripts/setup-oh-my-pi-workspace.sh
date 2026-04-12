#!/usr/bin/env bash
# ABOUTME: Creates the external oh-my-pi workspace used as the runtime-facing project surface.
# ABOUTME: Symlinks the repo-owned skills and tools into the workspace and ensures a working directory exists.
set -euo pipefail

WORKSPACE_ROOT="${HOME}/.oh-my-pi-workspaces/checkpoint"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${WORKSPACE_ROOT}/.omp" "${WORKSPACE_ROOT}/workdir"
rm -rf "${WORKSPACE_ROOT}/.omp/skills" "${WORKSPACE_ROOT}/.omp/tools"
ln -s "${REPO_ROOT}/skills" "${WORKSPACE_ROOT}/.omp/skills"
ln -s "${REPO_ROOT}/src/tools" "${WORKSPACE_ROOT}/.omp/tools"
