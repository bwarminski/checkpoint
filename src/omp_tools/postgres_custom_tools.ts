// ABOUTME: Exposes native oh-my-pi custom tools for coarse Postgres investigation workflows.
// ABOUTME: Shares one adapter layer between filesystem-discovered tools and SDK-backed tests.
import { createLiveQueryCheckerWithCompletion } from "./live_query_checker.ts";
import {
  createPostgresRunner,
  requireToolContext,
  toTextResult,
  type NativeCustomTool,
  type NativeCustomToolFactory,
  type QueryCompletion,
  type SdkToolDefinition,
  type TypeFactory,
} from "./runtime.ts";
import { createQueryCheckerCompletion } from "../omp_extension/tool_runtime.ts";
import { createPostgresCheckerTool } from "../tools/postgres/checker_tool.ts";
import { createPostgresListTablesTool } from "../tools/postgres/list_tables_tool.ts";
import { createPostgresQueryTool } from "../tools/postgres/query_tool.ts";
import { createPostgresSchemaTool } from "../tools/postgres/schema_tool.ts";

type PostgresDefinition = ReturnType<typeof createPostgresToolDefinitions>[number];

export function createPostgresToolDefinitions(type: TypeFactory, runCompletion: QueryCompletion): Array<SdkToolDefinition> {
  const runner = createPostgresRunner();
  return [
    createPostgresListTablesDefinition(type, runner),
    createPostgresSchemaDefinition(type, runner),
    createPostgresCheckerDefinition(type, runCompletion),
    createPostgresQueryDefinition(type, runner),
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

function createPostgresNativeTools(type: TypeFactory): [NativeCustomTool, NativeCustomTool, NativeCustomTool, NativeCustomTool] {
  const definitions = createPostgresToolDefinitions(type, createQueryCheckerCompletion());
  return [
    toCustomTool(definitions[0]),
    toCustomTool(definitions[1]),
    toCustomTool(definitions[2]),
    toCustomTool(definitions[3]),
  ];
}

export const sqlDbListTables: NativeCustomToolFactory = (pi) =>
  toCustomTool(createPostgresListTablesDefinition(pi.typebox.Type, createPostgresRunner()));
export const sqlDbSchema: NativeCustomToolFactory = (pi) =>
  toCustomTool(createPostgresSchemaDefinition(pi.typebox.Type, createPostgresRunner()));
export const sqlDbChecker: NativeCustomToolFactory = (pi) =>
  toCustomTool(createPostgresCheckerDefinition(pi.typebox.Type, createQueryCheckerCompletion()));
export const sqlDbQuery: NativeCustomToolFactory = (pi) =>
  toCustomTool(createPostgresQueryDefinition(pi.typebox.Type, createPostgresRunner()));

const postgresCustomTools: NativeCustomToolFactory = (pi) => createPostgresNativeTools(pi.typebox.Type);

export default postgresCustomTools;

function createPostgresListTablesDefinition(
  type: TypeFactory,
  runner: (sql: string) => Promise<Array<Record<string, unknown>>>,
): SdkToolDefinition {
  const postgresListTablesTool = createPostgresListTablesTool(
    async (sql) => runner(sql) as Promise<Array<{ table_name: string }>>,
  );
  return {
    name: "sql_db_list_tables",
    label: "Postgres Tables",
    description: "List PostgreSQL tables from the requested schema.",
    parameters: type.Object({ schema: type.String() }),
    async execute(_toolCallId: string, params: { schema: string }) {
      return toTextResult(await postgresListTablesTool.execute(params));
    },
  };
}

function createPostgresSchemaDefinition(
  type: TypeFactory,
  runner: (sql: string) => Promise<Array<Record<string, unknown>>>,
): SdkToolDefinition {
  const postgresSchemaTool = createPostgresSchemaTool(runner);
  return {
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
  };
}

function createPostgresCheckerDefinition(type: TypeFactory, runCompletion: QueryCompletion): SdkToolDefinition {
  return {
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
        createLiveQueryCheckerWithCompletion(
          runCompletion,
          requireToolContext("sql_db_checker", ctx),
        ),
      );
      return toTextResult(JSON.stringify(await postgresCheckerTool.execute(params), null, 2));
    },
  };
}

function createPostgresQueryDefinition(
  type: TypeFactory,
  runner: (sql: string) => Promise<Array<Record<string, unknown>>>,
): SdkToolDefinition {
  const postgresQueryTool = createPostgresQueryTool(runner);
  return {
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
  };
}
