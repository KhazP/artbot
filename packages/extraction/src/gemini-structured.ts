import { z } from "zod";
import type { PriceType } from "@artbot/shared-types";

const structuredExtractionSchema = z.object({
  priceType: z.enum([
    "asking_price",
    "estimate",
    "hammer_price",
    "realized_price",
    "realized_with_buyers_premium",
    "inquiry_only",
    "unknown"
  ]),
  estimateLow: z.number().nullable(),
  estimateHigh: z.number().nullable(),
  priceAmount: z.number().nullable(),
  currency: z.string().nullable(),
  lotNumber: z.string().nullable(),
  saleDate: z.string().nullable(),
  priceHidden: z.boolean(),
  buyersPremiumIncluded: z.boolean().nullable(),
  rationale: z.string()
});

export type StructuredGeminiExtraction = z.infer<typeof structuredExtractionSchema>;
type StructuredLlmProvider = "gemini" | "openai_compatible";

interface GeminiExtractionInput {
  content: string;
  model?: string;
}

const priceTypes: PriceType[] = [
  "asking_price",
  "estimate",
  "hammer_price",
  "realized_price",
  "realized_with_buyers_premium",
  "inquiry_only",
  "unknown"
];

const jsonSchema = {
  type: "object",
  properties: {
    priceType: { type: "string", enum: priceTypes },
    estimateLow: { type: ["number", "null"] },
    estimateHigh: { type: ["number", "null"] },
    priceAmount: { type: ["number", "null"] },
    currency: { type: ["string", "null"] },
    lotNumber: { type: ["string", "null"] },
    saleDate: { type: ["string", "null"] },
    priceHidden: { type: "boolean" },
    buyersPremiumIncluded: { type: ["boolean", "null"] },
    rationale: { type: "string" }
  },
  required: [
    "priceType",
    "estimateLow",
    "estimateHigh",
    "priceAmount",
    "currency",
    "lotNumber",
    "saleDate",
    "priceHidden",
    "buyersPremiumIncluded",
    "rationale"
  ]
};

function buildPrompt(content: string): string {
  return [
    "Extract structured price evidence for an art lot/listing.",
    "Return strict JSON only.",
    "Rules:",
    "- Do not invent missing values.",
    "- Keep estimate separate from realized/asking.",
    "- If price is hidden or inquiry-only, set priceHidden=true and priceType=inquiry_only.",
    "",
    `Allowed priceType values: ${priceTypes.join(", ")}`,
    "",
    "Page content:",
    content.slice(0, 16000)
  ].join("\n");
}

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

  // auto/default routing: prefer Gemini when key exists; otherwise use local OpenAI-compatible endpoint if configured.
  if (process.env.GEMINI_API_KEY) {
    return "gemini";
  }
  if (process.env.LLM_BASE_URL) {
    return "openai_compatible";
  }
  return null;
}

function parseResponseText(text: string): StructuredGeminiExtraction | null {
  const trimmed = text.trim();
  const directCandidates = [trimmed];
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    directCandidates.push(fenced[1].trim());
  }

  for (const candidate of directCandidates) {
    try {
      return structuredExtractionSchema.parse(JSON.parse(candidate) as unknown);
    } catch {
      // continue
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      const sliced = trimmed.slice(firstBrace, lastBrace + 1);
      return structuredExtractionSchema.parse(JSON.parse(sliced) as unknown);
    } catch {
      return null;
    }
  }

  return null;
}

function structuredLlmTimeoutMs(): number {
  const parsed = Number(process.env.STRUCTURED_LLM_TIMEOUT_MS ?? 12_000);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 12_000;
  }
  return Math.max(1_000, Math.floor(parsed));
}

async function postJsonWithTimeout(
  endpoint: string,
  headers: Record<string, string>,
  payload: unknown,
  timeoutMs: number
): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(endpoint, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify(payload)
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini(input: GeminiExtractionInput): Promise<StructuredGeminiExtraction | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = input.model ?? process.env.MODEL_CHEAP_DEFAULT ?? "gemini-3.1-flash-lite";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const prompt = buildPrompt(input.content);
  const timeoutMs = structuredLlmTimeoutMs();

  try {
    const response = await postJsonWithTimeout(
      endpoint,
      {
        "content-type": "application/json"
      },
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: jsonSchema
        }
      },
      timeoutMs
    );

    if (!response?.ok) {
      return null;
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
      return null;
    }
    return parseResponseText(text);
  } catch {
    return null;
  }
}

async function callOpenAiCompatible(input: GeminiExtractionInput): Promise<StructuredGeminiExtraction | null> {
  const baseUrl = (process.env.LLM_BASE_URL ?? "").trim();
  if (!baseUrl) {
    return null;
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const model = input.model ?? process.env.MODEL_CHEAP_DEFAULT ?? "google/gemma-4-26b-a4b";
  const apiKey = process.env.LLM_API_KEY?.trim();
  const prompt = buildPrompt(input.content);
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
        content: prompt
      }
    ],
    temperature: 0
  };

  try {
    let response = await postJsonWithTimeout(
      endpoint,
      headers,
      {
        ...baseBody,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "art_price_extraction",
            schema: jsonSchema,
            strict: true
          }
        }
      },
      timeoutMs
    );

    if (!response?.ok) {
      response = await postJsonWithTimeout(endpoint, headers, baseBody, timeoutMs);
      if (!response?.ok) {
        return null;
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
      return null;
    }
    return parseResponseText(text);
  } catch {
    return null;
  }
}

export async function extractWithGeminiSchema(
  input: GeminiExtractionInput
): Promise<StructuredGeminiExtraction | null> {
  const provider = resolveProvider();
  if (!provider) {
    return null;
  }

  if (provider === "gemini") {
    return callGemini(input);
  }
  return callOpenAiCompatible(input);
}
