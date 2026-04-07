// ABOUTME: Exercises the standalone pi package through a built container image.
// ABOUTME: Verifies the db-specialist extension is visible in pi print output.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const dockerfilePath = join(repoRoot, "Dockerfile");
const imageTag = "checkpoint-db-specialist:test";

test("standalone pi session loads the db-specialist extension", async () => {
  const provider = await startTestProvider();
  const configDir = await mkdtemp(join(tmpdir(), "checkpoint-pi-config-"));

  try {
    await writeModelsJson(configDir, provider.baseUrl);

    const result = await runPi(
      [
        "--provider",
        "standalone-pi-test",
        "--model",
        "standalone-pi-test-model",
        "--no-session",
        "-p",
        "List the available DB specialist tools.",
      ],
      configDir,
    );

    assert.match(result.stdout, /query_findings/);
    assert.match(result.stdout, /open_pull_request/);
  } finally {
    await rm(configDir, { recursive: true, force: true });
    await provider.close();
  }
});

async function runPi(args: Array<string>, configDir: string): Promise<{ stdout: string }> {
  const buildContext = await mkdtemp(join(tmpdir(), "checkpoint-pi-"));

  try {
    await copyBuildContext(buildContext);
    await execFileAsync(
      "docker",
      ["build", "-t", imageTag, "-f", dockerfilePath, buildContext],
      {
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    const result = await execFileAsync(
      "docker",
      [
        "run",
        "--rm",
        "--add-host",
        "host.docker.internal:host-gateway",
        "-e",
        "PI_CODING_AGENT_DIR=/pi-config",
        "-v",
        `${configDir}:/pi-config`,
        imageTag,
        "-e",
        "./extensions/db-specialist.ts",
        ...args,
      ],
      {
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    return {
      stdout: result.stdout,
    };
  } finally {
    await rm(buildContext, { recursive: true, force: true });
  }
}

async function copyBuildContext(targetDir: string): Promise<void> {
  await cp(join(repoRoot, "package.json"), join(targetDir, "package.json"));
  await cp(join(repoRoot, "tsconfig.json"), join(targetDir, "tsconfig.json"));
  await cp(join(repoRoot, "README.md"), join(targetDir, "README.md"));
  await cp(join(repoRoot, "extensions"), join(targetDir, "extensions"), { recursive: true });
  await cp(join(repoRoot, "skills"), join(targetDir, "skills"), { recursive: true });
  await cp(join(repoRoot, "src"), join(targetDir, "src"), { recursive: true });
}

async function writeModelsJson(configDir: string, baseUrl: string): Promise<void> {
  await writeFile(
    join(configDir, "models.json"),
    JSON.stringify(
      {
        providers: {
          "standalone-pi-test": {
            api: "openai-completions",
            apiKey: "test-key",
            baseUrl,
            models: [
              {
                id: "standalone-pi-test-model",
                name: "Standalone Pi Test Model",
                reasoning: false,
                input: ["text"],
                cost: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                contextWindow: 8192,
                maxTokens: 1024,
              },
            ],
          },
        },
      },
      null,
      2,
    ),
  );
}

async function startTestProvider(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }

    const body = await readJsonBody(req);
    const toolNames = extractToolNames(body);
    const output = toolNames.join("\n");
    const chunkId = "chatcmpl-test";

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      connection: "keep-alive",
      "cache-control": "no-cache",
    });

    res.write(
      `data: ${JSON.stringify({
        id: chunkId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "standalone-pi-test-model",
        choices: [
          {
            index: 0,
            delta: { content: output },
            finish_reason: null,
          },
        ],
      })}\n\n`,
    );

    res.write(
      `data: ${JSON.stringify({
        id: chunkId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "standalone-pi-test-model",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
          },
        ],
      })}\n\n`,
    );

    res.end("data: [DONE]\n\n");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test provider server did not bind to a TCP port.");
  }

  return {
    baseUrl: `http://host.docker.internal:${address.port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

async function readJsonBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Array<Buffer> = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(text) as unknown;
}

function extractToolNames(body: unknown): Array<string> {
  if (!body || typeof body !== "object") {
    return [];
  }

  const request = body as {
    tools?: Array<{ function?: { name?: string }; name?: string }>;
  };

  if (!Array.isArray(request.tools)) {
    return [];
  }

  return request.tools
    .map((tool) => tool.function?.name ?? tool.name ?? "")
    .filter((name): name is string => name.length > 0);
}
