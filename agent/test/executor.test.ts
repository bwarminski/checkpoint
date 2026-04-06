// ABOUTME: Verifies the executor emits the minimal lifecycle events for Gate A.
// ABOUTME: Keeps the agent scaffold honest while ClickHouse queries flow through raw TSV output.
import assert from "node:assert/strict";
import test from "node:test";

import { DBSpecialistExecutor } from "../src/executor.ts";

function buildOffenderTsv(
  rows: Array<{
    fingerprint: string;
    p95_exec_time_ms: number;
    sample_query: string;
    source_file?: string;
    source_tag?: string;
    total_exec_count: number;
    total_exec_time_ms: number;
  }>,
): string {
  const header = [
    "fingerprint",
    "source_tag",
    "source_file",
    "sample_query",
    "total_exec_count",
    "total_exec_time_ms",
    "p95_exec_time_ms",
  ];

  return [
    header.join("\t"),
    ...rows.map((row) =>
      [
        row.fingerprint,
        row.source_tag ?? "\\N",
        row.source_file ?? "\\N",
        row.sample_query,
        row.total_exec_count,
        row.total_exec_time_ms,
        row.p95_exec_time_ms,
      ].join("\t"),
    ),
    "",
  ].join("\n");
}

test("DBSpecialistExecutor emits working and completed events", async () => {
  const queries: Array<string> = [];
  const events: Array<unknown> = [];
  const executor = new DBSpecialistExecutor({
    clickhouseTool: {
      executeQuery: async (sql: string) => {
        queries.push(sql);
        return buildOffenderTsv([]);
      },
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

  assert.match(queries[0] ?? "", /FROM query_events/);
  assert.deepEqual(events, [
    { type: "working", message: "analysis started" },
    { type: "completed", result: { findings: [] } },
  ]);
});

test("DBSpecialistExecutor publishes findings on the A2A event bus", async () => {
  const queries: Array<string> = [];
  const events: Array<any> = [];
  let finished = false;
  const executor = new DBSpecialistExecutor({
    clickhouseTool: {
      executeQuery: async (sql: string) => {
        queries.push(sql);
        return buildOffenderTsv([
          {
            fingerprint: "fp-a2a",
            sample_query: "SELECT * FROM todos WHERE user_id = 7",
            source_file: "/app/controllers/todos_controller.rb:12",
            total_exec_count: 9,
            total_exec_time_ms: 301.5,
            p95_exec_time_ms: 120,
          },
        ]);
      },
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

  assert.match(queries[0] ?? "", /FROM query_events/);
  assert.match(queries[0] ?? "", /source_tag IS NOT NULL/);
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
  const queries: Array<string> = [];
  const executor = new DBSpecialistExecutor({
    clickhouseTool: {
      executeQuery: async (sql: string) => {
        queries.push(sql);
        return buildOffenderTsv([
          {
            fingerprint: "fp-tagged",
            sample_query: "SELECT * FROM todos WHERE status = 'open'",
            source_tag: "todos#status",
            total_exec_count: 4,
            total_exec_time_ms: 40,
            p95_exec_time_ms: 12,
          },
        ]);
      },
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

  assert.match(queries[0] ?? "", /FROM query_events/);
  assert.deepEqual(locateCalls, [{ source_file: undefined, source_tag: "todos#status" }]);
  assert.equal(
    events[1]?.result?.findings?.[0]?.source?.source_file,
    "app/controllers/todos_controller.rb:1",
  );
});

test("DBSpecialistExecutor classifies multiple fix types from traced source content", async () => {
  const executor = new DBSpecialistExecutor({
    clickhouseTool: {
      executeQuery: async () =>
        buildOffenderTsv([
          {
            fingerprint: "fp-like",
            sample_query: "SELECT * FROM todos WHERE title LIKE '%foo%'",
            source_file: "/app/controllers/todos_controller.rb:4",
            total_exec_count: 5,
            total_exec_time_ms: 80,
            p95_exec_time_ms: 22,
          },
          {
            fingerprint: "fp-count",
            sample_query: "SELECT COUNT(*) FROM todos WHERE user_id = 1",
            source_file: "/app/controllers/todos_controller.rb:12",
            total_exec_count: 8,
            total_exec_time_ms: 120,
            p95_exec_time_ms: 18,
          },
          {
            fingerprint: "fp-includes",
            sample_query: "SELECT * FROM todos JOIN users ON users.id = todos.user_id",
            source_file: "/app/controllers/todos_controller.rb:3",
            total_exec_count: 2,
            total_exec_time_ms: 40,
            p95_exec_time_ms: 10,
          },
        ]),
    },
    codeSearchTool: {
      locate: async ({ source_file }: { source_file?: string | null }) => {
        if (source_file?.includes(":4")) {
          return {
            content: "4: todos = params[:q].present? ? Todo.where(\"title LIKE ?\", \"%#{params[:q]}%\") : Todo.all",
            source_file,
          };
        }

        if (source_file?.includes(":3")) {
          return {
            content:
              "3: todos = params[:q].present? ? Todo.where(...) : Todo.all\n4: todos.each { |t| t.user.name }",
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
    ["rewrite_like", "rewrite_count", "add_includes"],
  );
});

test("DBSpecialistExecutor passes demo repo branch and diff metadata to GitHubTool", async () => {
  const openPullRequestCalls: Array<any> = [];
  const applyFixCalls: Array<any> = [];
  const executor = new DBSpecialistExecutor({
    clickhouseTool: {
      executeQuery: async () =>
        buildOffenderTsv([
          {
            fingerprint: "fp-pr",
            sample_query: "SELECT * FROM todos WHERE title LIKE '%foo%'",
            source_file: "/app/controllers/todos_controller.rb:4",
            total_exec_count: 4,
            total_exec_time_ms: 240,
            p95_exec_time_ms: 140,
          },
        ]),
    },
    codeSearchTool: {
      locate: async ({ source_file }: { source_file?: string | null }) => ({
        content:
          "4: todos = params[:q].present? ? Todo.where(\"title LIKE ?\", \"%#{params[:q]}%\") : Todo.all",
        source_file: source_file ?? "app/controllers/todos_controller.rb:4",
      }),
    },
    explainTool: {
      analyze: async () => ({ validated: true }),
    },
    memoryTool: {
      shouldSuggest: async () => true,
    },
    demoRepoTool: {
      applyFix: async (input: any) => {
        applyFixCalls.push(input);
        return {
          branchName: "agent/demo-fix-fp-pr",
          diff: "diff --git a/app/controllers/todos_controller.rb b/app/controllers/todos_controller.rb",
        };
      },
    },
    githubTool: {
      openPullRequest: async (input: any) => {
        openPullRequestCalls.push(input);
        return { url: "https://example.test/pr/3" };
      },
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

  assert.equal(applyFixCalls.length, 1);
  assert.deepEqual(openPullRequestCalls[0], {
    finding: {
      fingerprint: "fp-pr",
      sample_query: "SELECT * FROM todos WHERE title LIKE '%foo%'",
      source_file: "/app/controllers/todos_controller.rb:4",
      source_tag: null,
      total_exec_count: 4,
      total_exec_time_ms: 240,
      p95_exec_time_ms: 140,
      severity: "high",
    },
    fix: {
      fix_type: "rewrite_like",
      summary: "Replace the leading-wildcard LIKE search with a searchable alternative.",
    },
    source: {
      content:
        "4: todos = params[:q].present? ? Todo.where(\"title LIKE ?\", \"%#{params[:q]}%\") : Todo.all",
      source_file: "/app/controllers/todos_controller.rb:4",
    },
    validation: { validated: true },
    headRef: "agent/demo-fix-fp-pr",
    codeDiff: "diff --git a/app/controllers/todos_controller.rb b/app/controllers/todos_controller.rb",
  });
});

test("DBSpecialistExecutor prepares the demo repo branch before opening a PR", async () => {
  const callOrder: Array<string> = [];
  const queries: Array<string> = [];
  const executor = new DBSpecialistExecutor({
    clickhouseTool: {
      executeQuery: async (sql: string) => {
        queries.push(sql);
        return buildOffenderTsv([
          {
            fingerprint: "fp-pr",
            sample_query: "SELECT * FROM todos WHERE status = 'open'",
            source_file: "/app/controllers/todos_controller.rb:9",
            source_tag: "todos#status",
            total_exec_count: 13,
            total_exec_time_ms: 210,
            p95_exec_time_ms: 140,
          },
        ]);
      },
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
    { userMessage: { text: "analyze_table todos all" } } as any,
    {
      enqueueEvent() {},
    },
  );

  assert.match(queries[0] ?? "", /FROM query_fingerprints/);
  assert.match(queries[0] ?? "", /WHERE source_tag IS NOT NULL AND source_tag ILIKE 'todos#%'/);
  assert.deepEqual(callOrder, ["prepare", "open"]);
});
