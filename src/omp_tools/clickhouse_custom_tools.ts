// ABOUTME: Exposes oh-my-pi tool definitions for coarse ClickHouse investigation workflows.
// ABOUTME: Wraps pure tool logic with SDK type factories and injectable query completion.
import { createLiveQueryCheckerWithCompletion } from "./live_query_checker.ts";
import {
  createClickHouseRunner,
  requireToolContext,
  toTextResult,
  type QueryCompletion,
  type SdkToolDefinition,
  type TypeFactory,
} from "./runtime.ts";
import { createClickHouseCheckerTool } from "../tools/clickhouse/checker_tool.ts";
import { createClickHouseListTablesTool } from "../tools/clickhouse/list_tables_tool.ts";
import { createClickHouseQueryTool } from "../tools/clickhouse/query_tool.ts";
import { createClickHouseSchemaTool } from "../tools/clickhouse/schema_tool.ts";

export function createClickHouseToolDefinitions(type: TypeFactory, runCompletion: QueryCompletion): Array<SdkToolDefinition> {
  const runner = createClickHouseRunner();
  return [
    createClickHouseListTablesDefinition(type, runner),
    createClickHouseSchemaDefinition(type, runner),
    createClickHouseCheckerDefinition(type, runCompletion),
    createClickHouseQueryDefinition(type, runner),
  ];
}

function createClickHouseListTablesDefinition(
  type: TypeFactory,
  runner: (sql: string) => Promise<Array<Record<string, unknown>>>,
): SdkToolDefinition {
  const clickHouseListTablesTool = createClickHouseListTablesTool(
    async (sql) => runner(sql) as Promise<Array<{ name: string }>>,
  );
  return {
    name: "clickhouse_db_list_tables",
    label: "ClickHouse Tables",
    description: "List ClickHouse tables from the requested database.",
    parameters: type.Object({ database: type.String() }),
    async execute(_toolCallId: string, params: { database: string }) {
      return toTextResult(await clickHouseListTablesTool.execute(params));
    },
  };
}

function createClickHouseSchemaDefinition(
  type: TypeFactory,
  runner: (sql: string) => Promise<Array<Record<string, unknown>>>,
): SdkToolDefinition {
  const clickHouseSchemaTool = createClickHouseSchemaTool(runner);
  return {
    name: "clickhouse_db_schema",
    label: "ClickHouse Schema",
    description: "Show ClickHouse schema details and sample rows for the requested tables.",
    parameters: type.Object({
      database: type.String(),
      tables: type.Array(type.String()),
    }),
    async execute(_toolCallId: string, params: { database: string; tables: Array<string> }) {
      return toTextResult(await clickHouseSchemaTool.execute(params));
    },
  };
}

function createClickHouseCheckerDefinition(type: TypeFactory, runCompletion: QueryCompletion): SdkToolDefinition {
  return {
    name: "clickhouse_db_checker",
    label: "ClickHouse Checker",
    description: "Validate a ClickHouse query and return a structured verdict.",
    parameters: type.Object({
      dialect: type.Literal("clickhouse"),
      question: type.String(),
      query: type.String(),
    }),
    async execute(
      _toolCallId: string,
      params: { dialect: "clickhouse"; question: string; query: string },
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx,
    ) {
      const clickHouseCheckerTool = createClickHouseCheckerTool(
        createLiveQueryCheckerWithCompletion(
          runCompletion,
          requireToolContext("clickhouse_db_checker", ctx),
        ),
      );
      return toTextResult(JSON.stringify(await clickHouseCheckerTool.execute(params), null, 2));
    },
  };
}

function createClickHouseQueryDefinition(
  type: TypeFactory,
  runner: (sql: string) => Promise<Array<Record<string, unknown>>>,
): SdkToolDefinition {
  const clickHouseQueryTool = createClickHouseQueryTool(runner);
  return {
    name: "clickhouse_db_query",
    label: "ClickHouse Query",
    description: "Run a bounded exploratory ClickHouse query.",
    parameters: type.Object({
      query: type.String(),
      rowCap: type.Optional(type.Number()),
      timeoutMs: type.Optional(type.Number()),
    }),
    async execute(_toolCallId: string, params: { query: string; rowCap?: number; timeoutMs?: number }) {
      return toTextResult(await clickHouseQueryTool.execute(params));
    },
  };
}
