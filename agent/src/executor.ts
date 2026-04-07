// ABOUTME: Bridges the DB specialist A2A lifecycle onto a pi-agent-core agent session.
// ABOUTME: Keeps transport concerns in A2A while the loop uses provider-agnostic model config and agent tools.
import type { ExecutionEventBus, RequestContext } from "@a2a-js/sdk/server";
import { Agent, type AgentEvent, type AgentTool, type StreamFn } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";

import {
  buildAgentTools,
  createLoopRunEvidence,
  type AgentToolDependencies,
} from "./agent_tools.ts";
import {
  parseLlmConfig,
  type LlmConfig,
  type QualifiedModelRef,
} from "./llm_config.ts";
import { ClickHouseTool } from "./tools/clickhouse_tool.ts";

type EventQueue = {
  enqueueEvent(event: unknown): void;
};

type EventSink = ExecutionEventBus | EventQueue;

type QueueRequestContext = Partial<RequestContext> & {
  userMessage?: {
    parts?: Array<{ text?: string }>;
    text?: string;
  };
};

type ExecutorOptions = {
  createAgent?: (input: CreateAgentInput) => LoopAgent;
  env?: {
    LLM_MODEL?: string;
  };
  now?: () => Date;
  systemPrompt?: string;
  streamFn?: StreamFn;
};

type CreateAgentInput = {
  deps: AgentToolDependencies;
  llmConfig: LlmConfig;
  systemPrompt: string;
  streamFn?: StreamFn;
  tools: Array<AgentTool>;
};

type LoopAgent = {
  abort?: () => void;
  prompt(input: string): Promise<void>;
  subscribe(listener: (event: AgentEvent) => void | Promise<void>): () => void;
  waitForIdle(): Promise<void>;
};

type LoopRunResult = {
  findings: Array<unknown>;
  response: string;
  toolResults: Array<{
    details: unknown;
    toolName: string;
  }>;
};

const FALLBACK_TASK_ID = "gate-a-task";
const FALLBACK_CONTEXT_ID = "gate-a-context";

const DEFAULT_SYSTEM_PROMPT = [
  "You are the DB specialist agent.",
  "Investigate database issues by using the available tools instead of inventing data.",
  "Use query_findings for normalized ClickHouse findings and query_database only for guarded follow-up queries.",
  "Finish with a concise response that explains what you found and what should happen next.",
].join("\n");

export class DBSpecialistExecutor {
  readonly llmConfig: LlmConfig;

  private readonly createAgentImpl: (input: CreateAgentInput) => LoopAgent;
  private readonly now: () => Date;
  private readonly systemPrompt: string;
  private readonly streamFn?: StreamFn;
  private readonly activeTasks = new Map<string, { agent: LoopAgent; contextId: string }>();

  constructor(
    private readonly deps: AgentToolDependencies = {
      clickhouseTool: new ClickHouseTool(),
    },
    options: ExecutorOptions = {},
  ) {
    this.llmConfig = parseLlmConfig(options.env ?? process.env);
    this.createAgentImpl = options.createAgent ?? createAgent;
    this.now = options.now ?? (() => new Date());
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.streamFn = options.streamFn;
  }

