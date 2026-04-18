// ABOUTME: Provides extension-owned runtime helpers for the DB specialist tools.
// ABOUTME: Owns model invocation and tool-definition adaptation for the extension boundary.
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { extractAssistantText } from "../tools/shared/query_checker.ts";
import type { ToolContext, ToolModel, SdkToolDefinition } from "../omp_tools/runtime.ts";

export type QueryCompletionInput = {
  model: ToolModel;
  apiKey: string;
  sessionId: string;
  prompt: string;
};

export type QueryCompletion = (input: QueryCompletionInput) => Promise<string>;

export function createQueryCheckerCompletion(): QueryCompletion {
  return async ({ model, apiKey, sessionId, prompt }) => {
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
  };
}

export function toExtensionToolDefinition(definition: SdkToolDefinition): ToolDefinition {
  return {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: definition.parameters as ToolDefinition["parameters"],
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return definition.execute(toolCallId, params, signal, onUpdate, ctx as ToolContext);
    },
  };
}
