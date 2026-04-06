// ABOUTME: Exercises the hybrid markdown-plus-JSONL memory surface.
// ABOUTME: Verifies durable memory search, append-only recording, and runtime wiring.
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";

import { createRuntimeDependencies } from "../src/runtime_dependencies.ts";
import { MemoryTool } from "../src/tools/memory_tool.ts";

test("MemoryTool returns merged markdown and JSONL memory search results", async () => {
  const root = await mkdtemp(join(tmpdir(), "memory-tool-"));

  try {
    await writeFile(
      join(root, "MEMORY.md"),
      [
        "# Agent Memory",
        "",
        "## Preferences",
        "- Brett prefers provider-agnostic model configuration.",
        "",
        "## Constraints",
        "- Do not preserve backward compatibility without explicit approval.",
      ].join("\n"),
    );
    await writeFile(
      join(root, "events.jsonl"),
      [
        JSON.stringify({
          ts: "2026-04-05T00:00:00.000Z",
          kind: "discovery",
          summary: "Keep provider selection open for local and hosted models.",
          details: { provider: "local" },
        }),
        "",
      ].join("\n"),
    );

    const tool = new MemoryTool({ rootDir: root });
    const results = await tool.search("provider");

    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((entry) => entry.source).sort(),
      ["events_jsonl", "memory_md"],
    );

    const markdownEntry = results.find((entry) => entry.source === "memory_md");
    assert.ok(markdownEntry);
    assert.equal(markdownEntry?.kind, "preference");
    assert.equal(markdownEntry?.summary, "Brett prefers provider-agnostic model configuration.");
    assert.equal(markdownEntry?.metadata?.path, "MEMORY.md");

    const eventEntry = results.find((entry) => entry.source === "events_jsonl");
    assert.ok(eventEntry);
    assert.equal(eventEntry?.kind, "discovery");
    assert.equal(eventEntry?.summary, "Keep provider selection open for local and hosted models.");
    assert.equal(eventEntry?.metadata?.path, "events.jsonl");
    assert.equal(eventEntry?.metadata?.ts, "2026-04-05T00:00:00.000Z");
    assert.deepEqual(eventEntry?.details, { provider: "local" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("MemoryTool appends records to events.jsonl", async () => {
  const root = await mkdtemp(join(tmpdir(), "memory-tool-"));

  try {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "MEMORY.md"), "# Agent Memory\n");
    await writeFile(join(root, "events.jsonl"), "");

    const tool = new MemoryTool({ rootDir: root });
    await tool.record({
      kind: "failed_attempt",
      summary: "Adding an index did not improve the query plan.",
      details: { fingerprint: "fp-1" },
    });

    const events = await readFile(join(root, "events.jsonl"), "utf8");
    const lines = events.trim().split("\n");

    assert.equal(lines.length, 1);
    const event = JSON.parse(lines[0]);
    assert.equal(event.kind, "failed_attempt");
    assert.equal(event.summary, "Adding an index did not improve the query plan.");
    assert.deepEqual(event.details, { fingerprint: "fp-1" });
    assert.equal(typeof event.ts, "string");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("runtime dependencies point MemoryTool at agent/memory", () => {
  const deps = createRuntimeDependencies();

  assert.match(deps.memoryToolRoot, /\/agent\/memory$/);
});
