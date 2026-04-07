// ABOUTME: Verifies A2A context mappings are persisted in the session registry.
// ABOUTME: Keeps the registry focused on simple file-backed JSON storage.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SessionRegistry } from "../../src/a2a_bridge/session_registry.ts";

test("SessionRegistry persists context mappings across instances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "checkpoint-a2a-registry-"));
  const registryPath = join(directory, "sessions.json");

  try {
    const registry = new SessionRegistry(registryPath);

    await registry.record("ctx-1", {
      sessionPath: "/sessions/one",
      createdAt: "2026-04-07T00:00:00.000Z",
      lastActiveAt: "2026-04-07T00:00:00.000Z",
    });
    await registry.record("ctx-2", {
      sessionPath: "/sessions/two",
      createdAt: "2026-04-07T00:01:00.000Z",
      lastActiveAt: "2026-04-07T00:01:00.000Z",
    });

    const reloaded = new SessionRegistry(registryPath);

    assert.deepEqual(await reloaded.read("ctx-1"), {
      sessionPath: "/sessions/one",
      createdAt: "2026-04-07T00:00:00.000Z",
      lastActiveAt: "2026-04-07T00:00:00.000Z",
    });
    assert.deepEqual(await reloaded.read("ctx-2"), {
      sessionPath: "/sessions/two",
      createdAt: "2026-04-07T00:01:00.000Z",
      lastActiveAt: "2026-04-07T00:01:00.000Z",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
