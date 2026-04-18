// ABOUTME: Unit tests for the pure utility functions in the oh-my-pi workspace test helper.
// ABOUTME: Covers extractAssistantText and parseQueryCheckResult without requiring a live model.
import assert from "node:assert/strict";
import test from "node:test";

import { extractAssistantText, parseQueryCheckResult } from "./oh_my_pi_workspace.ts";

test("extractAssistantText returns trimmed string content as-is", () => {
  assert.equal(extractAssistantText("  hello world  "), "hello world");
});

test("extractAssistantText joins text blocks from array content", () => {
  const content = [
    { type: "text", text: "first" },
    { type: "tool_use", input: {} },
    { type: "text", text: "second" },
  ];
  assert.equal(extractAssistantText(content), "first\nsecond");
});

test("extractAssistantText returns empty string for array with no text blocks", () => {
  assert.equal(extractAssistantText([{ type: "tool_use" }]), "");
});

test("parseQueryCheckResult parses raw JSON", () => {
  const result = parseQueryCheckResult(
    JSON.stringify({ verdict: "safe", rewrittenQuery: "select 1", notes: ["ok"] }),
  );
  assert.deepEqual(result, { verdict: "safe", rewrittenQuery: "select 1", notes: ["ok"] });
});

test("parseQueryCheckResult strips ```json code fence", () => {
  const result = parseQueryCheckResult(
    '```json\n{"verdict":"rewrite","rewrittenQuery":"select 2","notes":[]}\n```',
  );
  assert.equal(result.verdict, "rewrite");
  assert.equal(result.rewrittenQuery, "select 2");
});

test("parseQueryCheckResult strips plain ``` code fence", () => {
  const result = parseQueryCheckResult(
    '```\n{"verdict":"reject","rewrittenQuery":"","notes":["unsafe"]}\n```',
  );
  assert.equal(result.verdict, "reject");
});

test("parseQueryCheckResult normalizes missing rewrittenQuery to empty string", () => {
  const result = parseQueryCheckResult(
    JSON.stringify({ verdict: "safe", notes: ["ok"] }),
  );
  assert.equal(result.rewrittenQuery, "");
});

test("parseQueryCheckResult normalizes missing notes to empty array", () => {
  const result = parseQueryCheckResult(
    JSON.stringify({ verdict: "safe", rewrittenQuery: "select 1" }),
  );
  assert.deepEqual(result.notes, []);
});

test("parseQueryCheckResult throws on invalid verdict", () => {
  assert.throws(
    () => parseQueryCheckResult(JSON.stringify({ verdict: "unknown" })),
    /invalid verdict/,
  );
});
