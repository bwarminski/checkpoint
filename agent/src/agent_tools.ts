// ABOUTME: Builds focused pi-agent-core tool wrappers over the agent runtime boundaries.
// ABOUTME: Exposes ClickHouse, source lookup, validation, and fix/PR actions to the loop.
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

type ClickHouseFinding = {
  fingerprint: string;
  [key: string]: unknown;
};

type ApplyFixResult = {
  branchName: string;
  diff: string;
};

export type AgentToolDependencies = {
  clickhouseTool?: {
    describeTable(table: string): Promise<string>;
    executeQuery(sql: string): Promise<string>;
    listTables(): Promise<Array<string>>;
    queryFindings(scope?: unknown): Promise<Array<ClickHouseFinding>>;
  };
  codeSearchTool?: {
    locate(input: {
      source_file?: string;
      source_tag?: string;
    }): Promise<unknown>;
  };
  demoRepoTool?: {
    applyFix(input: {
      finding: {
        fingerprint: string;
      };
      fix: {
        fix_type: string;
        summary: string;
      };
      source: {
        content: string;
        source_file: string;
      };
    }): Promise<ApplyFixResult>;
  };
  explainTool?: {
    analyze(input: { sql: string }): Promise<unknown>;
  };
  githubTool?: {
    openPullRequest(input: {
      codeDiff?: string;
      finding: {
        fingerprint?: string;
        source_tag?: string;
      };
      fix: {
        fix_type?: string;
        summary?: string;
      };
      headRef?: string;
      source?: {
        [key: string]: unknown;
      };
      validation?: {
        [key: string]: unknown;
        plan_rows?: Array<Record<string, unknown>>;
      };
    }): Promise<unknown>;
  };
};

export function buildAgentTools(
  deps: AgentToolDependencies,
): Array<AgentTool<any>> {
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
        const source = await deps.codeSearchTool!.locate(asLocateSourceInput(params));
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
        finding: Type.Object({
          fingerprint: Type.String(),
          severity: Type.Optional(Type.String()),
        }),
        fix: Type.Object({
          fix_type: Type.String(),
          summary: Type.String(),
        }),
        validation: Type.Optional(
          Type.Object({
            validated: Type.Optional(Type.Boolean()),
          }),
        ),
        source: Type.Object({
          content: Type.String(),
          source_file: Type.String(),
        }),
      }),
      execute: async (_id, params) => {
        const input = asApplyFixInput(params);
        if (input.finding.severity !== "high") {
          throw new Error("apply_fix requires a high-severity finding");
        }
        if (input.validation?.validated !== true) {
          throw new Error("apply_fix requires validated query input");
        }
        if (!input.source.source_file) {
          throw new Error("apply_fix requires source_file");
        }
        const result = await deps.demoRepoTool!.applyFix({
          finding: {
            fingerprint: input.finding.fingerprint,
          },
          fix: input.fix,
          source: input.source,
        });
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
        finding: Type.Object({
          fingerprint: Type.Optional(Type.String()),
          source_tag: Type.Optional(Type.String()),
        }),
        fix: Type.Object({
          fix_type: Type.Optional(Type.String()),
          summary: Type.Optional(Type.String()),
        }),
        validation: Type.Optional(Type.Unknown()),
        headRef: Type.Optional(Type.String()),
        codeDiff: Type.Optional(Type.String()),
      }),
      execute: async (_id, params) => {
        const input = asOpenPullRequestInput(params);
        if (!input.headRef || !input.codeDiff) {
          throw new Error("open_pull_request requires non-empty headRef and codeDiff");
        }
        const result = await deps.githubTool!.openPullRequest({
          ...input,
        });
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

function asLocateSourceInput(value: unknown): {
  source_file?: string;
  source_tag?: string;
} {
  const source_file = readOptionalStringProperty(value, "source_file");
  const source_tag = readOptionalStringProperty(value, "source_tag");

  if (!source_file && !source_tag) {
    throw new Error("locate_source requires source_file or source_tag");
  }

  return { source_file, source_tag };
}

function asApplyFixInput(value: unknown): {
  finding: {
    fingerprint: string;
    severity?: string;
  };
  fix: {
    fix_type: string;
    summary: string;
  };
  validation?: {
    validated?: boolean;
    [key: string]: unknown;
  };
  source: {
    content: string;
    source_file: string;
  };
} {
  const finding = readRecordProperty(value, "finding");
  const fix = readRecordProperty(value, "fix");
  const validation = readOptionalRecordProperty(value, "validation");
  const source = readRecordProperty(value, "source");

  return {
    finding: {
      fingerprint: readStringProperty(finding, "fingerprint"),
      severity: readOptionalStringProperty(finding, "severity"),
    },
    fix: {
      fix_type: readStringProperty(fix, "fix_type"),
      summary: readStringProperty(fix, "summary"),
    },
    validation: validation
      ? {
          ...validation,
          validated: validation.validated === true,
        }
      : undefined,
    source: {
      content: readStringProperty(source, "content"),
      source_file: readStringProperty(source, "source_file"),
    },
  };
}

function asOpenPullRequestInput(value: unknown): {
  codeDiff?: string;
  finding: {
    fingerprint?: string;
    source_tag?: string;
  };
  fix: {
    fix_type?: string;
    summary?: string;
  };
  headRef?: string;
  validation?: {
    [key: string]: unknown;
    plan_rows?: Array<Record<string, unknown>>;
  };
} {
  const finding = readRecordProperty(value, "finding");
  const fix = readRecordProperty(value, "fix");
  const validation = readOptionalRecordProperty(value, "validation");

  return {
    finding: {
      fingerprint: readOptionalStringProperty(finding, "fingerprint"),
      source_tag: readOptionalStringProperty(finding, "source_tag"),
    },
    fix: {
      fix_type: readOptionalStringProperty(fix, "fix_type"),
      summary: readOptionalStringProperty(fix, "summary"),
    },
    headRef: readOptionalStringProperty(value, "headRef"),
    codeDiff: readOptionalStringProperty(value, "codeDiff"),
    validation: validation
      ? {
          ...validation,
          plan_rows: readOptionalPlanRows(validation),
        }
      : undefined,
  };
}

function readRecordProperty(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value[key])) {
    throw new Error(`${key} is required`);
  }

  return value[key];
}

function readOptionalRecordProperty(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value) || value[key] === undefined) {
    return undefined;
  }

  if (!isRecord(value[key])) {
    throw new Error(`${key} must be an object`);
  }

  return value[key];
}

function readOptionalPlanRows(value: Record<string, unknown>): Array<Record<string, unknown>> | undefined {
  if (value.plan_rows === undefined) {
    return undefined;
  }

  if (!Array.isArray(value.plan_rows) || value.plan_rows.some((row) => !isRecord(row))) {
    throw new Error("validation.plan_rows must be an array of objects");
  }

  return value.plan_rows;
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
  if (result === undefined) {
    throw new Error(`${key} is required`);
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
