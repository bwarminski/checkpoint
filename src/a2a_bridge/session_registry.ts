// ABOUTME: Stores A2A context-to-pi-session mappings in a JSON file.
// ABOUTME: Keeps the registry small so bridge restarts can resume sessions.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export type SessionRecord = {
  createdAt: string;
  lastActiveAt: string;
  sessionPath: string;
};

type SessionRecords = Record<string, SessionRecord>;

export class SessionRegistry {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async read(contextId: string): Promise<SessionRecord | undefined> {
    await this.writeQueue;
    const records = await this.load();
    return records[contextId];
  }

  async record(contextId: string, value: SessionRecord): Promise<void> {
    await this.runExclusive(async () => {
      const records = await this.load();
      records[contextId] = value;
      await this.save(records);
    });
  }

  async remove(contextId: string): Promise<void> {
    await this.runExclusive(async () => {
      const records = await this.load();
      delete records[contextId];
      await this.save(records);
    });
  }

  private async load(): Promise<SessionRecords> {
    try {
      const contents = await readFile(this.path, "utf8");
      if (contents.trim().length === 0) {
        return {};
      }

      return JSON.parse(contents) as SessionRecords;
    } catch (error) {
      if (isMissingFile(error) || error instanceof SyntaxError) {
        return {};
      }

      throw error;
    }
  }

  private async save(records: SessionRecords): Promise<void> {
    const directory = dirname(this.path);
    const temporaryPath = join(directory, `.${basename(this.path)}.tmp`);

    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, JSON.stringify(records, null, 2));
    await rename(temporaryPath, this.path);
  }

  private async runExclusive(work: () => Promise<void>): Promise<void> {
    const previous = this.writeQueue;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.writeQueue = previous.then(() => current);
    await previous;

    try {
      await work();
    } finally {
      release();
    }
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
