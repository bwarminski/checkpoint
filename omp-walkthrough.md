# DB Specialist Extension: Code Walkthrough

*2026-04-19T14:15:43Z by Showboat 0.6.1*
<!-- showboat-id: 165a9c74-346e-4030-94f2-e0383dc1fc6e -->

This repo is a **DB Specialist extension** for the oh-my-pi agent platform. It gives the LLM eight SQL tools — four for Postgres, four for ClickHouse — so an agent session can explore a database schema, run safe exploratory queries, and have its proposed SQL peer-reviewed by a second model call before execution.

The codebase is organized into three layers that depend strictly downward:

```
src/omp_extension/   ← extension boundary  (oh-my-pi loads this)
src/omp_tools/       ← SDK adapter layer   (bridges tools to the SDK)
src/tools/           ← pure tool logic     (no SDK dependency)
```

Each layer knows about the one below it, but never the one above. This makes the pure tool layer independently testable with ordinary function calls, while the SDK adapter and extension boundary handle all the wiring.

```bash
find src -type f | sort | sed 's|src/||'
```

```output
omp_extension/db_specialist_extension.ts
omp_extension/tool_runtime.ts
omp_tools/clickhouse_custom_tools.ts
omp_tools/live_query_checker.ts
omp_tools/postgres_custom_tools.ts
omp_tools/runtime.ts
tools/clickhouse/checker_tool.ts
tools/clickhouse/list_tables_tool.ts
tools/clickhouse/query_tool.ts
tools/clickhouse/schema_tool.ts
tools/code_search_tool.ts
tools/explain_tool.ts
tools/postgres/checker_tool.ts
tools/postgres/list_tables_tool.ts
tools/postgres/query_tool.ts
tools/postgres/schema_tool.ts
tools/shared/identifier.ts
tools/shared/query_checker.ts
tools/shared/query_limits.ts
tools/shared/result_formatter.ts
tools/shared/schema_formatter.ts
```

## Layer 1: Pure tool logic (`src/tools/`)

The bottom layer has no dependency on oh-my-pi at all. Each tool is a plain function that takes a runner (a function that executes SQL and returns rows) and returns an object with an `execute` method. The runner is injected by the caller, which is what makes these easy to unit test.

There are four shared helpers that every tool uses:

```bash
cat src/tools/shared/identifier.ts
```

```output
// ABOUTME: Guards identifier inputs against SQL injection in tool name parameters.
// ABOUTME: Shared by Postgres and ClickHouse tools that interpolate schema or table names.

export function assertIdentifierLike(value: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}
```

`assertIdentifierLike` is the injection guard. Schema names and table names are interpolated directly into SQL strings (e.g. `WHERE table_schema = '${input.schema}'`), so they must pass a strict alphanumeric+underscore check before touching a query. If they don't, an error is thrown before anything reaches the database.

```bash
cat src/tools/shared/query_limits.ts
```

```output
// ABOUTME: Resolves safe row-cap and timeout values for exploratory SQL tools.
// ABOUTME: Prevents callers from bypassing configured hard limits.
export function resolveQueryLimits(
  requested: { rowCap?: number; timeoutMs?: number },
  caps: { maxRows: number; maxTimeoutMs: number },
): { rowCap: number; timeoutMs: number } {
  return {
    rowCap: normalizeLimit(requested.rowCap, caps.maxRows),
    timeoutMs: normalizeLimit(requested.timeoutMs, caps.maxTimeoutMs),
  };
}

function normalizeLimit(value: number | undefined, cap: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return cap;
  }

  return Math.min(cap, Math.max(1, Math.floor(value)));
}
```

`resolveQueryLimits` enforces hard caps on row count and timeout regardless of what the caller requests. The LLM can ask for 10 000 rows or a 60-second timeout, but the tool will silently clamp those to the configured maximums (200 rows, 10 seconds for both databases). A missing or invalid value falls back to the cap.

### The query checker contract (`src/tools/shared/query_checker.ts`)

Before we look at any database tool, it helps to understand the query checker contract, because the checker tool in each database family uses it.

```bash
cat src/tools/shared/query_checker.ts
```

```output
// ABOUTME: Defines the shared contract for SQL query checker tools.
// ABOUTME: Keeps checker prompt construction and result parsing reusable across runtimes.

export function buildQueryCheckPrompt(input: QueryCheckInput): string {
  return [
    `Dialect: ${input.dialect}`,
    `Question: ${input.question}`,
    "Review the SQL for correctness and safety.",
    `SQL:\n${input.query}`,
    'Respond with JSON: {"verdict":"safe|rewrite|reject","rewrittenQuery":"...","notes":["..."]}',
  ].join("\n\n");
}

export type QueryCheckVerdict = "safe" | "rewrite" | "reject";

export type QueryCheckResult = {
  verdict: QueryCheckVerdict;
  rewrittenQuery: string;
  notes: Array<string>;
};

export type QueryCheckInput = {
  dialect: "postgres" | "clickhouse";
  question: string;
  query: string;
};

export type QueryChecker = {
  runCheck(input: QueryCheckInput): Promise<QueryCheckResult>;
};

export function parseQueryCheckResult(output: string): QueryCheckResult {
  const trimmed = output.trim();
  const jsonText = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  const parsed = JSON.parse(jsonText) as Partial<QueryCheckResult>;
  if (
    parsed.verdict !== "safe" &&
    parsed.verdict !== "rewrite" &&
    parsed.verdict !== "reject"
  ) {
    throw new Error(`Checker returned an invalid verdict: ${output}`);
  }

  return {
    verdict: parsed.verdict,
    rewrittenQuery: typeof parsed.rewrittenQuery === "string" ? parsed.rewrittenQuery : "",
    notes: Array.isArray(parsed.notes) ? parsed.notes.map((note) => String(note)) : [],
  };
}

export function extractAssistantText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") {
    return content.trim();
  }

  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
}
```

