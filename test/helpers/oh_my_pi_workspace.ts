// ABOUTME: Helps integration tests create the generated oh-my-pi workspace and run live prompts in it.
// ABOUTME: Uses the oh-my-pi SDK to inject the repo's SQL tools into a real generated workspace session.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { Type } from "@sinclair/typebox";
import { Pool } from "pg";

import { createClickHouseCheckerTool } from "../../src/tools/clickhouse/checker_tool.ts";
import { createClickHouseListTablesTool } from "../../src/tools/clickhouse/list_tables_tool.ts";
import { createClickHouseQueryTool } from "../../src/tools/clickhouse/query_tool.ts";
import { createClickHouseSchemaTool } from "../../src/tools/clickhouse/schema_tool.ts";
import { createPostgresCheckerTool } from "../../src/tools/postgres/checker_tool.ts";
import { createPostgresListTablesTool } from "../../src/tools/postgres/list_tables_tool.ts";
import { createPostgresQueryTool } from "../../src/tools/postgres/query_tool.ts";
import { createPostgresSchemaTool } from "../../src/tools/postgres/schema_tool.ts";
import type { QueryCheckInput, QueryCheckResult } from "../../src/tools/shared/query_checker.ts";

const execFileAsync = promisify(execFile);

export function getWorkspaceRoot(home: string): string {
  return join(home, ".oh-my-pi-workspaces", "checkpoint");
}

export async function setupWorkspace(home: string): Promise<void> {
  await runWorkspaceScript(home, "scripts/setup-oh-my-pi-workspace.sh");
}

export async function resetWorkspace(home: string): Promise<void> {
  await runWorkspaceScript(home, "scripts/reset-oh-my-pi-workspace.sh");
}

