// ABOUTME: Validates ClickHouse SQL through an injected oh-my-pi subagent adapter.
// ABOUTME: Shares the same prompt contract as the Postgres checker tool.

import { buildCheckerPrompt, type SubagentChecker } from "../shared/subagent_checker.ts";

export function createClickHouseCheckerTool(checker: SubagentChecker) {
  return {
    async execute(input: { dialect: "clickhouse"; question: string; query: string }) {
      return checker.runCheck(buildCheckerPrompt(input));
    },
  };
}
