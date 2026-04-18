// ABOUTME: Exposes native oh-my-pi custom tools for coarse Postgres investigation workflows.
// ABOUTME: Shares one adapter layer between filesystem-discovered tools and SDK-backed tests.
import { createLiveQueryChecker } from "./live_query_checker.ts";
import {
  createPostgresRunner,
  requireToolContext,
  toTextResult,
  type NativeCustomTool,
  type NativeCustomToolFactory,
  type SdkToolDefinition,
  type TypeFactory,
} from "./runtime.ts";
import { createPostgresCheckerTool } from "../tools/postgres/checker_tool.ts";
import { createPostgresListTablesTool } from "../tools/postgres/list_tables_tool.ts";
import { createPostgresQueryTool } from "../tools/postgres/query_tool.ts";
import { createPostgresSchemaTool } from "../tools/postgres/schema_tool.ts";

type PostgresDefinition = ReturnType<typeof createPostgresToolDefinitions>[number];

export function createPostgresToolDefinitions(type: TypeFactory): Array<SdkToolDefinition> {
  const runner = createPostgresRunner();
  const postgresListTablesTool = createPostgresListTablesTool(
    async (sql) => runner(sql) as Promise<Array<{ table_name: string }>>,
  );
  const postgresSchemaTool = createPostgresSchemaTool(runner);
  const postgresQueryTool = createPostgresQueryTool(runner);

  return [
    {
      name: "sql_db_list_tables",
      label: "Postgres Tables",
      description: "List PostgreSQL tables from the requested schema.",
      parameters: type.Object({ schema: type.String() }),
      async execute(_toolCallId: string, params: { schema: string }) {
        return toTextResult(await postgresListTablesTool.execute(params));
      },
    },
    {
      name: "sql_db_schema",
      label: "Postgres Schema",
      description: "Show PostgreSQL schema details and sample rows for the requested tables.",
      parameters: type.Object({
        schema: type.String(),
        tables: type.Array(type.String()),
      }),
      async execute(_toolCallId: string, params: { schema: string; tables: Array<string> }) {
        return toTextResult(await postgresSchemaTool.execute(params));
      },
    },
    {
      name: "sql_db_checker",
      label: "Postgres Checker",
      description: "Validate a PostgreSQL query and return a structured verdict.",
      parameters: type.Object({
        dialect: type.Literal("postgres"),
        question: type.String(),
        query: type.String(),
      }),
      async execute(
        _toolCallId: string,
        params: { dialect: "postgres"; question: string; query: string },
        _signal: AbortSignal | undefined,
        _onUpdate: unknown,
        ctx,
      ) {
        const postgresCheckerTool = createPostgresCheckerTool(
          createLiveQueryChecker(requireToolContext("sql_db_checker", ctx)),
        );
        return toTextResult(JSON.stringify(await postgresCheckerTool.execute(params), null, 2));
      },
    },
    {
      name: "sql_db_query",
      label: "Postgres Query",
      description: "Run a bounded exploratory PostgreSQL query.",
      parameters: type.Object({
        query: type.String(),
        rowCap: type.Optional(type.Number()),
        timeoutMs: type.Optional(type.Number()),
      }),
      async execute(_toolCallId: string, params: { query: string; rowCap?: number; timeoutMs?: number }) {
        return toTextResult(await postgresQueryTool.execute(params));
      },
    },
  ];
}

function toCustomTool(definition: PostgresDefinition): NativeCustomTool {
  return {
    ...definition,
    async execute(toolCallId, params, onUpdate, ctx, signal) {
      return definition.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  };
}

export const sqlDbListTables: NativeCustomToolFactory = (pi) => toCustomTool(createPostgresToolDefinitions(pi.typebox.Type)[0]);
export const sqlDbSchema: NativeCustomToolFactory = (pi) => toCustomTool(createPostgresToolDefinitions(pi.typebox.Type)[1]);
export const sqlDbChecker: NativeCustomToolFactory = (pi) => toCustomTool(createPostgresToolDefinitions(pi.typebox.Type)[2]);
export const sqlDbQuery: NativeCustomToolFactory = (pi) => toCustomTool(createPostgresToolDefinitions(pi.typebox.Type)[3]);

const postgresCustomTools: NativeCustomToolFactory = (pi) => [
  toCustomTool(createPostgresToolDefinitions(pi.typebox.Type)[0]),
  toCustomTool(createPostgresToolDefinitions(pi.typebox.Type)[1]),
  toCustomTool(createPostgresToolDefinitions(pi.typebox.Type)[2]),
  toCustomTool(createPostgresToolDefinitions(pi.typebox.Type)[3]),
];

export default postgresCustomTools;