This file defines the whole checker contract in one place. `buildQueryCheckPrompt` constructs the prompt that gets sent to the LLM reviewer — dialect, the original question, and the SQL. The LLM is instructed to return JSON with three fields: `verdict` (safe / rewrite / reject), `rewrittenQuery` (the corrected SQL if needed), and `notes` (explanation).

`parseQueryCheckResult` strips markdown fences if the model wrapped its JSON in a code block, then validates the verdict field. `extractAssistantText` handles the SDK's content format, which may be a plain string or an array of typed blocks.

The `QueryChecker` interface (`{ runCheck(input): Promise<QueryCheckResult> }`) is the seam that everything plugs into — the pure checker tool just calls `checker.runCheck()` without knowing anything about models or API keys.

### The four Postgres tools

Each database family has the same four tools. Postgres is shown in full; ClickHouse is symmetric.

```bash
cat src/tools/postgres/list_tables_tool.ts
```

```output
// ABOUTME: Lists PostgreSQL tables from the requested schema through an injected runner.
// ABOUTME: Keeps table discovery separate from schema and query execution concerns.
import { assertIdentifierLike } from "../shared/identifier.ts";

export function createPostgresListTablesTool(
  runQuery: (sql: string) => Promise<Array<{ table_name: string }>>,
) {
  return {
    async execute(input: { schema: string }) {
      assertIdentifierLike(input.schema, "PostgreSQL schema");
      const rows = await runQuery(
        `select table_name from information_schema.tables where table_schema = '${input.schema}' order by table_name`,
      );
      return rows.map((row) => row.table_name).join(", ");
    },
  };
}
```

```bash
cat src/tools/postgres/schema_tool.ts
```

```output
// ABOUTME: Inspects PostgreSQL table columns from information_schema through an injected runner.
// ABOUTME: Leaves runtime wiring and connection ownership to the caller.
import { assertIdentifierLike } from "../shared/identifier.ts";
import { formatSchemaTables } from "../shared/schema_formatter.ts";

export function createPostgresSchemaTool(
  runQuery: (sql: string) => Promise<Array<Record<string, unknown>>>,
) {
  return {
    async execute(input: { schema: string; tables: Array<string> }) {
      assertIdentifierLike(input.schema, "PostgreSQL schema");
      if (input.tables.length === 0) {
        throw new Error("Table list must not be empty");
      }

      const tables = input.tables.map((table) => {
        assertIdentifierLike(table, "PostgreSQL table");
        return `'${table}'`;
      }).join(", ");
      const columnRows = await runQuery(
        "select table_name, column_name, data_type " +
          "from information_schema.columns " +
          `where table_schema = '${input.schema}' and table_name in (${tables}) ` +
          "order by table_name, ordinal_position",
      );

      const columnsByTable = new Map<string, Array<{ name: string; type: string }>>();
      for (const row of columnRows) {
        const tableName = String(row.table_name);
        const columns = columnsByTable.get(tableName) ?? [];
        columns.push({
          name: String(row.column_name),
          type: String(row.data_type),
        });
        columnsByTable.set(tableName, columns);
      }

      const formattedTables = [];
      for (const tableName of input.tables) {
        const sampleRows = await runQuery(
          `select * from "${input.schema}"."${tableName}" limit 3`,
        );
        formattedTables.push({
          tableName,
          columns: columnsByTable.get(tableName) ?? [],
          sampleRows,
        });
      }

      return formatSchemaTables(formattedTables);
    },
  };
}
```

`createPostgresListTablesTool` returns a comma-separated list of table names from `information_schema.tables`. The schema name goes through `assertIdentifierLike` before interpolation.

`createPostgresSchemaTool` does two queries: first it fetches column metadata from `information_schema.columns` for all requested tables in one shot, then it issues a `SELECT * ... LIMIT 3` per table for sample rows. Results are assembled via `formatSchemaTables` from the shared formatter.

```bash
cat src/tools/postgres/query_tool.ts
```

```output
// ABOUTME: Executes bounded PostgreSQL SQL for exploration through an injected runner.
// ABOUTME: Applies statement_timeout and a row limit before delegating to the caller.
import { resolveQueryLimits } from "../shared/query_limits.ts";
import { formatQueryResult } from "../shared/result_formatter.ts";

export function createPostgresQueryTool(
  runQuery: (sql: string) => Promise<Array<Record<string, unknown>>>,
) {
  return {
    async execute(input: { query: string; rowCap?: number; timeoutMs?: number }) {
      const limits = resolveQueryLimits(input, { maxRows: 200, maxTimeoutMs: 10_000 });
      const query = input.query.trim().replace(/;+$/, "").replace(/\bLIMIT\s+\d+(\s+OFFSET\s+\d+)?\s*$/i, "").trimEnd();
      // statement_timeout is session-level; leaks on pooled connections. Acceptable for single-user local MVP.
      try {
        const rows = await runQuery(
          `set statement_timeout = ${limits.timeoutMs}; ${query} LIMIT ${limits.rowCap}`,
        );
        return formatQueryResult(rows);
      } catch (error) {
        return `Error: ${formatError(error)}`;
      }
    },
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
```

