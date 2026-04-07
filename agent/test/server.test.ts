// ABOUTME: Verifies the exported A2A service surface advertised by the local server.
// ABOUTME: Keeps the agent card aligned with the commands the executor is expected to handle.
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("createServer advertises analyze_db and analyze_table skills", async () => {
  const { createServer } = await loadServerModule();
  const server = createServer({ baseUrl: "http://127.0.0.1:3001" });

  assert.deepEqual(
    server.agentCard.skills.map((skill: { id: string }) => skill.id),
    ["analyze_db", "analyze_table"],
  );
});

test("createServer uses a provider-qualified default LLM model", async () => {
  const { createServer } = await loadServerModule();
  const server = createServer({ baseUrl: "http://127.0.0.1:3001" });

  assert.deepEqual(server.executor.llmConfig.primary, {
    provider: "openai",
    model: "gpt-4o-mini",
  });
});

test("server startup loads repo-root .env without overriding existing shell vars", async () => {
  const repoRoot = resolve(process.cwd(), "..");
  const envPath = resolve(repoRoot, ".env");
  const originalDemoRepo = process.env.DEMO_REPO;
  const originalEnv = await readExistingEnv(envPath);

  await writeFile(envPath, "DEMO_REPO=file/value\nDEMO_BASE_REF=main\n");
  process.env.DEMO_REPO = "shell/value";
  delete process.env.DEMO_BASE_REF;

  try {
    await loadServerModule();

    assert.equal(process.env.DEMO_REPO, "shell/value");
    assert.equal(process.env.DEMO_BASE_REF, "main");
  } finally {
    if (originalDemoRepo === undefined) {
      delete process.env.DEMO_REPO;
    } else {
      process.env.DEMO_REPO = originalDemoRepo;
    }
    delete process.env.DEMO_BASE_REF;
    await restoreEnvFile(envPath, originalEnv);
  }
});

test("startServer validates the runtime schema before listening", async () => {
  const { startServer } = await loadServerModule();
  let validated = false;
  let server: { close: (callback: () => void) => void } | undefined;

  try {
    await assert.rejects(
      async () => {
        server = await startServer({
          host: "127.0.0.1",
          port: 0,
          validateRuntimeSchema: async () => {
            validated = true;
            throw new Error("schema mismatch");
          },
        } as any);
      },
      /schema mismatch/,
    );
  } finally {
    await new Promise<void>((resolve) => {
      if (!server) {
        resolve();
        return;
      }

      server.close(() => resolve());
    });
  }

  assert.equal(validated, true);
});

async function loadServerModule() {
  return import(new URL(`../src/server.ts?${Date.now()}`, import.meta.url).href);
}

async function readExistingEnv(envPath: string): Promise<string | undefined> {
  try {
    return await readFile(envPath, "utf8");
  } catch {
    return undefined;
  }
}

async function restoreEnvFile(envPath: string, content: string | undefined): Promise<void> {
  if (content === undefined) {
    await rm(envPath, { force: true });
    return;
  }

  await writeFile(envPath, content);
}
