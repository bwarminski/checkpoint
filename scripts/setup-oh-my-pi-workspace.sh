#!/usr/bin/env bash
# ABOUTME: Creates the external oh-my-pi workspace skeleton used by the current MVP.
# ABOUTME: Symlinks repo-owned skills and generates discoverable tool shims with a persistent working directory.
set -euo pipefail

WORKSPACE_ROOT="${HOME}/.oh-my-pi-workspaces/checkpoint"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

write_tool() {
  local tool_name="$1"
  local export_name="$2"
  local module_path="$3"

  mkdir -p "${WORKSPACE_ROOT}/.omp/tools/${tool_name}"
  printf 'export { %s as default } from "%s";\n' "${export_name}" "${module_path}" > "${WORKSPACE_ROOT}/.omp/tools/${tool_name}/index.ts"
}

mkdir -p "${WORKSPACE_ROOT}/.omp" "${WORKSPACE_ROOT}/workdir"
rm -rf "${WORKSPACE_ROOT}/.omp/skills" "${WORKSPACE_ROOT}/.omp/tools"
ln -s "${REPO_ROOT}/skills" "${WORKSPACE_ROOT}/.omp/skills"
mkdir -p "${WORKSPACE_ROOT}/.omp/tools"

write_tool "sql_db_list_tables" "sqlDbListTables" "${REPO_ROOT}/src/omp_tools/postgres_custom_tools.ts"
write_tool "sql_db_schema" "sqlDbSchema" "${REPO_ROOT}/src/omp_tools/postgres_custom_tools.ts"
write_tool "sql_db_checker" "sqlDbChecker" "${REPO_ROOT}/src/omp_tools/postgres_custom_tools.ts"
write_tool "sql_db_query" "sqlDbQuery" "${REPO_ROOT}/src/omp_tools/postgres_custom_tools.ts"
write_tool "clickhouse_db_list_tables" "clickhouseDbListTables" "${REPO_ROOT}/src/omp_tools/clickhouse_custom_tools.ts"
write_tool "clickhouse_db_schema" "clickhouseDbSchema" "${REPO_ROOT}/src/omp_tools/clickhouse_custom_tools.ts"
write_tool "clickhouse_db_checker" "clickhouseDbChecker" "${REPO_ROOT}/src/omp_tools/clickhouse_custom_tools.ts"
write_tool "clickhouse_db_query" "clickhouseDbQuery" "${REPO_ROOT}/src/omp_tools/clickhouse_custom_tools.ts"
