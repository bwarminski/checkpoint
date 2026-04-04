// ABOUTME: Checks prior suggestion history before the agent proposes a DB fix again.
// ABOUTME: Applies the CEO-plan status rules for pending, accepted, rejected, and invalid rows.
type MemoryRow = {
  created_at?: string | null;
  status: string;
};

type MemoryDatabase = {
  query(sql: string, params?: unknown[]): Promise<Array<MemoryRow>>;
};

type MemoryToolOptions = {
  invalidRetryAfterDays: number;
  now?: () => Date;
};

const BLOCKING_STATUSES = new Set(["pending", "accepted", "rejected"]);

export class MemoryTool {
  private readonly now: () => Date;

  constructor(
    private readonly db: MemoryDatabase,
    private readonly options: MemoryToolOptions = {
      invalidRetryAfterDays: 7,
    },
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async shouldSuggest(input: { fingerprint: string; fixType: string }): Promise<boolean> {
    const rows = await this.db.query(
      [
        "SELECT status, created_at",
        "FROM suggestions",
        "WHERE fingerprint = $1 AND fix_type = $2",
        "ORDER BY created_at DESC",
      ].join(" "),
      [input.fingerprint, input.fixType],
    );

    if (rows.some((row) => BLOCKING_STATUSES.has(row.status))) {
      return false;
    }

    if (rows.length === 0) {
      return true;
    }

    const invalidRows = rows.filter((row) => row.status === "invalid");
    if (invalidRows.length !== rows.length) {
      return true;
    }

    return invalidRows.every((row) => hasExpired(row.created_at, this.options, this.now));
  }
}

function hasExpired(
  createdAt: string | null | undefined,
  options: MemoryToolOptions,
  now: () => Date,
): boolean {
  if (!createdAt) {
    return false;
  }

  const createdAtTime = new Date(createdAt).getTime();
  if (Number.isNaN(createdAtTime)) {
    return false;
  }

  const retryWindowMs = options.invalidRetryAfterDays * 24 * 60 * 60 * 1000;
  return now().getTime() - createdAtTime > retryWindowMs;
}
