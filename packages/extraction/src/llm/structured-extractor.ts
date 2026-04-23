import type { StructuredExtraction, StructuredExtractionInput, StructuredLlmProvider } from "./types.js";
import { extractWithLangChainGemini } from "./providers/gemini.js";
import { extractWithLangChainOpenAiCompatible } from "./providers/openai-compatible.js";

function resolveProvider(): StructuredLlmProvider | null {
  const configured = process.env.STRUCTURED_LLM_PROVIDER?.trim().toLowerCase();
  if (configured === "gemini") {
    return "gemini";
  }
  if (
    configured === "openai_compatible" ||
    configured === "openai-compatible" ||
    configured === "lmstudio" ||
    configured === "lm_studio"
  ) {
    return "openai_compatible";
  }

  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    return "gemini";
  }
  if (process.env.LLM_BASE_URL) {
    return "openai_compatible";
  }
  return null;
}

export async function extractWithLangChainStructuredOutput(
  input: StructuredExtractionInput
): Promise<StructuredExtraction | null> {
  const provider = resolveProvider();
  if (!provider) {
    return null;
  }

  if (provider === "gemini") {
    return extractWithLangChainGemini(input);
  }

  return extractWithLangChainOpenAiCompatible(input);
}
