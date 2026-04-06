// ABOUTME: Verifies provider-qualified model config parsing for the agent loop runtime.
// ABOUTME: Keeps the LLM env contract provider-agnostic and rejects ambiguous refs.
import assert from "node:assert/strict";
import test from "node:test";

import { parseLlmConfig } from "../src/llm_config.ts";

test("parseLlmConfig reads provider-qualified model refs", () => {
  const config = parseLlmConfig({
    LLM_MODEL: "ollama/llama3.1:8b",
    LLM_FALLBACK_MODELS: "openai/gpt-4o-mini,anthropic/claude-sonnet-4-20250514",
  });

  assert.equal(config.primary.provider, "ollama");
  assert.equal(config.primary.model, "llama3.1:8b");
  assert.deepEqual(
    config.fallbacks.map((entry) => `${entry.provider}/${entry.model}`),
    ["openai/gpt-4o-mini", "anthropic/claude-sonnet-4-20250514"],
  );
});

test("parseLlmConfig rejects an unqualified model ref", () => {
  assert.throws(
    () => parseLlmConfig({ LLM_MODEL: "claude-sonnet" } as any),
    /provider\/model/i,
  );
});

