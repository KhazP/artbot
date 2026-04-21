import { structuredExtractionJsonSchema, type StructuredGeminiExtraction } from "../schemas.js";
import { parseStructuredResponseText, postJsonWithTimeout, structuredLlmTimeoutMs } from "./common.js";

export async function callOpenAiCompatibleStructuredExtraction(input: {
  prompt: string;
  model?: string;
}): Promise<{
  result: StructuredGeminiExtraction | null;
  model: string;
  timedOut: boolean;
  usedSchemaResponseMode: boolean;
}> {
  const baseUrl = (process.env.LLM_BASE_URL ?? "").trim();
  const model = input.model ?? process.env.MODEL_CHEAP_DEFAULT ?? "google/gemma-4-26b-a4b";
  if (!baseUrl) {
    return { result: null, model, timedOut: false, usedSchemaResponseMode: false };
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const apiKey = process.env.LLM_API_KEY?.trim();
  const timeoutMs = structuredLlmTimeoutMs();
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const baseBody = {
    model,
    messages: [
      {
        role: "system",
        content: "You extract structured art price evidence. Return JSON only."
      },
      {
        role: "user",
        content: input.prompt
      }
    ],
    temperature: 0
  };

  try {
    let usedSchemaResponseMode = true;
    let response = await postJsonWithTimeout(
      endpoint,
      headers,
      {
        ...baseBody,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "art_price_extraction",
            schema: structuredExtractionJsonSchema,
            strict: true
          }
        }
      },
      timeoutMs
    );

    if (!response?.ok) {
      usedSchemaResponseMode = false;
      response = await postJsonWithTimeout(endpoint, headers, baseBody, timeoutMs);
      if (!response?.ok) {
        return { result: null, model, timedOut: false, usedSchemaResponseMode };
      }
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; text?: string }>;
        };
      }>;
    };

    const content = payload.choices?.[0]?.message?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
              .join("\n")
          : null;

    if (!text) {
      return { result: null, model, timedOut: false, usedSchemaResponseMode };
    }
    return {
      result: parseStructuredResponseText(text),
      model,
      timedOut: false,
      usedSchemaResponseMode
    };
  } catch (error) {
    return {
      result: null,
      model,
      timedOut: error instanceof Error && error.message.includes("timeout"),
      usedSchemaResponseMode: false
    };
  }
}