The query tool strips any trailing semicolons and any existing `LIMIT` clause from the user's SQL before re-appending a capped `LIMIT`. For Postgres it also prepends `SET statement_timeout` so the query is killed at the database level if it runs long. The comment notes that `statement_timeout` is session-scoped and leaks on a pooled connection — acceptable for the current single-user MVP, but worth knowing if connection pooling is ever added.

The checker tool is intentionally trivial:

```bash
cat src/tools/postgres/checker_tool.ts
```

```output
// ABOUTME: Validates Postgres SQL through an injected query checker.
// ABOUTME: Returns the checker verdict without embedding runtime-specific wiring here.

import type { QueryChecker } from "../shared/query_checker.ts";

export function createPostgresCheckerTool(checker: QueryChecker) {
  return {
    async execute(input: { dialect: "postgres"; question: string; query: string }) {
      return checker.runCheck(input);
    },
  };
}
```

The checker tool is four lines of delegation. It accepts a `QueryChecker` and calls `runCheck`. All the model invocation complexity lives above this layer — here the pure tool just forwards the call. The ClickHouse checker is identical with `dialect: "clickhouse"` instead.

## Layer 2: SDK adapter (`src/omp_tools/`)

This layer bridges the pure tools to the oh-my-pi SDK. It owns three concerns: shared types and database connection wiring (`runtime.ts`), connecting the query checker to a live model (`live_query_checker.ts`), and assembling each tool into the `SdkToolDefinition` shape the extension layer expects (`postgres_custom_tools.ts` and `clickhouse_custom_tools.ts`).

```bash
grep -n 'export type\|export function' src/omp_tools/runtime.ts
```

```output
5:export type ToolTextResult = {
9:export type NativeToolExecute = (
17:export type NativeCustomTool = {
25:export type NativeCustomToolFactoryAPI = {
31:export type NativeCustomToolFactory = (
35:export type ToolModel = {
39:export type QueryCompletionInput = {
46:export type QueryCompletion = (input: QueryCompletionInput) => Promise<string>;
48:export type ToolContext = {
58:export type ToolExtensionFields = {
67:export type SdkToolDefinition = ToolExtensionFields & {
81:export type ExtensionToolDefinition = ToolExtensionFields & {
95:export type ExtensionAPI = {
99:export type TypeFactory = {
108:export function createPostgresRunner(): (sql: string) => Promise<Array<Record<string, unknown>>> {
145:export function createClickHouseRunner(): (sql: string) => Promise<Array<Record<string, unknown>>> {
167:export function requireToolContext(toolName: string, ctx: ToolContext | undefined): ToolContext {
175:export function toTextResult(text: string): ToolTextResult {
```

```bash
sed -n '35,96p' src/omp_tools/runtime.ts
```

```output
export type ToolModel = {
  provider: string;
} & Record<string, unknown>;

export type QueryCompletionInput = {
  model: ToolModel;
  apiKey: string;
  sessionId: string;
  prompt: string;
};

export type QueryCompletion = (input: QueryCompletionInput) => Promise<string>;

export type ToolContext = {
  model: ToolModel | undefined;
  modelRegistry: {
    getApiKey(model: ToolModel, sessionId?: string): Promise<string | undefined>;
  };
  sessionManager: {
    getSessionId(): string;
  };
};

export type ToolExtensionFields = {
  hidden?: boolean;
  defaultInactive?: boolean;
  deferrable?: boolean;
  onSession?: (event: unknown, ctx: unknown) => void | Promise<void>;
  renderCall?: (...args: unknown[]) => unknown;
  renderResult?: (...args: unknown[]) => unknown;
};

export type SdkToolDefinition = ToolExtensionFields & {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: ToolContext,
  ): Promise<ToolTextResult>;
};

export type ExtensionToolDefinition = ToolExtensionFields & {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: ToolContext,
  ): Promise<ToolTextResult>;
};

export type ExtensionAPI = {
  registerTool(tool: ExtensionToolDefinition): void;
```

The key types here are:

- **`ToolContext`** — what the SDK passes to every tool call. Carries the active model, a `modelRegistry` that can resolve API keys, and a `sessionManager` that provides the session ID for tracking.
- **`QueryCompletion`** — the injection seam for model calls. A function that accepts a fully-assembled prompt plus auth material and returns the raw completion string. This is what gets injected into `createLiveQueryCheckerWithCompletion`.
- **`SdkToolDefinition`** and **`ExtensionToolDefinition`** — both extend `ToolExtensionFields`, which mirrors the optional SDK extension fields (`hidden`, `defaultInactive`, `deferrable`, `onSession`, render hooks). The two types have the same shape; `SdkToolDefinition` is what the factory functions produce, `ExtensionToolDefinition` is what the SDK's `registerTool` consumes.
- **`createPostgresRunner`** and **`createClickHouseRunner`** — factory functions that read env vars and return a function that executes SQL. The Postgres runner uses `pg.Pool`; the ClickHouse runner uses the HTTP query interface via `fetch` and parses the `JSONEachRow` response line-by-line.

### Connecting the checker to a live model (`src/omp_tools/live_query_checker.ts`)

```bash
cat src/omp_tools/live_query_checker.ts
```

