// ABOUTME: Provides the demo code-search operations over the mounted Rails app tree.
// ABOUTME: Keeps file reads and recursive text search scoped to CODE_SEARCH_ROOT.
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

export type SearchMatch = {
  line: number;
  path: string;
  preview: string;
};

type ReadFileInput = {
  lines?: number;
  path: string;
};

type SearchCodeInput = {
  glob?: string;
  pattern: string;
};

type PathReference = {
  line?: number;
  relativePath: string;
};

export function createCodeSearchService(root: string) {
  const resolvedRoot = resolve(root);

  return {
    async readFile(input: ReadFileInput): Promise<string> {
      const reference = parsePathReference(input.path);
      const absolutePath = resolveWithinRoot(resolvedRoot, reference.relativePath);
      const content = await readFile(absolutePath, "utf8");

      if (!reference.line) {
        return content;
      }

      const fileLines = content.split(/\r?\n/);
      const contextLines = input.lines ?? 3;
      const startLine = Math.max(1, reference.line - contextLines);
      const endLine = Math.min(fileLines.length, reference.line + contextLines);

      return fileLines
        .slice(startLine - 1, endLine)
        .map((line, index) => `${startLine + index}: ${line}`)
        .join("\n");
    },

    async searchCode(input: SearchCodeInput): Promise<Array<SearchMatch>> {
      const matcher = createGlobMatcher(input.glob);
      const matches: Array<SearchMatch> = [];

      for (const absolutePath of await collectFiles(resolvedRoot)) {
        const relativePath = relative(resolvedRoot, absolutePath).replaceAll("\\", "/");
        if (!matcher(relativePath)) {
          continue;
        }

        const content = await readFile(absolutePath, "utf8");
        const fileMatches = content
          .split(/\r?\n/)
          .flatMap((line, index) =>
            line.includes(input.pattern)
              ? [{ line: index + 1, path: relativePath, preview: line }]
              : [],
          );

        matches.push(...fileMatches);
      }

      return matches;
    },
  };
}

export function getCodeSearchRoot(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const root = env.CODE_SEARCH_ROOT;

  if (!root) {
    throw new Error("CODE_SEARCH_ROOT is required for the code-search MCP server.");
  }

  return root;
}

function parsePathReference(pathReference: string): PathReference {
  const match = pathReference.match(/^(.*?)(?::(\d+))?$/);
  if (!match || !match[1]) {
    throw new Error(`Invalid file reference: ${pathReference}`);
  }

  const line = match[2] ? Number(match[2]) : undefined;
  if (line === 0) {
    throw new Error(`Line numbers must be >= 1: ${pathReference}`);
  }

  return {
    line,
    relativePath: normalizeRelativePath(match[1]),
  };
}

function normalizeRelativePath(path: string): string {
  const normalizedPath = path.replaceAll("\\", "/").replace(/^\/+/, "");

  if (!normalizedPath || normalizedPath.split("/").includes("..")) {
    throw new Error(`Path escapes the code-search root: ${path}`);
  }

  return normalizedPath;
}

function resolveWithinRoot(root: string, relativePath: string): string {
  const absolutePath = resolve(root, relativePath);
  const normalizedRoot = `${root}/`;

  if (absolutePath !== root && !absolutePath.startsWith(normalizedRoot)) {
    throw new Error(`Path escapes the code-search root: ${relativePath}`);
  }

  return absolutePath;
}

async function collectFiles(root: string): Promise<Array<string>> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: Array<string> = [];

  for (const entry of entries) {
    const absolutePath = resolve(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolutePath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files.sort();
}

function createGlobMatcher(glob: string | undefined): (path: string) => boolean {
  if (!glob) {
    return () => true;
  }

  const pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**/", "___DOUBLE_STAR_DIRECTORY___")
    .replaceAll("**", "___DOUBLE_STAR___")
    .replaceAll("*", "[^/]*")
    .replaceAll("___DOUBLE_STAR_DIRECTORY___", "(?:.*/)?")
    .replaceAll("___DOUBLE_STAR___", ".*");
  const regex = new RegExp(`^${pattern}$`);

  return (path: string) => regex.test(path);
}
