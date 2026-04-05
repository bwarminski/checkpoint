// ABOUTME: Runs the DB specialist task lifecycle for the agent service.
// ABOUTME: Bridges the plan's simple test queue with the A2A SDK event bus.
import type { ExecutionEventBus, RequestContext } from "@a2a-js/sdk/server";

import { ClickHouseTool, type TopOffender } from "./tools/clickhouse_tool.ts";

type EventQueue = {
  enqueueEvent(event: unknown): void;
};

type EventSink = ExecutionEventBus | EventQueue;

type LocatedSource = {
  content: string;
  source_file: string;
};

type FixProposal = {
  fix_type: string;
  summary: string;
};

type ValidationResult = {
  validated: boolean;
  [key: string]: unknown;
};

type PullRequestResult = {
  url?: string;
  [key: string]: unknown;
} | null;

type ExecutorDependencies = {
  clickhouseTool?: {
    topOffenders(scope?: unknown): Promise<Array<TopOffender>>;
  };
  codeSearchTool?: {
    locate(input: {
      source_file?: string | null;
      source_tag?: string | null;
    }): Promise<LocatedSource>;
  };
  explainTool?: {
    analyze(input: { sql: string }): Promise<unknown>;
  };
  githubTool?: {
    openPullRequest(input: {
      finding: TopOffender;
      fix: FixProposal;
      source: LocatedSource;
      validation: ValidationResult;
    }): Promise<PullRequestResult>;
  };
  demoRepoTool?: {
    applyFix(input: {
      finding: TopOffender;
      fix: FixProposal;
      source: LocatedSource;
    }): Promise<void>;
  };
  memoryTool?: {
    shouldSuggest(input: { fingerprint: string; fixType: string }): Promise<boolean>;
  };
};

type QueueRequestContext = Partial<RequestContext> & {
  userMessage?: {
    parts?: Array<{ text?: string }>;
    text?: string;
  };
};

export class DBSpecialistExecutor {
  constructor(
    private readonly deps: ExecutorDependencies = {
      clickhouseTool: new ClickHouseTool(),
    },
  ) {}

  async execute(
    requestContext: QueueRequestContext,
    eventSink: EventSink,
  ): Promise<void> {
    const scope = readUserText(requestContext);
    this.publishSubmittedTask(requestContext, eventSink);
    this.publishWorking(requestContext, eventSink);
    const findings = await this.analyzeTopOffenders(scope);
    this.publishCompleted(requestContext, eventSink, findings);
  }

  async cancelTask(_taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    eventBus.finished();
  }

  private publishWorking(
    requestContext: Partial<RequestContext>,
    eventSink: EventSink,
  ): void {
    if ("enqueueEvent" in eventSink) {
      eventSink.enqueueEvent({ type: "working", message: "analysis started" });
      return;
    }

    eventSink.publish({
      kind: "status-update",
      taskId: requestContext.taskId ?? "gate-a-task",
      contextId: requestContext.contextId ?? "gate-a-context",
      status: { state: "working", timestamp: new Date().toISOString() },
      final: false,
    });
  }

  private publishSubmittedTask(
    requestContext: QueueRequestContext,
    eventSink: EventSink,
  ): void {
    if ("enqueueEvent" in eventSink || requestContext.task) {
      return;
    }

    eventSink.publish({
      kind: "task",
      id: requestContext.taskId ?? "gate-a-task",
      contextId: requestContext.contextId ?? "gate-a-context",
      status: { state: "submitted", timestamp: new Date().toISOString() },
      history: toTaskHistory(requestContext.userMessage),
    });
  }

  private publishCompleted(
    requestContext: Partial<RequestContext>,
    eventSink: EventSink,
    findings: Array<unknown>,
  ): void {
    if ("enqueueEvent" in eventSink) {
      eventSink.enqueueEvent({ type: "completed", result: { findings } });
      return;
    }

    eventSink.publish({
      kind: "status-update",
      taskId: requestContext.taskId ?? "gate-a-task",
      contextId: requestContext.contextId ?? "gate-a-context",
      status: {
        state: "completed",
        timestamp: new Date().toISOString(),
        message: buildCompletedMessage(requestContext, findings),
      },
      final: true,
    });
    eventSink.finished();
  }

  private async analyzeTopOffenders(scope?: string): Promise<Array<unknown>> {
    const findings = await this.deps.clickhouseTool?.topOffenders(scope);

    if (!findings?.length) {
      return [];
    }

    const completed: Array<unknown> = [];
    for (const finding of findings) {
      completed.push(await this.analyzeFinding(finding));
    }

    return completed;
  }

