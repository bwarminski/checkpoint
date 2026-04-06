// ABOUTME: Builds focused pi-agent-core tool wrappers over the agent runtime boundaries.
// ABOUTME: Exposes ClickHouse, memory, source lookup, validation, and fix/PR actions to the loop.
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

type ClickHouseFinding = {
  fingerprint: string;
  [key: string]: unknown;
};

export type AgentToolDependencies = {
  clickhouseTool?: {
    describeTable(table: string): Promise<string>;
    executeQuery(sql: string): Promise<string>;
    listTables(): Promise<Array<string>>;
    queryFindings(scope?: unknown): Promise<Array<ClickHouseFinding>>;
  };
  codeSearchTool?: {
    locate(input: unknown): Promise<unknown>;
  };
  demoRepoTool?: {
    applyFix(input: unknown): Promise<unknown>;
  };
  explainTool?: {
    analyze(input: { sql: string }): Promise<unknown>;
  };
  githubTool?: {
    openPullRequest(input: unknown): Promise<unknown>;
  };
  memoryTool?: {
    record(input: {
      details?: unknown;
      kind: "preference" | "constraint" | "discovery" | "failed_attempt";
      summary: string;
    }): Promise<void>;
    search(query: string): Promise<Array<unknown>>;
  };
};

export function buildAgentTools(deps: AgentToolDependencies): Array<AgentTool<any>> {
  const tools: Array<AgentTool<any>> = [];

  if (deps.clickhouseTool) {
    tools.push(
      {
        name: "list_tables",
        label: "List Tables",
        description: "List the supported ClickHouse tables available to the agent.",
        parameters: Type.Object({}),
        execute: async () => {
          const tables = await deps.clickhouseTool!.listTables();
          return textResult(JSON.stringify(tables), tables);
        },
      },
      {
        name: "describe_table",
        label: "Describe Table",
        description: "Describe a supported ClickHouse table schema.",
        parameters: Type.Object({
          table: Type.String(),
        }),
        execute: async (_id, params) => {
          const table = readStringProperty(params, "table");
          const schema = await deps.clickhouseTool!.describeTable(table);
          return textResult(schema, schema);
        },
      },
      {
        name: "query_database",
        label: "Query Database",
        description: "Run a guarded SELECT query against the supported ClickHouse tables.",
        parameters: Type.Object({
          sql: Type.String(),
        }),
        execute: async (_id, params) => {
          const sql = readStringProperty(params, "sql");
          const rows = await deps.clickhouseTool!.executeQuery(sql);
          return textResult(rows, rows);
        },
      },
      {
        name: "query_findings",
        label: "Query Findings",
        description: "Load normalized ClickHouse findings for the current database scope.",
        parameters: Type.Object({
          scope: Type.Optional(Type.String()),
        }),
        execute: async (_id, params) => {
          const scope = readOptionalStringProperty(params, "scope");
          const findings = await deps.clickhouseTool!.queryFindings(scope);
          return textResult(JSON.stringify(findings), findings);
        },
      },
    );
  }

  if (deps.memoryTool) {
    tools.push(
      {
        name: "search_memory",
        label: "Search Memory",
        description: "Search prior discoveries, preferences, constraints, and failed attempts.",
        parameters: Type.Object({
          query: Type.String(),
        }),
        execute: async (_id, params) => {
          const query = readStringProperty(params, "query");
          const entries = await deps.memoryTool!.search(query);
          return textResult(JSON.stringify(entries), entries);
        },
      },
      {
        name: "record_memory",
        label: "Record Memory",
        description: "Record a durable lesson, preference, discovery, or failed attempt.",
        parameters: Type.Object({
          kind: Type.Union([
            Type.Literal("preference"),
            Type.Literal("constraint"),
            Type.Literal("discovery"),
            Type.Literal("failed_attempt"),
          ]),
          summary: Type.String(),
          details: Type.Optional(Type.Unknown()),
        }),
        execute: async (_id, params) => {
          await deps.memoryTool!.record(asMemoryRecord(params));
          return textResult("Memory recorded.", { recorded: true });
        },
      },
    );
  }

  if (deps.codeSearchTool) {
    tools.push({
      name: "locate_source",
      label: "Locate Source",
      description: "Load the source file context for a finding's source file or source tag.",
      parameters: Type.Object({
        source_file: Type.Optional(Type.String()),
        source_tag: Type.Optional(Type.String()),
      }),
      execute: async (_id, params) => {
        const source = await deps.codeSearchTool!.locate(params);
        return textResult(JSON.stringify(source), source);
      },
    });
  }

  if (deps.explainTool) {
    tools.push({
      name: "analyze_query",
      label: "Analyze Query",
      description: "Run the guarded query validation path for a candidate SQL statement.",
      parameters: Type.Object({
        sql: Type.String(),
      }),
      execute: async (_id, params) => {
        const sql = readStringProperty(params, "sql");
        const result = await deps.explainTool!.analyze({ sql });
        return textResult(JSON.stringify(result), result);
      },
    });
  }

  if (deps.demoRepoTool) {
    tools.push({
      name: "apply_fix",
      label: "Apply Fix",
      description: "Apply a concrete fix in the demo repo for a selected finding.",
      parameters: Type.Object({
        finding: Type.Unknown(),
        fix: Type.Unknown(),
        source: Type.Unknown(),
      }),
      execute: async (_id, params) => {
        const result = await deps.demoRepoTool!.applyFix(params);
        return textResult(JSON.stringify(result), result);
      },
    });
  }

  if (deps.githubTool) {
    tools.push({
      name: "open_pull_request",
      label: "Open Pull Request",
      description: "Open a pull request for the selected finding and prepared fix.",
      parameters: Type.Object({
        finding: Type.Unknown(),
        fix: Type.Unknown(),
        source: Type.Optional(Type.Unknown()),
        validation: Type.Optional(Type.Unknown()),
        headRef: Type.Optional(Type.String()),
        codeDiff: Type.Optional(Type.String()),
      }),
      execute: async (_id, params) => {
        const result = await deps.githubTool!.openPullRequest(params);
        return textResult(JSON.stringify(result), result);
      },
    });
  }

  return tools;
}

function textResult<TDetails>(text: string, details: TDetails): AgentToolResult<TDetails> {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

function asMemoryRecord(value: unknown): {
  details?: unknown;
  kind: "preference" | "constraint" | "discovery" | "failed_attempt";
  summary: string;
} {
  const kind = readStringProperty(value, "kind");
  const summary = readStringProperty(value, "summary");

  if (
    kind !== "preference" &&
    kind !== "constraint" &&
    kind !== "discovery" &&
    kind !== "failed_attempt"
  ) {
    throw new Error(`Unsupported memory kind: ${kind}`);
  }

  return {
    kind,
    summary,
    details: isRecord(value) ? value.details : undefined,
  };
}

function readOptionalStringProperty(value: unknown, key: string): string | undefined {
  if (!isRecord(value) || value[key] === undefined) {
    return undefined;
  }

  if (typeof value[key] !== "string") {
    throw new Error(`${key} must be a string`);
  }

  return value[key];
}

function readStringProperty(value: unknown, key: string): string {
  const result = readOptionalStringProperty(value, key);
  if (!result) {
    throw new Error(`${key} is required`);
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
