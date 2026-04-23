export const DEFAULT_OPENAI_COMPATIBLE_API_KEY = "lm-studio";

export type StagehandMode = "DISABLED" | "LOCAL" | "BROWSERBASE";

export function resolveOpenAiCompatibleApiKey(
  env: NodeJS.ProcessEnv = process.env,
  fallback = DEFAULT_OPENAI_COMPATIBLE_API_KEY
): string {
  const value = env.LLM_API_KEY?.trim();
  return value && value.length > 0 ? value : fallback;
}

export function resolveOpenAiCompatibleModel(
  env: NodeJS.ProcessEnv = process.env,
  fallback: string
): string {
  const llmModel = env.LLM_MODEL?.trim();
  if (llmModel) {
    return llmModel;
  }

  const legacyModel = env.MODEL_CHEAP_DEFAULT?.trim();
  if (legacyModel) {
    return legacyModel;
  }

  return fallback;
}

export function normalizeStagehandMode(value: string | null | undefined): StagehandMode {
  switch (value?.trim().toUpperCase()) {
    case "LOCAL":
      return "LOCAL";
    case "BROWSERBASE":
      return "BROWSERBASE";
    default:
      return "DISABLED";
  }
}