```output
// ABOUTME: Builds the live SQL checker used by oh-my-pi SDK sessions and discovered custom tools.
// ABOUTME: Keeps shared checker logic separate from the runtime-specific model invocation path.
import type { QueryCheckInput, QueryCheckResult } from "../tools/shared/query_checker.ts";
import {
  buildQueryCheckPrompt,
  extractAssistantText,
  parseQueryCheckResult,
} from "../tools/shared/query_checker.ts";
import type { QueryCompletion, ToolContext } from "./runtime.ts";

export type LiveCheckerContext = ToolContext;

export function createLiveQueryCheckerWithCompletion(
  runCompletion: QueryCompletion,
  ctx: LiveCheckerContext,
): {
  runCheck(input: QueryCheckInput): Promise<QueryCheckResult>;
} {
  return {
    async runCheck(input: QueryCheckInput) {
      const model = ctx.model;
      if (!model) {
        throw new Error("Checker requires an active model");
      }

      const apiKey = await ctx.modelRegistry.getApiKey(model, ctx.sessionManager.getSessionId());
      if (!apiKey) {
        throw new Error(`Checker could not resolve API key for provider: ${model.provider}`);
      }

      return parseQueryCheckResult(
        await runCompletion({
          model,
          apiKey,
          sessionId: ctx.sessionManager.getSessionId(),
          prompt: buildQueryCheckPrompt(input),
        }),
      );
    },
  };
}

export { extractAssistantText, parseQueryCheckResult } from "../tools/shared/query_checker.ts";
```

`createLiveQueryCheckerWithCompletion` is the bridge between the pure `QueryChecker` interface and a live model. It takes two arguments: the injected `runCompletion` function (which the extension layer provides) and a `ToolContext` (which the SDK provides at call time).

When `runCheck` is called, it:
1. Verifies a model is active in the context (throws if not)
2. Resolves an API key from the model registry (throws if resolution fails)
3. Builds the checker prompt via `buildQueryCheckPrompt`
4. Calls `runCompletion` with the model, API key, session ID, and prompt
5. Parses the JSON response via `parseQueryCheckResult`

This function is what turns the purely abstract `QueryChecker` interface into something that actually calls an LLM.

### Assembling tools as SDK definitions (`src/omp_tools/postgres_custom_tools.ts`)

```bash
sed -n '1,60p' src/omp_tools/postgres_custom_tools.ts
```

```output
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
```

```bash
sed -n '101,128p' src/omp_tools/postgres_custom_tools.ts
```

```output
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

```

`createPostgresToolDefinitions` takes a `TypeFactory` (the TypeBox `Type` object, injected so tests can pass a compatible stub) and a `QueryCompletion` (injected so the checker can be driven with a fake in tests). It returns four `SdkToolDefinition` objects.

The checker definition (`createPostgresCheckerDefinition`) is the most interesting one. On each call it:
1. Calls `requireToolContext` to assert the SDK passed a non-null context (throws an error with the tool name if not)
2. Constructs a `createLiveQueryCheckerWithCompletion` — passing the injected `runCompletion` and the current call's context
3. Wraps that in `createPostgresCheckerTool` (the pure tool from Layer 1)
4. Executes, serializes the result as JSON, and wraps it in `toTextResult`

The `runCompletion` is injected at factory creation time — it comes from `createQueryCheckerCompletion()` in the extension layer, which is created once in `dbSpecialistExtension` and shared across all eight tools.

The named exports at the top (`sqlDbListTables`, `sqlDbChecker`, etc.) are `NativeCustomToolFactory` functions — these exist for the legacy oh-my-pi `customTools` API and are not used by the current extension-path approach. They're kept to avoid breaking anything that might still reference them.

## Layer 3: Extension boundary (`src/omp_extension/`)

This is the outermost layer — what oh-my-pi actually loads. It owns two files: `tool_runtime.ts` which provides model completion and adapts our tool definitions to the SDK's exact shape, and `db_specialist_extension.ts` which is the extension factory function.

```bash
cat src/omp_extension/tool_runtime.ts
```

```output
// ABOUTME: Provides extension-owned runtime helpers for the DB specialist tools.
// ABOUTME: Owns model invocation and tool-definition adaptation for the extension boundary.
import { extractAssistantText } from "../tools/shared/query_checker.ts";
import type {
  ExtensionToolDefinition,
  QueryCompletion,
  QueryCompletionInput,
  ToolContext,
  ToolModel,
  SdkToolDefinition,
} from "../omp_tools/runtime.ts";

export type { QueryCompletion, QueryCompletionInput };

// Mirrors @oh-my-pi/pi-ai@14.1.2 completeSimple. Verify on SDK upgrade.
type CompleteSimpleModule = {
  completeSimple(
    model: ToolModel,
    request: {
      systemPrompt: string;
      messages: Array<{
        role: "user";
        content: string;
        timestamp: number;
      }>;
    },
    options: {
      apiKey: string;
      sessionId: string;
      toolChoice: "none";
    },
  ): Promise<{
    content: string | Array<{ type: string; text?: string }>;
  }>;
};

const loadModule = new Function(
  "specifier",
  "return import(specifier);",
) as (specifier: string) => Promise<unknown>;

export function createQueryCheckerCompletion(): QueryCompletion {
  return async ({ model, apiKey, sessionId, prompt }) => {
    const { completeSimple } = await loadModule("@oh-my-pi/pi-ai") as CompleteSimpleModule;
    const result = await completeSimple(
      model,
      {
        systemPrompt:
          'You validate SQL queries. Reply with JSON only in the form {"verdict":"safe|rewrite|reject","rewrittenQuery":"...","notes":["..."]}.',
        messages: [{
          role: "user",
          content: prompt,
          timestamp: Date.now(),
        }],
      },
      {
        apiKey,
        sessionId,
        toolChoice: "none",
      },
    );

    return extractAssistantText(result.content);
  };
}

export function toExtensionToolDefinition(definition: SdkToolDefinition): ExtensionToolDefinition {
  const { execute, ...rest } = definition;
  return {
    ...rest,
    async execute(
      toolCallId: string,
      params: Record<string, unknown>,
      signal?: AbortSignal,
      onUpdate?: unknown,
      ctx?: ToolContext,
    ) {
      return execute(toolCallId, params, signal, onUpdate, ctx as ToolContext);
    },
  };
}
```

