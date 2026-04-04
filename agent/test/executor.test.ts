// ABOUTME: Verifies the executor emits the minimal lifecycle events for Gate A.
// ABOUTME: Keeps the agent scaffold honest before later orchestration is added.
import assert from "node:assert/strict";
import test from "node:test";

import { DBSpecialistExecutor } from "../src/executor.ts";

test("DBSpecialistExecutor emits working and completed events", async () => {
  const events: Array<unknown> = [];
  const executor = new DBSpecialistExecutor();

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
    { type: "completed", result: { findings: [] } },
  ]);
});

test("DBSpecialistExecutor publishes findings on the A2A event bus", async () => {
  const events: Array<any> = [];
  let finished = false;
  const executor = new DBSpecialistExecutor({
    clickhouseTool: {
      topOffenders: async () => [
        {
          fingerprint: "fp-a2a",
          sample_query: "SELECT * FROM todos WHERE user_id = 7",
          severity: "high",
          source_file: "/app/controllers/todos_controller.rb:12",
        },
      ],
    },
    codeSearchTool: {
      locate: async ({ source_file }: { source_file: string }) => ({
        content: "12: Todo.where(user_id: 7)",
        source_file,
      }),
    },
    explainTool: {
      analyze: async () => ({ validated: true }),
    },
    memoryTool: {
      shouldSuggest: async () => true,
    },
    githubTool: {
      openPullRequest: async () => ({ url: "https://example.test/pr/1" }),
    },
  } as any);

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
                findings: [
                  {
                    decision: "opened",
                    fingerprint: "fp-a2a",
                    fix: {
                      fix_type: "add_index",
                      summary: "Consider an index for /app/controllers/todos_controller.rb:12",
                    },
                    pr: { url: "https://example.test/pr/1" },
                    severity: "high",
                    source: {
                      content: "12: Todo.where(user_id: 7)",
                      source_file: "/app/controllers/todos_controller.rb:12",
                    },
                    validation: { validated: true },
                  },
                ],
              },
            },
          ],
        },
      },
      final: true,
    },
  ]);
});
