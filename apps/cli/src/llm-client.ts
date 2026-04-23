import { resolveOpenAiCompatibleApiKey, resolveOpenAiCompatibleModel } from "@artbot/shared-types";
import { normalizeLlmBaseUrl } from "./setup/health.js";

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ArtResearchRequest {
  query: string;
}

const SYSTEM_PROMPT = `You are an expert art historian and market analyst specializing in Turkish and international contemporary art.
Given an artist name or artwork title, provide a concise research summary with exactly three sections using markdown headers:

## Artist Profile
A 2-3 paragraph biography covering birth/death dates, nationality, education, artistic movement, and significance.

## Notable Works
A bulleted list of 3-5 important works with approximate dates and medium.

## Market Context
A 1-2 paragraph summary of auction performance, price ranges, and market trends.

Keep the tone professional but accessible. If you are uncertain about specific facts, indicate this clearly.`;

export function resolveLlmConfig(): LlmConfig | null {
  const baseUrl = normalizeLlmBaseUrl(process.env.LLM_BASE_URL?.trim() || "http://127.0.0.1:1234/v1");

  return {
    baseUrl,
    apiKey: resolveOpenAiCompatibleApiKey(process.env),
    model: resolveOpenAiCompatibleModel(process.env, "google/gemma-4-26b-a4b"),
  };
}

export async function* streamArtResearch(
  config: LlmConfig,
  request: ArtResearchRequest,
): AsyncGenerator<string> {
  const endpoint = `${config.baseUrl}/chat/completions`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model,
      stream: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Research: ${request.query}` },
      ],
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`LLM request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const body = response.body;
  if (!body) {
    throw new Error("No response body from LLM");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") return;

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // skip malformed SSE chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function queryArtResearch(
  config: LlmConfig,
  request: ArtResearchRequest,
): Promise<string> {
  const endpoint = `${config.baseUrl}/chat/completions`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model,
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Research: ${request.query}` },
      ],
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`LLM request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return payload.choices?.[0]?.message?.content ?? "";
}
