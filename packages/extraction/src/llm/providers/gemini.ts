import { structuredExtractionJsonSchema, type StructuredGeminiExtraction } from "../schemas.js";
import { postJsonWithTimeout, structuredLlmTimeoutMs, parseStructuredResponseText } from "./common.js";

export async function callGeminiStructuredExtraction(input: {
  prompt: string;
  model?: string;
}): Promise<{ result: StructuredGeminiExtraction | null; model: string; timedOut: boolean }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      result: null,
      model: input.model ?? process.env.MODEL_CHEAP_DEFAULT ?? "gemini-3.1-flash-lite",
      timedOut: false
    };
  }

  const model = input.model ?? process.env.MODEL_CHEAP_DEFAULT ?? "gemini-3.1-flash-lite";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const timeoutMs = structuredLlmTimeoutMs();

  try {
    const response = await postJsonWithTimeout(
      endpoint,
      {
        "content-type": "application/json"
      },
      {
        contents: [{ parts: [{ text: input.prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: structuredExtractionJsonSchema
        }
      },
      timeoutMs
    );

    if (!response?.ok) {
      return { result: null, model, timedOut: false };
    }

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return { result: null, model, timedOut: false };
    }
    return { result: parseStructuredResponseText(text), model, timedOut: false };
  } catch (error) {
    return {
      result: null,
      model,
      timedOut: error instanceof Error && error.message.includes("timeout")
    };
  }
}