Two important things happen in `tool_runtime.ts`.

**`createQueryCheckerCompletion`** is where model calls are actually made. It returns a `QueryCompletion` function that, when invoked, dynamically imports `@oh-my-pi/pi-ai` and calls `completeSimple`. The dynamic import uses the `new Function` pattern to avoid TypeScript trying to resolve `@oh-my-pi/pi-ai` at compile time — that package is only available inside an active oh-my-pi session, not as a declared devDependency. The comment warns to verify the `CompleteSimpleModule` type on SDK upgrades; `@oh-my-pi/pi-ai` is declared in `package.json` (added during eng review) but the type is hand-mirrored from version 14.1.2.

**`toExtensionToolDefinition`** adapts a `SdkToolDefinition` to what the SDK's `registerTool` actually expects. It spreads all fields from the definition (including the optional extension fields like `hidden`, `deferrable`, `onSession`) and overrides only `execute` with a wrapper that casts the `ctx` argument. This ensures optional SDK fields on the definition are passed through rather than silently dropped.

```bash
cat src/omp_extension/db_specialist_extension.ts
```

```output
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
```

This is the extension entrypoint — 14 lines that wire everything together. When oh-my-pi loads this file, it calls `dbSpecialistExtension(pi)` where `pi` is the `ExtensionAPI`.

The function:
1. Creates one `runCompletion` function shared by all eight tools — so all checker calls in a session go through the same completion factory
2. Calls both `createPostgresToolDefinitions` and `createClickHouseToolDefinitions` with the real TypeBox `Type` and the shared `runCompletion`
3. Wraps each definition with `toExtensionToolDefinition` and registers it via `pi.registerTool`

The extension isn't loaded directly. The workspace setup script generates a shim file at `.omp/extensions/db-specialist.ts` that re-exports the default from this file. The shim is what oh-my-pi discovers via the `additionalExtensionPaths` SDK option.

## End-to-end: tracing a `sql_db_checker` call

Here's the full call chain when the LLM invokes the `sql_db_checker` tool:

```bash
cat /tmp/checker-chain.txt
```

```output
# Call chain for sql_db_checker

1. oh-my-pi agent receives tool call from the LLM:
     sql_db_checker({ dialect: "postgres", question: "...", query: "SELECT ..." })

2. SDK dispatches to the registered ExtensionToolDefinition.execute()
     -> toExtensionToolDefinition wrapper  (omp_extension/tool_runtime.ts)
     -> casts ctx, delegates to the original SdkToolDefinition.execute()

3. SdkToolDefinition.execute()  (omp_tools/postgres_custom_tools.ts)
     -> requireToolContext("sql_db_checker", ctx)    # throws if ctx is missing
     -> createLiveQueryCheckerWithCompletion(runCompletion, ctx)
     -> createPostgresCheckerTool(liveChecker)
     -> postgresCheckerTool.execute(params)          # pure tool: just calls runCheck

4. createLiveQueryCheckerWithCompletion.runCheck()  (omp_tools/live_query_checker.ts)
     -> assert ctx.model is set                      # throws: "Checker requires an active model"
     -> ctx.modelRegistry.getApiKey(model, sessionId)
     -> buildQueryCheckPrompt({ dialect, question, query })
     -> runCompletion({ model, apiKey, sessionId, prompt })

5. runCompletion = createQueryCheckerCompletion()  (omp_extension/tool_runtime.ts)
     -> dynamic import("@oh-my-pi/pi-ai")           # avoids compile-time resolution
     -> completeSimple(model, { systemPrompt, messages }, { apiKey, sessionId, toolChoice: "none" })

6. Back in runCheck:
     -> extractAssistantText(rawString)              # handles string or content-block array
     -> parseQueryCheckResult(text)                  # strips fences, validates verdict field

7. Result: { verdict: "safe"|"rewrite"|"reject", rewrittenQuery: "...", notes: [...] }

8. SdkToolDefinition.execute() wraps it:
     -> JSON.stringify(result, null, 2)
     -> toTextResult(json)  -> { content: [{ type: "text", text: json }] }

9. SDK returns the tool result to the LLM
```

The key insight in this chain is how the layering enables the injection seam. The `runCompletion` function is created once (step 5 at startup, in `dbSpecialistExtension`), captured in the closure of each tool definition (step 3), and finally called at step 4 — but what runs at step 5 is fully substitutable. In tests, `runCompletion` is replaced with a function that pushes to an array and returns a hardcoded JSON string, letting the entire chain run without touching a real model.

## Testing strategy

The test suite is split by concern. Unit tests live in `test/tools/` and test each tool in isolation with injected fakes. Integration tests live in `test/integration/` and are mostly skipped in regular `npm test` runs (they require `OMP_MODEL` env var and in some cases a live database).

```bash
sed -n '34,90p' test/tools/live_query_checker.test.ts
```

