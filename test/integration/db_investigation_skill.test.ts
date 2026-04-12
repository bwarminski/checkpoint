// ABOUTME: Verifies the root skill surface exposes the DB investigation skill markdown.
// ABOUTME: Ensures the skill includes the inline ClickHouse catalog and investigation workflow.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

test("db investigation skill includes ClickHouse catalog guidance", async () => {
  const skillFiles = await readdir("skills");
  assert.ok(skillFiles.includes("db-investigation.md"));

  const markdown = await readFile("skills/db-investigation.md", "utf8");

  assert.match(markdown, /^# DB Investigation/m);
  assert.match(markdown, /query_events/);
  assert.match(markdown, /query_intervals/);
  assert.match(markdown, /highest-value issue/);
});
