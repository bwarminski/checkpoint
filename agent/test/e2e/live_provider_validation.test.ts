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
  await runClickHouseQuery(clickhouseUrl, "TRUNCATE TABLE query_events");
  await runClickHouseQuery(clickhouseUrl, "TRUNCATE TABLE collector_state");
  await runClickHouseQuery(clickhouseUrl, "TRUNCATE TABLE postgres_logs");
  await runClickHouseQuery(
    clickhouseUrl,
    [
      "INSERT INTO query_events",
      "(",
      "  collected_at, dbid, userid, toplevel, queryid, statement_text, comment_metadata, total_exec_count,",
      "  total_exec_time_ms, rows_returned_or_affected, shared_blks_hit, shared_blks_read, local_blks_hit,",
      "  local_blks_read, temp_blks_read, temp_blks_written, total_block_accesses, min_exec_time_ms,",
      "  max_exec_time_ms, mean_exec_time_ms, stddev_exec_time_ms",
      ") VALUES",
      "  (toDateTime64(now() - INTERVAL 1 MINUTE, 3), 1, 1, true, '101', 'SELECT * FROM todos', map('source_location', '/app/controllers/todos_controller.rb:12'), 5, 450, 10, 80, 20, 0, 0, 0, 0, 100, 70, 120, 90, 10),",
      "  (toDateTime64(now(), 3), 1, 1, true, '101', 'SELECT * FROM todos', map('source_location', '/app/controllers/todos_controller.rb:12'), 7, 700, 15, 120, 30, 0, 0, 0, 0, 150, 80, 140, 110, 12)",
    ].join(" "),
  );
  await runClickHouseQuery(
    clickhouseUrl,
    "INSERT INTO collector_state (collected_at, dealloc, stats_reset) SELECT collected_at, 0, now() - INTERVAL 10 MINUTE FROM query_events WHERE queryid = '101'",
  );
  await runClickHouseQuery(
    clickhouseUrl,
    "INSERT INTO postgres_logs (log_file, byte_offset, log_timestamp, query_id, statement_text, database, session_id, comment_metadata, raw_json) VALUES ('postgresql.json', 1, toDateTime64(now() - INTERVAL 30 SECOND, 3), '101', 'SELECT * FROM todos', 'checkpoint_demo', 'session-live-provider', map('source_location', '/app/controllers/todos_controller.rb:12'), '{\"message\":\"duration: 1.23 ms statement: SELECT * FROM todos\"}')",
  );
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
