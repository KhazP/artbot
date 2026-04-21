import FirecrawlApp from "@mendable/firecrawl-js";
import type { FetchResult } from "./http-fetch.js";

function firecrawlEnabledByEnv(): boolean {
  return process.env.FIRECRAWL_ENABLED?.trim().toLowerCase() === "true";
}

function firecrawlBaseUrlFromEnv(): string | null {
  const value = process.env.FIRECRAWL_BASE_URL?.trim();
  return value && value.length > 0 ? value : null;
}

function positiveIntFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function firecrawlTimeoutMsFromEnv(): number {
  return positiveIntFromEnv(process.env.FIRECRAWL_TIMEOUT_MS, 15_000);
}

function firecrawlMaxRetriesFromEnv(): number {
  return positiveIntFromEnv(process.env.FIRECRAWL_MAX_RETRIES, 2);
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("firecrawl_timeout")), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function firecrawlScrape(url: string): Promise<FetchResult | null> {
  if (!firecrawlEnabledByEnv()) {
    return null;
  }

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return null;
  }

  const app = new FirecrawlApp({
    apiKey,
    ...(firecrawlBaseUrlFromEnv() ? { apiUrl: firecrawlBaseUrlFromEnv() } : {})
  } as ConstructorParameters<typeof FirecrawlApp>[0]);
  const maxRetries = firecrawlMaxRetriesFromEnv();
  const timeoutMs = firecrawlTimeoutMsFromEnv();

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await withTimeout(
        app.scrapeUrl(url, {
          formats: ["markdown", "html"],
          onlyMainContent: false
        }),
        timeoutMs
      );

      const html = (response as { html?: string }).html ?? "";
      const markdown = (response as { markdown?: string }).markdown ?? "";

      return {
        url,
        html,
        markdown,
        status: 200,
        parserUsed: "firecrawl"
      };
    } catch {
      if (attempt >= maxRetries) {
        return null;
      }
    }
  }

  return null;
}
