// ABOUTME: Provides the DB specialist extension entrypoint used by the generated oh-my-pi workspace.
// ABOUTME: Registers the DB specialist tool surface through the extension runtime boundary.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createClickHouseToolDefinitions } from "../omp_tools/clickhouse_custom_tools.ts";
import { createPostgresToolDefinitions } from "../omp_tools/postgres_custom_tools.ts";
import { toExtensionToolDefinition } from "./tool_runtime.ts";

export default function dbSpecialistExtension(pi: ExtensionAPI): void {
  for (const definition of [...createPostgresToolDefinitions(Type), ...createClickHouseToolDefinitions(Type)]) {
    pi.registerTool(toExtensionToolDefinition(definition));
  }
}
