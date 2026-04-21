export type StructuredLlmProvider = "gemini" | "openai_compatible";

export interface StructuredExtractionInput {
  content: string;
  model?: string;
}

export interface StructuredExtractionMetadata {
  provider: StructuredLlmProvider;
  model: string;
  timedOut: boolean;
  usedSchemaResponseMode: boolean;
}
