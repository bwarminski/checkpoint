// ABOUTME: Executes bounded PostgreSQL SQL for exploration through an injected runner.
// ABOUTME: Applies statement_timeout and a row limit before delegating to the caller.
import { resolveQueryLimits } from "../shared/query_limits.ts";

export function createPostgresQueryTool(
  runQuery: (sql: string) => Promise<Array<Record<string, unknown>>>,
) {
  return {
    async execute(input: { query: string; rowCap?: number; timeoutMs?: number }) {
      const limits = resolveQueryLimits(input, { maxRows: 200, maxTimeoutMs: 10_000 });
      const query = input.query.trim().replace(/;+$/, "");
      return runQuery(`set statement_timeout = ${limits.timeoutMs}; ${query} LIMIT ${limits.rowCap}`);
    },
  };
}
