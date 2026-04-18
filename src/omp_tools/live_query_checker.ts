// ABOUTME: Builds the live SQL checker used by oh-my-pi SDK sessions and discovered custom tools.
// ABOUTME: Keeps shared checker logic separate from the runtime-specific model invocation path.
import type { QueryCheckInput, QueryCheckResult } from "../tools/shared/query_checker.ts";
import {
  buildQueryCheckPrompt,
  extractAssistantText,
  parseQueryCheckResult,
} from "../tools/shared/query_checker.ts";
import type { QueryCompletion } from "../omp_extension/tool_runtime.ts";
import type { ToolContext } from "./runtime.ts";

export type LiveCheckerContext = ToolContext;

export function createLiveQueryChecker(ctx: LiveCheckerContext): {
  runCheck(input: QueryCheckInput): Promise<QueryCheckResult>;
} {
  return createLiveQueryCheckerWithCompletion(
    async ({ model, apiKey, sessionId, prompt }) => {
      const { completeSimple } = await import("@oh-my-pi/pi-ai");
      const result = await completeSimple(
        model,
        {
          systemPrompt:
            'You validate SQL queries. Reply with JSON only in the form {"verdict":"safe|rewrite|reject","rewrittenQuery":"...","notes":["..."]}.',
          messages: [{
            role: "user",
            content: prompt,
            timestamp: Date.now(),
          }],
        },
        {
          apiKey,
          sessionId,
          toolChoice: "none",
        },
      );

      return extractAssistantText(result.content);
    },
    ctx,
  );
}

export function createLiveQueryCheckerWithCompletion(
  runCompletion: QueryCompletion,
  ctx: LiveCheckerContext,
): {
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

      return parseQueryCheckResult(
        await runCompletion({
          model,
          apiKey,
          sessionId: ctx.sessionManager.getSessionId(),
          prompt: buildQueryCheckPrompt(input),
        }),
      );
    },
  };
}

export { extractAssistantText, parseQueryCheckResult } from "../tools/shared/query_checker.ts";
