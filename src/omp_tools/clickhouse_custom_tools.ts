// ABOUTME: Exposes native oh-my-pi custom tools for coarse ClickHouse investigation workflows.
// ABOUTME: Shares one adapter layer between filesystem-discovered tools and SDK-backed tests.
import { createLiveQueryChecker } from "./live_query_checker.ts";
import {
  createClickHouseRunner,
  requireToolContext,
  toTextResult,
  type NativeCustomTool,
  type NativeCustomToolFactory,
  type SdkToolDefinition,
  type TypeFactory,
} from "./runtime.ts";
import { createClickHouseCheckerTool } from "../tools/clickhouse/checker_tool.ts";
import { createClickHouseListTablesTool } from "../tools/clickhouse/list_tables_tool.ts";
import { createClickHouseQueryTool } from "../tools/clickhouse/query_tool.ts";
import { createClickHouseSchemaTool } from "../tools/clickhouse/schema_tool.ts";

type ClickHouseDefinition = ReturnType<typeof createClickHouseToolDefinitions>[number];

export function createClickHouseToolDefinitions(type: TypeFactory): Array<SdkToolDefinition> {
  const runner = createClickHouseRunner();
  const clickHouseListTablesTool = createClickHouseListTablesTool(
    async (sql) => runner(sql) as Promise<Array<{ name: string }>>,
  );
  const clickHouseSchemaTool = createClickHouseSchemaTool(runner);
  const clickHouseQueryTool = createClickHouseQueryTool(runner);

  return [
    {
      name: "clickhouse_db_list_tables",
      label: "ClickHouse Tables",
      description: "List ClickHouse tables from the requested database.",
      parameters: type.Object({ database: type.String() }),
      async execute(_toolCallId: string, params: { database: string }) {
        return toTextResult(await clickHouseListTablesTool.execute(params));
      },
    },
    {
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
    },
    {
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
          createLiveQueryChecker(requireToolContext("clickhouse_db_checker", ctx)),
        );
        return toTextResult(JSON.stringify(await clickHouseCheckerTool.execute(params), null, 2));
      },
    },
    {
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
    },
  ];
}

function toCustomTool(definition: ClickHouseDefinition): NativeCustomTool {
  return {
    ...definition,
    async execute(toolCallId, params, onUpdate, ctx, signal) {
      return definition.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  };
}

function createClickHouseNativeTools(type: TypeFactory): [NativeCustomTool, NativeCustomTool, NativeCustomTool, NativeCustomTool] {
  const definitions = createClickHouseToolDefinitions(type);
  return [
    toCustomTool(definitions[0]),
    toCustomTool(definitions[1]),
    toCustomTool(definitions[2]),
    toCustomTool(definitions[3]),
  ];
}

export const clickhouseDbListTables: NativeCustomToolFactory = (pi) => createClickHouseNativeTools(pi.typebox.Type)[0];
export const clickhouseDbSchema: NativeCustomToolFactory = (pi) => createClickHouseNativeTools(pi.typebox.Type)[1];
export const clickhouseDbChecker: NativeCustomToolFactory = (pi) => createClickHouseNativeTools(pi.typebox.Type)[2];
export const clickhouseDbQuery: NativeCustomToolFactory = (pi) => createClickHouseNativeTools(pi.typebox.Type)[3];

const clickHouseCustomTools: NativeCustomToolFactory = (pi) => createClickHouseNativeTools(pi.typebox.Type);

export default clickHouseCustomTools;
