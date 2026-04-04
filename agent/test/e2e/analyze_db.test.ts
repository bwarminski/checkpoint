// ABOUTME: Verifies the high-severity Step 8 flow opens a PR after validation.
// ABOUTME: Confirms offender lookup, source tracing, validation, and PR orchestration stay connected.
import assert from "node:assert/strict";
import test from "node:test";

import { DBSpecialistExecutor } from "../../src/executor.ts";

test("analyze_db opens a PR only for high severity validated findings", async () => {
  const events: Array<unknown> = [];
  const topOffenderScopes: Array<unknown> = [];
  const memoryCalls: Array<{ fingerprint: string; fixType: string }> = [];
  const validationCalls: Array<{ sql: string }> = [];
  const pullRequests: Array<unknown> = [];
  const executor = new DBSpecialistExecutor({
    clickhouseTool: {
      topOffenders: async (scope?: unknown) => {
        topOffenderScopes.push(scope);
        return [
          {
            fingerprint: "fp-high",
            sample_query: "SELECT * FROM todos WHERE user_id = 7",
            severity: "high",
            source_file: "/app/controllers/todos_controller.rb:12",
          },
        ];
      },
    },
    codeSearchTool: {
      locate: async ({ source_file }: { source_file: string }) => ({
        content: "11: before_action :load_user\n12: Todo.where(user_id: 7)\n13: end",
        source_file,
      }),
    },
    explainTool: {
      analyze: async ({ sql }: { sql: string }) => {
        validationCalls.push({ sql });
        return { planDiff: "better", validated: true };
      },
    },
    githubTool: {
      openPullRequest: async (input: unknown) => {
        pullRequests.push(input);
        return { url: "https://example.test/pr/1" };
      },
    },
    memoryTool: {
      shouldSuggest: async (input: { fingerprint: string; fixType: string }) => {
        memoryCalls.push(input);
        return true;
      },
    },
  } as any);

  await executor.execute(
    {
      userMessage: {
        parts: [{ kind: "text", text: "analyze_db" }],
      },
    } as any,
    {
      enqueueEvent(event: unknown) {
        events.push(event);
      },
    },
  );

  assert.deepEqual(topOffenderScopes, ["analyze_db"]);
  assert.deepEqual(memoryCalls, [{ fingerprint: "fp-high", fixType: "add_index" }]);
  assert.deepEqual(validationCalls, [{ sql: "SELECT * FROM todos WHERE user_id = 7" }]);
  assert.equal(pullRequests.length, 1);
  assert.deepEqual(events, [
    { type: "working", message: "analysis started" },
    {
      type: "completed",
      result: {
        findings: [
          {
            decision: "opened",
            fingerprint: "fp-high",
            fix: {
              fix_type: "add_index",
              summary: "Consider an index for /app/controllers/todos_controller.rb:12",
            },
            pr: { url: "https://example.test/pr/1" },
            severity: "high",
            source: {
              content: "11: before_action :load_user\n12: Todo.where(user_id: 7)\n13: end",
              source_file: "/app/controllers/todos_controller.rb:12",
            },
            validation: { planDiff: "better", validated: true },
          },
        ],
      },
    },
  ]);
});
