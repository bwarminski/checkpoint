// ABOUTME: Executes bounded PostgreSQL SQL for exploration through an injected runner.
// ABOUTME: Applies statement_timeout and a row limit before delegating to the caller.
import { resolveQueryLimits } from "../shared/query_limits.ts";
import { formatQueryResult } from "../shared/result_formatter.ts";

export function createPostgresQueryTool(
  runQuery: (sql: string) => Promise<Array<Record<string, unknown>>>,
) {
  return {
    async execute(input: { query: string; rowCap?: number; timeoutMs?: number }) {
      const limits = resolveQueryLimits(input, { maxRows: 200, maxTimeoutMs: 10_000 });
      const query = input.query.trim().replace(/;+$/, "").replace(/\bLIMIT\s+\d+(\s+OFFSET\s+\d+)?\s*$/i, "").trimEnd();
      // statement_timeout is session-level; leaks on pooled connections. Acceptable for single-user local MVP.
      try {
        const rows = await runQuery(
          `set statement_timeout = ${limits.timeoutMs}; ${query} LIMIT ${limits.rowCap}`,
        );
        return formatQueryResult(rows);
      } catch (error) {
        return `Error: ${formatError(error)}`;
      }
    },
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
