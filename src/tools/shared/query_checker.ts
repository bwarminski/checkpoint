// ABOUTME: Defines the shared contract for SQL query checker tools.
// ABOUTME: Keeps checker prompt construction and result parsing reusable across runtimes.

export const CHECKER_RESPONSE_FORMAT =
  '{"verdict":"safe|rewrite|reject","rewrittenQuery":"...","notes":["..."]}';

export const CHECKER_SYSTEM_PROMPT =
  `You validate SQL queries. Reply with JSON only in the form ${CHECKER_RESPONSE_FORMAT}.`;

export function buildQueryCheckPrompt(input: QueryCheckInput): string {
  return [
    `Dialect: ${input.dialect}`,
    `Question: ${input.question}`,
    "Review the SQL for correctness and safety.",
    `SQL:\n${input.query}`,
    `Respond with JSON: ${CHECKER_RESPONSE_FORMAT}`,
  ].join("\n\n");
}

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

export function parseQueryCheckResult(output: string): QueryCheckResult {
  const trimmed = output.trim();
  const jsonText = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  const parsed = JSON.parse(jsonText) as Partial<QueryCheckResult>;
  if (
    parsed.verdict !== "safe" &&
    parsed.verdict !== "rewrite" &&
    parsed.verdict !== "reject"
  ) {
    throw new Error(`Checker returned an invalid verdict: ${output}`);
  }

  return {
    verdict: parsed.verdict,
    rewrittenQuery: typeof parsed.rewrittenQuery === "string" ? parsed.rewrittenQuery : "",
    notes: Array.isArray(parsed.notes) ? parsed.notes.map((note) => String(note)) : [],
  };
}

export function extractAssistantText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") {
    return content.trim();
  }

  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
}
