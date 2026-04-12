// ABOUTME: Parses the agent's provider-qualified LLM model configuration from env input.
// ABOUTME: Keeps the runtime contract centered on a single provider-qualified LLM_MODEL.
export type QualifiedModelRef = {
  model: string;
  provider: string;
};

export type LlmConfig = {
  primary: QualifiedModelRef;
};

type LlmEnv = {
  LLM_MODEL?: string;
};

export const DEFAULT_LLM_MODEL = "openai/gpt-4o-mini";

export function parseLlmConfig(env: LlmEnv): LlmConfig {
  return {
    primary: parseQualifiedModelRef(env.LLM_MODEL ?? DEFAULT_LLM_MODEL),
  };
}

export function parseQualifiedModelRef(value: string): QualifiedModelRef {
  const [provider, ...modelParts] = value.split("/");
  const model = modelParts.join("/").trim();

  if (!provider?.trim() || !model) {
    throw new Error("LLM_MODEL must use provider/model format");
  }

  return {
    provider: provider.trim(),
    model,
  };
}
