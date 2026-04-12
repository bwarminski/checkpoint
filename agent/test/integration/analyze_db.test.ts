// ABOUTME: Exercises the HTTP A2A stream for analyze_db against the loop-backed executor path.
// ABOUTME: Verifies submitted, working, and completed events survive the JSON-RPC transport.
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { DBSpecialistExecutor } from "../../src/executor.ts";
import { createServer } from "../../src/server.ts";

test("analyze_db publishes submitted, working, and completed events through the pi-agent-core path", async () => {
  const executor = buildMockLoopExecutor();
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
    const results = payloads.map((payload) => payload.result).filter(Boolean);

    assert.equal(response.ok, true);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/i);
    assert.equal(results.some((result) => result?.kind === "task"), true);
    assert.equal(results.some((result) => result?.status?.state === "working"), true);
    assert.equal(results.some((result) => result?.status?.state === "completed"), true);
    assert.deepEqual(results.at(-1)?.status?.message?.parts?.[0]?.data, {
      findings: [{ fingerprint: "fp-loop", severity: "high" }],
      response: "loop complete",
      toolResults: [
        {
          toolName: "query_findings",
          details: [{ fingerprint: "fp-loop", severity: "high" }],
        },
      ],
    });
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

function buildMockLoopExecutor(): DBSpecialistExecutor {
  return new DBSpecialistExecutor(
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
        const finalMessage = assistantMessage("loop complete");

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
                toolName: "query_findings",
                isError: false,
                result: {
                  content: [{ type: "text", text: "[]" }],
                  details: [{ fingerprint: "fp-loop", severity: "high" }],
                },
              });
              handler({
                type: "message_update",
                message: finalMessage,
                assistantMessageEvent: {
                  type: "text_delta",
                  contentIndex: 0,
                  delta: "loop complete",
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
}

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
