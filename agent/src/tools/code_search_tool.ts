// ABOUTME: Resolves source references through the generated code-search MCP client.
// ABOUTME: Converts container paths into repo-relative file lookups with context lines.
import { fileURLToPath } from "node:url";

type ReadFileResult =
  | string
  | {
      text?: () => string;
    };

type CodeSearchClient = {
  read_file(input: { path: string; lines?: number }): Promise<ReadFileResult>;
};

type CodeSearchInput = {
  source_file: string;
};

type CodeSearchResult = {
  content: string;
  source_file: string;
};

type CodeSearchToolOptions = {
  contextLines?: number;
};

export class CodeSearchTool {
  private readonly clientPromise?: Promise<CodeSearchClient>;

  constructor(
    private readonly client?: CodeSearchClient,
    private readonly options: CodeSearchToolOptions = {},
  ) {
    if (!client) {
      this.clientPromise = createGeneratedClient();
    }
  }

  async locate(input: CodeSearchInput): Promise<CodeSearchResult> {
    const sourceFile = toRelativeSourceFile(input.source_file);
    const client = await this.getClient();
    const content = await client.read_file({
      lines: this.options.contextLines ?? 3,
      path: sourceFile,
    });

    return {
      content: toText(content),
      source_file: sourceFile,
    };
  }

  private async getClient(): Promise<CodeSearchClient> {
    if (this.client) {
      return this.client;
    }

    if (!this.clientPromise) {
      throw new Error("Code search client is unavailable.");
    }

    return this.clientPromise;
  }
}

async function createGeneratedClient(): Promise<CodeSearchClient> {
  const generatedModulePath = `./generated/${"code-search-client"}.ts`;
  const module = (await import(generatedModulePath)) as {
    createCodeSearchClient: (input: { configPath: string }) => Promise<CodeSearchClient>;
  };

  return module.createCodeSearchClient({
    configPath: fileURLToPath(new URL("../../.mcporter.json", import.meta.url)),
  });
}

function toRelativeSourceFile(sourceFile: string): string {
  if (!sourceFile) {
    throw new Error("source_file is required");
  }

  if (sourceFile.startsWith("/app/")) {
    return sourceFile.slice("/app/".length);
  }

  return sourceFile.replace(/^\.?\//, "");
}

function toText(result: ReadFileResult): string {
  if (typeof result === "string") {
    return result;
  }

  if (typeof result.text === "function") {
    return result.text();
  }

  throw new Error("Code search client returned an unreadable file response.");
}
