import { z } from "zod";
import type { PriceType } from "@artbot/shared-types";

export const structuredPriceTypes: PriceType[] = [
  "asking_price",
  "estimate",
  "hammer_price",
  "realized_price",
  "realized_with_buyers_premium",
  "inquiry_only",
  "unknown"
];

export const structuredExtractionSchema = z.object({
  priceType: z.enum(structuredPriceTypes),
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

export const structuredExtractionJsonSchema = {
  type: "object",
  properties: {
    priceType: { type: "string", enum: structuredPriceTypes },
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
