import { resolveOpenAiCompatibleApiKey, resolveOpenAiCompatibleModel } from "@artbot/shared-types";
import { ChatOpenAI } from "@langchain/openai";
import { structuredExtractionSchema } from "../schemas.js";
import { buildStructuredExtractionMessages } from "../prompts.js";
import type { StructuredExtraction, StructuredExtractionInput } from "../types.js";

export async function extractWithLangChainOpenAiCompatible(
  input: StructuredExtractionInput
): Promise<StructuredExtraction | null> {
  const baseUrl = (process.env.LLM_BASE_URL ?? "").trim();
  if (!baseUrl) {
    return null;
  }

  const model = new ChatOpenAI({
    model: input.model ?? resolveOpenAiCompatibleModel(process.env, "google/gemma-4-26b-a4b"),
    apiKey: resolveOpenAiCompatibleApiKey(process.env),
    temperature: 0,
    maxRetries: 0,
    streamUsage: false,
    configuration: {
      baseURL: baseUrl.replace(/\/$/, "")
    }
  }).withStructuredOutput(structuredExtractionSchema, {
    name: "art_price_extraction",
    strict: true
  });

  try {
    return structuredExtractionSchema.parse(await model.invoke(buildStructuredExtractionMessages(input.content)));
  } catch {
    return null;
  }
}
