// ABOUTME: Verifies the executor bridges pi-agent-core loop events onto the A2A lifecycle.
// ABOUTME: Keeps the executor transport-agnostic while preserving submitted, working, and completed events.
import assert from "node:assert/strict";
import test from "node:test";

import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";

import { DBSpecialistExecutor } from "../src/executor.ts";

test("executor bridges pi-agent-core events into working and completed task events", async () => {
  const events: Array<unknown> = [];
  let promptText = "";
  let systemPrompt = "";
  let toolNames: Array<string> = [];
  const executor = new DBSpecialistExecutor(
    {
      clickhouseTool: {
        listTables: async () => ["query_events"],
        describeTable: async () => "fingerprint\tString",
        executeQuery: async () => "fingerprint\tabc",
        queryFindings: async () => [],
      },
    } as any,
    {
      createAgent: ({ systemPrompt: prompt, tools }) => {
        systemPrompt = prompt;
        toolNames = tools.map((tool) => tool.name);
        const handlers = new Set<(event: any) => void>();
        const finalMessage = assistantMessage("analysis complete");

        return {
          subscribe(handler: (event: any) => void) {
            handlers.add(handler);
            return () => {
              handlers.delete(handler);
            };
          },
          async prompt(input: string) {
            promptText = input;

            for (const handler of handlers) {
              handler({
                type: "tool_execution_end",
                toolCallId: "tool-1",
                toolName: "query_findings",
                isError: false,
                result: {
                  content: [{ type: "text", text: "[]" }],
                  details: [{ queryid: "101", severity: "high" }],
                },
              });
              handler({
                type: "message_update",
                message: finalMessage,
                assistantMessageEvent: {
                  type: "text_delta",
                  contentIndex: 0,
                  delta: "analysis complete",
                  partial: finalMessage,
                },
              });
              handler({
                type: "message_end",
                message: finalMessage,
              });
              handler({
                type: "agent_end",
                messages: [finalMessage],
              });
            }
          },
          async waitForIdle() {},
        };
      },
    },
  );

  await executor.execute(
    { userMessage: { text: "users report slow checkout" } } as any,
    {
      enqueueEvent(event: unknown) {
        events.push(event);
      },
    },
  );

  assert.equal(promptText, "users report slow checkout");
  assert.equal(/memory/i.test(systemPrompt), false);
  assert.equal(toolNames.includes("query_findings"), true);
  assert.equal(toolNames.includes("search_memory"), false);
  assert.equal(toolNames.includes("record_memory"), false);
  assert.deepEqual(events, [
    { type: "working", message: "analysis started" },
    {
      type: "completed",
      result: {
        findings: [{ queryid: "101", severity: "high" }],
        response: "analysis complete",
        toolResults: [
          {
            toolName: "query_findings",
            details: [{ queryid: "101", severity: "high" }],
          },
        ],
      },
    },
  ]);
});

test("executor publishes submitted, working, and completed events on the A2A bus", async () => {
  const events: Array<any> = [];
  let finished = false;
  const executor = new DBSpecialistExecutor(
    {
      clickhouseTool: {
        listTables: async () => ["query_events"],
        describeTable: async () => "fingerprint\tString",
        executeQuery: async () => "fingerprint\tabc",
        queryFindings: async () => [],
      },
    } as any,
    {
      createAgent: () => {
        const handlers = new Set<(event: any) => void>();
        const finalMessage = assistantMessage("loop finished");

        return {
          subscribe(handler: (event: any) => void) {
            handlers.add(handler);
            return () => {
              handlers.delete(handler);
            };
          },
          async prompt() {
            for (const handler of handlers) {
              handler({
                type: "message_update",
                message: finalMessage,
                assistantMessageEvent: {
                  type: "text_delta",
                  contentIndex: 0,
                  delta: "loop finished",
                  partial: finalMessage,
                },
              });
              handler({
                type: "message_end",
                message: finalMessage,
              });
              handler({
                type: "agent_end",
                messages: [finalMessage],
              });
            }
          },
          async waitForIdle() {},
        };
      },
    },
  );

  await executor.execute(
    {
      taskId: "task-123",
      contextId: "context-123",
      userMessage: { text: "analyze_db" },
    } as any,
    {
      publish(event: unknown) {
        events.push(event);
      },
      on() {
        return this;
      },
      off() {
        return this;
      },
      once() {
        return this;
      },
      removeAllListeners() {
        return this;
      },
      finished() {
        finished = true;
      },
    } as any,
  );

  assert.equal(finished, true);
  assert.deepEqual(events, [
    {
      kind: "task",
      id: "task-123",
      contextId: "context-123",
      status: {
        state: "submitted",
        timestamp: events[0]?.status?.timestamp,
      },
      history: [{ text: "analyze_db" }],
    },
    {
      kind: "status-update",
      taskId: "task-123",
      contextId: "context-123",
      status: { state: "working", timestamp: events[1]?.status?.timestamp },
      final: false,
    },
    {
      kind: "status-update",
      taskId: "task-123",
      contextId: "context-123",
      status: {
        state: "completed",
        timestamp: events[2]?.status?.timestamp,
        message: {
          kind: "message",
          messageId: "task-123-completed",
          role: "agent",
          taskId: "task-123",
          contextId: "context-123",
          parts: [
            {
              kind: "data",
              data: {
                findings: [],
                response: "loop finished",
                toolResults: [],
              },
            },
          ],
        },
      },
      final: true,
    },
  ]);
});