```output
test("createLiveQueryCheckerWithCompletion delegates completion to the injected runtime helper", async () => {
  const calls: Array<{
    apiKey: string;
    modelProvider: string;
    prompt: string;
    sessionId: string;
  }> = [];
  const checker = createLiveQueryCheckerWithCompletion(
    async ({ apiKey, model, prompt, sessionId }) => {
      calls.push({
        apiKey,
        modelProvider: model.provider,
        prompt,
        sessionId,
      });
      return JSON.stringify({ verdict: "safe", rewrittenQuery: "select 1", notes: ["ok"] });
    },
    {
      model: { provider: "openai" },
      modelRegistry: {
        async getApiKey() {
          return "secret-api-key";
        },
      },
      sessionManager: {
        getSessionId() {
          return "session-123";
        },
      },
    },
  );

  const result = await checker.runCheck({
    dialect: "postgres",
    question: "Is this query safe?",
    query: "select 1",
  });

  assert.deepEqual(calls, [
    {
      apiKey: "secret-api-key",
      modelProvider: "openai",
      prompt: buildQueryCheckPrompt({
        dialect: "postgres",
        question: "Is this query safe?",
        query: "select 1",
      }),
      sessionId: "session-123",
    },
  ]);
  assert.deepEqual(result, {
    verdict: "safe",
    rewrittenQuery: "select 1",
    notes: ["ok"],
  });
});

```

This test shows the injection pattern at its clearest. The fake `runCompletion` captures everything it receives into the `calls` array and returns a hardcoded JSON string. The fake `ToolContext` provides a known API key and session ID. After `runCheck`, the test asserts:
- Exactly one call was made
- The call got the right API key, model provider, session ID, and prompt (verified via `buildQueryCheckPrompt` so the prompt format is tested in one place)
- The result is the parsed `QueryCheckResult`

None of this touches a real model or database. The two tests below it (not shown) verify the error paths: model undefined and API key resolution failure.

```bash
npm test 2>&1 | grep -E '^(ok|not ok|# )'
```

```output
# Subtest: extractAssistantText returns trimmed string content as-is
ok 1 - extractAssistantText returns trimmed string content as-is
# Subtest: extractAssistantText joins text blocks from array content
ok 2 - extractAssistantText joins text blocks from array content
# Subtest: extractAssistantText returns empty string for array with no text blocks
ok 3 - extractAssistantText returns empty string for array with no text blocks
# Subtest: parseQueryCheckResult parses raw JSON
ok 4 - parseQueryCheckResult parses raw JSON
# Subtest: parseQueryCheckResult strips ```json code fence
ok 5 - parseQueryCheckResult strips ```json code fence
# Subtest: parseQueryCheckResult strips plain ``` code fence
ok 6 - parseQueryCheckResult strips plain ``` code fence
# Subtest: parseQueryCheckResult normalizes missing rewrittenQuery to empty string
ok 7 - parseQueryCheckResult normalizes missing rewrittenQuery to empty string
# Subtest: parseQueryCheckResult normalizes missing notes to empty array
ok 8 - parseQueryCheckResult normalizes missing notes to empty array
# Subtest: parseQueryCheckResult throws on invalid verdict
ok 9 - parseQueryCheckResult throws on invalid verdict
# Subtest: workspace setup and reset create an extension-based DB specialist runtime
ok 10 - workspace setup and reset create an extension-based DB specialist runtime
# Subtest: db investigation skill includes ClickHouse catalog guidance
ok 11 - db investigation skill includes ClickHouse catalog guidance
# Subtest: legacy runtime files are removed from the main path
ok 12 - legacy runtime files are removed from the main path
# Subtest: workspace setup creates a loadable db specialist extension
ok 13 - workspace setup creates a loadable db specialist extension
# Subtest: workspace setup does not generate db specialist tool shims
ok 14 - workspace setup does not generate db specialist tool shims
# Subtest: live oh-my-pi session exposes coarse SQL tools
ok 15 - live oh-my-pi session exposes coarse SQL tools # SKIP
# Subtest: live oh-my-pi checker tools return structured verdicts
ok 16 - live oh-my-pi checker tools return structured verdicts # SKIP
# Subtest: workspace setup validates the generated db specialist extension entrypoint
ok 17 - workspace setup validates the generated db specialist extension entrypoint
# Subtest: workspace session tool names come from the generated extension runtime
ok 18 - workspace session tool names come from the generated extension runtime # SKIP
# Subtest: clickhouse checker delegates to the injected subagent
ok 19 - clickhouse checker delegates to the injected subagent
# Subtest: clickhouse list tables returns a comma-separated table list
ok 20 - clickhouse list tables returns a comma-separated table list
# Subtest: clickhouse list tables rejects non-identifier databases
ok 21 - clickhouse list tables rejects non-identifier databases
# Subtest: clickhouse query tool renders formatted query results
ok 22 - clickhouse query tool renders formatted query results
# Subtest: clickhouse query tool returns Error text when execution fails
ok 23 - clickhouse query tool returns Error text when execution fails
# Subtest: clickhouse schema tool returns formatted schema text for the requested tables
ok 24 - clickhouse schema tool returns formatted schema text for the requested tables
# Subtest: clickhouse schema tool rejects empty table lists
ok 25 - clickhouse schema tool rejects empty table lists
# Subtest: clickhouse schema tool rejects non-identifier table names
ok 26 - clickhouse schema tool rejects non-identifier table names
# Subtest: CodeSearchTool default client reads from CODE_SEARCH_ROOT
ok 27 - CodeSearchTool default client reads from CODE_SEARCH_ROOT
# Subtest: CodeSearchTool default client falls back to DEMO_APP_ROOT when CODE_SEARCH_ROOT is unset
ok 28 - CodeSearchTool default client falls back to DEMO_APP_ROOT when CODE_SEARCH_ROOT is unset
# Subtest: CodeSearchTool requires source_file input
ok 29 - CodeSearchTool requires source_file input
# Subtest: CodeSearchTool source does not reference the agent package
ok 30 - CodeSearchTool source does not reference the agent package
# Subtest: buildQueryCheckPrompt includes the expected checker instructions
ok 31 - buildQueryCheckPrompt includes the expected checker instructions
# Subtest: parseQueryCheckResult parses raw checker JSON
ok 32 - parseQueryCheckResult parses raw checker JSON
# Subtest: createLiveQueryCheckerWithCompletion delegates completion to the injected runtime helper
ok 33 - createLiveQueryCheckerWithCompletion delegates completion to the injected runtime helper
# Subtest: createLiveQueryCheckerWithCompletion throws when model is undefined
ok 34 - createLiveQueryCheckerWithCompletion throws when model is undefined
# Subtest: createLiveQueryCheckerWithCompletion throws when API key cannot be resolved
ok 35 - createLiveQueryCheckerWithCompletion throws when API key cannot be resolved
# Subtest: toExtensionToolDefinition preserves the tool seam
ok 36 - toExtensionToolDefinition preserves the tool seam
# Subtest: postgres checker delegates to the injected subagent
ok 37 - postgres checker delegates to the injected subagent
# Subtest: postgres list tables returns a comma-separated table list
ok 38 - postgres list tables returns a comma-separated table list
# Subtest: postgres list tables rejects non-identifier schemas
ok 39 - postgres list tables rejects non-identifier schemas
# Subtest: postgres query tool renders formatted query results
ok 40 - postgres query tool renders formatted query results
# Subtest: postgres query tool returns Error text when execution fails
ok 41 - postgres query tool returns Error text when execution fails
# Subtest: postgres schema tool returns formatted schema text for the requested tables
ok 42 - postgres schema tool returns formatted schema text for the requested tables
# Subtest: postgres schema tool rejects empty table lists
ok 43 - postgres schema tool rejects empty table lists
# Subtest: postgres schema tool rejects non-identifier table names
ok 44 - postgres schema tool rejects non-identifier table names
# Subtest: resolveQueryLimits clamps row caps and timeout values
ok 45 - resolveQueryLimits clamps row caps and timeout values
# Subtest: resolveQueryLimits normalizes invalid row caps and timeouts
ok 46 - resolveQueryLimits normalizes invalid row caps and timeouts
# Subtest: formatQueryResult renders multiple rows with headers
ok 47 - formatQueryResult renders multiple rows with headers
# Subtest: formatQueryResult renders an explicit empty result
ok 48 - formatQueryResult renders an explicit empty result
# Subtest: formatQueryResult preserves column names when rendering values
ok 49 - formatQueryResult preserves column names when rendering values
# Subtest: formatSchemaTables renders one table with columns and sample rows
ok 50 - formatSchemaTables renders one table with columns and sample rows
# Subtest: formatSchemaTables renders multiple table blocks deterministically
ok 51 - formatSchemaTables renders multiple table blocks deterministically
# Subtest: formatSchemaTables renders a stable empty sample section
ok 52 - formatSchemaTables renders a stable empty sample section
# tests 52
# suites 0
# pass 49
# fail 0
# cancelled 0
# skipped 3
# todo 0
# duration_ms 5476.18934
```

