// ABOUTME: Resolves source references through the generated code-search MCP client.
// ABOUTME: Converts container paths into repo-relative file lookups with context lines.
import { fileURLToPath } from "node:url";

type ReadFileResult =
  | string
  | {
      text?: () => string;
    };

type CodeSearchClient = {
  close?: () => Promise<void>;
  read_file(path: string, lines?: number): Promise<ReadFileResult>;
};

type CodeSearchInput = {
  source_file: string;
};

type CodeSearchResult = {
  content: string;
  source_file: string;
};

type CodeSearchToolOptions = {
  clientFactory?: () => Promise<CodeSearchClient>;
  contextLines?: number;
};

export class CodeSearchTool {
  private clientPromise?: Promise<CodeSearchClient>;
  private managedClient?: CodeSearchClient;
  private readonly clientFactory?: () => Promise<CodeSearchClient>;

  constructor(
    private readonly client?: CodeSearchClient,
    private readonly options: CodeSearchToolOptions = {},
  ) {
    this.clientFactory = client ? undefined : (options.clientFactory ?? createGeneratedClient);
  }

  async locate(input: CodeSearchInput): Promise<CodeSearchResult> {
    const sourceFile = toRelativeSourceFile(input.source_file);
    const client = await this.getClient();
    const content = await client.read_file(
      sourceFile,
      this.options.contextLines ?? 3,
    );

    return {
      content: toText(content),
      source_file: sourceFile,
    };
  }

  async close(): Promise<void> {
    const client = this.managedClient ?? (await this.clientPromise?.catch(() => undefined));

    this.managedClient = undefined;
    this.clientPromise = undefined;

    await client?.close?.();
  }

  private async getClient(): Promise<CodeSearchClient> {
    if (this.client) {
      return this.client;
    }

    if (this.managedClient) {
      return this.managedClient;
    }

    if (!this.clientFactory) {
      throw new Error("Code search client is unavailable.");
    }

    if (!this.clientPromise) {
      const clientPromise = this.clientFactory()
        .then((client) => {
          this.managedClient = client;
          return client;
        })
        .catch((error) => {
          if (this.clientPromise === clientPromise) {
            this.clientPromise = undefined;
          }

          throw error;
        });

      this.clientPromise = clientPromise;
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

  if (sourceFile.startsWith("/")) {
    if (!sourceFile.startsWith("/app/")) {
      throw new Error("Absolute source_file paths must stay under /app/.");
    }

    return sourceFile.slice(1);
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
