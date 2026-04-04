// ABOUTME: Verifies Step 8 still reports traced findings when the PR rule rejects them.
// ABOUTME: Confirms low-severity results do not open pull requests after validation.
import assert from "node:assert/strict";
import test from "node:test";

import { DBSpecialistExecutor } from "../../src/executor.ts";

test("analyze_table reports findings without opening a PR when severity is not high", async () => {
  const events: Array<unknown> = [];
  const pullRequests: Array<unknown> = [];
  const executor = new DBSpecialistExecutor({
    clickhouseTool: {
      topOffenders: async (scope?: unknown) => {
        assert.equal(scope, "analyze_table todos");
        return [
          {
            fingerprint: "fp-medium",
            sample_query: "SELECT * FROM todos WHERE status = 'open'",
            severity: "medium",
            source_file: "/app/models/todo.rb:5",
          },
        ];
      },
    },
    codeSearchTool: {
      locate: async ({ source_file }: { source_file: string }) => ({
        content: "4: class Todo < ApplicationRecord\n5: scope :open, -> { where(status: 'open') }\n6: end",
        source_file,
      }),
    },
    explainTool: {
      analyze: async () => ({ planDiff: "unchanged", validated: true }),
    },
    githubTool: {
      openPullRequest: async (input: unknown) => {
        pullRequests.push(input);
        return { url: "https://example.test/pr/2" };
      },
    },
    memoryTool: {
      shouldSuggest: async () => true,
    },
  } as any);

  await executor.execute(
    {
      userMessage: {
        parts: [{ kind: "text", text: "analyze_table todos" }],
      },
    } as any,
    {
      enqueueEvent(event: unknown) {
        events.push(event);
      },
    },
  );

  assert.equal(pullRequests.length, 0);
  assert.deepEqual(events, [
    { type: "working", message: "analysis started" },
    {
      type: "completed",
      result: {
        findings: [
          {
            decision: "reported",
            fingerprint: "fp-medium",
            fix: {
              fix_type: "add_index",
              summary: "Consider an index for /app/models/todo.rb:5",
            },
            pr: null,
            severity: "medium",
            source: {
              content:
                "4: class Todo < ApplicationRecord\n5: scope :open, -> { where(status: 'open') }\n6: end",
              source_file: "/app/models/todo.rb:5",
            },
            validation: { planDiff: "unchanged", validated: true },
          },
        ],
      },
    },
  ]);
});