test("executor preserves structured tool outcomes in the completed payload", async () => {
  const events: Array<unknown> = [];
  const executor = new DBSpecialistExecutor(
    {
      clickhouseTool: {
        listTables: async () => ["query_events"],
        describeTable: async () => "fingerprint\tString",
        executeQuery: async () => "fingerprint\tabc",
        queryFindings: async () => [],
      },
    } as any,
    {
      createAgent: () => {
        const handlers = new Set<(event: any) => void>();
        const finalMessage = assistantMessage("loop finished");

        return {
          subscribe(handler: (event: any) => void) {
            handlers.add(handler);
            return () => {
              handlers.delete(handler);
            };
          },
          async prompt() {
            for (const handler of handlers) {
              handler({
                type: "tool_execution_end",
                toolCallId: "tool-1",
                toolName: "analyze_query",
                isError: false,
                result: {
                  content: [{ type: "text", text: "{\"validated\":true}" }],
                  details: { validated: true, plan_rows: [{ "QUERY PLAN": "Index Scan" }] },
                },
              });
              handler({
                type: "tool_execution_end",
                toolCallId: "tool-2",
                toolName: "apply_fix",
                isError: false,
                result: {
                  content: [{ type: "text", text: "{\"branchName\":\"agent/demo-fix-fp-1\"}" }],
                  details: { branchName: "agent/demo-fix-fp-1", diff: "diff --git a/file b/file" },
                },
              });
              handler({
                type: "tool_execution_end",
                toolCallId: "tool-3",
                toolName: "open_pull_request",
                isError: false,
                result: {
                  content: [{ type: "text", text: "{\"url\":\"https://example.test/pr/1\"}" }],
                  details: { url: "https://example.test/pr/1" },
                },
              });
              handler({
                type: "message_end",
                message: finalMessage,
              });
              handler({
                type: "agent_end",
                messages: [finalMessage],
              });
            }
          },
          async waitForIdle() {},
        };
      },
    },
  );

  await executor.execute(
    { userMessage: { text: "analyze_db" } } as any,
    {
      enqueueEvent(event: unknown) {
        events.push(event);
      },
    },
  );

  assert.deepEqual(events.at(-1), {
    type: "completed",
    result: {
      findings: [],
      response: "loop finished",
      toolResults: [
        {
          toolName: "analyze_query",
          details: { validated: true, plan_rows: [{ "QUERY PLAN": "Index Scan" }] },
        },
        {
          toolName: "apply_fix",
          details: { branchName: "agent/demo-fix-fp-1", diff: "diff --git a/file b/file" },
        },
        {
          toolName: "open_pull_request",
          details: { url: "https://example.test/pr/1" },
        },
      ],
    },
  });
});

test("executor can run through the default pi-agent-core agent path with a local streamFn", async () => {
  const events: Array<unknown> = [];
  const executor = new DBSpecialistExecutor(
    {
      clickhouseTool: {
        listTables: async () => ["query_events"],
        describeTable: async () => "fingerprint\tString",
        executeQuery: async () => "fingerprint\tabc",
        queryFindings: async () => [{ queryid: "201", severity: "high" }],
      },
    } as any,
    {
      env: { LLM_MODEL: "openai/gpt-4o-mini" },
      streamFn: async (_model, context) => {
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          const toolResultSeen = context.messages.some(
            (message) => message.role === "toolResult" && message.toolName === "query_findings",
          );
          if (!toolResultSeen) {
            const partial = assistantMessage("");
            const toolCall = {
              type: "toolCall" as const,
              id: "tool-1",
              name: "query_findings",
              arguments: { scope: "analyze_db" },
            };
            const message = {
              ...assistantMessage(""),
              content: [toolCall],
              stopReason: "toolUse" as const,
            };
            stream.push({ type: "start", partial });
            stream.push({ type: "toolcall_start", contentIndex: 0, partial });
            stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
            stream.push({ type: "done", reason: "toolUse", message });
            return;
          }

          const partial = assistantMessage("");
          const message = assistantMessage("agent path complete");
          stream.push({ type: "start", partial });
          stream.push({ type: "text_start", contentIndex: 0, partial });
          stream.push({
            type: "text_delta",
            contentIndex: 0,
            delta: "agent path complete",
            partial: message,
          });
          stream.push({
            type: "text_end",
            contentIndex: 0,
            content: "agent path complete",
            partial: message,
          });
          stream.push({ type: "done", reason: "stop", message });
        });
        return stream;
      },
    },
  );

  await executor.execute(
    { userMessage: { text: "analyze_db" } } as any,
    {
      enqueueEvent(event: unknown) {
        events.push(event);
      },
    },
  );

  assert.deepEqual(events.at(-1), {
    type: "completed",
    result: {
      findings: [{ queryid: "201", severity: "high" }],
      response: "agent path complete",
      toolResults: [
        {
          toolName: "query_findings",
          details: [{ queryid: "201", severity: "high" }],
        },
      ],
    },
  });
});