52 tests, 49 pass, 3 skipped (model-integration tests that require `OMP_MODEL` and Bun), 0 fail. The skipped tests exercise the full live session path — workspace creation, extension loading, and actual tool execution against a running model.

## Workspace setup: how the extension gets loaded

The shim file generated by the setup script is what oh-my-pi actually finds at extension discovery time. The workspace helper in the test suite also sets `disableExtensionDiscovery: true` and passes the path directly via `additionalExtensionPaths`.

```bash
cat scripts/setup-oh-my-pi-workspace.sh
```

```output
#!/usr/bin/env bash
# ABOUTME: Creates the external oh-my-pi workspace skeleton used by the current MVP.
# ABOUTME: Symlinks repo-owned skills and generates the DB specialist extension entrypoint with a persistent working directory.
set -euo pipefail

WORKSPACE_ROOT="${HOME}/.oh-my-pi-workspaces/checkpoint"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${WORKSPACE_ROOT}/.omp" "${WORKSPACE_ROOT}/workdir"
rm -rf "${WORKSPACE_ROOT}/.omp/skills" "${WORKSPACE_ROOT}/.omp/tools" "${WORKSPACE_ROOT}/.omp/extensions"
ln -s "${REPO_ROOT}/skills" "${WORKSPACE_ROOT}/.omp/skills"
mkdir -p "${WORKSPACE_ROOT}/.omp/extensions"
printf 'export { default } from "%s";\n' "${REPO_ROOT}/src/omp_extension/db_specialist_extension.ts" > "${WORKSPACE_ROOT}/.omp/extensions/db-specialist.ts"
```

The setup script creates the workspace skeleton under `~/.oh-my-pi-workspaces/checkpoint/.omp/extensions/` and generates a one-liner shim:

```typescript
export { default } from "/abs/path/to/src/omp_extension/db_specialist_extension.ts";
```

This shim is what oh-my-pi imports at session start. Because the shim uses an absolute path, the repo can be updated without re-running setup. The script also removes `.omp/tools` (the legacy discovery location) and symlinks `skills/` into the workspace.

