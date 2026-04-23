export function buildStructuredExtractionMessages(content: string) {
  return [
    {
      role: "system" as const,
      content: [
        "You extract structured price evidence for art lots and listings.",
        "Return only schema-conforming structured output.",
        "Do not invent missing values.",
        "Keep estimate separate from realized/asking.",
        "If the page is inquiry-only or hidden-price, set priceHidden=true and priceType=inquiry_only."
      ].join("\n")
    },
    {
      role: "user" as const,
      content: `Extract price evidence from this page content:\n\n${content.slice(0, 16000)}`
    }
  ];
}
