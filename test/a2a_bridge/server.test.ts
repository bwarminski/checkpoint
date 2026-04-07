// ABOUTME: Verifies the A2A bridge reuses recorded pi sessions per context.
// ABOUTME: Keeps same-context sends serialized so bridge work stays thin and deterministic.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SessionRegistry } from "../../src/a2a_bridge/session_registry.ts";
import { createA2ABridge } from "../../src/a2a_bridge/server.ts";

test("createA2ABridge records new sessions and resumes them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "checkpoint-a2a-bridge-"));
  const registryPath = join(directory, "sessions.json");
  const registry = new SessionRegistry(registryPath);
  const seenSessionPaths: Array<string | undefined> = [];
  const promptInputs: Array<string> = [];
  const times = [
    new Date("2026-04-07T00:00:00.000Z"),
    new Date("2026-04-07T00:01:00.000Z"),
  ];

  try {
    const bridge = createA2ABridge({
      now: () => times.shift() ?? new Date("2026-04-07T00:02:00.000Z"),
      registry,
      createAgentSession: async (sessionPath) => {
        seenSessionPaths.push(sessionPath);
        return {
          sessionPath: sessionPath ?? `/sessions/${seenSessionPaths.length}`,
          prompt: async (text) => {
            promptInputs.push(text);
            return `reply:${text}`;
          },
        };
      },
    });

    assert.equal(await bridge.send("ctx-1", "first"), "reply:first");
    assert.equal(await bridge.send("ctx-1", "second"), "reply:second");

    assert.deepEqual(seenSessionPaths, [undefined, "/sessions/1"]);
    assert.deepEqual(promptInputs, ["first", "second"]);
    assert.deepEqual(await registry.read("ctx-1"), {
      sessionPath: "/sessions/1",
      createdAt: "2026-04-07T00:00:00.000Z",
      lastActiveAt: "2026-04-07T00:01:00.000Z",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("createA2ABridge drops a stale session path and creates a fresh session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "checkpoint-a2a-bridge-"));
  const registryPath = join(directory, "sessions.json");
  const registry = new SessionRegistry(registryPath);
  const seenSessionPaths: Array<string | undefined> = [];
  const promptInputs: Array<string> = [];

  try {
    await registry.record("ctx-1", {
      sessionPath: "/sessions/stale",
      createdAt: "2026-04-07T00:00:00.000Z",
      lastActiveAt: "2026-04-07T00:00:00.000Z",
    });

    const bridge = createA2ABridge({
      now: () => new Date("2026-04-07T00:01:00.000Z"),
      registry,
      createAgentSession: async (sessionPath) => {
        seenSessionPaths.push(sessionPath);

        if (sessionPath === "/sessions/stale") {
          throw new Error("missing session");
        }

        return {
          sessionPath: sessionPath ?? "/sessions/fresh",
          prompt: async (text) => {
            promptInputs.push(text);
            return `reply:${text}`;
          },
        };
      },
    });

    assert.equal(await bridge.send("ctx-1", "hello"), "reply:hello");

    assert.deepEqual(seenSessionPaths, ["/sessions/stale", undefined]);
    assert.deepEqual(promptInputs, ["hello"]);
    assert.deepEqual(await registry.read("ctx-1"), {
      sessionPath: "/sessions/fresh",
      createdAt: "2026-04-07T00:00:00.000Z",
      lastActiveAt: "2026-04-07T00:01:00.000Z",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("createA2ABridge rethrows non-missing resume failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "checkpoint-a2a-bridge-"));
  const registryPath = join(directory, "sessions.json");
  const registry = new SessionRegistry(registryPath);

  try {
    await registry.record("ctx-1", {
      sessionPath: "/sessions/live",
      createdAt: "2026-04-07T00:00:00.000Z",
      lastActiveAt: "2026-04-07T00:00:00.000Z",
    });

    const bridge = createA2ABridge({
      registry,
      createAgentSession: async (sessionPath) => {
        if (sessionPath === "/sessions/live") {
          throw new Error("provider offline");
        }

        return {
          sessionPath: sessionPath ?? "/sessions/fresh",
          prompt: async (text) => `reply:${text}`,
        };
      },
    });

    await assert.rejects(
      () => bridge.send("ctx-1", "hello"),
      /provider offline/,
    );

    assert.deepEqual(await registry.read("ctx-1"), {
      sessionPath: "/sessions/live",
      createdAt: "2026-04-07T00:00:00.000Z",
      lastActiveAt: "2026-04-07T00:00:00.000Z",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("createA2ABridge serializes concurrent sends for one context", async () => {
  const directory = await mkdtemp(join(tmpdir(), "checkpoint-a2a-bridge-"));
  const registryPath = join(directory, "sessions.json");
  const registry = new SessionRegistry(registryPath);
  const seenSessionPaths: Array<string | undefined> = [];
  const promptInputs: Array<string> = [];
  const pendingPrompts: Array<() => void> = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const bridge = createA2ABridge({
    registry,
    createAgentSession: async (sessionPath) => {
      seenSessionPaths.push(sessionPath);
      return {
        sessionPath: sessionPath ?? `/sessions/${seenSessionPaths.length}`,
        prompt: async (text) => {
          promptInputs.push(text);
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise<void>((resolve) => {
            pendingPrompts.push(resolve);
          });
          inFlight -= 1;
          return `reply:${text}`;
        },
      };
    },
  });

  try {
    const first = bridge.send("ctx-1", "first");
    const second = bridge.send("ctx-1", "second");

    await waitFor(() => promptInputs.length === 1);

    assert.deepEqual(seenSessionPaths, [undefined]);
    assert.deepEqual(promptInputs, ["first"]);
    assert.equal(maxInFlight, 1);

    pendingPrompts.shift()?.();
    assert.equal(await first, "reply:first");

    await waitFor(() => promptInputs.length === 2);

    assert.deepEqual(seenSessionPaths, [undefined, "/sessions/1"]);
    assert.deepEqual(promptInputs, ["first", "second"]);
    assert.equal(maxInFlight, 1);

    pendingPrompts.shift()?.();
    assert.equal(await second, "reply:second");
    assert.equal(maxInFlight, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;

  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the bridge to advance.");
    }

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}
