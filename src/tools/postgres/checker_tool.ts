// ABOUTME: Validates Postgres SQL through an injected query checker.
// ABOUTME: Returns the checker verdict without embedding runtime-specific wiring here.

import type { QueryChecker } from "../shared/query_checker.ts";

export function createPostgresCheckerTool(checker: QueryChecker) {
  return {
    async execute(input: { dialect: "postgres"; question: string; query: string }) {
      return checker.runCheck(input);
    },
  };
}
