// ABOUTME: Executes bounded ClickHouse SQL for exploration through an injected runner.
// ABOUTME: Applies max_execution_time and a row limit before delegating to the caller.
import { resolveQueryLimits } from "../shared/query_limits.ts";

export function createClickHouseQueryTool(
  runQuery: (sql: string) => Promise<Array<Record<string, unknown>>>,
) {
  return {
    async execute(input: { query: string; rowCap?: number; timeoutMs?: number }) {
      const limits = resolveQueryLimits(input, { maxRows: 200, maxTimeoutMs: 10_000 });
      const query = input.query.trim().replace(/;+$/, "");
      return runQuery(
        `${query} LIMIT ${limits.rowCap} SETTINGS max_execution_time = ${Math.ceil(limits.timeoutMs / 1000)}`,
      );
    },
  };
}