export async function runWorkspaceSession(input: {
  home: string;
  model: string;
  prompt: string;
}): Promise<string> {
  const { session } = await createWorkspaceSession(input.home, input.model);

  try {
    return await collectAssistantText(session, input.prompt);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to run the oh-my-pi SDK session. ${message}`.trim());
  } finally {
    await session.dispose();
  }
}

export async function runWorkspaceChecker(input: {
  home: string;
  model: string;
  toolName: "sql_db_checker" | "clickhouse_db_checker";
  input: QueryCheckInput;
}): Promise<QueryCheckResult> {
  const { session, sqlTools } = await createWorkspaceSession(input.home, input.model);
  const checkerTool = sqlTools.find((tool) => tool.name === input.toolName);

  if (!checkerTool) {
    throw new Error(`Missing checker tool definition: ${input.toolName}`);
  }

  try {
    const result = await checkerTool.execute(
      "checker-test-call",
      input.input,
      undefined,
      undefined,
      {
        model: session.model,
        modelRegistry: session.modelRegistry,
        sessionManager: session.sessionManager,
      },
    );
    return parseQueryCheckResult(extractAssistantText(result.content));
  } finally {
    await session.dispose();
  }
}

async function runWorkspaceScript(home: string, scriptPath: string): Promise<void> {
  await execFileAsync("bash", [scriptPath], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home },
  });
}

async function createWorkspaceSession(home: string, model: string): Promise<{
  session: WorkspaceSession;
  sqlTools: Array<ToolDefinition>;
}> {
  const sdkModuleName = "@oh-my-pi/pi-coding-agent";
  const { createAgentSession, SessionManager } = await import(sdkModuleName);
  const workspaceRoot = getWorkspaceRoot(home);
  const agentDir = join(home, ".omp", "agent");
  const sqlTools = createSqlToolDefinitions();
  const { session } = await createAgentSession({
    agentDir,
    contextFiles: [],
    cwd: workspaceRoot,
    customTools: sqlTools,
    disableExtensionDiscovery: true,
    enableLsp: false,
    enableMCP: false,
    hasUI: false,
    modelPattern: model,
    promptTemplates: [],
    sessionManager: SessionManager.inMemory(),
    skills: [],
    slashCommands: [],
    toolNames: ["__none__"],
  });

  return {
    session: session as WorkspaceSession,
    sqlTools,
  };
}

function createSqlToolDefinitions(): Array<ToolDefinition> {
  const postgresRunner = createPostgresRunner();
  const clickHouseRunner = createClickHouseRunner();
  const postgresListRunner = async (sql: string): Promise<Array<{ table_name: string }>> =>
    postgresRunner(sql) as Promise<Array<{ table_name: string }>>;
  const clickHouseListRunner = async (sql: string): Promise<Array<{ name: string }>> =>
    clickHouseRunner(sql) as Promise<Array<{ name: string }>>;

  const postgresListTablesTool = createPostgresListTablesTool(postgresListRunner);
  const postgresSchemaTool = createPostgresSchemaTool(postgresRunner);
  const postgresQueryTool = createPostgresQueryTool(postgresRunner);
  const clickHouseListTablesTool = createClickHouseListTablesTool(clickHouseListRunner);
  const clickHouseSchemaTool = createClickHouseSchemaTool(clickHouseRunner);
  const clickHouseQueryTool = createClickHouseQueryTool(clickHouseRunner);

  return [
    {
      name: "sql_db_list_tables",
      label: "Postgres Tables",
      description: "List PostgreSQL tables from the requested schema.",
      parameters: Type.Object({ schema: Type.String() }),
      async execute(_toolCallId: string, params: { schema: string }) {
        return toTextResult(await postgresListTablesTool.execute(params));
      },
    },
    {
      name: "sql_db_schema",
      label: "Postgres Schema",
      description: "Show PostgreSQL schema details and sample rows for the requested tables.",
      parameters: Type.Object({
        schema: Type.String(),
        tables: Type.Array(Type.String()),
      }),
      async execute(_toolCallId: string, params: { schema: string; tables: Array<string> }) {
        return toTextResult(await postgresSchemaTool.execute(params));
      },
    },
    {
      name: "sql_db_checker",
      label: "Postgres Checker",
      description: "Validate a PostgreSQL query and return a structured verdict.",
      parameters: Type.Object({
        dialect: Type.Literal("postgres"),
        question: Type.String(),
        query: Type.String(),
      }),
      async execute(
        _toolCallId: string,
        params: { dialect: "postgres"; question: string; query: string },
        _signal: AbortSignal | undefined,
        _onUpdate: unknown,
        ctx: ToolContext,
      ) {
        const postgresCheckerTool = createPostgresCheckerTool(createLiveQueryChecker(ctx));
        return toTextResult(JSON.stringify(await postgresCheckerTool.execute(params), null, 2));
      },
    },
    {
      name: "sql_db_query",
      label: "Postgres Query",
      description: "Run a bounded exploratory PostgreSQL query.",
      parameters: Type.Object({
        query: Type.String(),
        rowCap: Type.Optional(Type.Number()),
        timeoutMs: Type.Optional(Type.Number()),
      }),
      async execute(_toolCallId: string, params: { query: string; rowCap?: number; timeoutMs?: number }) {
        return toTextResult(await postgresQueryTool.execute(params));
      },
    },
    {
      name: "clickhouse_db_list_tables",
      label: "ClickHouse Tables",
      description: "List ClickHouse tables from the requested database.",
      parameters: Type.Object({ database: Type.String() }),
      async execute(_toolCallId: string, params: { database: string }) {
        return toTextResult(await clickHouseListTablesTool.execute(params));
      },
    },
    {
      name: "clickhouse_db_schema",
      label: "ClickHouse Schema",
      description: "Show ClickHouse schema details and sample rows for the requested tables.",
      parameters: Type.Object({
        database: Type.String(),
        tables: Type.Array(Type.String()),
      }),
      async execute(_toolCallId: string, params: { database: string; tables: Array<string> }) {
        return toTextResult(await clickHouseSchemaTool.execute(params));
      },
    },
    {
      name: "clickhouse_db_checker",
      label: "ClickHouse Checker",
      description: "Validate a ClickHouse query and return a structured verdict.",
      parameters: Type.Object({
        dialect: Type.Literal("clickhouse"),
        question: Type.String(),
        query: Type.String(),
      }),
      async execute(
        _toolCallId: string,
        params: { dialect: "clickhouse"; question: string; query: string },
        _signal: AbortSignal | undefined,
        _onUpdate: unknown,
        ctx: ToolContext,
      ) {
        const clickHouseCheckerTool = createClickHouseCheckerTool(createLiveQueryChecker(ctx));
        return toTextResult(JSON.stringify(await clickHouseCheckerTool.execute(params), null, 2));
      },
    },
    {
      name: "clickhouse_db_query",
      label: "ClickHouse Query",
      description: "Run a bounded exploratory ClickHouse query.",
      parameters: Type.Object({
        query: Type.String(),
        rowCap: Type.Optional(Type.Number()),
        timeoutMs: Type.Optional(Type.Number()),
      }),
      async execute(_toolCallId: string, params: { query: string; rowCap?: number; timeoutMs?: number }) {
        return toTextResult(await clickHouseQueryTool.execute(params));
      },
    },
  ];
}

function createPostgresRunner(): (sql: string) => Promise<Array<Record<string, unknown>>> {
  let pool: Pool | undefined;

  const getPool = () => {
    if (pool) {
      return pool;
    }

    const host = process.env.PGHOST;
    const database = process.env.PGDATABASE;
    const user = process.env.PGUSER;
    const password = process.env.PGPASSWORD;
    if (!host || !database || !user || !password) {
      throw new Error("Postgres runner requires PGHOST, PGDATABASE, PGUSER, and PGPASSWORD");
    }

    pool = new Pool({
      host,
      port: Number(process.env.PGPORT ?? "5432"),
      database,
      user,
      password,
    });
    return pool;
  };

  return async (sql) => {
    const result = await getPool().query(sql);
    if (Array.isArray(result)) {
      const finalResult = result.at(-1);
      return Array.isArray(finalResult?.rows) ? finalResult.rows : [];
    }

    return result.rows;
  };
}

function createClickHouseRunner(): (sql: string) => Promise<Array<Record<string, unknown>>> {
  return async (sql) => {
    const url = process.env.CLICKHOUSE_URL;
    if (!url) {
      throw new Error("ClickHouse runner requires CLICKHOUSE_URL");
    }

    const separator = url.includes("?") ? "&" : "?";
    const response = await fetch(`${url}${separator}query=${encodeURIComponent(`${sql} FORMAT JSONEachRow`)}`);
    if (!response.ok) {
      throw new Error(`ClickHouse query failed: ${response.status} ${response.statusText}`);
    }

    const body = await response.text();
    return body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  };
}

function createLiveQueryChecker(ctx: ToolContext): { runCheck(input: QueryCheckInput): Promise<QueryCheckResult> } {
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

      const aiModuleName = "@oh-my-pi/pi-ai";
      const { completeSimple } = await import(aiModuleName);
      const result = await completeSimple(
        model,
        {
          systemPrompt:
            'You validate SQL queries. Reply with JSON only in the form {"verdict":"safe|rewrite|reject","rewrittenQuery":"...","notes":["..."]}.',
          messages: [{
            role: "user",
            content: buildCheckerPrompt(input),
            timestamp: Date.now(),
          }],
        },
        {
          apiKey,
          sessionId: ctx.sessionManager.getSessionId(),
          toolChoice: "none",
        },
      );

      return parseQueryCheckResult(extractAssistantText(result.content));
    },
  };
}

async function collectAssistantText(
  session: SessionLike,
  prompt: string,
): Promise<string> {
  const messages: Array<string> = [];
  const unsubscribe = session.subscribe((event: SessionEvent) => {
    if (event.type !== "message_end" || event.message.role !== "assistant") {
      return;
    }

    const text = extractAssistantText(event.message.content);
    if (text) {
      messages.push(text);
    }
  });

  try {
    await session.prompt(prompt, { expandPromptTemplates: false });
    return messages.join("\n").trim();
  } finally {
    unsubscribe();
  }
}

type SessionLike = {
  dispose(): Promise<void>;
  prompt(text: string, options?: { expandPromptTemplates?: boolean }): Promise<void>;
  subscribe(listener: (event: SessionEvent) => void): () => void;
};

type ToolDefinition = {
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
  ): Promise<{
    content: Array<{ type: "text"; text: string }>;
  }>;
};

type ToolModel = {
  provider: string;
} & Record<string, unknown>;

type WorkspaceSession = SessionLike & {
  model: ToolModel | undefined;
  modelRegistry: ToolContext["modelRegistry"];
  sessionManager: ToolContext["sessionManager"];
};

type ToolContext = {
  model: ToolModel | undefined;
  modelRegistry: {
    getApiKey(model: ToolModel, sessionId?: string): Promise<string | undefined>;
  };
  sessionManager: {
    getSessionId(): string;
  };
};

type SessionEvent = {
  type: string;
  message: {
    role: string;
    content: string | Array<{ type: string; text?: string }>;
  };
};

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

function buildCheckerPrompt(input: QueryCheckInput): string {
  return [
    `Dialect: ${input.dialect}`,
    `Question: ${input.question}`,
    "Review the SQL for correctness and safety.",
    `SQL:\n${input.query}`,
    'Respond with JSON: {"verdict":"safe|rewrite|reject","rewrittenQuery":"...","notes":["..."]}',
  ].join("\n\n");
}

function toTextResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}
