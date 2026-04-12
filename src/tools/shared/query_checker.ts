// ABOUTME: Defines the shared contract for SQL query checker tools.
// ABOUTME: Keeps checker logic injectable so unit tests do not require a live model.

export type QueryCheckVerdict = "safe" | "rewrite" | "reject";

export type QueryCheckResult = {
  verdict: QueryCheckVerdict;
  rewrittenQuery: string;
  notes: Array<string>;
};

export type QueryChecker = {
  runCheck(prompt: string): Promise<QueryCheckResult>;
};

export function buildCheckerPrompt(input: {
  dialect: "postgres" | "clickhouse";
  question: string;
  query: string;
}): string {
  return [
    `Dialect: ${input.dialect}`,
    `Question: ${input.question}`,
    "Review the SQL for correctness and safety.",
    `SQL:\n${input.query}`,
    'Respond with JSON: {"verdict":"safe|rewrite|reject","rewrittenQuery":"...","notes":["..."]}',
  ].join("\n\n");
}
