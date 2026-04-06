// ABOUTME: Parses the agent's provider-qualified LLM model configuration from env input.
// ABOUTME: Keeps the runtime contract centered on LLM_MODEL and optional fallback refs.
export type QualifiedModelRef = {
  model: string;
  provider: string;
};

export type LlmConfig = {
  fallbacks: Array<QualifiedModelRef>;
  primary: QualifiedModelRef;
};

type LlmEnv = {
  LLM_FALLBACK_MODELS?: string;
  LLM_MODEL?: string;
};

export const DEFAULT_LLM_MODEL = "openai/gpt-4o-mini";

export function parseLlmConfig(env: LlmEnv): LlmConfig {
  return {
    primary: parseQualifiedModelRef(env.LLM_MODEL ?? DEFAULT_LLM_MODEL),
    fallbacks: parseFallbackModels(env.LLM_FALLBACK_MODELS),
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

function parseFallbackModels(value?: string): Array<QualifiedModelRef> {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(parseQualifiedModelRef);
}

