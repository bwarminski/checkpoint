// ABOUTME: Covers the shared live query checker helpers used by oh-my-pi runtime adapters.
// ABOUTME: Exercises prompt building, result parsing, and injected completion wiring.
import assert from "node:assert/strict";
import test from "node:test";

import { createLiveQueryCheckerWithCompletion } from "../../src/omp_tools/live_query_checker.ts";
import { buildQueryCheckPrompt, parseQueryCheckResult } from "../../src/tools/shared/query_checker.ts";

test("buildQueryCheckPrompt includes the expected checker instructions", () => {
  const prompt = buildQueryCheckPrompt({
    dialect: "postgres",
    question: "Is this query safe?",
    query: "select 1",
  });

  assert.match(prompt, /Dialect: postgres/);
  assert.match(prompt, /Question: Is this query safe\?/);
  assert.match(prompt, /SQL:\nselect 1/);
});

test("parseQueryCheckResult parses raw checker JSON", () => {
  const result = parseQueryCheckResult(
    JSON.stringify({ verdict: "safe", rewrittenQuery: "select 1", notes: ["ok"] }),
  );

  assert.deepEqual(result, {
    verdict: "safe",
    rewrittenQuery: "select 1",
    notes: ["ok"],
  });
});

test("createLiveQueryCheckerWithCompletion delegates completion to the injected runtime helper", async () => {
  const calls: Array<{
    apiKey: string;
    modelProvider: string;
    prompt: string;
    sessionId: string;
  }> = [];
  const checker = createLiveQueryCheckerWithCompletion(
    async ({ apiKey, model, prompt, sessionId }) => {
      calls.push({
        apiKey,
        modelProvider: model.provider,
        prompt,
        sessionId,
      });
      return JSON.stringify({ verdict: "safe", rewrittenQuery: "select 1", notes: ["ok"] });
    },
    {
      model: { provider: "openai" },
      modelRegistry: {
        async getApiKey() {
          return "secret-api-key";
        },
      },
      sessionManager: {
        getSessionId() {
          return "session-123";
        },
      },
    },
  );

  const result = await checker.runCheck({
    dialect: "postgres",
    question: "Is this query safe?",
    query: "select 1",
  });

  assert.deepEqual(calls, [
    {
      apiKey: "secret-api-key",
      modelProvider: "openai",
      prompt: buildQueryCheckPrompt({
        dialect: "postgres",
        question: "Is this query safe?",
        query: "select 1",
      }),
      sessionId: "session-123",
    },
  ]);
  assert.deepEqual(result, {
    verdict: "safe",
    rewrittenQuery: "select 1",
    notes: ["ok"],
  });
});
