// ABOUTME: Provides extension-owned runtime helpers for the DB specialist tools.
// ABOUTME: Owns model invocation and tool-definition adaptation for the extension boundary.
import { extractAssistantText } from "../tools/shared/query_checker.ts";
import type {
  ExtensionToolDefinition,
  QueryCompletion,
  QueryCompletionInput,
  ToolContext,
  ToolModel,
  SdkToolDefinition,
} from "../omp_tools/runtime.ts";

export type { QueryCompletion, QueryCompletionInput };

// Mirrors @oh-my-pi/pi-ai@14.1.2 completeSimple. Verify on SDK upgrade.
type CompleteSimpleModule = {
  completeSimple(
    model: ToolModel,
    request: {
      systemPrompt: string;
      messages: Array<{
        role: "user";
        content: string;
        timestamp: number;
      }>;
    },
    options: {
      apiKey: string;
      sessionId: string;
      toolChoice: "none";
    },
  ): Promise<{
    content: string | Array<{ type: string; text?: string }>;
  }>;
};

const loadModule = new Function(
  "specifier",
  "return import(specifier);",
) as (specifier: string) => Promise<unknown>;

export function createQueryCheckerCompletion(): QueryCompletion {
  return async ({ model, apiKey, sessionId, prompt }) => {
    const { completeSimple } = await loadModule("@oh-my-pi/pi-ai") as CompleteSimpleModule;
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
  };
}

export function toExtensionToolDefinition(definition: SdkToolDefinition): ExtensionToolDefinition {
  const { execute, ...rest } = definition;
  return {
    ...rest,
    async execute(
      toolCallId: string,
      params: Record<string, unknown>,
      signal?: AbortSignal,
      onUpdate?: unknown,
      ctx?: ToolContext,
    ) {
      return execute(toolCallId, params, signal, onUpdate, ctx as ToolContext);
    },
  };
}
