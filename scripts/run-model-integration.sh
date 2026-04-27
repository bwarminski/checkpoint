#!/usr/bin/env bash
# ABOUTME: Prepares the generated oh-my-pi workspace and runs the live-model integration test entrypoint.
# ABOUTME: Skips cleanly when the required model environment is not present.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

if [[ -z "${OMP_MODEL:-}" ]]; then
  printf 'Skipping model integration test because OMP_MODEL is not set.\n'
  exit 0
fi

bash scripts/setup-oh-my-pi-workspace.sh
bun test test/integration/oh_my_pi_session.test.ts
