// ABOUTME: Defines the shared contract for SQL checker tools backed by oh-my-pi subagents.
// ABOUTME: Keeps checker logic injectable so unit tests do not require a live model.

export type CheckerVerdict = "safe" | "rewrite" | "reject";

export type CheckerResult = {
  verdict: CheckerVerdict;
  rewrittenQuery: string;
  notes: Array<string>;
};

export type SubagentChecker = {
  runCheck(prompt: string): Promise<CheckerResult>;
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
