// ABOUTME: Exercises the HTTP A2A stream for the analyze_db command against the local service.
// ABOUTME: Verifies the completed SSE payload carries findings through the real JSON-RPC transport.
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { DBSpecialistExecutor } from "../../src/executor.ts";
import { createServer } from "../../src/server.ts";

test("analyze_db streams a completed finding payload over A2A", async () => {
  const executor = new DBSpecialistExecutor({
    clickhouseTool: {
      topOffenders: async (scope?: unknown) => {
        assert.equal(scope, "analyze_db");
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
      analyze: async () => ({ planDiff: "better", validated: true }),
    },
    githubTool: {
      openPullRequest: async () => ({ url: "https://example.test/pr/1" }),
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
        id: "req-analyze-db",
        method: "message/stream",
        params: {
          message: {
            kind: "message",
            messageId: "message-analyze-db",
            role: "user",
            parts: [{ kind: "text", text: "analyze_db" }],
          },
        },
      }),
    });
    const payloads = await readSsePayloads(response);
    const completed = payloads.at(-1)?.result;

    assert.equal(response.ok, true);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/i);
    assert.equal(completed?.kind, "status-update");
    assert.equal(completed?.status?.state, "completed");
    assert.deepEqual(completed?.status?.message?.parts?.[0]?.data?.findings, [
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
