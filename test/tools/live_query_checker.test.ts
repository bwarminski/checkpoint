// ABOUTME: Covers the shared live query checker helpers used by oh-my-pi runtime adapters.
// ABOUTME: Exercises prompt building, result parsing, and injected completion wiring.
import assert from "node:assert/strict";
import test from "node:test";

import { toExtensionToolDefinition } from "../../src/omp_extension/tool_runtime.ts";
import { createLiveQueryCheckerWithCompletion } from "../../src/omp_tools/live_query_checker.ts";
import {
  CHECKER_SYSTEM_PROMPT,
  buildQueryCheckPrompt,
  parseQueryCheckResult,
} from "../../src/tools/shared/query_checker.ts";

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

test("CHECKER_SYSTEM_PROMPT keeps the JSON response contract in one shared export", () => {
  assert.match(CHECKER_SYSTEM_PROMPT, /JSON only/);
  assert.match(CHECKER_SYSTEM_PROMPT, /safe\|rewrite\|reject/);
  assert.match(CHECKER_SYSTEM_PROMPT, /rewrittenQuery/);
  assert.match(CHECKER_SYSTEM_PROMPT, /notes/);
});

test("createLiveQueryCheckerWithCompletion throws when model is undefined", async () => {
  const checker = createLiveQueryCheckerWithCompletion(async () => "", {
    model: undefined,
    modelRegistry: { async getApiKey() { return "key"; } },
    sessionManager: { getSessionId() { return "session"; } },
  });

  await assert.rejects(
    () => checker.runCheck({ dialect: "postgres", question: "safe?", query: "select 1" }),
    /Checker requires an active model/,
  );
});

test("createLiveQueryCheckerWithCompletion throws when API key cannot be resolved", async () => {
  const checker = createLiveQueryCheckerWithCompletion(async () => "", {
    model: { provider: "anthropic" },
    modelRegistry: { async getApiKey() { return undefined; } },
    sessionManager: { getSessionId() { return "session"; } },
  });

  await assert.rejects(
    () => checker.runCheck({ dialect: "postgres", question: "safe?", query: "select 1" }),
    /could not resolve API key/i,
  );
});

test("toExtensionToolDefinition preserves the tool seam", async () => {
  const tool = toExtensionToolDefinition({
    name: "sql_db_checker",
    label: "Postgres Checker",
    description: "Validate a PostgreSQL query and return a structured verdict.",
    parameters: { kind: "object" },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      assert.deepEqual(params, { query: "select 1" });
      assert.equal(ctx?.model?.provider, "openai");
      return {
        content: [{ type: "text", text: "ok" }],
      };
    },
  });

  assert.equal(tool.name, "sql_db_checker");
  assert.equal(tool.label, "Postgres Checker");
  assert.equal(tool.description, "Validate a PostgreSQL query and return a structured verdict.");

  const result = await tool.execute(
    "call-1",
    { query: "select 1" },
    undefined,
    undefined,
    {
      model: { provider: "openai" },
      modelRegistry: {
        async getApiKey() {
          return undefined;
        },
      },
      sessionManager: {
        getSessionId() {
          return "session-123";
        },
      },
    },
  );

  assert.deepEqual(result, {
    content: [{ type: "text", text: "ok" }],
  });
});
