// ABOUTME: Unit tests for the oh-my-pi workspace test helper utilities and generated workspace shape.
// ABOUTME: Covers extractAssistantText, parseQueryCheckResult, and the generated extension-based runtime.
import assert from "node:assert/strict";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  extractAssistantText,
  getWorkspaceRoot,
  parseQueryCheckResult,
  resetWorkspace,
  setupWorkspace,
} from "./oh_my_pi_workspace.ts";

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

test("workspace setup and reset create an extension-based DB specialist runtime", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "checkpoint-oh-my-pi-home-"));
  const workspaceRoot = getWorkspaceRoot(fakeHome);
  const extensionEntry = join(workspaceRoot, ".omp", "extensions", "db-specialist.ts");
  const postgresCheckerShim = join(workspaceRoot, ".omp", "tools", "sql_db_checker", "index.ts");
  const clickHouseQueryShim = join(workspaceRoot, ".omp", "tools", "clickhouse_db_query", "index.ts");

  try {
    await setupWorkspace(fakeHome);

    const extensionStats = await lstat(extensionEntry);
    const extensionModule = await import(pathToFileURL(extensionEntry).href);

    assert.equal(extensionStats.isFile(), true);
    assert.equal(typeof extensionModule.default, "function");
    await assert.rejects(() => lstat(postgresCheckerShim));
    await assert.rejects(() => lstat(clickHouseQueryShim));

    await resetWorkspace(fakeHome);

    assert.equal((await lstat(extensionEntry)).isFile(), true);
    await assert.rejects(() => lstat(postgresCheckerShim));
    await assert.rejects(() => lstat(clickHouseQueryShim));
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
  }
});
