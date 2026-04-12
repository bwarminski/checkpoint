#!/usr/bin/env bash
# ABOUTME: Prepares the generated oh-my-pi workspace and prints the manual smoke verification loop.
# ABOUTME: Keeps the TUI workflow explicit without trying to automate the interactive session.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="${HOME}/.oh-my-pi-workspaces/checkpoint"

"${SCRIPT_DIR}/setup-oh-my-pi-workspace.sh"

cat <<PROMPT
Manual workspace smoke verification
===================================

Workspace ready at:
${WORKSPACE_ROOT}

Manual TUI loop
1. Export a real model, for example: export OMP_MODEL=<provider/model>
2. Change into the generated workspace:
   cd "${WORKSPACE_ROOT}"
3. Start the oh-my-pi TUI:
   pi --model "\$OMP_MODEL"
4. Paste one of the scenario prompts below.
5. Inspect the resulting diff or local commit in workdir after the run.

Scenario 1:
Investigate the demo repo for the highest-value database performance issue.
Use Postgres and ClickHouse evidence, make the smallest reasonable local fix,
and leave a local git diff or commit in the demo checkout.

Scenario 2:
Investigate the demo repo for a concrete slow query or missing index problem.
Show the evidence you used, make one minimal local fix, and summarize the diff
left in the demo checkout.
PROMPT
