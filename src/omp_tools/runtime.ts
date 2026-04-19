// ABOUTME: Creates shared database runners and lightweight tool helper types for oh-my-pi SQL tools.
// ABOUTME: Keeps Postgres and ClickHouse runtime wiring out of tests and custom tool adapters.
import { Pool } from "pg";

export type ToolTextResult = {
  content: Array<{ type: "text"; text: string }>;
};

export type NativeToolExecute = (
  toolCallId: string,
  params: Record<string, unknown>,
  onUpdate: unknown,
  ctx: ToolContext,
  signal?: AbortSignal,
) => Promise<ToolTextResult>;

export type NativeCustomTool = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: NativeToolExecute;
};

export type NativeCustomToolFactoryAPI = {
  typebox: {
    Type: TypeFactory;
  };
};

export type NativeCustomToolFactory = (
  pi: NativeCustomToolFactoryAPI,
) => NativeCustomTool | Array<NativeCustomTool> | Promise<NativeCustomTool | Array<NativeCustomTool>>;

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
};

export type TypeFactory = {
  Object(properties: Record<string, unknown>): unknown;
  String(options?: Record<string, unknown>): unknown;
  Array(items: unknown): unknown;
  Literal(value: string): unknown;
  Optional(schema: unknown): unknown;
  Number(options?: Record<string, unknown>): unknown;
};

export function createPostgresRunner(): (sql: string) => Promise<Array<Record<string, unknown>>> {
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

export function createClickHouseRunner(): (sql: string) => Promise<Array<Record<string, unknown>>> {
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

export function requireToolContext(toolName: string, ctx: ToolContext | undefined): ToolContext {
  if (!ctx) {
    throw new Error(`${toolName} requires an active tool context`);
  }

  return ctx;
}

export function toTextResult(text: string): ToolTextResult {
  return {
    content: [{ type: "text", text }],
  };
}
