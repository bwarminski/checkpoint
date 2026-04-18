// ABOUTME: Builds the live SQL checker used by oh-my-pi SDK sessions and discovered custom tools.
// ABOUTME: Shares the same model prompt and JSON parsing contract across runtime entrypoints.
import type { QueryCheckInput, QueryCheckResult } from "../tools/shared/query_checker.ts";
import type { ToolContext } from "./runtime.ts";

export type LiveCheckerContext = ToolContext;

export function createLiveQueryChecker(ctx: LiveCheckerContext): {
  runCheck(input: QueryCheckInput): Promise<QueryCheckResult>;
} {
  return {
    async runCheck(input: QueryCheckInput) {
      const model = ctx.model;
      if (!model) {
        throw new Error("Checker requires an active model");
      }

      const apiKey = await ctx.modelRegistry.getApiKey(model, ctx.sessionManager.getSessionId());
      if (!apiKey) {
        throw new Error(`Checker could not resolve API key for provider: ${model.provider}`);
      }

      const aiModuleName = "@oh-my-pi/pi-ai";
      const { completeSimple } = await import(aiModuleName);
      const result = await completeSimple(
        model,
        {
          systemPrompt:
            'You validate SQL queries. Reply with JSON only in the form {"verdict":"safe|rewrite|reject","rewrittenQuery":"...","notes":["..."]}.',
          messages: [{
            role: "user",
            content: buildCheckerPrompt(input),
            timestamp: Date.now(),
          }],
        },
        {
          apiKey,
          sessionId: ctx.sessionManager.getSessionId(),
          toolChoice: "none",
        },
      );

      return parseQueryCheckResult(extractAssistantText(result.content));
    },
  };
}

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

function buildCheckerPrompt(input: QueryCheckInput): string {
  return [
    `Dialect: ${input.dialect}`,
    `Question: ${input.question}`,
    "Review the SQL for correctness and safety.",
    `SQL:\n${input.query}`,
    'Respond with JSON: {"verdict":"safe|rewrite|reject","rewrittenQuery":"...","notes":["..."]}',
  ].join("\n\n");
}
