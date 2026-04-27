#!/usr/bin/env bash
# ABOUTME: Prepares the baked checkpoint skill surface inside the mounted lab workspace.
# ABOUTME: Creates OMP project files from image-owned sources before launching the agent.
set -euo pipefail

rm -rf /workspace/.omp/skills /workspace/.omp/tools /workspace/.omp/extensions
mkdir -p /workspace/.omp/extensions
cp -R /checkpoint-skills /workspace/.omp/skills

cat > /workspace/.omp/extensions/db-specialist.ts <<'ENTRYPOINT'
export { default } from "/checkpoint-src/src/omp_extension/db_specialist_extension.ts";
ENTRYPOINT

exec omp "$@"
