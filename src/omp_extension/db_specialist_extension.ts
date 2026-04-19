// ABOUTME: Provides the DB specialist extension entrypoint used by the generated oh-my-pi workspace.
// ABOUTME: Registers the DB specialist tool surface through the extension runtime boundary.
import { Type } from "@sinclair/typebox";
import { createClickHouseToolDefinitions } from "../omp_tools/clickhouse_custom_tools.ts";
import type { ExtensionAPI } from "../omp_tools/runtime.ts";
import { createPostgresToolDefinitions } from "../omp_tools/postgres_custom_tools.ts";
import { createQueryCheckerCompletion, toExtensionToolDefinition } from "./tool_runtime.ts";

export default function dbSpecialistExtension(pi: ExtensionAPI): void {
  const runCompletion = createQueryCheckerCompletion();
  for (const definition of [...createPostgresToolDefinitions(Type, runCompletion), ...createClickHouseToolDefinitions(Type, runCompletion)]) {
    pi.registerTool(toExtensionToolDefinition(definition));
  }
}
