// ABOUTME: Resolves source references through a local filesystem-backed code search client.
// ABOUTME: Converts container paths into repo-relative file lookups with context lines.
import { mkdir, readFile, readdir } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";

import { defaultDemoAppRoot } from "./demo_repo_tool.ts";

type ReadFileResult =
  | string
  | {
      text?: () => string;
    };

type CodeSearchClient = {
  close?: () => Promise<void>;
  read_file(path: string, lines?: number): Promise<ReadFileResult>;
  search_code?(pattern: string, glob?: string): Promise<ReadFileResult>;
};

type CodeSearchInput = {
  source_file?: string | null;
  source_tag?: string | null;
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
    this.clientFactory = client ? undefined : (options.clientFactory ?? createLocalClient);
  }

  async locate(input: CodeSearchInput): Promise<CodeSearchResult> {
    const client = await this.getClient();
    const sourceFile = await toRelativeSourceFile(input, client);
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

type SearchMatch = {
  line?: number;
  path?: string;
};

async function createLocalClient(): Promise<CodeSearchClient> {
  const root = resolveCodeSearchRoot();

  return {
    async close() {
      return;
    },
    async read_file(path: string, lines?: number): Promise<ReadFileResult> {
      const { filePath, lineNumber } = splitSourcePath(path);
      const absolutePath = resolveWithinRoot(root, filePath);
      const content = await readFile(absolutePath, "utf8");

      if (!lineNumber) {
        return content;
      }

      return formatContextLines(content, lineNumber, lines ?? 3);
    },
    async search_code(pattern: string, glob?: string): Promise<ReadFileResult> {
      const searchRoot = resolve(root, deriveSearchDirectory(glob));
      const matches = await findMatches(searchRoot, pattern);
      return JSON.stringify(matches);
    },
  };
}

function resolveCodeSearchRoot(): string {
  return process.env.CODE_SEARCH_ROOT ?? process.env.DEMO_APP_ROOT ?? defaultDemoAppRoot();
}

async function toRelativeSourceFile(
  input: CodeSearchInput,
  client: CodeSearchClient,
): Promise<string> {
  if (input.source_file) {
    return normalizeSourceFile(input.source_file);
  }

  if (input.source_tag) {
    return deriveSourceFileFromTag(input.source_tag, client);
  }

  throw new Error("source_file is required");
}

function normalizeSourceFile(sourceFile: string): string {
  if (sourceFile.startsWith("/")) {
    if (!sourceFile.startsWith("/app/")) {
      throw new Error("Absolute source_file paths must stay under /app/.");
    }

    return sourceFile.slice(1);
  }

  return sourceFile.replace(/^\.?\//, "");
}

function splitSourcePath(sourcePath: string): { filePath: string; lineNumber?: number } {
  const match = sourcePath.match(/^(.*?):(\d+)$/);

  if (!match) {
    return { filePath: sourcePath };
  }

  return {
    filePath: match[1] ?? sourcePath,
    lineNumber: Number(match[2]),
  };
}

function resolveWithinRoot(root: string, filePath: string): string {
  const relativePath = filePath.replace(/^\/+/, "");
  const absolutePath = resolve(root, relativePath);

  if (!absolutePath.startsWith(root + sep)) {
    throw new Error(`Code search path escapes the root: ${filePath}`);
  }

  return absolutePath;
}

function formatContextLines(content: string, lineNumber: number, contextLines: number): string {
  const lines = content.split(/\r?\n/);
  const start = Math.max(1, lineNumber - contextLines);
  const end = Math.min(lines.length, lineNumber + contextLines);

  return lines
    .slice(start - 1, end)
    .map((line, index) => `${start + index}: ${line}`)
    .join("\n");
}

function deriveSearchDirectory(glob?: string): string {
  if (!glob) {
    return ".";
  }

  const prefix = glob.split("/**", 1)[0];
  return prefix && prefix.length > 0 ? prefix : ".";
}

async function findMatches(root: string, pattern: string): Promise<Array<SearchMatch>> {
  const matches: Array<SearchMatch> = [];

  async function walk(relativeDir: string): Promise<void> {
    const absoluteDir = resolve(root, relativeDir);
    const entries = await readdir(absoluteDir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = relativeDir === "." ? entry.name : `${relativeDir}/${entry.name}`;
      const absolutePath = resolve(root, relativePath);

      if (entry.isDirectory()) {
        await walk(relativePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!basename(entry.name).endsWith("_controller.rb")) {
        continue;
      }

      const content = await readFile(absolutePath, "utf8");
      content.split(/\r?\n/).forEach((line, index) => {
        if (line.includes(pattern)) {
          matches.push({
            line: index + 1,
            path: relativePath,
          });
        }
      });
    }
  }

  await mkdir(root, { recursive: true });
  await walk(".");
  return matches;
}

async function deriveSourceFileFromTag(
  sourceTag: string,
  client: CodeSearchClient,
): Promise<string> {
  const [controller, action] = sourceTag.split("#", 2).map((part) => part?.trim());

  if (!controller) {
    throw new Error("source_tag could not be resolved to a controller file.");
  }

  if (action && client.search_code) {
    const result = await client.search_code(
      `def ${action}`,
      "app/controllers/**/*_controller.rb",
    );
    const matches = toSearchMatches(result);
    const matchingPath = `app/controllers/${controller}_controller.rb`;
    const match = matches.find((entry) => entry.path === matchingPath && typeof entry.line === "number");

    if (match?.line) {
      return `${matchingPath}:${match.line}`;
    }
  }

  return `app/controllers/${controller}_controller.rb:1`;
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

function toSearchMatches(result: ReadFileResult): Array<SearchMatch> {
  const text = toText(result);
  const parsed = JSON.parse(text) as Array<SearchMatch>;
  return Array.isArray(parsed) ? parsed : [];
}