  async execute(
    requestContext: QueueRequestContext,
    eventSink: EventSink,
  ): Promise<void> {
    const userText = readUserText(requestContext) ?? "analyze_db";
    const loopEvidence = createLoopRunEvidence();
    const tools = buildAgentTools(this.deps, loopEvidence);
    const agent = this.createAgentImpl({
      deps: this.deps,
      llmConfig: this.llmConfig,
      systemPrompt: this.systemPrompt,
      streamFn: this.streamFn,
      tools,
    });
    const runResult: LoopRunResult = {
      findings: [],
      response: "",
      toolResults: [],
    };

    const taskId = requestContext.taskId ?? FALLBACK_TASK_ID;
    const contextId = requestContext.contextId ?? FALLBACK_CONTEXT_ID;
    this.activeTasks.set(taskId, { agent, contextId });
    const unsubscribe = agent.subscribe((event) => {
      applyLoopEvent(runResult, event);
    });

    try {
      this.publishSubmittedTask(requestContext, eventSink);
      this.publishWorking(requestContext, eventSink);
      await agent.prompt(userText);
      await agent.waitForIdle();
      this.publishCompleted(requestContext, eventSink, runResult);
    } catch (err) {
      this.publishFailed(requestContext, eventSink, err);
    } finally {
      unsubscribe();
      const activeTask = this.activeTasks.get(taskId);
      if (activeTask?.agent === agent) {
        this.activeTasks.delete(taskId);
      }
    }
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    const activeTask = this.activeTasks.get(taskId);
    activeTask?.agent.abort?.();
    eventBus.publish({
      kind: "status-update",
      taskId,
      contextId: activeTask?.contextId ?? FALLBACK_CONTEXT_ID,
      status: { state: "canceled", timestamp: this.timestamp() },
      final: true,
    });
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
      taskId: requestContext.taskId ?? FALLBACK_TASK_ID,
      contextId: requestContext.contextId ?? FALLBACK_CONTEXT_ID,
      status: { state: "working", timestamp: this.timestamp() },
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
      id: requestContext.taskId ?? FALLBACK_TASK_ID,
      contextId: requestContext.contextId ?? FALLBACK_CONTEXT_ID,
      status: { state: "submitted", timestamp: this.timestamp() },
      history: toTaskHistory(requestContext.userMessage),
    });
  }

  private publishCompleted(
    requestContext: Partial<RequestContext>,
    eventSink: EventSink,
    runResult: LoopRunResult,
  ): void {
    if ("enqueueEvent" in eventSink) {
      eventSink.enqueueEvent({ type: "completed", result: runResult });
      return;
    }

    eventSink.publish({
      kind: "status-update",
      taskId: requestContext.taskId ?? FALLBACK_TASK_ID,
      contextId: requestContext.contextId ?? FALLBACK_CONTEXT_ID,
      status: {
        state: "completed",
        timestamp: this.timestamp(),
        message: buildCompletedMessage(requestContext, runResult),
      },
      final: true,
    });
    eventSink.finished();
  }

  private publishFailed(
    requestContext: Partial<RequestContext>,
    eventSink: EventSink,
    err: unknown,
  ): void {
    if ("enqueueEvent" in eventSink) {
      eventSink.enqueueEvent({ type: "failed", error: String(err) });
      return;
    }

    eventSink.publish({
      kind: "status-update",
      taskId: requestContext.taskId ?? FALLBACK_TASK_ID,
      contextId: requestContext.contextId ?? FALLBACK_CONTEXT_ID,
      status: { state: "failed", timestamp: this.timestamp() },
      final: true,
    });
    eventSink.finished();
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function createAgent(input: CreateAgentInput): LoopAgent {
  return new Agent({
    initialState: {
      model: resolveModel(input.llmConfig.primary),
      systemPrompt: input.systemPrompt,
      tools: input.tools,
    },
    streamFn: input.streamFn,
  });
}

function resolveModel(modelRef: QualifiedModelRef) {
  try {
    return getModel(modelRef.provider as any, modelRef.model as never);
  } catch {
    throw new Error(
      `Unsupported LLM provider/model for the current runtime: ${modelRef.provider}/${modelRef.model}`,
    );
  }
}

function applyLoopEvent(runResult: LoopRunResult, event: AgentEvent): void {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    runResult.response += event.assistantMessageEvent.delta;
    return;
  }

  if (event.type === "message_end" && event.message.role === "assistant") {
    const text = extractAssistantText(event.message);
    if (text.length > 0) {
      runResult.response = text;
    }
    return;
  }

  if (
    event.type === "tool_execution_end" &&
    typeof event.toolName === "string"
  ) {
    runResult.toolResults.push({
      details: event.result?.details,
      toolName: event.toolName,
    });

    if (
      !event.isError &&
      event.toolName === "query_findings" &&
      Array.isArray(event.result?.details)
    ) {
      runResult.findings = event.result.details;
    }
  }
}

function extractAssistantText(
  message: Extract<AgentEvent, { type: "message_end" }>["message"],
): string {
  if (message.role !== "assistant") {
    return "";
  }

  return message.content
    .filter(
      (part): part is { text: string; type: "text" } =>
        part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("");
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
  runResult: LoopRunResult,
): {
  contextId: string;
  kind: "message";
  messageId: string;
  parts: Array<{ data: LoopRunResult; kind: "data" }>;
  role: "agent";
  taskId: string;
} {
  const taskId = requestContext.taskId ?? FALLBACK_TASK_ID;
  const contextId = requestContext.contextId ?? FALLBACK_CONTEXT_ID;

  return {
    contextId,
    kind: "message",
    messageId: `${taskId}-completed`,
    parts: [
      {
        kind: "data",
        data: runResult,
      },
    ],
    role: "agent",
    taskId,
  };
}
