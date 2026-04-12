// ABOUTME: Validates ClickHouse SQL through an injected query checker.
// ABOUTME: Shares the same prompt contract as the Postgres checker tool.

import { buildCheckerPrompt, type QueryChecker } from "../shared/query_checker.ts";

export function createClickHouseCheckerTool(checker: QueryChecker) {
  return {
    async execute(input: { dialect: "clickhouse"; question: string; query: string }) {
      return checker.runCheck(buildCheckerPrompt(input));
    },
  };
}
