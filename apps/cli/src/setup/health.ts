import type { ApiHealthResult, LlmHealthResult, SearxngHealthResult } from "./types.js";

export function normalizeLlmBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    return "http://127.0.0.1:1234/v1";
  }

  try {
    const url = new URL(trimmed);
    if (url.pathname === "/" || url.pathname === "") {
      url.pathname = "/v1";
      return url.toString().replace(/\/$/, "");
    }

    return trimmed.replace(/\/$/, "");
  } catch {
    return trimmed.replace(/\/$/, "");
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkLlmHealth(
  baseUrl: string,
  apiKey = "",
  timeoutMs = 1500
): Promise<LlmHealthResult> {
  const normalizedBaseUrl = normalizeLlmBaseUrl(baseUrl);
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetchWithTimeout(`${normalizedBaseUrl}/models`, { headers }, timeoutMs);
    if (!response.ok) {
      return {
        ok: false,
        baseUrl: normalizedBaseUrl,
        statusCode: response.status,
        reason:
          response.status === 404
            ? `HTTP 404. Make sure the base URL points at an OpenAI-compatible endpoint and includes /v1 when required.`
            : `HTTP ${response.status}`
      };
    }

    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    return {
      ok: true,
      baseUrl: normalizedBaseUrl,
      modelId: payload.data?.[0]?.id
    };
  } catch (error) {
      return {
        ok: false,
        baseUrl: normalizedBaseUrl,
        reason:
          error instanceof Error
          ? `${error.message}. Expected an OpenAI-compatible endpoint at ${normalizedBaseUrl}.`
          : String(error)
      };
  }
}

export async function checkApiHealth(apiBaseUrl: string, apiKey = "", timeoutMs = 1500): Promise<ApiHealthResult> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  try {
    const response = await fetchWithTimeout(`${apiBaseUrl.replace(/\/$/, "")}/health`, { headers }, timeoutMs);
    if (!response.ok) {
      return {
        ok: false,
        apiBaseUrl,
        statusCode: response.status,
        reason: `HTTP ${response.status}`
      };
    }

    return { ok: true, apiBaseUrl };
  } catch (error) {
    return {
      ok: false,
      apiBaseUrl,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function checkSearxngHealth(baseUrl: string, timeoutMs = 1500): Promise<SearxngHealthResult> {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  try {
    const endpoint = new URL("/search", `${normalizedBaseUrl}/`);
    endpoint.searchParams.set("q", "artbot health");
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("language", "all");

    const response = await fetchWithTimeout(
      endpoint.toString(),
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; ArtBot/1.0; +https://artbot.local)"
        }
      },
      timeoutMs
    );
    if (!response.ok) {
      return {
        ok: false,
        baseUrl: normalizedBaseUrl,
        statusCode: response.status,
        reason: `HTTP ${response.status}`
      };
    }
    return { ok: true, baseUrl: normalizedBaseUrl };
  } catch (error) {
    return {
      ok: false,
      baseUrl: normalizedBaseUrl,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}
