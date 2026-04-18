#!/usr/bin/env bash
# ABOUTME: Recreates the external oh-my-pi workspace from scratch for repeatable verification runs.
# ABOUTME: Removes any generated workspace state and delegates to the setup script for the extension-based layout.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="${HOME}/.oh-my-pi-workspaces/checkpoint"

rm -rf "${WORKSPACE_ROOT}"
"${SCRIPT_DIR}/setup-oh-my-pi-workspace.sh"
