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

test("SessionRegistry preserves concurrent records for different contexts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "checkpoint-a2a-registry-"));
  const registryPath = join(directory, "sessions.json");
  const registry = new SessionRegistry(registryPath);
  const originalSave = registry["save" as keyof SessionRegistry] as unknown as (
    records: Record<string, { createdAt: string; lastActiveAt: string; sessionPath: string }>,
  ) => Promise<void>;
  const saveCalls: Array<Array<string>> = [];
  const gate = createDeferred<void>();

  (registry as unknown as { save: typeof originalSave }).save = async function (
    this: SessionRegistry,
    records: Record<string, { createdAt: string; lastActiveAt: string; sessionPath: string }>,
  ) {
    saveCalls.push(Object.keys(records).sort());
    await gate.promise;
    return originalSave.call(this, records);
  };

  try {
    const first = registry.record("ctx-1", {
      sessionPath: "/sessions/one",
      createdAt: "2026-04-07T00:00:00.000Z",
      lastActiveAt: "2026-04-07T00:00:00.000Z",
    });
    const second = registry.record("ctx-2", {
      sessionPath: "/sessions/two",
      createdAt: "2026-04-07T00:01:00.000Z",
      lastActiveAt: "2026-04-07T00:01:00.000Z",
    });

    await waitFor(() => saveCalls.length === 1);
    gate.resolve();

    await Promise.all([first, second]);
    assert.deepEqual(await registry.read("ctx-1"), {
      sessionPath: "/sessions/one",
      createdAt: "2026-04-07T00:00:00.000Z",
      lastActiveAt: "2026-04-07T00:00:00.000Z",
    });
    assert.deepEqual(await registry.read("ctx-2"), {
      sessionPath: "/sessions/two",
      createdAt: "2026-04-07T00:01:00.000Z",
      lastActiveAt: "2026-04-07T00:01:00.000Z",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;

  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the registry to advance.");
    }

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}
