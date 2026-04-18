// ABOUTME: Defines the shared contract for SQL query checker tools.
// ABOUTME: Keeps checker logic injectable so unit tests do not require a live model.

export type QueryCheckVerdict = "safe" | "rewrite" | "reject";

export type QueryCheckResult = {
  verdict: QueryCheckVerdict;
  rewrittenQuery: string;
  notes: Array<string>;
};

export type QueryCheckInput = {
  dialect: "postgres" | "clickhouse";
  question: string;
  query: string;
};

export type QueryChecker = {
  runCheck(input: QueryCheckInput): Promise<QueryCheckResult>;
};
