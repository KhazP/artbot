import type { z } from "zod";
import type { structuredExtractionSchema } from "./schemas.js";

export type StructuredExtraction = z.infer<typeof structuredExtractionSchema>;
export type StructuredLlmProvider = "gemini" | "openai_compatible";

export interface StructuredExtractionInput {
  content: string;
  model?: string;
}
