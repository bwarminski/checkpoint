// ABOUTME: Reads durable memory from markdown files and append-only JSONL events.
// ABOUTME: Searches preferences, constraints, discoveries, and failed attempts across the agent memory root.
import { appendFile, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

type MemoryEntryKind = "preference" | "constraint" | "discovery" | "failed_attempt";
type MemoryEntrySource = "memory_md" | "events_jsonl";

type MemoryEntry = {
  details?: unknown;
  kind: MemoryEntryKind;
  metadata?: {
    path?: string;
    section?: string;
    ts?: string;
  };
  source: MemoryEntrySource;
  summary: string;
};

type MemoryToolOptions = {
  appendFile?: (path: string, data: string) => Promise<void>;
  now?: () => Date;
  rootDir: string;
};

const KIND_BY_SECTION = new Map<string, MemoryEntryKind>([
  ["preferences", "preference"],
  ["constraints", "constraint"],
  ["discoveries", "discovery"],
  ["failed attempts", "failed_attempt"],
]);

export class MemoryTool {
  private readonly appendFileFn: (path: string, data: string) => Promise<void>;
  private readonly now: () => Date;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: MemoryToolOptions) {
    this.appendFileFn = options.appendFile ?? appendFile;
    this.now = options.now ?? (() => new Date());
  }

  async search(query: string): Promise<Array<MemoryEntry>> {
    const markdownEntries = await readMarkdownEntries(this.options.rootDir);
    const eventEntries = await readJsonlEntries(this.options.rootDir);
    const entries = [...markdownEntries, ...eventEntries];

    if (!query.trim()) {
      return entries;
    }

    return entries.filter((entry) => matchesQuery(entry, query));
  }

  async record(input: {
    details?: unknown;
    kind: MemoryEntryKind;
    summary: string;
  }): Promise<void> {
    const line = JSON.stringify({
      ts: this.now().toISOString(),
      ...input,
    });

    const currentWrite = this.writeQueue
      .catch(() => {})
      .then(() => this.appendFileFn(join(this.options.rootDir, "events.jsonl"), `${line}\n`));
    this.writeQueue = currentWrite.catch(() => {});
    await currentWrite;
  }
}

async function readMarkdownEntries(rootDir: string): Promise<Array<MemoryEntry>> {
  const markdownFiles = await collectMarkdownFiles(rootDir);
  const entries: Array<MemoryEntry> = [];

  for (const filePath of markdownFiles) {
    const content = await readFile(filePath, "utf8").catch(() => "");
    const fileEntries = parseMarkdownMemory(rootDir, filePath, content);
    entries.push(...fileEntries);
  }

  return entries;
}

async function collectMarkdownFiles(rootDir: string): Promise<Array<string>> {
  const files: Array<string> = [];
  await walkDirectory(rootDir, files);
  return files.filter((filePath) => filePath.endsWith(".md"));
}

async function walkDirectory(directory: string, files: Array<string>): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw err;
  }

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(path, files);
      continue;
    }

    if (entry.isFile()) {
      files.push(path);
    }
  }
}

function parseMarkdownMemory(
  rootDir: string,
  filePath: string,
  content: string,
): Array<MemoryEntry> {
  const entries: Array<MemoryEntry> = [];
  const lines = content.split(/\r?\n/);
  const path = relative(rootDir, filePath) || filePath;
  let section: string | undefined;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      section = heading[1].trim();
      continue;
    }

    const bullet = line.match(/^\s*-\s+(.+)$/);
    if (!bullet || !section) {
      continue;
    }

    const kind = kindFromSection(section);
    if (!kind) {
      continue;
    }

    const summary = bullet[1].trim();
    if (!summary) {
      continue;
    }

    entries.push({
      kind,
      summary,
      source: "memory_md",
      metadata: {
        path,
        section,
      },
    });
  }

  return entries;
}

function kindFromSection(section: string): MemoryEntryKind | undefined {
  return KIND_BY_SECTION.get(section.trim().toLowerCase());
}

async function readJsonlEntries(rootDir: string): Promise<Array<MemoryEntry>> {
  const eventsPath = join(rootDir, "events.jsonl");
  const content = await readFile(eventsPath, "utf8").catch(() => "");
  const entries: Array<MemoryEntry> = [];

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }

    entries.push(parseJsonlEvent(rootDir, line, eventsPath, index + 1));
  }

  return entries;
}

function parseJsonlEvent(
  rootDir: string,
  line: string,
  eventsPath: string,
  lineNumber: number,
): MemoryEntry {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    throw new Error(`Invalid JSONL in ${relative(rootDir, eventsPath) || "events.jsonl"} at line ${lineNumber}`);
  }

  if (!isMemoryEntryRecord(event)) {
    throw new Error(`Invalid memory event in ${relative(rootDir, eventsPath) || "events.jsonl"} at line ${lineNumber}`);
  }

  const metadata: MemoryEntry["metadata"] = {
    path: relative(rootDir, eventsPath) || "events.jsonl",
  };

  if (typeof event.ts === "string" && event.ts.length > 0) {
    metadata.ts = event.ts;
  }

  return {
    kind: event.kind,
    summary: event.summary,
    details: event.details,
    source: "events_jsonl",
    metadata,
  };
}

function isMemoryEntryKind(kind: string | undefined): kind is MemoryEntryKind {
  return kind === "preference" || kind === "constraint" || kind === "discovery" || kind === "failed_attempt";
}

function isMemoryEntryRecord(value: unknown): value is {
  details?: unknown;
  kind: MemoryEntryKind;
  summary: string;
  ts?: string;
} {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as {
    kind?: string;
    summary?: unknown;
  };

  return isMemoryEntryKind(record.kind) && typeof record.summary === "string";
}

function matchesQuery(entry: MemoryEntry, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  const haystack = [
    entry.kind,
    entry.summary,
    stringifyDetails(entry.details),
    entry.metadata?.path,
    entry.metadata?.section,
    entry.metadata?.ts,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();

  return normalizedQuery
    .split(/\s+/)
    .every((token) => haystack.includes(token));
}

function stringifyDetails(details: unknown): string | undefined {
  if (details === undefined || details === null) {
    return undefined;
  }

  if (typeof details === "string") {
    return details;
  }

  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}
