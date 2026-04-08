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

export async function extractWithGeminiSchema(
  input: GeminiExtractionInput
): Promise<StructuredGeminiExtraction | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = input.model ?? process.env.MODEL_CHEAP_DEFAULT ?? "gemini-3.1-flash-lite";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = [
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
    input.content.slice(0, 16000)
  ].join("\n");

  const schema = {
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

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: schema
        }
      })
    });

    if (!response.ok) {
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

    const parsedJson = JSON.parse(text) as unknown;
    return structuredExtractionSchema.parse(parsedJson);
  } catch {
    return null;
  }
}

