// ABOUTME: Exercises the HTTP A2A stream for the analyze_table command against the local service.
// ABOUTME: Verifies non-high findings stay reported without opening a pull request over the wire.
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { DBSpecialistExecutor } from "../../src/executor.ts";
import { createServer } from "../../src/server.ts";

function buildOffenderTsv(): string {
  return [
    "fingerprint\tsource_tag\tsource_file\tsample_query\ttotal_exec_count\ttotal_exec_time_ms\tp95_exec_time_ms",
    "fp-medium\ttodos#status\t/app/models/todo.rb:5\tSELECT * FROM todos WHERE status = 'open'\t6\t88.5\t30",
    "",
  ].join("\n");
}

test("analyze_table streams reported findings without opening a PR", async () => {
  const queries: Array<string> = [];
  const executor = new DBSpecialistExecutor({
    clickhouseTool: {
      executeQuery: async (sql: string) => {
        queries.push(sql);
        return buildOffenderTsv();
      },
    },
    codeSearchTool: {
      locate: async ({ source_file }: { source_file: string }) => ({
        content:
          "4: class Todo < ApplicationRecord\n5: scope :open, -> { where(status: 'open') }\n6: end",
        source_file,
      }),
    },
    explainTool: {
      analyze: async () => ({ planDiff: "unchanged", validated: true }),
    },
    githubTool: {
      openPullRequest: async () => ({ url: "https://example.test/pr/2" }),
    },
    memoryTool: {
      shouldSuggest: async () => true,
    },
  } as any);
  const { app } = createServer({
    baseUrl: "http://127.0.0.1",
    executor,
  });
  const server = app.listen(0, "127.0.0.1");
  let listening = false;

  try {
    await once(server, "listening");
    listening = true;
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/a2a/jsonrpc`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req-analyze-table",
        method: "message/stream",
        params: {
          message: {
            kind: "message",
            messageId: "message-analyze-table",
            role: "user",
            parts: [{ kind: "text", text: "analyze_table todos" }],
          },
        },
      }),
    });
    const payloads = await readSsePayloads(response);
    const completed = payloads.at(-1)?.result;

    assert.equal(response.ok, true);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/i);
    assert.match(queries[0] ?? "", /FROM query_events/);
    assert.match(queries[0] ?? "", /source_tag ILIKE 'todos#%'/);
    assert.equal(completed?.kind, "status-update");
    assert.equal(completed?.status?.state, "completed");
    assert.deepEqual(completed?.status?.message?.parts?.[0]?.data?.findings, [
      {
        decision: "reported",
        fingerprint: "fp-medium",
        fix: {
          fix_type: "add_index",
          summary: "Add an index for the status filter used at /app/models/todo.rb:5.",
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
    ]);
  } finally {
    if (listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  }
});

async function readSsePayloads(response: Response): Promise<Array<any>> {
  const body = await response.text();

  return body
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice("data: ".length))
        .join("\n"),
    )
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
