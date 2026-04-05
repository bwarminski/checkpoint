// ABOUTME: Verifies the executor emits the minimal lifecycle events for Gate A.
// ABOUTME: Keeps the agent scaffold honest before later orchestration is added.
import assert from "node:assert/strict";
import test from "node:test";

import { DBSpecialistExecutor } from "../src/executor.ts";

test("DBSpecialistExecutor emits working and completed events", async () => {
  const events: Array<unknown> = [];
  const executor = new DBSpecialistExecutor({
    clickhouseTool: {
      topOffenders: async () => [],
    },
  } as any);

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
                      summary:
                        "Add an index for the user_id filter used at /app/controllers/todos_controller.rb:12.",
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

test("DBSpecialistExecutor passes source_tag to code search when source_file is missing", async () => {
  const locateCalls: Array<{ source_file?: string | null; source_tag?: string | null }> = [];
  const executor = new DBSpecialistExecutor({
    clickhouseTool: {
      topOffenders: async () => [
        {
          fingerprint: "fp-tagged",
          sample_query: "SELECT * FROM todos WHERE status = 'open'",
          severity: "high",
          source_tag: "todos#status",
        },
      ],
    },
    codeSearchTool: {
      locate: async (input: { source_file?: string | null; source_tag?: string | null }) => {
        locateCalls.push(input);
        return {
          content: "1: class TodosController < ApplicationController",
          source_file: "app/controllers/todos_controller.rb:1",
        };
      },
    },
    explainTool: {
      analyze: async () => ({ validated: true }),
    },
    memoryTool: {
      shouldSuggest: async () => true,
    },
    githubTool: {
      openPullRequest: async () => ({ url: "https://example.test/pr/2" }),
    },
  } as any);

  const events: Array<any> = [];
  await executor.execute(
    { userMessage: { text: "analyze_db" } } as any,
    {
      enqueueEvent(event: unknown) {
        events.push(event);
      },
    },
  );

  assert.deepEqual(locateCalls, [{ source_file: undefined, source_tag: "todos#status" }]);
  assert.equal(
    events[1]?.result?.findings?.[0]?.source?.source_file,
    "app/controllers/todos_controller.rb:1",
  );
});

test("DBSpecialistExecutor classifies multiple fix types from traced source content", async () => {
  const executor = new DBSpecialistExecutor({
    clickhouseTool: {
      topOffenders: async () => [
        {
          fingerprint: "fp-like",
          sample_query: "SELECT * FROM todos WHERE title LIKE '%foo%'",
          severity: "medium",
          source_file: "/app/controllers/todos_controller.rb:4",
        },
        {
          fingerprint: "fp-count",
          sample_query: "SELECT COUNT(*) FROM todos WHERE user_id = 1",
          severity: "medium",
          source_file: "/app/controllers/todos_controller.rb:12",
        },
      ],
    },
    codeSearchTool: {
      locate: async ({ source_file }: { source_file?: string | null }) => {
        if (source_file?.includes(":4")) {
          return {
            content: "4: todos = params[:q].present? ? Todo.where(\"title LIKE ?\", \"%#{params[:q]}%\") : Todo.all",
            source_file,
          };
        }

        return {
          content: "12: render json: User.all.index_with { |user| user.todos.count }",
          source_file: source_file ?? "app/controllers/todos_controller.rb:12",
        };
      },
    },
    explainTool: {
      analyze: async () => ({ validated: true }),
    },
    memoryTool: {
      shouldSuggest: async () => true,
    },
  } as any);

  const events: Array<any> = [];
  await executor.execute(
    { userMessage: { text: "analyze_db" } } as any,
    {
      enqueueEvent(event: unknown) {
        events.push(event);
      },
    },
  );

  assert.deepEqual(
    events[1]?.result?.findings?.map((finding: any) => finding.fix.fix_type),
    ["rewrite_like", "rewrite_count"],
  );
});

test("DBSpecialistExecutor prepares the demo repo branch before opening a PR", async () => {
  const callOrder: Array<string> = [];
  const executor = new DBSpecialistExecutor({
    clickhouseTool: {
      topOffenders: async () => [
        {
          fingerprint: "fp-pr",
          sample_query: "SELECT * FROM todos WHERE status = 'open'",
          severity: "high",
          source_file: "/app/controllers/todos_controller.rb:9",
          source_tag: "todos#status",
        },
      ],
    },
    codeSearchTool: {
      locate: async ({ source_file }: { source_file?: string | null }) => ({
        content: "9:   def status\n10:     render json: Todo.where(status: params.fetch(:status, \"open\"))\n11:   end",
        source_file: source_file ?? "app/controllers/todos_controller.rb:9",
      }),
    },
    explainTool: {
      analyze: async () => ({ validated: true }),
    },
    memoryTool: {
      shouldSuggest: async () => true,
    },
    demoRepoTool: {
      applyFix: async () => {
        callOrder.push("prepare");
      },
    },
    githubTool: {
      openPullRequest: async () => {
        callOrder.push("open");
        return { url: "https://example.test/pr/99" };
      },
    },
  } as any);

  await executor.execute(
    { userMessage: { text: "analyze_db" } } as any,
    {
      enqueueEvent() {},
    },
  );

  assert.deepEqual(callOrder, ["prepare", "open"]);
});