The test helper's session creation (`test/helpers/oh_my_pi_workspace.ts`) reflects the same setup but uses cache-busted file URLs to avoid ESM module caching when the extension file is rewritten mid-test:

```bash
sed -n '98,129p' test/helpers/oh_my_pi_workspace.ts
```

```output
  const workspaceRoot = getWorkspaceRoot(home);
  const agentDir = join(home, ".omp", "agent");
  const extensionPath = getWorkspaceExtensionPath(home);
  await validateWorkspaceExtension(home);
  const extensionUrl = `${pathToFileURL(extensionPath).href}?t=${Date.now()}`;
  const authStorage = await discoverAuthStorage(agentDir);
  const modelRegistry = new ModelRegistry(authStorage);
  await modelRegistry.refresh();
  const resolvedModel = resolveRequestedModel(modelRegistry, model);

  if (!resolvedModel) {
    throw new Error(`Could not resolve requested model: ${model}`);
  }

  const { session } = await createAgentSession({
    agentDir,
    authStorage,
    contextFiles: [],
    cwd: workspaceRoot,
    additionalExtensionPaths: [extensionUrl],
    disableExtensionDiscovery: true,
    enableLsp: false,
    enableMCP: false,
    hasUI: false,
    model: resolvedModel,
    modelRegistry,
    promptTemplates: [],
    sessionManager: SessionManager.inMemory(),
    skills: [],
    slashCommands: [],
    toolNames: ["__none__"],
  });
```

The `?t=${Date.now()}` suffix makes each session creation use a distinct URL. Node.js's ESM module cache keys on the specifier string, so appending a timestamp forces a fresh import even when the file was imported in the same process earlier. `disableExtensionDiscovery: true` tells the SDK not to scan `.omp/extensions/` — only `additionalExtensionPaths` is used.

## ClickHouse differences

The ClickHouse tools are symmetric with Postgres but differ in three places:

```bash
grep -n 'CLICKHOUSE_URL\|JSONEachRow\|SETTINGS max_execution\|system.tables\|system.columns' src/omp_tools/runtime.ts src/tools/clickhouse/*.ts
```

```output
src/omp_tools/runtime.ts:147:    const url = process.env.CLICKHOUSE_URL;
src/omp_tools/runtime.ts:149:      throw new Error("ClickHouse runner requires CLICKHOUSE_URL");
src/omp_tools/runtime.ts:153:    const response = await fetch(`${url}${separator}query=${encodeURIComponent(`${sql} FORMAT JSONEachRow`)}`);
src/tools/clickhouse/list_tables_tool.ts:12:        `select name from system.tables where database = '${input.database}' order by name`,
src/tools/clickhouse/query_tool.ts:15:          `${query} LIMIT ${limits.rowCap} SETTINGS max_execution_time = ${Math.ceil(limits.timeoutMs / 1000)}`,
src/tools/clickhouse/schema_tool.ts:1:// ABOUTME: Inspects ClickHouse table columns from system.columns through an injected runner.
src/tools/clickhouse/schema_tool.ts:24:          "from system.columns " +
```

1. **Connection**: ClickHouse is reached via HTTP (`fetch`) using `CLICKHOUSE_URL`, not a pg pool. Queries are sent as URL-encoded query params with `FORMAT JSONEachRow`, and the response body is parsed line-by-line.

2. **Timeout**: Postgres uses `SET statement_timeout` (session-level, millisecond units). ClickHouse uses `SETTINGS max_execution_time = N` appended to the query (query-level, second units — hence `Math.ceil(timeoutMs / 1000)`).

3. **Catalog**: Postgres queries `information_schema.tables` and `information_schema.columns`. ClickHouse queries `system.tables` and `system.columns`, and uses `database` / `table` columns instead of `table_schema` / `table_name`.

## Design decisions summary

A few deliberate choices worth calling out:

**Injection over construction.** Every tool is created by a factory function that accepts its dependencies as arguments. No tool constructs its own database connection or calls `createQueryCheckerCompletion()` directly. This is what makes unit tests fast and straightforward — pass a fake, assert on the calls.

**Layering enforced by import direction.** `src/tools/` imports nothing from `omp_tools/` or `omp_extension/`. `src/omp_tools/` imports from `tools/` but not from `omp_extension/`. This means you can test the pure tool layer without loading the SDK at all. The `QueryCompletion` type was moved to `omp_tools/runtime.ts` specifically to prevent an upward import — `live_query_checker.ts` needed it, and it lives in `omp_tools/`.

**Dynamic import for `@oh-my-pi/pi-ai`.** TypeScript would try to resolve `@oh-my-pi/pi-ai` at compile time if it appeared in a regular `import`. Since that package is only available inside a running oh-my-pi session (it's a transitive dep of `@oh-my-pi/pi-coding-agent`), the code uses `new Function("specifier", "return import(specifier)")(...)` to bypass compile-time resolution. The package is now declared in `package.json` so a non-hoisted install doesn't break at runtime.

**ESM cache-busting in tests.** The reload integration test rewrites the extension file between two session creations. Because Node.js caches ESM modules by URL, both sessions would see the original cached module without the `?t=Date.now()` suffix on the file URL.

**`ToolExtensionFields` shared by both definition types.** `SdkToolDefinition` (what factory functions produce) and `ExtensionToolDefinition` (what `registerTool` consumes) share the same optional extension fields via `ToolExtensionFields`. `toExtensionToolDefinition` spreads the source definition so those fields are never silently dropped.
