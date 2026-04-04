// ABOUTME: Verifies the mcporter config and build scripts for the code-search client.
// ABOUTME: Prevents the generated client wiring from drifting out of the build flow.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const agentRoot = new URL("..", import.meta.url);

test("agent package scripts generate the typed code-search client before builds", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("./package.json", agentRoot), "utf8"),
  ) as {
    scripts?: Record<string, string>;
  };
  const generateScript = packageJson.scripts?.["generate:code-search"];

  assert.ok(generateScript);
  assert.match(generateScript, /\bmcporter\b|\bbunx\b|\bbun\b/);
  assert.match(generateScript, /\bemit-ts\b/);
  assert.match(generateScript, /\bcode-search\b/);
  assert.match(generateScript, /--config\s+\.mcporter\.json/);
  assert.match(
    generateScript,
    /--out\s+src\/tools\/generated\/code-search-client\.ts/,
  );
  assert.equal(packageJson.scripts?.pretypecheck, "npm run generate:code-search");
  assert.equal(packageJson.scripts?.prebuild, "npm run generate:code-search");
  assert.equal(typeof packageJson.scripts?.typecheck, "string");
  assert.equal(typeof packageJson.scripts?.build, "string");
});

test("agent mcporter config and gitignore include the code-search client paths", async () => {
  const configJson = JSON.parse(
    await readFile(new URL("./.mcporter.json", agentRoot), "utf8"),
  ) as {
    mcpServers?: Record<string, unknown>;
  };
  const gitignore = await readFile(join(agentRoot.pathname, ".gitignore"), "utf8");

  assert.ok(configJson.mcpServers?.["code-search"]);
  assert.match(gitignore, /^src\/tools\/generated\/$/m);
});

test("generated code-search client keeps path and pattern as the leading parameters", async () => {
  const declarations = await readFile(
    new URL("./src/tools/generated/code-search-client.d.ts", agentRoot),
    "utf8",
  );

  assert.match(declarations, /read_file\(path: string, lines\?: number\): Promise<CallResult>;/);
  assert.match(declarations, /search_code\(pattern: string, glob\?: string\): Promise<CallResult>;/);
});
