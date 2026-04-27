// ABOUTME: Verifies the OMP Postgres custom tool definitions exposed to the agent.
// ABOUTME: Covers schema-facing aliases and runtime normalization before checker execution.
import assert from "node:assert/strict";
import test from "node:test";

import { Type, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { createPostgresToolDefinitions } from "../../src/omp_tools/postgres_custom_tools.ts";

test("postgres checker accepts postgresql dialect alias from agent calls", async () => {
  const calls: Array<{ prompt: string }> = [];
  const definitions = createPostgresToolDefinitions(Type, async (input) => {
    calls.push({ prompt: input.prompt });
    return '{"verdict":"safe","rewrittenQuery":"","notes":["ok"]}';
  });
  const checker = definitions.find((definition) => definition.name === "sql_db_checker");
  assert.ok(checker);

  const params = {
    dialect: "postgresql",
    question: "Is this a valid index creation statement?",
    query: "CREATE INDEX index_todos_on_user_id ON todos (user_id);",
  };

  assert.equal(Value.Check(checker.parameters as TSchema, params), true);

  await checker.execute("tool-call-id", params, undefined, undefined, {
    model: { provider: "test" },
    modelRegistry: {
      getApiKey: async () => "test-api-key",
    },
    sessionManager: {
      getSessionId: () => "test-session-id",
    },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /^Dialect: postgres$/m);
});
