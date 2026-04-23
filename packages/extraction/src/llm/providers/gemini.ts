import { ChatGoogle } from "@langchain/google";
import { structuredExtractionSchema } from "../schemas.js";
import { buildStructuredExtractionMessages } from "../prompts.js";
import type { StructuredExtraction, StructuredExtractionInput } from "../types.js";

export async function extractWithLangChainGemini(
  input: StructuredExtractionInput
): Promise<StructuredExtraction | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const model = new ChatGoogle({
    apiKey,
    model: input.model ?? process.env.MODEL_CHEAP_DEFAULT ?? "gemini-3.1-flash-lite",
    temperature: 0,
    maxRetries: 0
  }).withStructuredOutput(structuredExtractionSchema);

  try {
    return structuredExtractionSchema.parse(await model.invoke(buildStructuredExtractionMessages(input.content)));
  } catch {
    return null;
  }
}
