// ABOUTME: Stores A2A context-to-pi-session mappings in a JSON file.
// ABOUTME: Keeps the registry small so bridge restarts can resume sessions.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type SessionRecord = {
  createdAt: string;
  lastActiveAt: string;
  sessionPath: string;
};

type SessionRecords = Record<string, SessionRecord>;

export class SessionRegistry {
  constructor(private readonly path: string) {}

  async read(contextId: string): Promise<SessionRecord | undefined> {
    const records = await this.load();
    return records[contextId];
  }

  async record(contextId: string, value: SessionRecord): Promise<void> {
    const records = await this.load();
    records[contextId] = value;
    await this.save(records);
  }

  private async load(): Promise<SessionRecords> {
    try {
      const contents = await readFile(this.path, "utf8");
      if (contents.trim().length === 0) {
        return {};
      }

      return JSON.parse(contents) as SessionRecords;
    } catch (error) {
      if (isMissingFile(error)) {
        return {};
      }

      throw error;
    }
  }

  private async save(records: SessionRecords): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(records, null, 2));
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
