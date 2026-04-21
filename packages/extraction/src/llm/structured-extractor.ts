import { StringOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";
import { buildStructuredExtractionPrompt } from "./prompts.js";
import { type StructuredGeminiExtraction } from "./schemas.js";
import type { StructuredExtractionInput, StructuredExtractionMetadata, StructuredLlmProvider } from "./types.js";
import { callGeminiStructuredExtraction } from "./providers/gemini.js";
import { callOpenAiCompatibleStructuredExtraction } from "./providers/openai-compatible.js";
import { parseStructuredResponseText } from "./providers/common.js";

const passThroughPrompt = PromptTemplate.fromTemplate("{prompt}");

export function resolveStructuredProvider(): StructuredLlmProvider | null {
  const configured = process.env.STRUCTURED_LLM_PROVIDER?.trim().toLowerCase();
  if (configured === "gemini") {
    return "gemini";
  }
  if (
    configured === "openai_compatible"
    || configured === "openai-compatible"
    || configured === "lmstudio"
    || configured === "lm_studio"
  ) {
    return "openai_compatible";
  }

  if (process.env.GEMINI_API_KEY) {
    return "gemini";
  }
  if (process.env.LLM_BASE_URL) {
    return "openai_compatible";
  }
  return null;
}

export async function extractStructuredWithLangChain(
  input: StructuredExtractionInput
): Promise<{ result: StructuredGeminiExtraction | null; metadata: StructuredExtractionMetadata | null }> {
  const provider = resolveStructuredProvider();
  if (!provider) {
    return { result: null, metadata: null };
  }

  const prompt = buildStructuredExtractionPrompt(input.content);
  const llmRunner = new RunnableLambda({
    func: async (formattedPrompt: string): Promise<string> => {
      if (provider === "gemini") {
        const response = await callGeminiStructuredExtraction({
          prompt: formattedPrompt,
          model: input.model
        });
        return JSON.stringify(response.result ?? {});
      }

      const response = await callOpenAiCompatibleStructuredExtraction({
        prompt: formattedPrompt,
        model: input.model
      });
      return JSON.stringify(response.result ?? {});
    }
  });

  const chain = RunnableSequence.from([passThroughPrompt, llmRunner, new StringOutputParser()]);
  const text = await chain.invoke({ prompt });
  const result = parseStructuredResponseText(text);

  if (provider === "gemini") {
    const model = input.model ?? process.env.MODEL_CHEAP_DEFAULT ?? "gemini-3.1-flash-lite";
    return {
      result,
      metadata: {
        provider,
        model,
        timedOut: false,
        usedSchemaResponseMode: true
      }
    };
  }

  const model = input.model ?? process.env.MODEL_CHEAP_DEFAULT ?? "google/gemma-4-26b-a4b";
  return {
    result,
    metadata: {
      provider,
      model,
      timedOut: false,
      usedSchemaResponseMode: true
    }
  };
}
