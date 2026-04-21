import { structuredPriceTypes } from "./schemas.js";

export function buildStructuredExtractionPrompt(content: string): string {
  return [
    "Extract structured price evidence for an art lot/listing.",
    "Return strict JSON only.",
    "Rules:",
    "- Do not invent missing values.",
    "- Keep estimate separate from realized/asking.",
    "- If price is hidden or inquiry-only, set priceHidden=true and priceType=inquiry_only.",
    "",
    `Allowed priceType values: ${structuredPriceTypes.join(", ")}`,
    "",
    "Page content:",
    content.slice(0, 16000)
  ].join("\n");
}