  private async analyzeFinding(finding: TopOffender): Promise<unknown> {
    const source = await this.locateSource(finding);
    const fix = buildFixProposal(finding, source);
    const validation = await this.validateFinding(finding);
    const allowed = await this.deps.memoryTool?.shouldSuggest({
      fingerprint: finding.fingerprint,
      fixType: fix.fix_type,
    });
    const mayOpenPr =
      allowed !== false &&
      finding.severity === "high" &&
      validation.validated &&
      this.deps.githubTool;
    let pr: PullRequestResult = null;
    if (mayOpenPr) {
      await this.deps.demoRepoTool?.applyFix({
        finding,
        fix,
        source,
      });
      pr = await this.deps.githubTool!.openPullRequest({
        finding,
        fix,
        source,
        validation,
      });
    }

    return {
      decision: allowed === false ? "blocked" : pr ? "opened" : "reported",
      fingerprint: finding.fingerprint,
      fix,
      pr,
      severity: finding.severity ?? "unknown",
      source,
      validation,
    };
  }

  private async locateSource(finding: TopOffender): Promise<LocatedSource> {
    if (
      !this.deps.codeSearchTool ||
      (typeof finding.source_file !== "string" && typeof finding.source_tag !== "string")
    ) {
      return {
        content: "",
        source_file: typeof finding.source_file === "string" ? finding.source_file : "",
      };
    }

    return this.deps.codeSearchTool.locate({
      source_file: typeof finding.source_file === "string" ? finding.source_file : undefined,
      source_tag: typeof finding.source_tag === "string" ? finding.source_tag : undefined,
    });
  }

  private async validateFinding(finding: TopOffender): Promise<ValidationResult> {
    if (!this.deps.explainTool || typeof finding.sample_query !== "string") {
      return { validated: false };
    }

    return normalizeValidationResult(
      await this.deps.explainTool.analyze({ sql: finding.sample_query }),
    );
  }
}

function buildFixProposal(finding: TopOffender, source: LocatedSource): FixProposal {
  const content = source.content;
  const normalized = content.toLowerCase();

  if (/\bcount\b/.test(normalized) && /\b(each|index_with|map)\b/.test(normalized)) {
    return {
      fix_type: "rewrite_count",
      summary: "Move the count query out of the loop and precompute the totals.",
    };
  }

  if (/like\s*\?/.test(normalized) || /like\s+'%/.test(normalized) || /%#\{/.test(content)) {
    return {
      fix_type: "rewrite_like",
      summary: "Replace the leading-wildcard LIKE search with a searchable alternative.",
    };
  }

  if (
    /\.\w+\.\w+/.test(content) ||
    (/\b(each|map|index_with)\b/.test(normalized) && /\.(user|todos|posts|comments)\b/.test(content))
  ) {
    return {
      fix_type: "add_includes",
      summary: "Eager load the accessed association to avoid an N+1 query pattern.",
    };
  }

  const rubyWhereColumn = content.match(/where\((\w+):/i)?.[1];
  const sqlWhereColumn = content.match(/\bwhere\s+["\w.]+\.(\w+)\s*=\s*/i)?.[1];
  const column = rubyWhereColumn ?? sqlWhereColumn;
  const sourceFile =
    typeof finding.source_file === "string" ? finding.source_file : finding.fingerprint;

  return {
    fix_type: "add_index",
    summary: column
      ? `Add an index for the ${column} filter used at ${sourceFile}.`
      : `Add an index for the equality filter used at ${sourceFile}.`,
  };
}

function normalizeValidationResult(result: unknown): ValidationResult {
  if (isObject(result) && typeof result.validated === "boolean") {
    return {
      ...result,
      validated: result.validated,
    };
  }

  return { validated: false };
}

function readUserText(requestContext: QueueRequestContext): string | undefined {
  if (typeof requestContext.userMessage?.text === "string") {
    return requestContext.userMessage.text;
  }

  const firstTextPart = requestContext.userMessage?.parts?.find(
    (part): part is { kind: "text"; text: string } =>
      isObject(part) && part.kind === "text" && typeof part.text === "string",
  );

  return firstTextPart?.text;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toTaskHistory(userMessage: unknown): Array<RequestContext["userMessage"]> {
  if (!isObject(userMessage)) {
    return [];
  }

  return [userMessage as unknown as RequestContext["userMessage"]];
}

function buildCompletedMessage(
  requestContext: Partial<RequestContext>,
  findings: Array<unknown>,
): {
  contextId: string;
  kind: "message";
  messageId: string;
  parts: Array<{ data: { findings: Array<unknown> }; kind: "data" }>;
  role: "agent";
  taskId: string;
} {
  const taskId = requestContext.taskId ?? "gate-a-task";
  const contextId = requestContext.contextId ?? "gate-a-context";

  return {
    contextId,
    kind: "message",
    messageId: `${taskId}-completed`,
    parts: [
      {
        kind: "data",
        data: { findings },
      },
    ],
    role: "agent",
    taskId,
  };
}