test("executor publishes failed status and closes stream when agent.prompt throws", async () => {
  const events: Array<unknown> = [];
  const executor = new DBSpecialistExecutor(
    {
      clickhouseTool: {
        listTables: async () => [],
        describeTable: async () => "",
        executeQuery: async () => "",
        queryFindings: async () => [],
      },
    } as any,
    {
      createAgent: () => ({
        subscribe: () => () => {},
        prompt: async () => {
          throw new Error("LLM provider unavailable");
        },
        waitForIdle: async () => {},
      }),
    },
  );

  await executor.execute(
    { userMessage: { text: "analyze_db" } } as any,
    {
      enqueueEvent(event: unknown) {
        events.push(event);
      },
    },
  );

  assert.deepEqual(events, [
    { type: "working", message: "analysis started" },
    { type: "failed", error: "Error: LLM provider unavailable" },
  ]);
});

test("cancelTask cancels only the matching active task and publishes canceled status", async () => {
  const aborts: Array<string> = [];
  const releases = new Map<string, () => void>();
  const executor = new DBSpecialistExecutor(
    {
      clickhouseTool: {
        listTables: async () => ["query_events"],
        describeTable: async () => "fingerprint\tString",
        executeQuery: async () => "fingerprint\tabc",
        queryFindings: async () => [],
      },
    } as any,
    {
      createAgent: () => {
        const handlers = new Set<(event: any) => void>();
        let promptText = "";

        return {
          subscribe(handler: (event: any) => void) {
            handlers.add(handler);
            return () => {
              handlers.delete(handler);
            };
          },
          async prompt(input: string) {
            promptText = input;
            await new Promise<void>((resolve) => {
              releases.set(input, resolve);
            });
            for (const handler of handlers) {
              handler({ type: "agent_end", messages: [] });
            }
          },
          abort() {
            aborts.push(promptText);
          },
          async waitForIdle() {},
        };
      },
    },
  );

  const first = executor.execute(
    {
      taskId: "task-1",
      contextId: "context-1",
      userMessage: { text: "first task" },
    } as any,
    {
      publish() {},
      on() {
        return this;
      },
      off() {
        return this;
      },
      once() {
        return this;
      },
      removeAllListeners() {
        return this;
      },
      finished() {},
    } as any,
  );
  const second = executor.execute(
    {
      taskId: "task-2",
      contextId: "context-2",
      userMessage: { text: "second task" },
    } as any,
    {
      publish() {},
      on() {
        return this;
      },
      off() {
        return this;
      },
      once() {
        return this;
      },
      removeAllListeners() {
        return this;
      },
      finished() {},
    } as any,
  );

  await new Promise((resolve) => setTimeout(resolve, 0));

  const cancelEvents: Array<any> = [];
  let finished = false;
  await executor.cancelTask(
    "task-2",
    {
      publish(event: unknown) {
        cancelEvents.push(event);
      },
      on() {
        return this;
      },
      off() {
        return this;
      },
      once() {
        return this;
      },
      removeAllListeners() {
        return this;
      },
      finished() {
        finished = true;
      },
    } as any,
  );

  releases.get("first task")?.();
  releases.get("second task")?.();
  await Promise.all([first, second]);

  assert.deepEqual(aborts, ["second task"]);
  assert.equal(finished, true);
  assert.deepEqual(cancelEvents, [
    {
      kind: "status-update",
      taskId: "task-2",
      contextId: "context-2",
      status: {
        state: "canceled",
        timestamp: cancelEvents[0]?.status?.timestamp,
      },
      final: true,
    },
  ]);
});

function assistantMessage(text: string) {
  return {
    role: "assistant" as const,
    api: "openai-responses",
    provider: "openai",
    model: "gpt-4o-mini",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
    content: [{ type: "text" as const, text }],
  };
}
