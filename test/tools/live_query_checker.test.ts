// ABOUTME: Covers the shared live query checker helpers used by oh-my-pi runtime adapters.
// ABOUTME: Exercises the shared assistant-text extraction path directly from src/omp_tools.
import assert from "node:assert/strict";
import test from "node:test";

import { extractAssistantText } from "../../src/omp_tools/live_query_checker.ts";

test("extractAssistantText joins text blocks from shared live checker content", () => {
  const result = extractAssistantText([
    { type: "text", text: "first" },
    { type: "tool_use", text: "ignored" },
    { type: "text", text: "second" },
  ]);

  assert.equal(result, "first\nsecond");
});
