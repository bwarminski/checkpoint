// ABOUTME: Repairs the generated code-search runtime wrapper so it matches the emitted declarations.
// ABOUTME: Keeps mcporter codegen usable in this repo until the upstream client wrapper is consistent.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const agentRoot = fileURLToPath(new URL("..", import.meta.url));
const generatedClientPath = fileURLToPath(
  new URL("../src/tools/generated/code-search-client.ts", import.meta.url),
);
const generatedClient = await readFile(generatedClientPath, "utf8");

const patchedClient = generatedClient
  .replace(
    /async read_file\(params: Parameters<CodeSearchTools\['read_file'\]>\[0\]\) \{\n\s+const tool = proxy\.readFile as \(args: Parameters<CodeSearchTools\['read_file'\]>\[0\]\) => Promise<unknown>;\n\s+const raw = await tool\(params\);/m,
    [
      "async read_file(path: Parameters<CodeSearchTools['read_file']>[0], lines?: Parameters<CodeSearchTools['read_file']>[1]) {",
      "      const tool = proxy.readFile as (args: { path: Parameters<CodeSearchTools['read_file']>[0]; lines?: Parameters<CodeSearchTools['read_file']>[1] }) => Promise<unknown>;",
      "      const raw = await tool({ path, lines });",
    ].join("\n"),
  )
  .replace(
    /async search_code\(params: Parameters<CodeSearchTools\['search_code'\]>\[0\]\) \{\n\s+const tool = proxy\.searchCode as \(args: Parameters<CodeSearchTools\['search_code'\]>\[0\]\) => Promise<unknown>;\n\s+const raw = await tool\(params\);/m,
    [
      "async search_code(pattern: Parameters<CodeSearchTools['search_code']>[0], glob?: Parameters<CodeSearchTools['search_code']>[1]) {",
      "      const tool = proxy.searchCode as (args: { pattern: Parameters<CodeSearchTools['search_code']>[0]; glob?: Parameters<CodeSearchTools['search_code']>[1] }) => Promise<unknown>;",
      "      const raw = await tool({ pattern, glob });",
    ].join("\n"),
  );

if (patchedClient === generatedClient) {
  throw new Error(
    `Failed to patch the generated code-search client at ${generatedClientPath}.`,
  );
}

await writeFile(generatedClientPath, patchedClient);
