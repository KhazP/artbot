import FirecrawlApp from "@mendable/firecrawl-js";
import type { FetchResult } from "./http-fetch.js";
import type { SourceAccessStatus } from "@artbot/shared-types";

function firecrawlEnabledByEnv(): boolean {
  return process.env.FIRECRAWL_ENABLED?.trim().toLowerCase() === "true";
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function getFirecrawlConfig() {
  return {
    apiKey: process.env.FIRECRAWL_API_KEY?.trim() ?? "",
    apiUrl: process.env.FIRECRAWL_BASE_URL?.trim() || undefined,
    timeoutMs: parsePositiveInteger(process.env.FIRECRAWL_TIMEOUT_MS, 15_000),
    maxRetries: parsePositiveInteger(process.env.FIRECRAWL_MAX_RETRIES, 1),
    allowedSourceFamilies: new Set(
      (process.env.FIRECRAWL_SOURCE_FAMILIES ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    )
  };
}

export interface FirecrawlFetchOptions {
  sourceFamily?: string | null;
  sourceAccessStatus?: SourceAccessStatus;
}

async function withTimeout<T>(timeoutMs: number, task: () => Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Firecrawl timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timeout.unref?.();
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function firecrawlAllowed(options: FirecrawlFetchOptions | undefined): boolean {
  if (!options?.sourceAccessStatus || options.sourceAccessStatus !== "public_access") {
    return false;
  }

  const { allowedSourceFamilies } = getFirecrawlConfig();
  if (allowedSourceFamilies.size === 0) {
    return true;
  }

  const family = options.sourceFamily?.trim().toLowerCase();
  return Boolean(family && allowedSourceFamilies.has(family));
}

export async function firecrawlScrape(url: string, options?: FirecrawlFetchOptions): Promise<FetchResult | null> {
  if (!firecrawlEnabledByEnv()) {
    return null;
  }
  if (!firecrawlAllowed(options)) {
    return null;
  }

  const { apiKey, apiUrl, timeoutMs, maxRetries } = getFirecrawlConfig();
  if (!apiKey) {
    return null;
  }

  const app = new FirecrawlApp({
    apiKey,
    ...(apiUrl ? ({ apiUrl } as { apiUrl: string }) : {})
  });

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await withTimeout(timeoutMs, () =>
        app.scrapeUrl(url, {
          formats: ["markdown", "html"],
          onlyMainContent: false
        })
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
      if (attempt === maxRetries) {
        return null;
      }
    }
  }

  return null;
}
