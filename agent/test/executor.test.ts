// ABOUTME: Verifies the executor bridges pi-agent-core loop events onto the A2A lifecycle.
// ABOUTME: Keeps the executor transport-agnostic while preserving submitted, working, and completed events.
import assert from "node:assert/strict";
import test from "node:test";

import { DBSpecialistExecutor } from "../src/executor.ts";

test("executor bridges pi-agent-core events into working and completed task events", async () => {
  const events: Array<unknown> = [];
  let promptText = "";
  let toolNames: Array<string> = [];
  const executor = new DBSpecialistExecutor(
    {
      clickhouseTool: {
        listTables: async () => ["query_events"],
        describeTable: async () => "fingerprint\tString",
        executeQuery: async () => "fingerprint\tabc",
        queryFindings: async () => [],
      },
      memoryTool: {
        search: async () => [],
        record: async () => {},
      },
    } as any,
    {
      createAgent: ({ tools }) => {
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
                  details: [{ fingerprint: "fp-1", severity: "high" }],
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
  assert.equal(toolNames.includes("query_findings"), true);
  assert.equal(toolNames.includes("search_memory"), true);
  assert.deepEqual(events, [
    { type: "working", message: "analysis started" },
    {
      type: "completed",
      result: {
        findings: [{ fingerprint: "fp-1", severity: "high" }],
        response: "analysis complete",
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
      memoryTool: {
        search: async () => [],
        record: async () => {},
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
              },
            },
          ],
        },
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

