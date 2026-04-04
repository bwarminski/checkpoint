// ABOUTME: Runs the demo code-search MCP server over stdio for mcporter code generation.
// ABOUTME: Exposes read_file and search_code against the mounted Rails app directory.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import { createCodeSearchService, getCodeSearchRoot } from "./service.ts";

const server = new McpServer({
  name: "code-search",
  version: "0.0.0",
});
const service = createCodeSearchService(getCodeSearchRoot());

server.registerTool(
  "read_file",
  {
    description: "Read a source file from the mounted Rails app, with optional line context.",
    inputSchema: {
      path: z.string().describe("Relative path inside the mounted app, optionally with :line."),
      lines: z.number().int().nonnegative().optional(),
    },
  },
  async ({ lines, path }) => {
    const content = await service.readFile({ lines, path });

    return {
      content: [{ type: "text", text: content }],
      structuredContent: {
        content,
      },
    };
  },
);

server.registerTool(
  "search_code",
  {
    description: "Search source files under the mounted Rails app for a literal string.",
    inputSchema: {
      pattern: z.string(),
      glob: z.string().optional(),
    },
  },
  async ({ glob, pattern }) => {
    const matches = await service.searchCode({ glob, pattern });

    return {
      content: [{ type: "text", text: JSON.stringify(matches, null, 2) }],
      structuredContent: {
        matches,
      },
    };
  },
);

const transport = new StdioServerTransport();

server.connect(transport).catch((error) => {
  console.error("Code search MCP server failed:", error);
  process.exit(1);
});
