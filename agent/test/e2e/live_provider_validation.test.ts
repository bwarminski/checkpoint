// ABOUTME: Exercises the live provider loop against a running local stack without stream or agent mocks.
// ABOUTME: Skips cleanly unless the selected LLM provider credentials and local services are available.
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createServer } from "../../src/server.ts";

test("live provider analyze_db uses query_findings and completes the A2A request", async (t) => {
  const skipReason = missingLiveValidationRequirement();
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  await seedLiveValidationData();

  const { app } = createServer({
    baseUrl: "http://127.0.0.1",
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
        id: "req-live-provider",
        method: "message/stream",
        params: {
          message: {
            kind: "message",
            messageId: "message-live-provider",
            role: "user",
            parts: [{ kind: "text", text: "analyze_db and use query_findings before answering" }],
          },
        },
      }),
    });

    const payloads = await readSsePayloads(response);
    const results = payloads.map((payload) => payload.result).filter(Boolean);
    const completed = results.at(-1);
    const data = completed?.status?.message?.parts?.[0]?.data;

    assert.equal(response.ok, true);
    assert.equal(completed?.status?.state, "completed");
    assert.equal(
      Array.isArray(data?.toolResults) &&
      data.toolResults.some((tool: { toolName?: string }) => tool.toolName === "query_findings"),
      true,
    );
    assert.equal(typeof data?.response, "string");
    assert.notEqual(data?.response?.trim(), "");
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

function missingLiveValidationRequirement(): string | null {
  const modelRef = process.env.LLM_MODEL;
  if (!modelRef) {
    return "LLM_MODEL is not set";
  }

  const [provider] = modelRef.split("/", 1);
  const providerKey = providerApiKeyEnv(provider);
  if (providerKey === undefined) {
    return `live validation does not have a credential mapping for ${provider}`;
  }
  if (providerKey && !process.env[providerKey]) {
    return `${providerKey} is not set for ${provider}`;
  }

  return null;
}

function providerApiKeyEnv(provider: string): string | null | undefined {
  switch (provider) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "google":
      return "GOOGLE_API_KEY";
    case "ollama":
      return null;
    case "openai":
      return "OPENAI_API_KEY";
    default:
      return undefined;
  }
}

async function seedLiveValidationData(): Promise<void> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL ?? "http://127.0.0.1:8123";
  const truncateEvents = "TRUNCATE TABLE query_events";
  const truncateFingerprints = "TRUNCATE TABLE query_fingerprints";
  const insertFixture = [
    "INSERT INTO query_events",
    "(",
    "  collected_at, fingerprint, source_tag, source_file, sample_query, total_exec_count, mean_exec_time_ms,",
    "  rows_returned_or_affected, shared_blks_hit, shared_blks_read, local_blks_hit, local_blks_read,",
    "  temp_blks_read, temp_blks_written, total_block_accesses, mean_block_accesses_per_call",
    ") VALUES (",
    "  now(), 'fp-live-provider', 'todos#index', '/app/controllers/todos_controller.rb:12',",
    "  'SELECT * FROM todos', 7, 125.5, 20, 100, 40, 0, 0, 3, 2, 145, 20.714285714285715",
    ")",
  ].join(" ");

  await runClickHouseQuery(clickhouseUrl, truncateEvents);
  await runClickHouseQuery(clickhouseUrl, truncateFingerprints);
  await runClickHouseQuery(clickhouseUrl, insertFixture);
}

async function runClickHouseQuery(baseUrl: string, sql: string): Promise<void> {
  const response = await fetch(`${baseUrl}/?query=${encodeURIComponent(sql)}`);
  if (!response.ok) {
    throw new Error(`ClickHouse query failed: ${response.status} ${response.statusText}`);
  }
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
