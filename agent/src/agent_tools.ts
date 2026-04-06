// ABOUTME: Builds focused pi-agent-core tool wrappers over the agent runtime boundaries.
// ABOUTME: Exposes ClickHouse, memory, source lookup, validation, and fix/PR actions to the loop.
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

type ClickHouseFinding = {
  fingerprint: string;
  [key: string]: unknown;
};

type LoopFinding = ClickHouseFinding & {
  sample_query?: string;
  severity?: string;
  source_file?: string;
};

type ApplyFixResult = {
  branchName: string;
  diff: string;
};

type ValidationDetails = {
  validated?: boolean;
  [key: string]: unknown;
};

type PreparationDetails = ApplyFixResult & {
  findingFingerprint: string;
  fix_type: string;
  source_file?: string;
};

export type LoopRunEvidence = {
  recordFindings(findings: Array<ClickHouseFinding>): void;
  recordValidation(input: { sql: string; validation: ValidationDetails }): void;
  recordPreparation(input: PreparationDetails): void;
  recordSourceLookup(input: { source_file?: string }): void;
  readFinding(fingerprint: string): LoopFinding | undefined;
  readValidation(sql: string): ValidationDetails | undefined;
  readPreparation(input: { findingFingerprint: string; fix_type: string }): PreparationDetails | undefined;
  sawSourceLookup(source_file: string): boolean;
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
  memoryTool?: {
    record(input: {
      details?: unknown;
      kind: "preference" | "constraint" | "discovery" | "failed_attempt";
      summary: string;
    }): Promise<void>;
    search(query: string): Promise<Array<unknown>>;
  };
};

export function createLoopRunEvidence(): LoopRunEvidence {
  const findingsByFingerprint = new Map<string, LoopFinding>();
  const validationsBySql = new Map<string, ValidationDetails>();
  const sourceLookups = new Set<string>();
  const preparationsByFingerprint = new Map<string, PreparationDetails>();

  return {
    recordFindings(findings: Array<ClickHouseFinding>) {
      for (const finding of findings) {
        findingsByFingerprint.set(finding.fingerprint, finding as LoopFinding);
      }
    },
    recordValidation(input) {
      validationsBySql.set(input.sql, input.validation);
    },
    recordPreparation(input) {
      preparationsByFingerprint.set(input.findingFingerprint, input);
    },
    recordSourceLookup(input) {
      if (typeof input.source_file === "string" && input.source_file.length > 0) {
        sourceLookups.add(input.source_file);
      }
    },
    readFinding(fingerprint: string) {
      return findingsByFingerprint.get(fingerprint);
    },
    readValidation(sql: string) {
      return validationsBySql.get(sql);
    },
    readPreparation(input) {
      const preparationEvidence = preparationsByFingerprint.get(input.findingFingerprint);
      if (!preparationEvidence || preparationEvidence.fix_type !== input.fix_type) {
        return undefined;
      }

      return preparationEvidence;
    },
    sawSourceLookup(source_file: string) {
      return sourceLookups.has(source_file);
    },
  };
}

export function buildAgentTools(
  deps: AgentToolDependencies,
  loopRunEvidence: LoopRunEvidence = createLoopRunEvidence(),
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
          loopRunEvidence.recordFindings(findings);
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
        const source = await deps.codeSearchTool!.locate(asLocateSourceInput(params));
        if (isRecord(source)) {
          loopRunEvidence.recordSourceLookup({
            source_file: readOptionalStringProperty(source, "source_file"),
          });
        }
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
        if (isRecord(result)) {
          loopRunEvidence.recordValidation({
            sql,
            validation: result,
          });
        }
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
          sample_query: Type.Optional(Type.String()),
          severity: Type.Optional(Type.String()),
        }),
        fix: Type.Object({
          fix_type: Type.String(),
          summary: Type.String(),
        }),
        source: Type.Object({
          content: Type.String(),
          source_file: Type.String(),
        }),
      }),
      execute: async (_id, params) => {
        const input = asApplyFixInput(params);
        const priorFinding = loopRunEvidence.readFinding(input.finding.fingerprint);
        if (!priorFinding) {
          throw new Error(`apply_fix requires prior finding evidence for ${input.finding.fingerprint}`);
        }
        if ((priorFinding.severity ?? input.finding.severity) !== "high") {
          throw new Error("apply_fix requires a high-severity finding");
        }
        const sampleQuery = input.finding.sample_query ?? priorFinding.sample_query;
        if (!sampleQuery || !loopRunEvidence.readValidation(sampleQuery)?.validated) {
          throw new Error("apply_fix requires a validated query for the selected finding");
        }
        if (!loopRunEvidence.sawSourceLookup(input.source.source_file)) {
          throw new Error("apply_fix requires prior source lookup evidence for the selected source");
        }
        const result = await deps.demoRepoTool!.applyFix(input);
        loopRunEvidence.recordPreparation({
          branchName: result.branchName,
          diff: result.diff,
          findingFingerprint: input.finding.fingerprint,
          fix_type: input.fix.fix_type,
          source_file: input.source.source_file,
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
        source: Type.Optional(Type.Unknown()),
        validation: Type.Optional(Type.Unknown()),
        headRef: Type.Optional(Type.String()),
        codeDiff: Type.Optional(Type.String()),
      }),
      execute: async (_id, params) => {
        const input = asOpenPullRequestInput(params);
        const findingFingerprint = input.finding.fingerprint ?? "unknown";
        const fixType = input.fix.fix_type ?? "unknown";
        const priorFinding = loopRunEvidence.readFinding(findingFingerprint);
        const sampleQuery = priorFinding?.sample_query;
        if (!sampleQuery || !loopRunEvidence.readValidation(sampleQuery)?.validated) {
          throw new Error("open_pull_request requires prior validation evidence");
        }
        const preparation = loopRunEvidence.readPreparation({
          findingFingerprint,
          fix_type: fixType,
        });
        if (!preparation) {
          throw new Error("open_pull_request requires a prepared fix from the current loop run");
        }
        const validation = loopRunEvidence.readValidation(sampleQuery);
        const result = await deps.githubTool!.openPullRequest({
          ...input,
          headRef: input.headRef ?? preparation.branchName,
          codeDiff: input.codeDiff ?? preparation.diff,
          validation: input.validation ?? validation,
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
    sample_query?: string;
    severity?: string;
  };
  fix: {
    fix_type: string;
    summary: string;
  };
  source: {
    content: string;
    source_file: string;
  };
} {
  const finding = readRecordProperty(value, "finding");
  const fix = readRecordProperty(value, "fix");
  const source = readRecordProperty(value, "source");

  return {
    finding: {
      fingerprint: readStringProperty(finding, "fingerprint"),
      sample_query: readOptionalStringProperty(finding, "sample_query"),
      severity: readOptionalStringProperty(finding, "severity"),
    },
    fix: {
      fix_type: readStringProperty(fix, "fix_type"),
      summary: readStringProperty(fix, "summary"),
    },
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
  source?: {
    [key: string]: unknown;
  };
  validation?: {
    [key: string]: unknown;
    plan_rows?: Array<Record<string, unknown>>;
  };
} {
  const finding = readRecordProperty(value, "finding");
  const fix = readRecordProperty(value, "fix");
  const source = readOptionalRecordProperty(value, "source");
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
    source,
    validation: validation
      ? {
          ...validation,
          plan_rows: readOptionalPlanRows(validation),
        }
      : undefined,
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
  if (!result) {
    throw new Error(`${key} is required`);
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
