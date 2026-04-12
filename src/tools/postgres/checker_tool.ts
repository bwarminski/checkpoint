// ABOUTME: Validates Postgres SQL through an injected oh-my-pi subagent adapter.
// ABOUTME: Returns the adapter verdict without embedding runtime-specific wiring here.

import { buildCheckerPrompt, type SubagentChecker } from "../shared/subagent_checker.ts";

export function createPostgresCheckerTool(checker: SubagentChecker) {
  return {
    async execute(input: { dialect: "postgres"; question: string; query: string }) {
      return checker.runCheck(buildCheckerPrompt(input));
    },
  };
}
