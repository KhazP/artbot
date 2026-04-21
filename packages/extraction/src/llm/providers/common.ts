import { structuredExtractionSchema, type StructuredGeminiExtraction } from "../schemas.js";

export function structuredLlmTimeoutMs(): number {
  const parsed = Number(process.env.STRUCTURED_LLM_TIMEOUT_MS ?? 12_000);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 12_000;
  }
  return Math.max(1_000, Math.floor(parsed));
}

export async function postJsonWithTimeout(
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

export function parseStructuredResponseText(text: string): StructuredGeminiExtraction | null {
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
