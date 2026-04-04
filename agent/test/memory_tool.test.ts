// ABOUTME: Exercises the memory schema and re-suggestion rules for DB fix history.
// ABOUTME: Locks the pending, accepted, rejected, and invalid semantics to the CEO plan.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MemoryTool } from "../src/tools/memory_tool.ts";

test("MemoryTool blocks pending, accepted, and rejected suggestions", async () => {
  const statuses = ["pending", "accepted", "rejected"] as const;

  for (const status of statuses) {
    const tool = new MemoryTool(
      {
        query: async () => [{ status }],
      },
      {
        invalidRetryAfterDays: 7,
        now: () => new Date("2026-04-04T00:00:00Z"),
      },
    );

    const result = await tool.shouldSuggest({
      fingerprint: "abc",
      fixType: "add_index",
    });

    assert.equal(result, false, `${status} should block re-suggestion`);
  }
});

test("MemoryTool allows retry only after an invalid suggestion ages out", async () => {
  const recentInvalid = new MemoryTool(
    {
      query: async () => [{ created_at: "2026-04-02T00:00:00Z", status: "invalid" }],
    },
    {
      invalidRetryAfterDays: 7,
      now: () => new Date("2026-04-04T00:00:00Z"),
    },
  );
  const staleInvalid = new MemoryTool(
    {
      query: async () => [{ created_at: "2026-03-20T00:00:00Z", status: "invalid" }],
    },
    {
      invalidRetryAfterDays: 7,
      now: () => new Date("2026-04-04T00:00:00Z"),
    },
  );

  assert.equal(
    await recentInvalid.shouldSuggest({ fingerprint: "abc", fixType: "add_index" }),
    false,
  );
  assert.equal(
    await staleInvalid.shouldSuggest({ fingerprint: "abc", fixType: "add_index" }),
    true,
  );
});

test("memory schema declares findings, suggestions, and pattern_log", async () => {
  const sql = await readFile(new URL("../db/001_memory_schema.sql", import.meta.url), "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS findings/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS suggestions/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS pattern_log/i);
  assert.match(sql, /status\s+TEXT\s+NOT NULL DEFAULT 'pending'/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS .*suggestions .*fingerprint, fix_type, status/i);
});
